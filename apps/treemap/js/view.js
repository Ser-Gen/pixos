// What the page says about the tree, kept apart from the DOM so it can be tested: where to start,
// the path as crumbs, and the sentences for a rect under the pointer.

import { formatBytes, formatPercent, formatCount, formatDuration, plural } from './format.js';
import { ancestorsOf, namesOf, rootOf } from './tree.js';
import { LABEL } from './kinds.js';
import { kindOfNode } from './render.js';

// A root that holds nothing but one folder opens on that folder, and so on down: a picked folder
// whose only content is `src/` would otherwise open on one block saying so.
export function startView(root) {
  let view = root;
  while (view.kids && view.kids.length === 1 && view.kids[0].kids !== null) view = view.kids[0];
  return view;
}

// The root's label: the folder measured on PixOS's filesystem, or the picked folder's name.
export function rootLabel(root) {
  return root.fsPath || root.name;
}

export function crumbs(view) {
  return ancestorsOf(view).map((node, i) => ({ node, label: i === 0 ? rootLabel(node) : node.name }));
}

// The path shown for a node: from the root's label down.
export function displayPath(node) {
  const root = rootLabel(rootOf(node));
  const rest = namesOf(node).slice(1).join('/');
  if (!rest) return root;
  return root.endsWith('/') ? root + rest : `${root}/${rest}`;
}

export function canGoIn(node) {
  return !!node && !node.rest && node.kids !== null && node.kids.length > 0;
}

// {name, meta, hint, line} for the tooltip and the status line. `openable` says whether a click
// opens the file.
export function describe(node, view, openable) {
  if (node.rest) {
    const where = node.parent === view ? 'here' : `in ${node.parent.name}`;
    return {
      name: `${plural(node.count, 'smaller item', 'smaller items')}`,
      meta: `${formatBytes(node.size)} · ${formatPercent(node.size, view.size)} · ${where}`,
      hint: node.parent === view ? '' : `Click to go into ${node.parent.name}`,
      line: `${plural(node.count, 'smaller item', 'smaller items')} ${where} · ${formatBytes(node.size)}`,
    };
  }
  const share = formatPercent(node.size, view.size);
  let meta;
  let hint = '';
  if (node.kids === null) {
    meta = `${formatBytes(node.size)} · ${share} · ${LABEL[kindOfNode(node)].toLowerCase()}`;
    if (openable) hint = 'Click to open';
  } else {
    meta = `${formatBytes(node.size)} · ${share} · ${plural(node.files, 'file', 'files')}`;
    if (canGoIn(node)) hint = 'Click to go in';
  }
  return { name: node.name, meta, hint, line: `${displayPath(node)} · ${meta}` };
}

// The line under the title.
export function summary(view, root, tookMs) {
  const parts = [
    formatBytes(view.size),
    plural(view.files, 'file', 'files'),
    plural(view.folders, 'folder', 'folders'),
  ];
  if (view !== root) parts.push(`${formatPercent(view.size, root.size)} of ${rootLabel(root)}`);
  else if (tookMs != null) parts.push(`measured in ${formatDuration(tookMs)}`);
  return parts.join(' · ');
}

// What was not measured, for the right end of the status line.
export function notes({ unreadable = 0, mounts = [] }) {
  const parts = [];
  if (mounts.length) parts.push(`Not measured: ${mounts.join(', ')} (mounted)`);
  if (unreadable) parts.push(`${formatCount(unreadable)} could not be read`);
  return parts.join(' · ');
}
