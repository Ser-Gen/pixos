import { scanFileList, mergeScanResults } from './scan.js';
import { layoutTreemap } from './treemap.js';
import { TreemapRenderer } from './render.js';
import { formatBytes, formatPercent } from './format.js';
import {
  isPixosEmbedded,
  parsePathFromQuery,
  scanPixosPath,
} from './scan-pixos.js';
import { canOpenFile, openTreemapFile } from './open-file.js';

const els = {
  btnOpen: document.getElementById('btn-open'),
  btnAddFolder: document.getElementById('btn-add-folder'),
  btnReset: document.getElementById('btn-reset'),
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
  hoverTooltip: document.getElementById('hover-tooltip'),
  hoverTooltipName: document.querySelector('#hover-tooltip .hover-tooltip__name'),
  hoverTooltipMeta: document.querySelector('#hover-tooltip .hover-tooltip__meta'),
  hoverTooltipHint: document.querySelector('#hover-tooltip .hover-tooltip__hint'),
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
  scanRootPath: null,
  localFileMap: null,
  combined: false,
  localSelection: false,
};

function isLocalSelectionActive() {
  return state.localSelection && !state.scanRootPath;
}

function updateLocalFolderControls() {
  const showLocalActions = isLocalSelectionActive();
  els.btnAddFolder.hidden = !showLocalActions;
  els.btnReset.hidden = !showLocalActions;
  if (!pixosEmbedded) {
    els.btnOpen.hidden = showLocalActions;
  }
  configureStandaloneUi();
}

function setScanning(active) {
  state.scanning = active;
  els.btnOpen.disabled = active;
  els.btnOpenEmpty.disabled = active;
  els.btnAddFolder.disabled = active;
  els.btnReset.disabled = active;
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
  hideHoverTooltip();
  refreshLayout();
}

function drillDown(node) {
  if (node.isFile || node.children.size === 0) return;
  state.pathStack.push(node);
  state.currentNode = node;
  state.hoverIndex = -1;
  els.hoverInfo.textContent = '—';
  hideHoverTooltip();
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
  hideHoverTooltip();
  refreshLayout();
}

function hasLocalFileSource() {
  return state.localFileMap instanceof Map && state.localFileMap.size > 0;
}

function canOpenNode(node) {
  return canOpenFile(node, {
    pixosEmbedded: pixosEmbedded && !hasLocalFileSource(),
    hasLocalSource: hasLocalFileSource(),
    localFile: state.localFileMap?.get(node.path),
  });
}

const TOOLTIP_OFFSET = 14;
const TOOLTIP_MARGIN = 8;

function buildHoverDetails(node) {
  const total = state.currentNode?.size ?? state.totalBytes;
  const type = node.isFile ? 'файл' : 'папка';
  let hint = '';
  if (node.isFile && canOpenNode(node)) {
    hint = 'Щелчок — открыть';
  } else if (!node.isFile && node.children.size > 0) {
    hint = 'Щелчок — войти';
  }
  const meta = `${formatBytes(node.size)} · ${formatPercent(node.size, total)} · ${type}`;
  const line = hint ? `${node.name} · ${meta} · ${hint.toLowerCase()}` : `${node.name} · ${meta}`;
  return { name: node.name, meta, hint, line };
}

function hideHoverTooltip() {
  els.hoverTooltip.hidden = true;
}

function positionHoverTooltip(clientX, clientY) {
  const tip = els.hoverTooltip;
  tip.hidden = false;

  const rect = tip.getBoundingClientRect();
  let x = clientX + TOOLTIP_OFFSET;
  let y = clientY + TOOLTIP_OFFSET;

  if (x + rect.width > window.innerWidth - TOOLTIP_MARGIN) {
    x = clientX - rect.width - TOOLTIP_OFFSET;
  }
  if (y + rect.height > window.innerHeight - TOOLTIP_MARGIN) {
    y = clientY - rect.height - TOOLTIP_OFFSET;
  }

  tip.style.left = `${Math.max(TOOLTIP_MARGIN, x)}px`;
  tip.style.top = `${Math.max(TOOLTIP_MARGIN, y)}px`;
}

function updateHoverTooltip(node, clientX, clientY) {
  if (!node || clientX == null || clientY == null) {
    hideHoverTooltip();
    return;
  }

  const details = buildHoverDetails(node);
  els.hoverTooltipName.textContent = details.name;
  els.hoverTooltipName.title = details.name;
  els.hoverTooltipMeta.textContent = details.meta;
  els.hoverTooltipHint.textContent = details.hint;
  positionHoverTooltip(clientX, clientY);
}

