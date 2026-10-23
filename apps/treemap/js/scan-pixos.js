// Measuring a folder on PixOS's own filesystem, reached as `parent.fs` (BrowserFS).
//
// **One transaction per folder, not one per file.** Asked through `fs.stat`, BrowserFS's IndexedDB
// backend finds a file by its path: past a cache of 100 paths, it reads the parent folder's whole
// listing and parses it again, for every file. A file in a folder of 3 000 costs a parse of 3 000
// names, so the folder costs the square of that: 4 s for one folder of 3 000 files. Where the
// folder lives in that backend, `readKeyValueFolder` reads its listing once and asks for every
// entry's inode by its id in the same transaction; a folder's inode is handed down to its own
// walk, so no path is ever looked up again. That reaches past the `fs` API into BrowserFS's
// key-value filesystem (`findINode`, `getDirListing`, `getINode`, `store`) — what mount-manager.js
// already does with `_getFs` — and anything else, a zip or a folder on the disk mounted, or a
// BrowserFS that has changed, is read through `readdir` and `stat` as before.
//
// **More than one request in flight.** The first version awaited each `stat` before asking for
// the next: the walk spent most of its time waiting for a round trip with nothing else queued.
// Here every folder read goes through one pool: `FOLDERS_IN_FLIGHT` folders read directly, or
// `IN_FLIGHT` calls to `readdir` and `stat`. Both were measured in tests/browser/treemap.mjs
// (2026-10-23). Read directly, 4, 16 and 64 folders in flight were within 10% of each other and 1
// took half as long again. Through `stat`, 1 took 2.3 times as long as 8, 128 took 1.8 times, and
// 32 was 10% slower than 8 over many small folders and 5% faster over one large one.
//
// **One entry that cannot be read is skipped and counted**, rather than ending the whole scan the
// way one rejected `stat` used to.
//
// **A mount below the folder measured is left out and named.** Measuring `/` — which is what the
// Storage widget opens — means "what fills this browser's storage", and a folder on the local disk
// or a cloud storage mounted under `/mnt` is neither in that storage nor cheap to walk. Measuring
// the mount point itself still measures the mount.

import { folder, addFolder, addFile, finish } from './tree.js';

export const IN_FLIGHT = 8;
export const FOLDERS_IN_FLIGHT = 4;
const PROGRESS_EVERY_MS = 100;

export function getPixosFs(host = globalThis.parent) {
  try {
    if (host && host !== globalThis && host.fs && typeof host.fs.readdir === 'function') {
      return host.fs;
    }
  } catch {
    // a parent from another origin
  }
  return null;
}

export function listMountPoints(host = globalThis.parent) {
  try {
    const list = host?.mountManager?.listMounts?.() || [];
    return list.map((mount) => mount.mountPoint).filter(Boolean);
  } catch {
    return [];
  }
}

export function normalizePath(input) {
  const parts = String(input || '').trim().split('/').filter((part) => part && part !== '.');
  return '/' + parts.join('/');
}

export function joinPath(dir, name) {
  return dir === '/' ? '/' + name : dir + '/' + name;
}

// The mount points strictly inside `path`.
export function mountsBelow(path, mounts) {
  const prefix = path === '/' ? '/' : path + '/';
  return mounts.filter((point) => point !== path && point.startsWith(prefix)).sort();
}

// fn() -> promise, run with at most `limit` running at once, first come first served.
export function makePool(limit) {
  const queue = [];
  let head = 0;
  let running = 0;
  function next() {
    while (running < limit && head < queue.length) {
      const job = queue[head];
      queue[head++] = undefined;
      running++;
      job().finally(() => {
        running--;
        next();
      });
    }
    if (head === queue.length) {
      queue.length = 0;
      head = 0;
    }
  }
  return (fn) => new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject));
    next();
  });
}

function call(fs, method, path) {
  return new Promise((resolve, reject) => {
    fs[method](path, (err, value) => (err ? reject(err) : resolve(value)));
  });
}

// BrowserFS's key-value backend holding `path`, and the path inside it, or null for any other.
export function keyValueBackend(fs, path) {
  try {
    const located = fs.getRootFS?.()?._getFs?.(path);
    let backend = located?.fs;
    if (typeof backend?.getFSUnlocked === 'function') backend = backend.getFSUnlocked();
    if (typeof backend?.store?.beginTransaction === 'function' && typeof backend.findINode === 'function'
      && typeof backend.getDirListing === 'function' && typeof backend.getINode === 'function') {
      return { backend, path: normalizePath(located.path) };
    }
  } catch {
    // not the BrowserFS this was written against
  }
  return null;
}

