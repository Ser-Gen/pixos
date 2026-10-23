// Drawing the layout on two canvases stacked one over the other.
//
// **The picture is drawn once per layout; the pointer only ever touches the top canvas.** The
// first version repainted every rect, label and clip region on each change of the rect under the
// pointer. Here the base canvas is painted when the layout changes (a folder opened, the window
// resized, the fonts arriving), and a hover clears the transparent overlay and outlines one rect
// and its folders.
//
// **Fills are batched by colour within each depth.** Rects at one depth never overlap, and every
// rect of a depth comes after every rect of the one above (layout.js writes them in that order),
// so one path per colour per depth paints the same picture as one fill per rect, with a few
// dozen colour changes instead of thousands.

import { HEADER } from './layout.js';
import { PAINT, kindOf } from './kinds.js';
import { formatBytes, formatCount } from './format.js';

export const THEME = {
  ground: '#0a0b0c',
  folders: ['#141619', '#181a1d', '#1b1e21', '#1e2124', '#212427'],
  header: '#c3c6c3',
  headerDim: '#787e7b',
  restInk: '#939996',
  restLine: '#2a2e31',
  mark: '#ee4b98',
  markWash: 'rgba(238, 75, 152, 0.16)',
  markTrail: 'rgba(238, 75, 152, 0.5)',
  font: '"DM Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

const LABEL_MIN_W = 40;
const LABEL_MIN_H = 20;
const SIZE_MIN_H = 34;

export function kindOfNode(node) {
  if (node.kind === undefined) node.kind = kindOf(node.name);
  return node.kind;
}

export function fillOf(node, depth) {
  if (node.rest) return 'rest';
  if (node.kids !== null) return THEME.folders[Math.min(depth, THEME.folders.length - 1)];
  return PAINT[kindOfNode(node)].fill;
}

// The longest start of `text` that fits in `max` pixels, with an ellipsis when cut.
export function fitText(measure, text, max) {
  if (measure(text) <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(text.slice(0, mid) + '…') <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo ? text.slice(0, lo) + '…' : '';
}

export class Renderer {
  constructor(base, overlay) {
    this.base = base;
    this.overlay = overlay;
    this.bctx = base.getContext('2d', { alpha: false });
    this.octx = overlay.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.rects = null;
    this.restPattern = null;
  }

  resize(width, height, dpr = globalThis.devicePixelRatio || 1) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    for (const canvas of [this.base, this.overlay]) {
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    }
    this.bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.restPattern = null;
  }

  pattern() {
    if (this.restPattern) return this.restPattern;
    const tile = document.createElement('canvas');
    tile.width = 6;
    tile.height = 6;
    const t = tile.getContext('2d');
    t.fillStyle = THEME.folders[0];
    t.fillRect(0, 0, 6, 6);
    t.strokeStyle = THEME.restLine;
    t.lineWidth = 1;
    t.beginPath();
    t.moveTo(-1, 7);
    t.lineTo(7, -1);
    t.stroke();
    this.restPattern = this.bctx.createPattern(tile, 'repeat');
    return this.restPattern;
  }

  draw(rects) {
    this.rects = rects;
    const ctx = this.bctx;
    ctx.fillStyle = THEME.ground;
    ctx.fillRect(0, 0, this.width, this.height);
    if (!rects || !rects.n) return;

    let depth = 0;
    let fills = new Map();
    let edges = new Map();
    const flush = () => {
      for (const [style, path] of fills) {
        ctx.fillStyle = style === 'rest' ? this.pattern() : style;
        ctx.fill(path);
      }
      for (const [style, path] of edges) {
        ctx.fillStyle = style;
        ctx.fill(path);
      }
      fills = new Map();
      edges = new Map();
    };
    const pathFor = (map, key) => {
      let path = map.get(key);
      if (!path) {
        path = new Path2D();
        map.set(key, path);
      }
      return path;
    };

    for (let i = 0; i < rects.n; i++) {
      if (rects.depth[i] !== depth) {
        flush();
        depth = rects.depth[i];
      }
      const node = rects.node[i];
      // Snapped to whole pixels, with a pixel of ground left on the right and below as the gap.
      const x0 = Math.round(rects.x[i]);
      const y0 = Math.round(rects.y[i]);
      const w = Math.max(1, Math.round(rects.x[i] + rects.w[i]) - x0 - 1);
      const h = Math.max(1, Math.round(rects.y[i] + rects.h[i]) - y0 - 1);
      pathFor(fills, fillOf(node, depth)).rect(x0, y0, w, h);
      if (node.kids === null && !node.rest && w >= 6 && h >= 6) {
        pathFor(edges, PAINT[kindOfNode(node)].edge).rect(x0, y0, w, 1);
      }
    }
    flush();
    this.labels(rects);
  }

  labels(rects) {
    const ctx = this.bctx;
    const font = THEME.font;
    ctx.textBaseline = 'alphabetic';
    let current = '';
    const use = (spec) => {
      if (spec !== current) {
        ctx.font = spec;
        current = spec;
      }
    };
    const measure = (text) => ctx.measureText(text).width;

    for (let i = 0; i < rects.n; i++) {
      const node = rects.node[i];
      const x = Math.round(rects.x[i]);
      const y = Math.round(rects.y[i]);
      const w = Math.round(rects.x[i] + rects.w[i]) - x - 1;
      const h = Math.round(rects.y[i] + rects.h[i]) - y - 1;

      if (rects.header[i]) {
        use(`500 10.5px ${font}`);
        const size = formatBytes(node.size);
        const sizeW = measure(size);
        const room = w - 12;
        const showSize = room - sizeW - 10 > 30;
        const name = fitText(measure, node.name, showSize ? room - sizeW - 10 : room);
        ctx.fillStyle = THEME.header;
        ctx.fillText(name, x + 5, y + HEADER - 5);
        if (showSize) {
          ctx.fillStyle = THEME.headerDim;
          ctx.fillText(size, x + w - 5 - sizeW, y + HEADER - 5);
        }
        continue;
      }
      if (w < LABEL_MIN_W || h < LABEL_MIN_H) continue;

      if (node.rest) {
        use(`400 10px ${font}`);
        ctx.fillStyle = THEME.restInk;
        ctx.fillText(fitText(measure, `+${formatCount(node.count)} smaller`, w - 10), x + 5, y + 14);
        continue;
      }
      const paint = node.kids === null ? PAINT[kindOfNode(node)] : null;
      use(`500 11px ${font}`);
      ctx.fillStyle = paint ? paint.ink : THEME.header;
      ctx.fillText(fitText(measure, node.name, w - 10), x + 5, y + 14);
      if (h >= SIZE_MIN_H) {
        use(`400 10px ${font}`);
        ctx.fillStyle = paint ? paint.dim : THEME.headerDim;
        ctx.fillText(fitText(measure, formatBytes(node.size), w - 10), x + 5, y + 27);
      }
    }
  }

  // Outlines rect `index` and the folders it is in; -1 clears.
  highlight(index) {
    const ctx = this.octx;
    ctx.clearRect(0, 0, this.width, this.height);
    const rects = this.rects;
    if (!rects || index < 0 || index >= rects.n) return;
    const box = (i) => {
      const x = Math.round(rects.x[i]);
      const y = Math.round(rects.y[i]);
      return [x, y, Math.max(1, Math.round(rects.x[i] + rects.w[i]) - x - 1), Math.max(1, Math.round(rects.y[i] + rects.h[i]) - y - 1)];
    };
    ctx.lineWidth = 1;
    ctx.strokeStyle = THEME.markTrail;
    for (let at = rects.parent[index]; at >= 0; at = rects.parent[at]) {
      const [x, y, w, h] = box(at);
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    const [x, y, w, h] = box(index);
    ctx.fillStyle = THEME.markWash;
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = THEME.mark;
    ctx.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
  }
}
