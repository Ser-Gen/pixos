// Where every rect goes: a squarified treemap (Bruls, Huizing, van Wijk), nested — each folder
// drawn with its contents inside, under a header with its name, as deep as there is room.
//
// **Nothing smaller than MIN_AREA square pixels is laid out** (about 4½ px a side: smaller, and the
// pixel of gap round each rect is most of what shows). Children are sorted largest first,
// so the first one under that size ends the list: everything after it is folded into one
// "smaller items" block of their summed size. A folder of 100 000 files costs as much as one of
// a few hundred, and the number of rects is bounded by the window's area, not by the disk. The
// first version laid out and redrew every child, sub-pixel ones included, through d3 from a CDN.
//
// The result is a set of flat typed arrays, one slot per rect, rather than an object per rect.
// A folder's children are written next to each other (`first`, `count`), always after the folder
// itself — so drawing in index order paints parents under children, and finding the rect under
// the pointer descends from the top instead of testing every rect.

export const MIN_AREA = 20;
export const HEADER = 16;
export const PAD = 2;
// A folder smaller than this is drawn as one block with nothing inside.
export const OPEN_MIN_W = 28;
export const OPEN_MIN_H = HEADER + 12;
export const MAX_DEPTH = 48;

// The block that stands for the smallest children of `parent`.
export function restOf(parent, from, size) {
  return { rest: true, parent, size, count: parent.kids.length - from, kids: null, name: '' };
}

class Rects {
  constructor(capacity) {
    this.n = 0;
    this.grow(capacity);
    this.node = [];
    this.top = { first: 0, count: 0 };
  }

  grow(capacity) {
    const keep = (Type, old) => {
      const next = new Type(capacity);
      if (old) next.set(old.subarray(0, this.n));
      return next;
    };
    this.x = keep(Float32Array, this.x);
    this.y = keep(Float32Array, this.y);
    this.w = keep(Float32Array, this.w);
    this.h = keep(Float32Array, this.h);
    this.depth = keep(Uint8Array, this.depth);
    this.parent = keep(Int32Array, this.parent);
    this.first = keep(Int32Array, this.first);
    this.count = keep(Int32Array, this.count);
    this.header = keep(Uint8Array, this.header);
    this.capacity = capacity;
  }

  push(node, x, y, w, h, depth, parent) {
    if (this.n === this.capacity) this.grow(this.capacity * 2);
    const i = this.n++;
    this.node[i] = node;
    this.x[i] = x;
    this.y[i] = y;
    this.w[i] = w;
    this.h[i] = h;
    this.depth[i] = depth;
    this.parent[i] = parent;
    // `count` and `header` are 0 already: a slot is written once, into an array that starts at 0.
    this.first[i] = -1;
    return i;
  }
}

// The children of `node` that get a rect of their own in a box of `area` square pixels, and the
// block standing for the rest (null when there is none worth a pixel). No room, or a folder of
// nothing, needs no case of its own: every child then comes to 0 or NaN square pixels, which is
// not MIN_AREA.
export function visibleChildren(node, area) {
  const kids = node.kids;
  if (!kids) return { items: [], rest: null };
  const scale = area / node.size;
  let cut = 0;
  while (cut < kids.length && kids[cut].size * scale >= MIN_AREA) cut++;
  let restSize = 0;
  for (let i = cut; i < kids.length; i++) restSize += kids[i].size;
  const items = cut === kids.length ? kids : kids.slice(0, cut);
  const rest = restSize * scale >= MIN_AREA ? restOf(node, cut, restSize) : null;
  return { items, rest };
}

