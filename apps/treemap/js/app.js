// Disk Treemap: the page. Scanning is in scan-pixos.js and scan-local.js, the picture in layout.js
// and render.js, the words in view.js; this wires them to the DOM.

import { combine, kindTotals } from './tree.js';
import { scanPixos, getPixosFs, listMountPoints, normalizePath } from './scan-pixos.js';
import { scanFiles } from './scan-local.js';
import { layout, hitTest } from './layout.js';
import { Renderer, THEME, kindOfNode } from './render.js';
import { KINDS, PAINT, kindOf } from './kinds.js';
import { formatBytes, formatPercent, formatCount, plural } from './format.js';
import { getShellOpener, canOpen, openNode } from './open-file.js';
import { startView, crumbs, canGoIn, describe, summary, notes, displayPath } from './view.js';

const LIST_LIMIT = 60;
const TIP_OFFSET = 14;
const TIP_MARGIN = 8;

const $ = (id) => document.getElementById(id);
const els = {
  up: $('up'),
  crumbs: $('crumbs'),
  status: $('status'),
  rescan: $('rescan'),
  pick: $('pick'),
  add: $('add'),
  clear: $('clear'),
  input: $('folder-input'),
  map: $('map'),
  base: $('base'),
  overlay: $('overlay'),
  tip: $('tip'),
  tipName: $('tip-name'),
  tipMeta: $('tip-meta'),
  tipHint: $('tip-hint'),
  empty: $('empty'),
  emptyError: $('empty-error'),
  measureRoot: $('measure-root'),
  pickEmpty: $('pick-empty'),
  busy: $('busy'),
  busyWhere: $('busy-where'),
  busyFiles: $('busy-files'),
  busyBytes: $('busy-bytes'),
  busyBar: $('busy-bar'),
  busyFill: $('busy-fill'),
  busyAt: $('busy-at'),
  stop: $('stop'),
  side: $('side'),
  list: $('list'),
  kinds: $('kinds'),
  hover: $('hover'),
  note: $('note'),
};

const fs = getPixosFs();
const opener = getShellOpener();
const renderer = new Renderer(els.base, els.overlay);

const state = {
  root: null,
  view: null,
  rects: null,
  hover: -1,
  hoverNode: null,
  source: null, // 'pixos' | 'local'
  fsPath: null,
  took: null,
  unreadable: 0,
  mounts: [],
  scan: null, // {stopped} while one runs
  rows: new Map(), // node -> its row in the side list
};

// --- what is on screen -------------------------------------------------------------------------

function showPanel(which) {
  els.empty.hidden = which !== 'empty';
  els.busy.hidden = which !== 'busy';
  const map = which === 'map';
  els.base.hidden = !map;
  els.overlay.hidden = !map;
  els.side.hidden = !map;
  if (!map) hideTip();
}

function updateActions() {
  const busy = !!state.scan;
  const local = state.source === 'local' && !!state.root;
  els.rescan.hidden = !(state.source === 'pixos' && state.root) || busy;
  els.pick.hidden = local || busy || !state.root;
  els.add.hidden = !local || busy;
  els.clear.hidden = !local || busy;
  els.measureRoot.hidden = !fs;
  els.pickEmpty.textContent = fs ? 'Pick a folder on this computer…' : 'Pick a folder…';
  els.up.disabled = !state.view || !state.view.parent || busy;
}

function showEmpty(error = '') {
  state.root = null;
  state.view = null;
  state.rects = null;
  state.source = null;
  els.emptyError.textContent = error;
  els.emptyError.hidden = !error;
  els.crumbs.textContent = 'Disk Treemap';
  els.status.textContent = '';
  els.hover.textContent = '';
  els.note.textContent = '';
  showPanel('empty');
  updateActions();
}

function drawCrumbs() {
  els.crumbs.replaceChildren();
  const list = crumbs(state.view);
  list.forEach(({ node, label }, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'Tm__crumbSep';
      sep.textContent = '/';
      els.crumbs.append(sep);
    }
    const last = i === list.length - 1;
    const part = document.createElement(last ? 'span' : 'button');
    part.className = 'Tm__crumb' + (last ? ' Tm__crumb--current' : '');
    part.textContent = label;
    if (!last) {
      part.type = 'button';
      part.addEventListener('click', () => go(node));
    }
    els.crumbs.append(part);
  });
}

