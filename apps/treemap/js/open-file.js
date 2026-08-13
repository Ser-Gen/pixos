import { fileExtension } from './format.js';

/** Extensions the browser can usually render natively in a new tab. */
export const BROWSER_VIEWABLE_EXTENSIONS = new Set([
  // images
  'avif', 'bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp',
  // audio
  'mp3', 'ogg', 'wav', 'weba',
  // video
  'mp4', 'ogv', 'webm',
  'pdf',
  // text / markup / code
  'c', 'cjs', 'cpp', 'css', 'csv', 'go', 'h', 'hpp', 'htm', 'html',
  'ini', 'java', 'js', 'json', 'jsx', 'less', 'log', 'md', 'mjs',
  'php', 'py', 'rb', 'rs', 'sass', 'scss', 'sh', 'sql', 'toml', 'ts',
  'tsx', 'txt', 'vue', 'xml', 'yaml', 'yml',
]);

/** Reserved for future hard blocks (empty for now). */
export const EXCLUDED_EXTENSIONS = new Set();

function getPixosPathModule() {
  try {
    const parent = globalThis.parent;
    if (parent && parent !== globalThis && parent.path) {
      return parent.path;
    }
  } catch {
    // cross-origin parent
  }
  return null;
}

export function isExcludedExtension(name) {
  const ext = fileExtension(name);
  return ext !== '' && EXCLUDED_EXTENSIONS.has(ext);
}

export function isBrowserViewable(name, file = null) {
  if (isExcludedExtension(name)) {
    return false;
  }
  const ext = fileExtension(name);
  if (ext !== '' && BROWSER_VIEWABLE_EXTENSIONS.has(ext)) {
    return true;
  }
  if (file?.type?.startsWith('text/')) {
    return true;
  }
  return false;
}

export function canOpenFile(node, { pixosEmbedded = false, hasLocalSource = false, localFile = null } = {}) {
  if (!node?.isFile || isExcludedExtension(node.name)) {
    return false;
  }
  if (hasLocalSource) {
    return isBrowserViewable(node.name, localFile ?? undefined);
  }
  if (pixosEmbedded) {
    return typeof getPixosOpenFile() === 'function';
  }
  return isBrowserViewable(node.name);
}

function getPixosOpenFile() {
  try {
    const parent = globalThis.parent;
    if (parent && parent !== globalThis && typeof parent.openFile === 'function') {
      return parent.openFile.bind(parent);
    }
  } catch {
    // cross-origin parent
  }
  return null;
}

export function resolvePixosAbsolutePath(scanRoot, nodePath) {
  const root = String(scanRoot || '').replace(/\/+$/, '') || '/';
  const pathModule = getPixosPathModule();
  const rootName = pathModule ? (pathModule.basename(root) || 'root') : root.split('/').filter(Boolean).pop() || 'root';

  if (nodePath === rootName) {
    return root;
  }

  const prefix = `${rootName}/`;
  const relative = nodePath.startsWith(prefix) ? nodePath.slice(prefix.length) : nodePath;

  if (pathModule) {
    return relative ? pathModule.join(root, relative) : root;
  }

  return relative ? `${root}/${relative}` : root;
}

/** @type {Record<string, string>} */
const MIME_BY_EXTENSION = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  weba: 'audio/webm',
  mp4: 'video/mp4',
  ogv: 'video/ogg',
  webm: 'video/webm',
  pdf: 'application/pdf',
  css: 'text/css',
  csv: 'text/csv',
  htm: 'text/html',
  html: 'text/html',
  js: 'text/javascript',
  json: 'application/json',
  md: 'text/markdown',
  mjs: 'text/javascript',
  txt: 'text/plain',
  xml: 'application/xml',
};

function mimeTypeForFile(file) {
  if (file.type) {
    return file.type;
  }
  const ext = fileExtension(file.name);
  return MIME_BY_EXTENSION[ext] || 'application/octet-stream';
}

function fileWithMimeType(file) {
  const mimeType = mimeTypeForFile(file);
  if (file.type === mimeType) {
    return file;
  }
  return new File([file], file.name, {
    type: mimeType,
    lastModified: file.lastModified,
  });
}

function openInNewTab(file) {
  const typedFile = fileWithMimeType(file);
  const url = URL.createObjectURL(typedFile);

  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 600_000);
  return { ok: true };
}

function openViaPixos(absolutePath) {
  const openFile = getPixosOpenFile();
  if (!openFile) {
    return { ok: false, message: 'PixOS недоступен' };
  }
  openFile(absolutePath);
  return { ok: true };
}

export function openTreemapFile(node, { pixosEmbedded, scanRootPath, localFileMap }) {
  if (!node?.isFile) {
    return { ok: false, message: 'Не файл' };
  }
  if (isExcludedExtension(node.name)) {
    return { ok: false, message: 'Файл исключён из открытия' };
  }

  const localFile = localFileMap?.get(node.path);
  if (localFile) {
    if (!isBrowserViewable(node.name, localFile)) {
      return { ok: false, message: 'Формат не поддерживается для просмотра в браузере' };
    }
    return openInNewTab(localFile);
  }

  if (pixosEmbedded && scanRootPath) {
    const absolutePath = resolvePixosAbsolutePath(scanRootPath, node.path);
    return openViaPixos(absolutePath);
  }

  return { ok: false, message: 'Файл недоступен' };
}
