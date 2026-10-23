// Opening the file under the pointer. On PixOS's filesystem the shell opens it, in whatever app
// it would open it with anywhere else (`parent.openFile`). A file picked from the local disk has
// no path the shell can read, so the browser shows it in a new tab — which it can only do for the
// formats below.

import { extensionOf } from './kinds.js';
import { fsPathOf } from './tree.js';

const MIME = {
  avif: 'image/avif', bmp: 'image/bmp', gif: 'image/gif', ico: 'image/x-icon', jpeg: 'image/jpeg',
  jpg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', weba: 'audio/webm', flac: 'audio/flac',
  mp4: 'video/mp4', ogv: 'video/ogg', webm: 'video/webm', pdf: 'application/pdf',
  css: 'text/css', csv: 'text/csv', htm: 'text/html', html: 'text/html', js: 'text/javascript',
  mjs: 'text/javascript', json: 'application/json', md: 'text/plain', txt: 'text/plain',
  xml: 'application/xml', log: 'text/plain',
};

// Text the browser shows as text, for a file it would otherwise download.
const PLAIN = new Set(('c cjs cpp go h hpp ini java jsx less php py rb rs sass scss sh sql toml ts '
  + 'tsx vue yaml yml').split(' '));

export function isViewable(name, file = null) {
  const ext = extensionOf(name);
  return ext in MIME || PLAIN.has(ext) || !!file?.type?.startsWith('text/');
}

export function mimeOf(name, file = null) {
  if (file?.type) return file.type;
  const ext = extensionOf(name);
  return MIME[ext] || (PLAIN.has(ext) ? 'text/plain' : 'application/octet-stream');
}

export function getShellOpener(host = globalThis.parent) {
  try {
    if (host && host !== globalThis && typeof host.openFile === 'function') {
      return host.openFile.bind(host);
    }
  } catch {
    // a parent from another origin
  }
  return null;
}

export function canOpen(node, opener) {
  if (!node || node.kids !== null || node.rest) return false;
  if (node.file) return isViewable(node.name, node.file);
  return typeof opener === 'function';
}

function openInTab(file) {
  const typed = file.type ? file : new File([file], file.name, { type: mimeOf(file.name), lastModified: file.lastModified });
  const url = URL.createObjectURL(typed);
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 600_000);
}

// Returns null when it was opened, or the sentence saying why it was not.
export function openNode(node, opener, inTab = openInTab) {
  if (!canOpen(node, opener)) {
    return node?.file ? 'The browser cannot show this kind of file' : 'Nothing here can open it';
  }
  if (node.file) {
    inTab(node.file);
    return null;
  }
  opener(fsPathOf(node));
  return null;
}