function swatchFor(node) {
  return node.kids === null ? PAINT[kindOfNode(node)].swatch : THEME.folders[3];
}

function drawSide() {
  const view = state.view;
  state.rows = new Map();
  const rows = view.kids.slice(0, LIST_LIMIT).map((node) => {
    const li = document.createElement('li');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'Tm__row';
    const swatch = document.createElement('span');
    swatch.className = 'Tm__swatch';
    swatch.style.background = swatchFor(node);
    const name = document.createElement('span');
    name.className = 'Tm__rowName' + (node.kids !== null ? ' Tm__rowName--folder' : '');
    name.textContent = node.name;
    const size = document.createElement('span');
    size.className = 'Tm__rowSize';
    size.textContent = formatBytes(node.size);
    const bar = document.createElement('span');
    bar.className = 'Tm__rowBar';
    const fill = document.createElement('span');
    fill.style.width = `${view.size ? (node.size / view.size) * 100 : 0}%`;
    bar.append(fill);
    row.append(swatch, name, size, bar);
    row.title = describe(node, view, canOpen(node, opener)).meta;
    row.disabled = !canGoIn(node) && !canOpen(node, opener);
    row.addEventListener('click', () => activate(node));
    row.addEventListener('pointerenter', () => hoverNode(node));
    row.addEventListener('pointerleave', () => hoverNode(null));
    row.addEventListener('focus', () => hoverNode(node));
    row.addEventListener('blur', () => hoverNode(null));
    state.rows.set(node, row);
    li.append(row);
    return li;
  });
  if (view.kids.length > LIST_LIMIT) {
    const more = document.createElement('li');
    more.className = 'Tm__more';
    more.textContent = `and ${plural(view.kids.length - LIST_LIMIT, 'more', 'more')}`;
    rows.push(more);
  }
  els.list.replaceChildren(...rows);

  const totals = kindTotals(view, kindOf);
  const kinds = KINDS.filter((kind) => totals[kind.id] > 0).sort((a, b) => totals[b.id] - totals[a.id]);
  els.kinds.replaceChildren(...kinds.map((kind) => {
    const li = document.createElement('li');
    li.className = 'Tm__row';
    const swatch = document.createElement('span');
    swatch.className = 'Tm__swatch';
    swatch.style.background = PAINT[kind.id].swatch;
    const name = document.createElement('span');
    name.className = 'Tm__rowName';
    name.textContent = kind.label;
    const size = document.createElement('span');
    size.className = 'Tm__rowSize';
    size.textContent = `${formatBytes(totals[kind.id])} · ${formatPercent(totals[kind.id], view.size)}`;
    const bar = document.createElement('span');
    bar.className = 'Tm__rowBar';
    const fill = document.createElement('span');
    fill.style.width = `${view.size ? (totals[kind.id] / view.size) * 100 : 0}%`;
    fill.style.background = PAINT[kind.id].swatch;
    bar.append(fill);
    li.append(swatch, name, size, bar);
    return li;
  }));
}

function relayout() {
  if (!state.view) return;
  const box = els.map.getBoundingClientRect();
  const width = Math.floor(box.width);
  const height = Math.floor(box.height);
  renderer.resize(width, height);
  state.rects = layout(state.view, width, height);
  renderer.draw(state.rects);
  setHover(-1);
}

let relayoutQueued = false;
function queueRelayout() {
  if (relayoutQueued) return;
  relayoutQueued = true;
  requestAnimationFrame(() => {
    relayoutQueued = false;
    relayout();
  });
}

function go(node) {
  if (!node || node.kids === null || node.rest) return;
  state.view = node;
  els.overlay.setAttribute('aria-label', `Treemap of ${displayPath(node)}: ${summary(node, state.root, null)}`);
  drawCrumbs();
  els.status.textContent = summary(state.view, state.root, state.took);
  drawSide();
  updateActions();
  relayout();
}

function up() {
  if (state.view?.parent && !state.scan) go(state.view.parent);
}

