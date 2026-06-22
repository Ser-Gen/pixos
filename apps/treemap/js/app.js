import { scanFileList } from './scan.js';
import { layoutTreemap } from './treemap.js';
import { TreemapRenderer } from './render.js';
import { formatBytes, formatPercent } from './format.js';
import {
  isPixosEmbedded,
  parsePathFromQuery,
  scanPixosPath,
} from './scan-pixos.js';

const els = {
  btnOpen: document.getElementById('btn-open'),
  btnOpenEmpty: document.getElementById('btn-open-empty'),
  folderInput: document.getElementById('folder-input'),
  breadcrumb: document.getElementById('breadcrumb'),
  stats: document.getElementById('stats'),
  main: document.getElementById('main'),
  emptyState: document.getElementById('empty-state'),
  canvas: document.getElementById('treemap-canvas'),
  progressWrap: document.getElementById('progress-wrap'),
  progressBar: document.getElementById('progress-bar'),
  progressText: document.getElementById('progress-text'),
  hoverInfo: document.getElementById('hover-info'),
};

const renderer = new TreemapRenderer(els.canvas);
const pixosEmbedded = isPixosEmbedded();

const state = {
  root: null,
  currentNode: null,
  pathStack: [],
  layoutRects: [],
  totalBytes: 0,
  fileCount: 0,
  folderCount: 0,
  scanning: false,
  hoverIndex: -1,
};

function setScanning(active) {
  state.scanning = active;
  els.btnOpen.disabled = active;
  els.btnOpenEmpty.disabled = active;
  els.progressWrap.hidden = !active;
  if (active) {
    els.canvas.hidden = true;
  }
}

function updateProgress(current, total) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  els.progressBar.style.setProperty('--progress', `${pct}%`);
  if (total > 0) {
    els.progressText.textContent = `${current.toLocaleString('ru-RU')} / ${total.toLocaleString('ru-RU')} файлов`;
    return;
  }
  els.progressText.textContent = `${current.toLocaleString('ru-RU')} файлов`;
}

function expandSingleFolderChain() {
  while (
    state.currentNode
    && !state.currentNode.isFile
    && state.currentNode.sortedChildren?.length === 1
    && !state.currentNode.sortedChildren[0].isFile
  ) {
    const child = state.currentNode.sortedChildren[0];
    state.pathStack.push(child);
    state.currentNode = child;
  }
}

function getCurrentChildren() {
  if (!state.currentNode || state.currentNode.isFile) return [];
  return state.currentNode.sortedChildren || [];
}

function refreshLayout() {
  const bounds = els.main.getBoundingClientRect();
  renderer.resize(bounds.width, bounds.height);

  const children = getCurrentChildren();
  state.layoutRects = layoutTreemap(children, bounds.width, bounds.height);
  renderer.setLayout(state.layoutRects);
  updateBreadcrumb();
  updateStats();
  updateCursor();
}

function updateStats() {
  if (!state.root) {
    els.stats.textContent = '';
    return;
  }
  const currentSize = state.currentNode?.size ?? state.totalBytes;
  els.stats.textContent = [
    formatBytes(currentSize),
    `${state.fileCount.toLocaleString('ru-RU')} файлов`,
    `${state.folderCount.toLocaleString('ru-RU')} папок`,
  ].join(' · ');
}

function updateBreadcrumb() {
  els.breadcrumb.replaceChildren();

  const items = state.pathStack.length > 0
    ? [state.root, ...state.pathStack]
    : state.root ? [state.root] : [];

  items.forEach((node, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '/';
      els.breadcrumb.appendChild(sep);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'breadcrumb-item';
    btn.textContent = node.name;
    btn.title = node.path;

    const isLast = i === items.length - 1;
    if (isLast) {
      btn.classList.add('is-current');
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => navigateToIndex(i));
    }

    els.breadcrumb.appendChild(btn);
  });
}

function navigateToIndex(index) {
  if (!state.root) return;
  if (index === 0) {
    state.currentNode = state.root;
    state.pathStack = [];
  } else {
    state.pathStack = state.pathStack.slice(0, index);
    state.currentNode = state.pathStack[state.pathStack.length - 1];
  }
  state.hoverIndex = -1;
  els.hoverInfo.textContent = '—';
  refreshLayout();
}

function drillDown(node) {
  if (node.isFile || node.children.size === 0) return;
  state.pathStack.push(node);
  state.currentNode = node;
  state.hoverIndex = -1;
  els.hoverInfo.textContent = '—';
  refreshLayout();
}

