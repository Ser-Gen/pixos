// The mode in which Cmd+W belongs to PixOS.
//
// In a tab, Cmd+W closes the tab, and everything open in PixOS goes with it. That is the
// browser's key and there is no way to take it — except one: the Keyboard Lock API, which
// hands specific physical keys to the page, and only while the page is fullscreen.
//
// The constraints are the feature, not footnotes to it:
//
//   - Keyboard Lock is Chromium-only. Firefox and Safari have not shipped it and there is
//     no polyfill, because there is nothing to polyfill — the browser either gives up the
//     key or it does not.
//   - It only takes effect in fullscreen. Leave fullscreen, by any route including Esc,
//     and the key belongs to the browser again the instant you do.
//   - Fullscreen itself needs a user gesture, so this can only ever be entered by someone
//     asking for it.
//
// So the mode announces what it does when you enter it, and where it is unsupported it
// says why rather than quietly doing nothing — which would be worse than not offering it,
// since the whole point is knowing whether Cmd+W is going to cost you your desktop.

var listeners = [];
var locked = false;
// The keys worth taking. W closes the window, T and N open a tab and a window over the
// top of PixOS. Nothing else the browser owns is destructive.
var KEYS = ['KeyW', 'KeyT', 'KeyN'];

export function isSupported () {
	return typeof document !== 'undefined'
		&& !!document.documentElement
		&& typeof document.documentElement.requestFullscreen === 'function';
}

// Chromium only. Reported separately from fullscreen support because the difference is
// exactly what the user needs told: fullscreen everywhere, the key only here.
export function canLockKeys () {
	return typeof navigator !== 'undefined'
		&& !!navigator.keyboard
		&& typeof navigator.keyboard.lock === 'function';
}

export function isActive () {
	return typeof document !== 'undefined' && !!document.fullscreenElement;
}

export function isKeyboardLocked () {
	return locked;
}

export function subscribe (listener) {
	listeners.push(listener);
	listener(state());
	return function () {
		listeners = listeners.filter(function (item) {
			return item !== listener;
		});
	};
}

function state () {
	return {active: isActive(), locked: locked, canLockKeys: canLockKeys()};
}

function emit () {
	var current = state();
	listeners.slice().forEach(function (listener) {
		try {
			listener(current);
		}
		catch (err) {
			console.error('fullscreen listener failed', err);
		}
	});
}

export function init () {
	if (typeof document === 'undefined') {
		return;
	}
	document.addEventListener('fullscreenchange', function () {
		// Leaving fullscreen releases the lock whether or not we asked: the browser does
		// it for us, and believing otherwise would leave the UI claiming Cmd+W is safe
		// when it is not.
		if (!isActive()) {
			locked = false;
		}
		emit();
	});
}

export async function enter () {
	if (!isSupported()) {
		throw new Error('This browser cannot go fullscreen');
	}
	await document.documentElement.requestFullscreen();
	if (canLockKeys()) {
		try {
			await navigator.keyboard.lock(KEYS);
			locked = true;
		}
		catch (err) {
			// Fullscreen without the lock is still worth having; it just does not save you
			// from Cmd+W, which is what the caller has to be able to say.
			locked = false;
		}
	}
	emit();
	return state();
}

export async function exit () {
	if (canLockKeys() && typeof navigator.keyboard.unlock === 'function') {
		try {
			navigator.keyboard.unlock();
		}
		catch (err) {
			// Leaving fullscreen releases it regardless.
		}
	}
	locked = false;
	if (isActive()) {
		await document.exitFullscreen();
	}
	emit();
	return state();
}

export function toggle () {
	return isActive() ? exit() : enter();
}

// What to say about it, in one place, so the button, the palette entry and the note that
// appears on entering cannot describe the same mode three different ways.
export function describe () {
	if (!isSupported()) {
		return {
			available: false,
			title: 'Fullscreen is unavailable',
			message: 'This browser will not let the page go fullscreen.'
		};
	}
	if (!canLockKeys()) {
		return {
			available: true,
			title: 'Fullscreen (Cmd+W still closes the tab)',
			message: 'Only Chromium browsers let a page take over Ctrl/Cmd+W, and only '
				+ 'while it is fullscreen. Here the key still belongs to the browser, so '
				+ 'fullscreen gains you the screen space and nothing else.'
		};
	}
	return {
		available: true,
		title: 'Fullscreen — Ctrl/Cmd+W closes the PixOS window',
		message: 'While this is fullscreen, Ctrl/Cmd+W closes the focused window inside '
			+ 'PixOS instead of the browser tab, and Ctrl/Cmd+T and Ctrl/Cmd+N do nothing. '
			+ 'Leaving fullscreen — including with Esc — hands all three back to '
			+ 'the browser immediately.'
	};
}