function updateHoverInfo(index, clientX, clientY) {
  const rect = renderer.getRect(index);
  if (!rect) {
    els.hoverInfo.textContent = '—';
    hideHoverTooltip();
    return;
  }

  const details = buildHoverDetails(rect.data);
  els.hoverInfo.textContent = details.line;
  updateHoverTooltip(rect.data, clientX, clientY);
}

function updateCursor() {
  const rect = renderer.getRect(state.hoverIndex);
  const isFolder = rect && !rect.data.isFile && rect.data.children.size > 0;
  const isOpenableFile = rect
    && rect.data.isFile
    && canOpenNode(rect.data);
  els.canvas.classList.toggle('is-folder-hover', isFolder);
  els.canvas.classList.toggle('is-file-hover', isOpenableFile);
  if (state.hoverIndex < 0) {
    els.canvas.style.cursor = '';
  } else {
    els.canvas.style.cursor = (isFolder || isOpenableFile) ? 'pointer' : 'default';
  }
}

function openNodeFile(node) {
  const result = openTreemapFile(node, {
    pixosEmbedded,
    scanRootPath: state.scanRootPath,
    localFileMap: state.localFileMap,
  });
  if (!result.ok && result.message) {
    els.hoverInfo.textContent = result.message;
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
  state.scanRootPath = result.scanRootPath ?? null;
  state.localFileMap = result.localFileMap ?? null;
  state.combined = result.combined ?? false;
  state.localSelection = result.localFileMap instanceof Map;

  els.emptyState.hidden = true;
  els.canvas.hidden = false;
  updateLocalFolderControls();
  refreshLayout();
  return true;
}

function resetLocalSelection() {
  state.root = null;
  state.currentNode = null;
  state.pathStack = [];
  state.layoutRects = [];
  state.totalBytes = 0;
  state.fileCount = 0;
  state.folderCount = 0;
  state.hoverIndex = -1;
  state.scanRootPath = null;
  state.localFileMap = null;
  state.combined = false;
  state.localSelection = false;

  els.emptyState.hidden = false;
  els.canvas.hidden = true;
  renderer.clear();
  els.canvas.classList.remove('is-folder-hover');
  els.canvas.classList.remove('is-file-hover');
  els.hoverInfo.textContent = '—';
  hideHoverTooltip();
  els.stats.textContent = '';
  els.breadcrumb.replaceChildren();
  updateLocalFolderControls();
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
    const incoming = await scanFileList(files, ({ current, total }) => {
      updateProgress(current, total);
    });
    if (!incoming?.root) {
      return;
    }

    const merged = state.localSelection
      ? mergeScanResults({
        root: state.root,
        fileCount: state.fileCount,
        folderCount: state.folderCount,
        localFileMap: state.localFileMap,
        combined: state.combined,
      }, incoming)
      : incoming;

    applyScanResult(merged);
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
    els.btnAddFolder.textContent = 'Добавить локальную папку';
    els.btnOpenEmpty.textContent = 'Локальная папка';
    return;
  }
  els.btnOpen.textContent = 'Выбрать папку';
  els.btnAddFolder.textContent = 'Добавить папку';
  els.btnOpenEmpty.textContent = 'Выбрать папку';
}

els.btnOpen.addEventListener('click', openFolderPicker);
els.btnAddFolder.addEventListener('click', openFolderPicker);
els.btnReset.addEventListener('click', () => {
  if (!state.scanning) resetLocalSelection();
});
els.btnOpenEmpty.addEventListener('click', openFolderPicker);
els.folderInput.addEventListener('change', handleFolderSelect);

els.canvas.addEventListener('mousemove', (e) => {
  const index = renderer.hitTest(e.clientX, e.clientY);
  state.hoverIndex = index;
  renderer.setHoverIndex(index);
  updateHoverInfo(index, e.clientX, e.clientY);
  updateCursor();
});

els.canvas.addEventListener('mouseleave', () => {
  state.hoverIndex = -1;
  renderer.setHoverIndex(-1);
  els.hoverInfo.textContent = '—';
  hideHoverTooltip();
  els.canvas.style.cursor = '';
  els.canvas.classList.remove('is-folder-hover');
  els.canvas.classList.remove('is-file-hover');
});

els.canvas.addEventListener('click', (e) => {
  const index = renderer.hitTest(e.clientX, e.clientY);
  const rect = renderer.getRect(index);
  if (!rect) return;

  if (rect.data.isFile) {
    if (canOpenNode(rect.data)) {
      openNodeFile(rect.data);
    }
    return;
  }

  if (rect.data.children.size > 0) {
    drillDown(rect.data);
  }
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
updateLocalFolderControls();

const pathFromQuery = parsePathFromQuery();
if (pathFromQuery) {
  void openPixosPath(pathFromQuery);
}
