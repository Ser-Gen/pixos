importScripts('./wasm-assets-config.js');

let coepCredentialless = false;
let opfsDataPrefetchPromise = null;

function withCoopCoep(response) {
  if (response.status === 0) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set(
    'Cross-Origin-Embedder-Policy',
    coepCredentialless ? 'credentialless' : 'require-corp',
  );
  if (!coepCredentialless) {
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  }
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function opfsSupported() {
  return typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory;
}

async function opfsRoot() {
  return navigator.storage.getDirectory();
}

async function opfsHasFile(name) {
  if (!opfsSupported()) {
    return false;
  }
  try {
    const root = await opfsRoot();
    await root.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function opfsReadFile(name) {
  const root = await opfsRoot();
  const handle = await root.getFileHandle(name);
  return handle.getFile();
}

async function opfsWriteBuffer(name, buffer) {
  const root = await opfsRoot();
  const handle = await root.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(buffer);
  await writable.close();
}

async function opfsWriteStream(name, response) {
  const root = await opfsRoot();
  const handle = await root.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await response.body.pipeTo(writable);
}

async function purgeOldOpfsAssetFiles() {
  if (!opfsSupported()) {
    return;
  }

  const keep = new Set([getWasmBinaryOpfsName(), getWasmDataOpfsName()]);
  const root = await opfsRoot();

  for await (const [name] of root.entries()) {
    if (name.startsWith('sherpa-onnx-wasm-') && !keep.has(name)) {
      await root.removeEntry(name);
      console.log('[SW] OPFS removed old asset:', name);
    }
  }
}

async function purgeLegacyCacheApiStores() {
  if (typeof caches === 'undefined') {
    return;
  }

  const keep = getWasmCacheName();
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith('gigaam-wasm-') && key !== keep)
      .map((key) => caches.delete(key)),
  );
}

function parseRangeHeader(rangeHeader, size) {
  const match = /^bytes=(\d+)-(\d*)$/i.exec((rangeHeader || '').trim());
  if (!match) {
    return null;
  }

  const start = parseInt(match[1], 10);
  let end = match[2] ? parseInt(match[2], 10) : size - 1;
  if (Number.isNaN(start) || start >= size) {
    return null;
  }
  end = Math.min(end, size - 1);
  if (end < start) {
    return null;
  }
  return { start, end };
}

function binaryResponseFromFile(file, request, contentType) {
  const size = file.size;
  const type = contentType || 'application/octet-stream';
  const rangeHeader = request.headers.get('Range');

  if (!rangeHeader) {
    return new Response(file, {
      status: 200,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(size),
        'Content-Type': type,
      },
    });
  }

  const range = parseRangeHeader(rangeHeader, size);
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` },
    });
  }

  const { start, end } = range;
  const slice = file.slice(start, end + 1);
  return new Response(slice, {
    status: 206,
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${size}`,
    },
  });
}

function isFullFileResponse(response) {
  if (response.status === 200) {
    return true;
  }
  if (response.status !== 206) {
    return false;
  }

  const contentRange = response.headers.get('Content-Range');
  if (!contentRange) {
    return false;
  }

  const match = /bytes (\d+)-(\d+)\/(\d+)/.exec(contentRange);
  if (!match) {
    return false;
  }

  const start = parseInt(match[1], 10);
  const end = parseInt(match[2], 10);
  const total = parseInt(match[3], 10);
  return start === 0 && end === total - 1;
}

function parseContentRangeTotal(contentRange) {
  if (!contentRange) {
    return 0;
  }
  const match = /bytes (\d+)-(\d+)\/(\d+)/.exec(contentRange);
  if (!match) {
    return 0;
  }
  return parseInt(match[3], 10);
}

function parseContentRangeEnd(contentRange) {
  if (!contentRange) {
    return -1;
  }
  const match = /bytes (\d+)-(\d+)\/(\d+)/.exec(contentRange);
  if (!match) {
    return -1;
  }
  return parseInt(match[2], 10);
}

