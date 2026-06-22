/**
 * URL бинарника и моделей sherpa-onnx WASM на CDN/отдельном хосте.
 *
 * Пустая строка — загрузка с того же origin (./sherpa-onnx-wasm.wasm / .data).
 *
 * WASM_CACHE_VERSION — смените при обновлении .wasm / .data.
 * В OPFS хранятся только файлы текущей версии; при активации service worker
 * старые sherpa-onnx-wasm-* удаляются (не копятся v1 + v2 + v3 на диске).
 *
 * Пример:
 *   var WASM_BINARY_URL = 'https://cdn.example.com/gigaam/sherpa-onnx-wasm.wasm';
 *   var WASM_DATA_URL = 'https://cdn.example.com/gigaam/sherpa-onnx-wasm.data';
 */
var WASM_CACHE_VERSION = '4';
var WASM_BINARY_URL = '';
var WASM_DATA_URL = '';
/** Задаётся из UI/query до fetch (SW не имеет localStorage). */
var RUNTIME_WASM_BINARY_URL = '';
var RUNTIME_WASM_DATA_URL = '';

function setRuntimeWasmAssetUrls(wasmBinaryUrl, wasmDataUrl) {
  RUNTIME_WASM_BINARY_URL = typeof wasmBinaryUrl === 'string' ? wasmBinaryUrl.trim() : '';
  RUNTIME_WASM_DATA_URL = typeof wasmDataUrl === 'string' ? wasmDataUrl.trim() : '';
}

function readStoredWasmAssetUrls() {
  if (typeof localStorage === 'undefined') {
    return { wasmBinaryUrl: '', wasmDataUrl: '' };
  }
  try {
    var raw = localStorage.getItem('gigaam-wasm-asset-urls');
    if (!raw) {
      return { wasmBinaryUrl: '', wasmDataUrl: '' };
    }
    var parsed = JSON.parse(raw);
    return {
      wasmBinaryUrl: typeof parsed.wasmBinaryUrl === 'string' ? parsed.wasmBinaryUrl.trim() : '',
      wasmDataUrl: typeof parsed.wasmDataUrl === 'string' ? parsed.wasmDataUrl.trim() : '',
    };
  } catch (e) {
    return { wasmBinaryUrl: '', wasmDataUrl: '' };
  }
}

function pickWasmBinaryUrl(baseHref, stored, runtime) {
  if (runtime && runtime.trim()) {
    return runtime.trim();
  }
  if (stored && stored.trim()) {
    return stored.trim();
  }
  if (typeof WASM_BINARY_URL === 'string' && WASM_BINARY_URL.trim()) {
    return WASM_BINARY_URL.trim();
  }
  return new URL('sherpa-onnx-wasm.wasm', baseHref || './').href;
}

function pickWasmDataUrl(baseHref, stored, runtime) {
  if (runtime && runtime.trim()) {
    return runtime.trim();
  }
  if (stored && stored.trim()) {
    return stored.trim();
  }
  if (typeof WASM_DATA_URL === 'string' && WASM_DATA_URL.trim()) {
    return WASM_DATA_URL.trim();
  }
  return new URL('sherpa-onnx-wasm.data', baseHref || './').href;
}

function getWasmCacheName() {
  return 'gigaam-wasm-' + WASM_CACHE_VERSION;
}

function getWasmBinaryOpfsName() {
  return 'sherpa-onnx-wasm-' + WASM_CACHE_VERSION + '.wasm';
}

function getWasmDataOpfsName() {
  return 'sherpa-onnx-wasm-' + WASM_CACHE_VERSION + '.data';
}

function resolveWasmAssetUrls(baseHref) {
  var base = baseHref || './';
  var stored = readStoredWasmAssetUrls();
  var wasm = pickWasmBinaryUrl(base, stored.wasmBinaryUrl, RUNTIME_WASM_BINARY_URL);
  var data = pickWasmDataUrl(base, stored.wasmDataUrl, RUNTIME_WASM_DATA_URL);
  return [wasm, data];
}

function isWasmBinaryAssetUrl(urlString, baseHref) {
  var url = new URL(urlString);
  var wasmUrl = resolveWasmAssetUrls(baseHref)[0];
  if (url.href === wasmUrl) {
    return true;
  }
  var leaf = url.pathname.split('/').pop();
  return leaf === 'sherpa-onnx-wasm.wasm' || leaf === getWasmBinaryOpfsName();
}

function isWasmDataAssetUrl(urlString, baseHref) {
  var url = new URL(urlString);
  var dataUrl = resolveWasmAssetUrls(baseHref)[1];
  if (url.href === dataUrl) {
    return true;
  }
  var leaf = url.pathname.split('/').pop();
  return (
    leaf === 'sherpa-onnx-wasm.data' ||
    leaf === 'sherpa-onnx-wasm-main-vad-asr.data' ||
    leaf === getWasmDataOpfsName()
  );
}

function isWasmAssetUrl(urlString, baseHref) {
  return isWasmBinaryAssetUrl(urlString, baseHref) || isWasmDataAssetUrl(urlString, baseHref);
}
