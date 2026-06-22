import { fileExtension } from './format.js';

const FOLDER_COLOR = { fill: '#457b9d', hover: '#5a9ab8' };

const EXT_HUES = {
  js: 45, ts: 45, jsx: 45, tsx: 45, mjs: 45, cjs: 45,
  json: 45, html: 15, css: 200, scss: 200, sass: 200, less: 200,
  png: 280, jpg: 280, jpeg: 280, gif: 280, svg: 280, webp: 280, ico: 280,
  mp4: 320, mov: 320, avi: 320, mkv: 320, webm: 320,
  mp3: 160, wav: 160, flac: 160, ogg: 160,
  zip: 30, gz: 30, tar: 30, rar: 30, '7z': 30,
  pdf: 0, doc: 0, docx: 0, xls: 120, xlsx: 120, ppt: 15, pptx: 15,
  py: 100, rb: 0, go: 190, rs: 25, java: 15, c: 200, cpp: 200, h: 200,
  md: 210, txt: 210, log: 210,
  sql: 170, db: 170, sqlite: 170,
};

function hashHue(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

function hsl(h, s, l) {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

export function getNodeColor(node) {
  if (!node.isFile) {
    return FOLDER_COLOR;
  }

  const ext = fileExtension(node.name);
  const hue = EXT_HUES[ext] ?? hashHue(ext || node.name);
  return {
    fill: hsl(hue, 42, 38),
    hover: hsl(hue, 48, 48),
  };
}