async function broadcastDownloadProgress(detail) {
  if (typeof self.clients?.matchAll !== 'function') {
    return;
  }
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: 'wasm-download-progress', ...detail });
  }
}

function wrapResponseWithDownloadProgress(response, asset) {
  if (!response.body) {
    return response;
  }

  const total = parseInt(response.headers.get('Content-Length') || '0', 10) || 0;
  let loaded = 0;
  let lastBroadcast = 0;

  const progressStream = new TransformStream({
    transform(chunk, controller) {
      loaded += chunk.byteLength;
      const now = Date.now();
      if (now - lastBroadcast >= 250 || (total > 0 && loaded >= total)) {
        lastBroadcast = now;
        broadcastDownloadProgress({ asset, loaded, total });
      }
      controller.enqueue(chunk);
    },
    flush() {
      broadcastDownloadProgress({ asset, loaded, total: total || loaded });
    },
  });

  return new Response(response.body.pipeThrough(progressStream), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function reportRangeFetchProgress(request, response, asset) {
  const rangeHeader = request.headers.get('Range');
  if (!rangeHeader) {
    return;
  }
  const contentRange = response.headers.get('Content-Range');
  const total = parseContentRangeTotal(contentRange);
  const end = parseContentRangeEnd(contentRange);
  if (total <= 0 || end < 0) {
    return;
  }
  broadcastDownloadProgress({ asset, loaded: end + 1, total });
}

function scheduleOpfsPersist(name, response) {
  maybePersistOpfsStream(name, response).catch((err) => {
    console.warn('[SW] OPFS write skipped:', name, err);
  });
}

async function maybePersistOpfsStream(name, response) {
  if (!opfsSupported() || !isFullFileResponse(response)) {
    return;
  }
  if (await opfsHasFile(name)) {
    return;
  }

  try {
    await opfsWriteStream(name, response);
    console.log('[SW] OPFS saved:', name);
  } catch (err) {
    console.warn('[SW] OPFS write skipped:', name, err);
  }
}

async function prefetchDataToOpfs(url) {
  if (!opfsSupported()) {
    return;
  }
  const name = getWasmDataOpfsName();
  if (await opfsHasFile(name)) {
    return;
  }

  const response = await fetch(url);
  if (!response.ok || response.status !== 200) {
    console.warn('[SW] OPFS .data prefetch failed:', response.status);
    return;
  }

  await opfsWriteStream(name, response);
  console.log('[SW] OPFS .data prefetched:', name);
}

function scheduleOpfsDataPrefetch(url) {
  if (opfsDataPrefetchPromise) {
    return opfsDataPrefetchPromise;
  }

  opfsDataPrefetchPromise = prefetchDataToOpfs(url)
    .catch((err) => {
      console.warn('[SW] OPFS .data prefetch error:', err);
    })
    .finally(() => {
      opfsDataPrefetchPromise = null;
    });

  return opfsDataPrefetchPromise;
}

async function fetchOpfsAsset(request, opfsName, contentType, assetLabel = 'data') {
  if (opfsSupported() && (await opfsHasFile(opfsName))) {
    console.log('[SW] OPFS hit:', opfsName);
    const file = await opfsReadFile(opfsName);
    return withCoopCoep(binaryResponseFromFile(file, request, contentType));
  }

  const response = await fetch(request);

  if (
    opfsSupported() &&
    response.ok &&
    isFullFileResponse(response) &&
    !(await opfsHasFile(opfsName))
  ) {
    scheduleOpfsPersist(opfsName, response.clone());
  }

  reportRangeFetchProgress(request, response, assetLabel);

  if (response.ok && !request.headers.get('Range') && response.body) {
    return withCoopCoep(wrapResponseWithDownloadProgress(response, assetLabel));
  }

  return withCoopCoep(response);
}

async function fetchWasmBinaryWithOpfs(request) {
  const name = getWasmBinaryOpfsName();

  if (request.headers.get('Range')) {
    if (opfsSupported() && (await opfsHasFile(name))) {
      console.log('[SW] OPFS hit:', name);
      const file = await opfsReadFile(name);
      return withCoopCoep(binaryResponseFromFile(file, request, 'application/wasm'));
    }
    const response = await fetch(request);
    reportRangeFetchProgress(request, response, 'wasm');
    return withCoopCoep(response);
  }

  if (opfsSupported() && (await opfsHasFile(name))) {
    console.log('[SW] OPFS hit:', name);
    const file = await opfsReadFile(name);
    return withCoopCoep(binaryResponseFromFile(file, request, 'application/wasm'));
  }

  const response = await fetch(request);
  if (!response.ok) {
    return withCoopCoep(response);
  }

  if (opfsSupported() && !(await opfsHasFile(name))) {
    scheduleOpfsPersist(name, response.clone());
  }

  return withCoopCoep(wrapResponseWithDownloadProgress(response, 'wasm'));
}

async function fetchDataAssetWithOpfs(request) {
  return fetchOpfsAsset(request, getWasmDataOpfsName(), 'application/octet-stream', 'data');
}

function isAudioProxyRequest(requestUrl) {
  try {
    const pathname = new URL(requestUrl).pathname;
    return pathname === '/api/audio' || pathname.endsWith('/api/audio');
  } catch {
    return false;
  }
}

async function fetchAudioProxy(request) {
  const requestUrl = new URL(request.url);
  const target = requestUrl.searchParams.get('url');
  if (!target) {
    return withCoopCoep(new Response('Missing url query parameter', { status: 400 }));
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return withCoopCoep(new Response('Invalid url', { status: 400 }));
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return withCoopCoep(new Response('Only http/https URLs are allowed', { status: 400 }));
  }

  const upstream = await fetch(parsed.toString(), { credentials: 'omit' });
  const headers = new Headers(upstream.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  return withCoopCoep(
    new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    }),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(purgeOldOpfsAssetFiles());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([purgeOldOpfsAssetFiles(), purgeLegacyCacheApiStores()]).then(() =>
      self.clients.claim(),
    ),
  );
});