function navigateUp() {
  if (state.pathStack.length === 0) return;
  state.pathStack.pop();
  state.currentNode = state.pathStack.length > 0
    ? state.pathStack[state.pathStack.length - 1]
    : state.root;
  state.hoverIndex = -1;
  els.hoverInfo.textContent = '—';
  refreshLayout();
}

function updateHoverInfo(index) {
  const rect = renderer.getRect(index);
  if (!rect) {
    els.hoverInfo.textContent = '—';
    return;
  }
  const node = rect.data;
  const total = state.currentNode?.size ?? state.totalBytes;
  const type = node.isFile ? 'файл' : 'папка';
  els.hoverInfo.textContent = `${node.name} · ${formatBytes(node.size)} · ${formatPercent(node.size, total)} · ${type}`;
}

function updateCursor() {
  const rect = renderer.getRect(state.hoverIndex);
  const isFolder = rect && !rect.data.isFile && rect.data.children.size > 0;
  els.canvas.classList.toggle('is-folder-hover', isFolder);
  if (state.hoverIndex < 0) {
    els.canvas.style.cursor = '';
  } else {
    els.canvas.style.cursor = isFolder ? 'pointer' : 'default';
  }
}

function applyScanResult(result) {
  if (!result?.root) {
    return false;
  }

  state.root = result.root;
  state.currentNode = result.root;
  state.pathStack = [];
  expandSingleFolderChain();
  state.totalBytes = result.root.size;
  state.fileCount = result.fileCount;
  state.folderCount = result.folderCount;

  els.emptyState.hidden = true;
  els.canvas.hidden = false;
  refreshLayout();
  return true;
}

async function runScan(scanFn) {
  setScanning(true);
  updateProgress(0, 0);
  try {
    const result = await scanFn(({ current, total }) => {
      updateProgress(current, total);
    });
    applyScanResult(result);
  } finally {
    setScanning(false);
  }
}

async function handleFolderSelect(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  setScanning(true);
  updateProgress(0, files.length);

  try {
    const result = await scanFileList(files, ({ current, total }) => {
      updateProgress(current, total);
    });
    applyScanResult(result);
  } finally {
    setScanning(false);
    els.folderInput.value = '';
  }
}

function openFolderPicker() {
  if (!state.scanning) els.folderInput.click();
}

async function openPixosPath(fsPath) {
  const normalized = String(fsPath || '').trim();
  if (!normalized || state.scanning) {
    return;
  }
  await runScan((onProgress) => scanPixosPath(normalized, onProgress));
}

function configureStandaloneUi() {
  if (pixosEmbedded) {
    els.btnOpen.textContent = 'Локальная папка';
    els.btnOpenEmpty.textContent = 'Локальная папка';
  }
}

els.btnOpen.addEventListener('click', openFolderPicker);
els.btnOpenEmpty.addEventListener('click', openFolderPicker);
els.folderInput.addEventListener('change', handleFolderSelect);

els.canvas.addEventListener('mousemove', (e) => {
  const index = renderer.hitTest(e.clientX, e.clientY);
  state.hoverIndex = index;
  renderer.setHoverIndex(index);
  updateHoverInfo(index);
  updateCursor();
});

els.canvas.addEventListener('mouseleave', () => {
  state.hoverIndex = -1;
  renderer.setHoverIndex(-1);
  els.hoverInfo.textContent = '—';
  els.canvas.style.cursor = '';
  els.canvas.classList.remove('is-folder-hover');
});

els.canvas.addEventListener('click', (e) => {
  const index = renderer.hitTest(e.clientX, e.clientY);
  const rect = renderer.getRect(index);
  if (rect && !rect.data.isFile && rect.data.children.size > 0) {
    drillDown(rect.data);
  }
});

els.canvas.addEventListener('dblclick', () => {
  navigateUp();
});

const resizeObserver = new ResizeObserver(() => {
  if (state.root && !state.scanning) refreshLayout();
});
resizeObserver.observe(els.main);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Backspace' && state.root && !state.scanning) {
    e.preventDefault();
    navigateUp();
  }
});

window.openPath = function openPath(fsPath) {
  void openPixosPath(fsPath);
};

configureStandaloneUi();

const pathFromQuery = parsePathFromQuery();
if (pathFromQuery) {
  void openPixosPath(pathFromQuery);
}
