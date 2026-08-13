import { buildTreeFromRelativeFiles } from './scan.js';

function getPixosFs() {
  const parent = globalThis.parent;
  if (!parent || parent === globalThis) {
    return null;
  }
  if (!parent.fs || !parent.path) {
    return null;
  }
  return { fs: parent.fs, path: parent.path };
}

function fsStat(fs, filePath) {
  return new Promise((resolve, reject) => {
    fs.stat(filePath, (err, stats) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stats);
    });
  });
}

function fsReaddir(fs, dirPath) {
  return new Promise((resolve, reject) => {
    fs.readdir(dirPath, (err, list) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(list || []);
    });
  });
}

function normalizePixosPath(pathModule, fsPath) {
  const normalized = String(fsPath || '').trim();
  if (!normalized) {
    return '/';
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function relativePathFromRoot(rootPath, filePath) {
  const root = rootPath.endsWith('/') ? rootPath.slice(0, -1) : rootPath;
  if (filePath === root) {
    return '';
  }
  if (filePath.startsWith(`${root}/`)) {
    return filePath.slice(root.length + 1);
  }
  return filePath.replace(/^\//, '');
}

function isDirectoryStat(stats) {
  if (!stats) {
    return false;
  }
  return typeof stats.isDirectory === 'function' ? stats.isDirectory() : !!stats.isDirectory;
}

function isFileStat(stats) {
  if (!stats) {
    return false;
  }
  return typeof stats.isFile === 'function' ? stats.isFile() : !!stats.isFile;
}

async function walkPixosDirectory(fs, pathModule, dirPath, rootPath, rootName, entries, onProgress) {
  const names = await fsReaddir(fs, dirPath);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const fullPath = dirPath === '/' ? `/${name}` : pathModule.join(dirPath, name);
    const stats = await fsStat(fs, fullPath);
    if (isDirectoryStat(stats)) {
      await walkPixosDirectory(fs, pathModule, fullPath, rootPath, rootName, entries, onProgress);
      continue;
    }
    if (isFileStat(stats)) {
      const rel = relativePathFromRoot(rootPath, fullPath);
      const relPath = rel ? `${rootName}/${rel}` : rootName;
      entries.push({
        relPath,
        size: stats.size || 0,
      });
      onProgress?.({
        current: entries.length,
        total: entries.length,
        phase: 'scan',
      });
    }
  }
}

export function isPixosEmbedded() {
  try {
    return (
      globalThis.parent !== globalThis &&
      /\/__browserfs__\//.test(globalThis.location?.pathname ?? '')
    );
  } catch {
    return false;
  }
}

export function parsePathFromQuery(search = globalThis.location?.search ?? '') {
  if (!search) {
    return '';
  }
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return (params.get('path') || params.get('dir') || '').trim();
}

export async function scanPixosPath(fsPath, onProgress) {
  const pixos = getPixosFs();
  if (!pixos) {
    throw new Error('PixOS filesystem unavailable');
  }

  const { fs, path: pathModule } = pixos;
  const normalized = normalizePixosPath(pathModule, fsPath);
  const stats = await fsStat(fs, normalized);
  if (!isDirectoryStat(stats)) {
    throw new Error('Not a directory: ' + normalized);
  }

  const rootName = pathModule.basename(normalized) || 'root';
  const entries = [];
  onProgress?.({ current: 0, total: 0, phase: 'scan' });
  await walkPixosDirectory(fs, pathModule, normalized, normalized, rootName, entries, onProgress);
  onProgress?.({ current: entries.length, total: entries.length, phase: 'done' });
  return {
    ...buildTreeFromRelativeFiles(entries, rootName),
    scanRootPath: normalized,
  };
}
