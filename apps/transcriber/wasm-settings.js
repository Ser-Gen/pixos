const STORAGE_KEY = 'gigaam-wasm-asset-urls';

function pickSearchParam(params, keys) {
  for (const key of keys) {
    const value = params.get(key);
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

/**
 * GET-параметры страницы: ?wasm=…&data=… (и альтернативные имена).
 */
export function parseWasmAssetUrlsFromQuery(search = globalThis.location?.search ?? '') {
  const params = new URLSearchParams(search);
  const wasmBinaryUrl = pickSearchParam(params, [
    'wasm',
    'wasm_url',
    'wasmUrl',
    'wasmBinaryUrl',
  ]);
  const wasmDataUrl = pickSearchParam(params, [
    'data',
    'wasm_data',
    'wasmData',
    'wasmDataUrl',
    'dataUrl',
  ]);
  return {
    wasmBinaryUrl,
    wasmDataUrl,
    hasAny: Boolean(wasmBinaryUrl || wasmDataUrl),
  };
}

export function loadWasmAssetUrls() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { wasmBinaryUrl: '', wasmDataUrl: '' };
    }
    const parsed = JSON.parse(raw);
    return {
      wasmBinaryUrl: typeof parsed.wasmBinaryUrl === 'string' ? parsed.wasmBinaryUrl.trim() : '',
      wasmDataUrl: typeof parsed.wasmDataUrl === 'string' ? parsed.wasmDataUrl.trim() : '',
    };
  } catch {
    return { wasmBinaryUrl: '', wasmDataUrl: '' };
  }
}

export function saveWasmAssetUrls(urls) {
  const wasmBinaryUrl = (urls.wasmBinaryUrl || '').trim();
  const wasmDataUrl = (urls.wasmDataUrl || '').trim();
  if (wasmBinaryUrl) {
    new URL(wasmBinaryUrl);
  }
  if (wasmDataUrl) {
    new URL(wasmDataUrl);
  }
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ wasmBinaryUrl, wasmDataUrl }),
  );
  return { wasmBinaryUrl, wasmDataUrl };
}

export function applyWasmAssetUrls(urls) {
  const wasmBinaryUrl = (urls?.wasmBinaryUrl || '').trim();
  const wasmDataUrl = (urls?.wasmDataUrl || '').trim();
  if (typeof globalThis.setRuntimeWasmAssetUrls === 'function') {
    globalThis.setRuntimeWasmAssetUrls(wasmBinaryUrl, wasmDataUrl);
  }
  globalThis.WASM_BINARY_URL = wasmBinaryUrl;
  globalThis.WASM_DATA_URL = wasmDataUrl;
  notifyServiceWorkerWasmUrls(wasmBinaryUrl, wasmDataUrl);
  return { wasmBinaryUrl, wasmDataUrl };
}

function notifyServiceWorkerWasmUrls(wasmBinaryUrl, wasmDataUrl) {
  const payload = {
    type: 'set-wasm-urls',
    wasmBinaryUrl,
    wasmDataUrl,
  };
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
    return;
  }
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage(payload);
  }
  navigator.serviceWorker.ready
    .then((reg) => {
      reg.active?.postMessage(payload);
    })
    .catch(() => {});
}

export function buildRecognizerWorkerUrl(workerScriptUrl) {
  const base =
    typeof workerScriptUrl === 'string'
      ? workerScriptUrl
      : workerScriptUrl instanceof URL
        ? workerScriptUrl.href
        : String(workerScriptUrl);
  const url = new URL(base, globalThis.location?.href);
  const { wasmBinaryUrl, wasmDataUrl } = loadWasmAssetUrls();
  if (wasmBinaryUrl) {
    url.searchParams.set('wasm', wasmBinaryUrl);
  }
  if (wasmDataUrl) {
    url.searchParams.set('data', wasmDataUrl);
  }
  return url.href;
}

export function initWasmAssetUrlsFromStorage() {
  return applyWasmAssetUrls(loadWasmAssetUrls());
}

/** Query → localStorage → apply (до создания recognizer worker). */
export function initWasmAssetUrls() {
  const fromQuery = parseWasmAssetUrlsFromQuery();
  if (fromQuery.hasAny) {
    const stored = loadWasmAssetUrls();
    const merged = {
      wasmBinaryUrl: fromQuery.wasmBinaryUrl || stored.wasmBinaryUrl,
      wasmDataUrl: fromQuery.wasmDataUrl || stored.wasmDataUrl,
    };
    try {
      saveWasmAssetUrls(merged);
    } catch {
      return applyWasmAssetUrls(stored);
    }
    return applyWasmAssetUrls(merged);
  }
  return initWasmAssetUrlsFromStorage();
}
