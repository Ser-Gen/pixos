/*! COOP/COEP registration + WASM Cache API (based on coi-serviceworker v0.1.7, MIT) */
(() => {
  const COI_STORAGE_PREFIX = 'gigaam-transcriber-coi-';

  function coiStorageKey(name) {
    return COI_STORAGE_PREFIX + name;
  }

  function isPixosEmbedded() {
    try {
      return window.parent !== window && /\/__browserfs__\//.test(window.location.pathname);
    } catch {
      return false;
    }
  }

  function isTranscriberServiceWorker(controller) {
    if (!controller?.scriptURL) {
      return false;
    }
    try {
      const { pathname } = new URL(controller.scriptURL);
      return pathname.includes('/transcriber/service-worker.js');
    } catch {
      return false;
    }
  }

  if (isPixosEmbedded()) {
    if (!window.coi?.quiet) {
      console.log('Transcriber: using PixOS service worker (skip local SW registration).');
    }
    if ('serviceWorker' in navigator) {
      const hadTranscriberController =
        navigator.serviceWorker.controller &&
        isTranscriberServiceWorker(navigator.serviceWorker.controller);
      navigator.serviceWorker.getRegistrations().then((regs) =>
        Promise.all(
          regs.map((reg) => {
            try {
              const scopePath = new URL(reg.scope).pathname;
              if (scopePath.includes('/transcriber/')) {
                return reg.unregister();
              }
            } catch {
              /* ignore */
            }
            return undefined;
          }),
        ),
      ).then(() => {
        if (hadTranscriberController) {
          window.location.reload();
        }
      });
    }
    return;
  }

  const reloadedBySelf = window.sessionStorage.getItem(coiStorageKey('coiReloadedBySelf'));
  window.sessionStorage.removeItem(coiStorageKey('coiReloadedBySelf'));
  const coepDegrading = reloadedBySelf === 'coepdegrade';

  const coi = {
    shouldRegister: () => !reloadedBySelf,
    shouldDeregister: () => false,
    coepCredentialless: () => true,
    coepDegrade: () => true,
    doReload: () => window.location.reload(),
    quiet: false,
    ...window.coi,
  };

  const navigatorRef = navigator;
  const controlling = navigatorRef.serviceWorker && navigatorRef.serviceWorker.controller;
  const ourController = controlling && isTranscriberServiceWorker(controlling);

  if (ourController && !window.crossOriginIsolated) {
    window.sessionStorage.setItem(coiStorageKey('coiCoepHasFailed'), 'true');
  }
  const coepHasFailed = window.sessionStorage.getItem(coiStorageKey('coiCoepHasFailed'));

  if (window.crossOriginIsolated) {
    window.sessionStorage.removeItem(coiStorageKey('coiCoepHasFailed'));
  }

  if (ourController) {
    const reloadToDegrade =
      coi.coepDegrade() && !(coepDegrading || window.crossOriginIsolated);
    navigatorRef.serviceWorker.controller.postMessage({
      type: 'coepCredentialless',
      value: !(reloadToDegrade || (coepHasFailed && coi.coepDegrade())) && coi.coepCredentialless(),
    });
    if (reloadToDegrade) {
      if (!coi.quiet) {
        console.log('Reloading page to degrade COEP.');
      }
      window.sessionStorage.setItem(coiStorageKey('coiReloadedBySelf'), 'coepdegrade');
      coi.doReload('coepdegrade');
    }
    if (coi.shouldDeregister()) {
      navigatorRef.serviceWorker.controller.postMessage({ type: 'deregister' });
    }
  }

  if (window.crossOriginIsolated !== false || !coi.shouldRegister()) {
    return;
  }

  if (!window.isSecureContext) {
    if (!coi.quiet) {
      console.log('Service Worker not registered, a secure context is required.');
    }
    return;
  }

  if (!navigatorRef.serviceWorker) {
    if (!coi.quiet) {
      console.error('Service Worker not registered, perhaps due to private mode.');
    }
    return;
  }

  const swScope = new URL('./', window.location.href).href;

  navigatorRef.serviceWorker.register('./service-worker.js', { scope: swScope }).then(
    (registration) => {
      if (!coi.quiet) {
        console.log('Service Worker registered (COOP/COEP + WASM cache)', registration.scope);
      }

      registration.addEventListener('updatefound', () => {
        if (!coi.quiet) {
          console.log('Reloading page to use updated Service Worker.');
        }
        window.sessionStorage.setItem(coiStorageKey('coiReloadedBySelf'), 'updatefound');
        coi.doReload();
      });

      if (registration.active && !navigatorRef.serviceWorker.controller) {
        if (!coi.quiet) {
          console.log('Reloading page to activate Service Worker.');
        }
        window.sessionStorage.setItem(coiStorageKey('coiReloadedBySelf'), 'notcontrolling');
        coi.doReload();
      }
    },
    (err) => {
      if (!coi.quiet) {
        console.error('Service Worker failed to register:', err);
      }
    },
  );
})();