function show(root, extra = {}) {
  state.root = root;
  state.took = extra.took ?? null;
  state.unreadable = extra.unreadable ?? 0;
  state.mounts = extra.mounts ?? [];
  els.note.textContent = notes(state);
  showPanel('map');
  go(startView(root));
}

// --- the pointer -------------------------------------------------------------------------------

function hideTip() {
  els.tip.hidden = true;
}

function placeTip(clientX, clientY) {
  const tip = els.tip;
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;
  let x = clientX + TIP_OFFSET;
  let y = clientY + TIP_OFFSET;
  if (x + width > innerWidth - TIP_MARGIN) x = clientX - width - TIP_OFFSET;
  if (y + height > innerHeight - TIP_MARGIN) y = clientY - height - TIP_OFFSET;
  tip.style.transform = `translate(${Math.max(TIP_MARGIN, x)}px, ${Math.max(TIP_MARGIN, y)}px)`;
}

function setHover(index) {
  const node = index >= 0 ? state.rects.node[index] : null;
  state.hover = index;
  renderer.highlight(index);
  if (state.hoverNode !== node) {
    state.rows.get(state.hoverNode)?.classList.remove('is-hover');
    state.rows.get(node)?.classList.add('is-hover');
    state.hoverNode = node;
  }
  if (!node) {
    els.hover.textContent = '';
    els.overlay.classList.remove('is-actionable');
    hideTip();
    return null;
  }
  const openable = canOpen(node, opener);
  const said = describe(node, state.view, openable);
  els.hover.textContent = said.line;
  els.tipName.textContent = said.name;
  els.tipMeta.textContent = said.meta;
  els.tipHint.textContent = said.hint;
  els.overlay.classList.toggle('is-actionable', openable || canGoIn(node) || (node.rest && node.parent !== state.view));
  return node;
}

// A row in the side list pointed at: the same outline on the map, if the node got a rect.
function hoverNode(node) {
  if (!state.rects) return;
  const top = state.rects.top;
  let index = -1;
  for (let i = top.first; node && i < top.first + top.count; i++) {
    if (state.rects.node[i] === node) index = i;
  }
  setHover(index);
  hideTip();
  if (!node) return;
  // The status line says it either way, rect or not.
  els.hover.textContent = describe(node, state.view, canOpen(node, opener)).line;
}

function activate(node) {
  if (!node) return;
  if (node.rest) {
    if (node.parent !== state.view) go(node.parent);
    return;
  }
  if (canGoIn(node)) {
    go(node);
    return;
  }
  const problem = openNode(node, opener);
  if (problem) els.hover.textContent = `${node.name}: ${problem}`;
}

function pointAt(event) {
  const box = els.overlay.getBoundingClientRect();
  return hitTest(state.rects, event.clientX - box.left, event.clientY - box.top);
}

els.overlay.addEventListener('pointermove', (event) => {
  if (!state.rects) return;
  const index = pointAt(event);
  if (index !== state.hover) setHover(index);
  if (index >= 0) {
    els.tip.hidden = false;
    placeTip(event.clientX, event.clientY);
  }
});

els.overlay.addEventListener('pointerleave', () => setHover(-1));

els.overlay.addEventListener('click', (event) => {
  if (!state.rects) return;
  const index = pointAt(event);
  if (index >= 0) activate(state.rects.node[index]);
});

// --- measuring ---------------------------------------------------------------------------------

function startScan(where) {
  if (state.scan) state.scan.stopped = true;
  const scan = { stopped: false };
  state.scan = scan;
  els.busyWhere.textContent = where;
  els.busyFiles.textContent = '0 files';
  els.busyBytes.textContent = '0 B';
  els.busyAt.textContent = '';
  els.busyBar.hidden = true;
  showPanel('busy');
  updateActions();
  els.stop.focus();
  return scan;
}

function endScan(scan) {
  if (state.scan === scan) state.scan = null;
  updateActions();
}

function progress({ files, total, bytes, at }) {
  els.busyFiles.textContent = total ? `${formatCount(files)} of ${plural(total, 'file', 'files')}` : plural(files, 'file', 'files');
  els.busyBytes.textContent = formatBytes(bytes);
  if (at) els.busyAt.textContent = at;
  if (total) {
    els.busyBar.hidden = false;
    els.busyFill.style.width = `${(files / total) * 100}%`;
  }
}

