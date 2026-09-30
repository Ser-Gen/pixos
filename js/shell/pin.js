// The PIN that wakes the screensaver, and the lock it opens. Phase 26, pass 6;
// docs/screensavers-plan.md.
//
// **It keeps out someone walking past, not someone who opens the developer tools.** The PIN is
// kept as a salted SHA-256 hash under `screensaver.pin` in /settings/desktop.json, and eight
// digits are a hundred million PINs, few enough for a script that can read that file to try them
// all. What it stops is a click or a key bringing the desktop back.
//
// **Locked is written down, in the browser's localStorage and not in /settings.** A reload has to
// come back locked, and so does every other PixOS tab: a lock one tab ignored would be a lock
// opened by switching tabs. Settings are written only by the tab that owns the session
// (js/shell/tabs.js), and a file change reaches the other tabs late; localStorage is written by
// any tab and tells every other one at once, with the `storage` event. The record carries the
// hash it was locked with, so a tab that booted before the PIN was set can still check one, and
// the wrong tries so far, so a reload does not start the count again.
//
// Nothing here touches the DOM. `crypto` and `storage` are parameters, for the tests.

export var LOCK_KEY = 'pixos:screensaver-lock';
// Four to eight digits: a PIN, typed on a number row or a keypad.
export var PIN_PATTERN = /^[0-9]{4,8}$/;
// Every fifth wrong PIN costs half a minute.
export var TRIES = 5;
export var WAIT_MS = 30000;

var HEX = /^[0-9a-f]+$/;

export function isValidPin (text) {
	return PIN_PATTERN.test(String(text == null ? '' : text));
}

function toHex (bytes) {
	return Array.from(new Uint8Array(bytes), function (byte) {
		return byte.toString(16).padStart(2, '0');
	}).join('');
}

// What /settings/desktop.json may hold under `screensaver.pin`: {salt, hash}, both hex, or null.
export function normalizePin (value) {
	if (!value || typeof value !== 'object') {
		return null;
	}
	var salt = String(value.salt || '');
	var hash = String(value.hash || '');
	if (salt.length !== 32 || hash.length !== 64 || !HEX.test(salt) || !HEX.test(hash)) {
		return null;
	}
	return {salt: salt, hash: hash};
}

// Whether a PIN can be checked here at all: SubtleCrypto exists only in a secure context,
// https or localhost. Where it cannot, the screensaver starts unlocked rather than locking
// someone out of their own machine.
export function canHash (crypto) {
	return !!(crypto && crypto.subtle && typeof crypto.subtle.digest === 'function');
}

function digest (salt, pin, crypto) {
	var bytes = new TextEncoder().encode(salt + ':' + pin);
	return Promise.resolve(crypto.subtle.digest('SHA-256', bytes)).then(toHex);
}

// The record to keep for `pin`, with a fresh salt. Rejects a PIN that is not four to eight digits.
export function makePin (pin, crypto) {
	if (!isValidPin(pin)) {
		return Promise.reject(new Error('A PIN is four to eight digits.'));
	}
	if (!canHash(crypto)) {
		return Promise.reject(new Error('This page is not on https, so the browser will not hash a PIN here.'));
	}
	var salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
	return digest(salt, String(pin), crypto).then(function (hash) {
		return {salt: salt, hash: hash};
	});
}

// Whether `pin` is the one `record` was made from. Anything that is not a PIN hashes to something
// no PIN does, and is simply wrong.
export function checkPin (pin, record, crypto) {
	var kept = normalizePin(record);
	if (!kept || !canHash(crypto)) {
		return Promise.resolve(false);
	}
	return digest(kept.salt, String(pin), crypto).then(function (hash) {
		return hash === kept.hash;
	});
}

// --- the lock ------------------------------------------------------------------------------------

// A lock record: the PIN it opens with, the wrong tries so far and until when no try is taken.
export function normalizeLock (value) {
	var pin = normalizePin(value);
	if (!pin) {
		return null;
	}
	var failures = Math.floor(Number(value.failures));
	var until = Number(value.until);
	return {
		salt: pin.salt,
		hash: pin.hash,
		failures: failures > 0 ? failures : 0,
		until: until > 0 ? until : 0
	};
}

// The lock after one more wrong PIN at `now`.
export function afterWrong (lock, now) {
	var failures = lock.failures + 1;
	return Object.assign({}, lock, {
		failures: failures,
		until: failures % TRIES === 0 ? now + WAIT_MS : lock.until
	});
}

// How long until the next try is taken, 0 for now.
export function waitLeft (lock, now) {
	return lock && lock.until > now ? lock.until - now : 0;
}

// localStorage can be missing, full, or throw on every call (a private window, a blocked site),
// and a lock that cannot be written is still a lock in this tab.
export function readLock (storage) {
	try {
		var text = storage ? storage.getItem(LOCK_KEY) : null;
		return text ? normalizeLock(JSON.parse(text)) : null;
	}
	catch (err) {
		return null;
	}
}

export function writeLock (storage, lock) {
	try {
		if (storage) {
			storage.setItem(LOCK_KEY, JSON.stringify(lock));
		}
	}
	catch (err) {
		console.warn('Screensaver: the lock could not be written down, so only this tab is locked', err);
	}
}

export function clearLock (storage) {
	try {
		if (storage) {
			storage.removeItem(LOCK_KEY);
		}
	}
	catch (err) {
		// Nothing was written, or nothing can be: either way there is no lock left to find.
	}
}
