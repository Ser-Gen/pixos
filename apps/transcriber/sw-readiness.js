function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPixosEmbedded() {
  try {
    return (
      window.parent !== window && /\/__browserfs__\//.test(globalThis.location?.pathname ?? '')
    );
  } catch {
    return false;
  }
}

export function getServiceWorkerReadinessSnapshot() {
  return {
    secureContext: globalThis.isSecureContext === true,
    serviceWorkerSupported: 'serviceWorker' in navigator,
    controlling: Boolean(navigator.serviceWorker?.controller),
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
  };
}

export function isServiceWorkerEnvironmentReady() {
  const snap = getServiceWorkerReadinessSnapshot();
  return snap.secureContext && snap.serviceWorkerSupported && snap.controlling && snap.crossOriginIsolated;
}

function readinessReason(snap, registration) {
  if (!snap.secureContext) {
    return {
      code: 'no-secure-context',
      message: 'Нужен HTTPS или localhost — Service Worker недоступен, кэш модели не работает.',
      canReload: false,
    };
  }
  if (!snap.serviceWorkerSupported) {
    return {
      code: 'no-sw-support',
      message: 'Браузер не поддерживает Service Worker (часто в приватном режиме).',
      canReload: false,
    };
  }
  if (!snap.crossOriginIsolated) {
    let message =
      'Страница ещё не cross-origin isolated (COOP/COEP). Перезагрузите, чтобы активировать Service Worker.';
    if (isPixosEmbedded()) {
      try {
        if (!window.parent.crossOriginIsolated) {
          message =
            'PixOS не в режиме cross-origin isolated (нужен COOP/COEP на оболочке). Перезагрузите PixOS — после этого загрузится модель WASM.';
        }
      } catch {
        /* ignore */
      }
    }
    return {
      code: 'not-isolated',
      message,
      canReload: true,
    };
  }
  if (!snap.controlling) {
    if (registration?.active) {
      return {
        code: 'needs-reload',
        message:
          'Service Worker установлен, но ещё не управляет страницей. Перезагрузите — без этого модель (~320 MB) скачается заново каждый раз.',
        canReload: true,
      };
    }
    return {
      code: 'not-registered',
      message:
        'Service Worker не активен. Перезагрузите страницу — иначе кэш OPFS не используется и модель будет качаться с CDN каждый раз.',
      canReload: true,
    };
  }
  return { code: 'ready', message: '', canReload: false };
}

/**
 * Ждёт controller + crossOriginIsolated. Не стартует загрузку WASM, пока SW не готов.
 */
export async function waitForServiceWorkerControl({ timeoutMs = 12000 } = {}) {
  if (isServiceWorkerEnvironmentReady()) {
    return { ready: true, reason: readinessReason(getServiceWorkerReadinessSnapshot(), null) };
  }

  if (!('serviceWorker' in navigator) || !globalThis.isSecureContext) {
    const snap = getServiceWorkerReadinessSnapshot();
    return { ready: false, reason: readinessReason(snap, null) };
  }

  let registration = null;
  try {
    registration = await Promise.race([
      navigator.serviceWorker.ready,
      delay(Math.min(timeoutMs, 4000)),
    ]);
  } catch {
    registration = await navigator.serviceWorker.getRegistration().catch(() => null);
  }

  if (!registration) {
    registration = await navigator.serviceWorker.getRegistration().catch(() => null);
  }

  await Promise.race([
    new Promise((resolve) => {
      if (isServiceWorkerEnvironmentReady()) {
        resolve();
        return;
      }
      const onChange = () => {
        if (isServiceWorkerEnvironmentReady()) {
          navigator.serviceWorker.removeEventListener('controllerchange', onChange);
          resolve();
        }
      };
      navigator.serviceWorker.addEventListener('controllerchange', onChange);
    }),
    delay(timeoutMs),
  ]);

  const snap = getServiceWorkerReadinessSnapshot();
  if (isServiceWorkerEnvironmentReady()) {
    return { ready: true, reason: readinessReason(snap, registration) };
  }

  return { ready: false, reason: readinessReason(snap, registration) };
}