async function measurePixos(path) {
  if (!fs) {
    showEmpty('PixOS’s filesystem is not reachable from here: open Disk Treemap inside PixOS.');
    return;
  }
  const where = normalizePath(path);
  const scan = startScan(where);
  const began = performance.now();
  try {
    const result = await scanPixos({
      fs,
      path: where,
      mounts: listMountPoints(),
      onProgress: progress,
      stopped: () => scan.stopped,
    });
    if (scan.stopped) return;
    endScan(scan);
    state.source = 'pixos';
    state.fsPath = where;
    show(result.root, { took: performance.now() - began, unreadable: result.unreadable, mounts: result.mounts });
  } catch (error) {
    if (scan.stopped) return;
    endScan(scan);
    showEmpty(`${where} could not be measured: ${error?.message || error}`);
  }
}

async function measureLocal(files, adding) {
  const scan = startScan(adding ? 'Adding a folder' : 'Reading the folder');
  const began = performance.now();
  const root = await scanFiles(files, { onProgress: progress, stopped: () => scan.stopped });
  if (scan.stopped) return;
  endScan(scan);
  if (!root) {
    if (state.root) restore();
    else showEmpty();
    return;
  }
  const combined = adding && state.source === 'local' && state.root ? combine(state.root, root) : root;
  state.source = 'local';
  state.fsPath = null;
  show(combined, { took: performance.now() - began });
}

// Stopping a scan goes back to what was there before it, if anything was.
function restore() {
  showPanel('map');
  updateActions();
  queueRelayout();
}

function stopScan() {
  const scan = state.scan;
  if (!scan) return;
  scan.stopped = true;
  endScan(scan);
  if (state.root) restore();
  else showEmpty();
}

let adding = false;
function pickFolder(add) {
  if (state.scan) return;
  adding = add;
  els.input.click();
}

els.input.addEventListener('change', () => {
  const files = els.input.files;
  if (files && files.length) {
    void measureLocal(Array.from(files), adding);
  }
  els.input.value = '';
});

els.pick.addEventListener('click', () => pickFolder(false));
els.pickEmpty.addEventListener('click', () => pickFolder(false));
els.add.addEventListener('click', () => pickFolder(true));
els.clear.addEventListener('click', () => showEmpty());
els.rescan.addEventListener('click', () => {
  const keep = state.view;
  const wanted = keep ? crumbs(keep).slice(1).map((c) => c.node.name) : [];
  void measurePixos(state.fsPath).then(() => {
    // Back to the folder that was being looked at, if it is still there.
    let at = state.root;
    for (const name of wanted) {
      const next = at?.kids?.find((kid) => kid.name === name && kid.kids !== null);
      if (!next) break;
      at = next;
    }
    if (at && at !== state.view) go(at);
  });
});
els.measureRoot.addEventListener('click', () => void measurePixos('/'));
els.stop.addEventListener('click', stopScan);
els.up.addEventListener('click', up);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.scan) {
    event.preventDefault();
    stopScan();
    return;
  }
  const typing = event.target instanceof HTMLInputElement;
  if (!typing && state.view && (event.key === 'Backspace' || (event.altKey && event.key === 'ArrowUp'))) {
    event.preventDefault();
    up();
  }
});

new ResizeObserver(() => {
  if (state.view && !state.scan) queueRelayout();
}).observe(els.map);

// The canvas draws its text in DM Mono, and a canvas does not ask for a face the way an element
// does: asked for here, and drawn again once it is in. `document.fonts.ready` would not do — it can
// settle before anything has asked for the face at all.
Promise.all(['400 10px "DM Mono"', '500 11px "DM Mono"'].map((face) => document.fonts?.load(face))).then(() => {
  if (state.view && !state.scan) relayout();
}, () => {});

// The shell, or anything else in PixOS, can point an open window at another folder.
window.openPath = (path) => void measurePixos(path);

const query = new URLSearchParams(location.search);
const asked = (query.get('path') || query.get('dir') || '').trim();
showEmpty();
if (asked) void measurePixos(asked);