// A folder's entries, each with its inode or the error that stood for it. Every request is made
// from inside the callback before it: an IndexedDB transaction closes once nothing is asked of it,
// and awaiting anything in between would let it.
export function readKeyValueFolder(backend, path, inode) {
  return new Promise((resolve, reject) => {
    const tx = backend.store.beginTransaction('readonly');
    const list = (dir) => backend.getDirListing(tx, path, dir, (err, listing) => {
      if (err) return reject(err);
      const names = Object.keys(listing);
      const entries = new Array(names.length);
      let left = names.length;
      if (!left) return resolve(entries);
      names.forEach((name, i) => {
        backend.getINode(tx, path, listing[name], (error, stats) => {
          entries[i] = error ? { name, error } : { name, stats };
          if (--left === 0) resolve(entries);
        });
      });
    });
    if (inode) list(inode);
    else backend.findINode(tx, path, (err, found) => (err ? reject(err) : list(found)));
  });
}

// Resolves with {root, unreadable, mounts} — root null if the scan was stopped, mounts the ones the
// walk came to and left out — or rejects when the folder itself cannot be read or is not a folder.
// `direct: false` reads through `readdir` and `stat` even where the backend could be read directly.
export async function scanPixos({
  fs,
  path,
  mounts = [],
  inFlight,
  direct = true,
  onProgress,
  stopped = () => false,
  now = () => performance.now(),
}) {
  const start = normalizePath(path);
  const stats = await call(fs, 'stat', start);
  if (!stats.isDirectory()) {
    throw new Error(`${start} is not a folder`);
  }
  const skip = new Set(mountsBelow(start, mounts));
  // A mount point need not be a folder in the store it is mounted over, so a listing read from
  // that store directly would not name it.
  const mountsIn = new Map();
  for (const point of skip) {
    const dir = point.slice(0, point.lastIndexOf('/')) || '/';
    if (!mountsIn.has(dir)) mountsIn.set(dir, []);
    mountsIn.get(dir).push(point.slice(point.lastIndexOf('/') + 1));
  }
  const kv = direct ? keyValueBackend(fs, start) : null;
  const inside = (dirPath) => normalizePath(kv.path + '/' + dirPath.slice(start.length));
  const list = kv
    ? (dirPath, inode) => readKeyValueFolder(kv.backend, inside(dirPath), inode)
    : (dirPath) => call(fs, 'readdir', dirPath).then((names) => names.map((name) => ({ name })));
  const run = makePool(inFlight ?? (kv ? FOLDERS_IN_FLIGHT : IN_FLIGHT));
  const root = folder(start === '/' ? '/' : start.slice(start.lastIndexOf('/') + 1));
  root.fsPath = start;

  let files = 0;
  let bytes = 0;
  let unreadable = 0;
  const left = [];
  let reported = now();
  const report = (at) => {
    const t = now();
    if (t - reported >= PROGRESS_EVERY_MS) {
      reported = t;
      onProgress?.({ files, bytes, at });
    }
  };

  async function walk(node, dirPath, inode) {
    let entries;
    try {
      entries = await run(() => list(dirPath, inode));
    } catch {
      unreadable++;
      return;
    }
    for (const name of mountsIn.get(dirPath) || []) {
      if (!entries.some((entry) => entry.name === name)) entries.push({ name });
    }
    await Promise.all(entries.map((entry) => visit(node, dirPath, entry)));
  }

  async function visit(parent, dirPath, { name, stats: known, error }) {
    if (stopped()) return;
    const entryPath = joinPath(dirPath, name);
    if (skip.has(entryPath)) {
      left.push(entryPath);
      return;
    }
    let entry = known;
    if (error) {
      unreadable++;
      return;
    }
    if (!entry) {
      try {
        entry = await run(() => call(fs, 'stat', entryPath));
      } catch {
        unreadable++;
        return;
      }
      if (stopped()) return;
    }
    if (entry.isDirectory()) {
      await walk(addFolder(parent, name), entryPath, kv ? entry : undefined);
      return;
    }
    bytes += addFile(parent, name, entry.size).size;
    files++;
    report(entryPath);
  }

  await walk(root, start);
  if (stopped()) return { root: null, unreadable, mounts: left.sort() };
  onProgress?.({ files, bytes, at: start });
  return { root: finish(root), unreadable, mounts: left.sort() };
}
