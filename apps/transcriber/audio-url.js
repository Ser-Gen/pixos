const STORAGE_KEY = 'gigaam-audio-url';
const QUERY_AUDIO_KEYS = ['audio', 'audioUrl', 'url'];

function pickAudioSearchParam(params) {
  for (const key of QUERY_AUDIO_KEYS) {
    const value = params.get(key);
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

export function loadAudioUrl() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return typeof raw === 'string' ? raw.trim() : '';
  } catch {
    return '';
  }
}

export function saveAudioUrl(url) {
  const trimmed = (url || '').trim();
  if (trimmed) {
    localStorage.setItem(STORAGE_KEY, trimmed);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  return trimmed;
}

/**
 * Читает URL аудио из query: ?audio=https://…
 * Также поддерживает ключи url и audioUrl.
 */
export function parseAudioUrlFromQuery(search = globalThis.location?.search ?? '') {
  if (!search) {
    return '';
  }
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return pickAudioSearchParam(params);
}

/**
 * @deprecated Старые ссылки #audio=… — fallback для обратной совместимости.
 */
export function parseAudioUrlFromHash(hash = globalThis.location?.hash ?? '') {
  if (!hash || hash === '#') {
    return '';
  }
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) {
    return '';
  }

  if (raw.includes('=')) {
    const params = new URLSearchParams(raw);
    const fromParam = pickAudioSearchParam(params);
    if (fromParam) {
      return fromParam;
    }
  }

  if (/^https?:\/\//i.test(raw)) {
    return decodeURIComponent(raw).trim();
  }

  return '';
}

/** Query, при отсутствии — legacy hash. */
export function parseAudioUrlFromLocation(location = globalThis.location) {
  if (!location) {
    return '';
  }
  return parseAudioUrlFromQuery(location.search) || parseAudioUrlFromHash(location.hash);
}

function stripLegacyAudioHash() {
  if (!globalThis.history?.replaceState || !globalThis.location) {
    return;
  }
  const { pathname, search, hash } = globalThis.location;
  if (!hash || hash === '#') {
    return;
  }
  if (!parseAudioUrlFromHash(hash)) {
    return;
  }
  globalThis.history.replaceState(null, '', `${pathname}${search}`);
}

function removeAudioSearchParams(params) {
  for (const key of QUERY_AUDIO_KEYS) {
    params.delete(key);
  }
}

export function setQueryAudioUrl(url) {
  if (!globalThis.history?.replaceState || !globalThis.location) {
    return;
  }
  const trimmed = (url || '').trim();
  const { pathname, search } = globalThis.location;
  const params = new URLSearchParams(search);

  if (!trimmed) {
    clearQueryAudioUrl();
    return;
  }

  removeAudioSearchParams(params);
  params.set('audio', trimmed);
  const qs = params.toString();
  globalThis.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
  stripLegacyAudioHash();
}

export function clearQueryAudioUrl() {
  if (!globalThis.history?.replaceState || !globalThis.location) {
    return;
  }
  const { pathname, search } = globalThis.location;
  const params = new URLSearchParams(search);
  removeAudioSearchParams(params);
  const qs = params.toString();
  globalThis.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
  stripLegacyAudioHash();
}

export function fileNameFromAudioUrl(url) {
  try {
    const path = new URL(url).pathname;
    const base = path.split('/').filter(Boolean).pop();
    return base ? decodeURIComponent(base) : 'audio-from-url';
  } catch {
    return 'audio-from-url';
  }
}

function proxyAudioUrl(targetUrl) {
  const proxy = new URL('/api/audio', globalThis.location.origin);
  proxy.searchParams.set('url', targetUrl);
  return proxy.toString();
}

/**
 * Загружает аудио по HTTP(S). Сначала прямой fetch (нужен CORS на источнике),
 * при ошибке — same-origin прокси /api/audio (serve.py или service worker).
 */
export async function fetchAudioFromUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) {
    throw new Error('URL не указан');
  }
  new URL(trimmed);

  let directError = null;
  try {
    const res = await fetch(trimmed, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const blob = await res.blob();
    if (!blob.size) {
      throw new Error('Пустой ответ');
    }
    return blob;
  } catch (err) {
    directError = err;
  }

  const proxy = proxyAudioUrl(trimmed);
  const res = await fetch(proxy);
  if (!res.ok) {
    const hint = directError
      ? `Прямой запрос: ${directError.message}. Прокси: HTTP ${res.status}`
      : `HTTP ${res.status}`;
    throw new Error(hint);
  }
  const blob = await res.blob();
  if (!blob.size) {
    throw new Error('Прокси вернул пустой ответ');
  }
  return blob;
}