// Lays `sizes` (largest first, all > 0) into the box, calling place(index, x, y, w, h).
export function squarify(sizes, x, y, w, h, place) {
  let total = 0;
  for (const size of sizes) total += size;
  if (total <= 0 || w <= 0 || h <= 0) return;
  const scale = (w * h) / total;
  let i = 0;
  while (i < sizes.length) {
    const side = Math.min(w, h);
    const side2 = side * side;
    let sum = 0;
    let min = Infinity;
    let max = 0;
    let worst = Infinity;
    let j = i;
    while (j < sizes.length) {
      const area = sizes[j] * scale;
      const nextSum = sum + area;
      const nextMin = Math.min(min, area);
      const nextMax = Math.max(max, area);
      const sum2 = nextSum * nextSum;
      const nextWorst = Math.max((side2 * nextMax) / sum2, sum2 / (side2 * nextMin));
      // Never true for a row's first, against Infinity: every row takes at least one.
      if (nextWorst > worst) break;
      sum = nextSum;
      min = nextMin;
      max = nextMax;
      worst = nextWorst;
      j++;
    }
    // The last row is as thick as what is left, so rounding never leaves a sliver unpainted.
    const last = j === sizes.length;
    if (w >= h) {
      const thick = last ? w : Math.min(w, sum / h);
      let at = y;
      for (let k = i; k < j; k++) {
        const len = (sizes[k] * scale) / thick;
        place(k, x, at, thick, len);
        at += len;
      }
      x += thick;
      w -= thick;
    } else {
      const thick = last ? h : Math.min(h, sum / w);
      let at = x;
      for (let k = i; k < j; k++) {
        const len = (sizes[k] * scale) / thick;
        place(k, at, y, len, thick);
        at += len;
      }
      y += thick;
      h -= thick;
    }
    i = j;
  }
}

// The whole picture of `view` in a width × height box: its children fill the box, and every
// folder big enough is opened in place.
export function layout(view, width, height) {
  const rects = new Rects(1024);
  if (!view || !view.kids) return rects;
  // Folders still to open, in the order their rects were written: [rect index, x, y, w, h].
  const queue = [[-1, 0, 0, Math.max(0, width), Math.max(0, height)]];
  for (let q = 0; q < queue.length; q++) {
    const [owner, bx, by, bw, bh] = queue[q];
    const node = owner < 0 ? view : rects.node[owner];
    const depth = owner < 0 ? 0 : rects.depth[owner] + 1;
    const { items, rest } = visibleChildren(node, bw * bh);
    const list = rest ? [...items, rest] : items;
    const sizes = list.map((item) => item.size);
    const first = rects.n;
    squarify(sizes, bx, by, bw, bh, (k, x, y, w, h) => {
      rects.push(list[k], x, y, w, h, depth, owner);
    });
    if (owner >= 0) {
      rects.first[owner] = first;
      rects.count[owner] = rects.n - first;
    } else {
      rects.top = { first: 0, count: rects.n };
    }
    for (let i = first; i < rects.n; i++) {
      const item = rects.node[i];
      if (item.kids === null || !item.kids.length || depth + 1 >= MAX_DEPTH) continue;
      const w = rects.w[i];
      const h = rects.h[i];
      if (w < OPEN_MIN_W || h < OPEN_MIN_H) continue;
      rects.header[i] = 1;
      queue.push([i, rects.x[i] + PAD, rects.y[i] + HEADER, w - PAD * 2, h - HEADER - PAD]);
    }
  }
  return rects;
}

function inside(rects, i, px, py) {
  const x = rects.x[i];
  const y = rects.y[i];
  return px >= x && py >= y && px < x + rects.w[i] && py < y + rects.h[i];
}

// The deepest rect under the point, or -1.
export function hitTest(rects, px, py) {
  let found = -1;
  let { first, count } = rects.top;
  for (;;) {
    let next = -1;
    for (let i = first; i < first + count; i++) {
      if (inside(rects, i, px, py)) {
        next = i;
        break;
      }
    }
    if (next < 0) break;
    found = next;
    first = rects.first[next];
    count = rects.count[next];
  }
  return found;
}

// The rect drawn for `node`, if it got one.
export function indexOf(rects, node) {
  for (let i = 0; i < rects.n; i++) {
    if (rects.node[i] === node) return i;
  }
  return -1;
}
