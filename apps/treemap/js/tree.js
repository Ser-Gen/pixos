// The measured tree, built once and then only read.
//
// **A node holds its name and its parent, never its path.** The first version stored the full
// path string on every node and rebuilt it per file by joining all its parts — quadratic in depth,
// and one long string per file held for the life of the window. A path is asked for only when one
// is shown or opened, and walking up a dozen parents then costs nothing.
//
// **A file is four fields.** No child map, no counts: `kids` is null, and that is what makes it a
// file. A folder keeps a `byName` map only while it is being filled, and only if it needs one; `finish`
// drops it.
// A file picked from the local disk carries its `File` on the node, so opening it needs no map
// from paths to files.

export function folder(name, parent = null) {
  return { name, parent, size: 0, files: 0, folders: 0, kids: [], byName: null };
}

export function file(name, size, parent, source = null) {
  const node = { name, parent, size: size > 0 ? size : 0, kids: null };
  if (source) node.file = source;
  return node;
}

export function isFolder(node) {
  return !!node && node.kids !== null;
}

export function addFile(parent, name, size, source = null) {
  const node = file(name, size, parent, source);
  parent.kids.push(node);
  return node;
}

// A folder under `parent` by name, made the first time it is asked for. The map is made on first
// use: a scan of PixOS's filesystem never needs it, since a listing names each entry once.
export function childFolder(parent, name) {
  parent.byName ??= new Map();
  let node = parent.byName.get(name);
  if (!node) {
    node = addFolder(parent, name);
    parent.byName.set(name, node);
  }
  return node;
}

export function addFolder(parent, name) {
  const node = folder(name, parent);
  parent.kids.push(node);
  return node;
}

// Sizes and counts summed upwards and every folder's children sorted largest first, without
// recursion: a deep tree from a local disk must not run out of stack.
export function finish(root) {
  const order = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    order.push(node);
    for (const kid of node.kids) {
      if (kid.kids !== null) stack.push(kid);
    }
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i];
    let size = 0;
    let files = 0;
    let folders = 0;
    for (const kid of node.kids) {
      size += kid.size;
      if (kid.kids === null) {
        files += 1;
      } else {
        files += kid.files;
        folders += 1 + kid.folders;
      }
    }
    node.size = size;
    node.files = files;
    node.folders = folders;
    node.kids.sort(bySize);
    node.byName = null;
    node.kinds = null;
  }
  return root;
}

function bySize(a, b) {
  return b.size - a.size;
}

// The names from the root down to `node`, the root's own included.
export function namesOf(node) {
  const names = [];
  for (let at = node; at; at = at.parent) names.push(at.name);
  return names.reverse();
}

export function rootOf(node) {
  let at = node;
  while (at.parent) at = at.parent;
  return at;
}

// Where a node is on PixOS's filesystem: the root carries the folder that was measured.
export function fsPathOf(node) {
  const root = rootOf(node);
  const base = root.fsPath || '/';
  const rest = namesOf(node).slice(1);
  if (!rest.length) return base;
  return (base === '/' ? '' : base) + '/' + rest.join('/');
}

export function ancestorsOf(node) {
  const list = [];
  for (let at = node; at; at = at.parent) list.push(at);
  return list.reverse();
}

export function contains(ancestor, node) {
  for (let at = node; at; at = at.parent) {
    if (at === ancestor) return true;
  }
  return false;
}

// Bytes per kind under a folder, worked out the first time a folder is looked at and kept: the
// tree does not change once finished.
export function kindTotals(node, kindOf) {
  if (node.kids === null) return { [kindOf(node.name)]: node.size };
  if (node.kinds) return node.kinds;
  const totals = {};
  const stack = [node];
  while (stack.length) {
    const at = stack.pop();
    for (const kid of at.kids) {
      if (kid.kids === null) {
        const kind = kindOf(kid.name);
        totals[kind] = (totals[kind] || 0) + kid.size;
      } else {
        stack.push(kid);
      }
    }
  }
  node.kinds = totals;
  return totals;
}

export const SELECTION_NAME = 'Selected folders';

// A second folder picked from the disk joins the first under one root instead of replacing it,
// so a huge disk can be measured a folder at a time. Two folders with one name are told apart.
export function combine(current, incoming) {
  let root = current;
  if (!current.combined) {
    root = folder(SELECTION_NAME);
    root.combined = true;
    root.byName = new Map();
    attach(root, current);
  } else {
    root.byName = new Map(root.kids.map((kid) => [kid.name, kid]));
  }
  attach(root, incoming);
  return finish(root);
}

function attach(root, child) {
  let name = child.name;
  for (let n = 2; root.byName.has(name); n++) name = `${child.name} (${n})`;
  child.name = name;
  child.parent = root;
  root.byName.set(name, child);
  root.kids.push(child);
}