self.addEventListener('message', (event) => {
  if (!event.data) {
    return;
  }
  if (event.data.type === 'deregister') {
    self.registration
      .unregister()
      .then(() => self.clients.matchAll())
      .then((clients) => {
        clients.forEach((client) => client.navigate(client.url));
      });
    return;
  }
  if (event.data.type === 'coepCredentialless') {
    coepCredentialless = event.data.value;
    return;
  }
  if (event.data.type === 'prefetch-data-opfs' && event.data.url) {
    event.waitUntil(scheduleOpfsDataPrefetch(event.data.url));
    return;
  }
  if (event.data.type === 'set-wasm-urls') {
    if (typeof setRuntimeWasmAssetUrls === 'function') {
      setRuntimeWasmAssetUrls(event.data.wasmBinaryUrl, event.data.wasmDataUrl);
    }
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
    return;
  }

  const fetchRequest =
    coepCredentialless && request.mode === 'no-cors'
      ? new Request(request, { credentials: 'omit' })
      : request;

  const scope = self.registration.scope;
  const url = fetchRequest.url;
  if (isAudioProxyRequest(url)) {
    event.respondWith(
      fetchAudioProxy(fetchRequest).catch(async (err) => {
        console.warn('[SW] /api/audio proxy failed:', err);
        return withCoopCoep(new Response('Proxy error', { status: 502 }));
      }),
    );
    return;
  }

  const isData = isWasmDataAssetUrl(url, scope);
  const isWasm = isWasmBinaryAssetUrl(url, scope);

  if (!isData && !isWasm) {
    event.respondWith(fetch(fetchRequest).then(withCoopCoep));
    return;
  }

  const handler = isData ? fetchDataAssetWithOpfs : fetchWasmBinaryWithOpfs;

  event.respondWith(
    handler(fetchRequest).catch(async (err) => {
      console.warn('[SW] respondWith failed, passthrough fetch:', err);
      return withCoopCoep(await fetch(fetchRequest));
    }),
  );
});
