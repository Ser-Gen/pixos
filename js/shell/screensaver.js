// The screensaver: a background drawn over everything once nobody has been at the machine for a
// while, and ended by the first input. Phase 26; docs/screensavers-plan.md.
//
// What it shows is a wallpaper config -- a colour, a shader, a page -- mounted through
// wallpaper.js into a layer of its own above the rest of the shell. So anything that can be the
// background can be the screensaver, and the same shader can be both at once.
//
// **Idle is the whole computer's where the browser can say so.** Chrome's IdleDetector sees every
// key and pointer move on the machine: typing in Photopea, or in another program entirely, is
// being there. It needs a permission, asked in the click that turns the screensaver on, and it
// cannot wait less than a minute. Without it -- Firefox, Safari, a refusal -- idle is the time
// since the last key, click, pointer move or scroll PixOS itself saw, in its own document and in
// every same-origin window through the WM's bridge. And then it never starts while a window
// PixOS cannot see into has the focus, where typing looks exactly like nobody being there.
//
// **Some things hold it off in both modes**: a video or a sound playing in any window PixOS can
// see into (idle detection calls someone watching a film idle), a hidden tab, a locked screen.
// Held off, it waits the whole time again from the moment it was.
//
// **Waking takes the input with it.** The layer takes the focus when it starts, so a key goes to
// it and not to an app, and a press lands on it and not on a window. It stays, clear, until the
// press is released, so the click that follows does not land either. Its key listener is on
// `window` in the capture phase and has to be registered before the desktop's and the shell's,
// which index.html does by calling init first: a Ctrl+K that wakes it should not also open the
// palette. The launchers are closed as it starts (`onStart`) for the same reason -- their own
// Escape handlers were registered earlier still.
//
// **With a PIN, waking asks for it** (pass 6). A start that was not a preview -- by itself, from
// *Start screensaver* or a hot corner -- locks, and the input that would have ended it opens a pad
// on the layer instead; the right PIN ends it. The lock is written down where every tab and a
// reload find it (js/shell/pin.js), so another PixOS tab locks too, and unlocking one unlocks them
// all. The pad takes keys as a text field does, and nothing else below it gets them.

import * as wallpaper from './wallpaper.js';
// For their side effect, as in desktop.js: what it shows may be a shader or a page.
import './wallpaper-shader.js';
import './wallpaper-page.js';
import {normalizeCorners} from './hot-corners.js';
import * as pin from './pin.js';

var STYLE_ID = 'pixos-screensaver-style';

var CSS = `
.PixScreensaver {
	position: absolute;
	inset: 0;
	z-index: 400;
	background: #000;
	cursor: none;
	outline: none;
	animation: pixos-screensaver-in 600ms ease;
	transition: opacity 180ms ease;
}

.PixScreensaver--closing {
	opacity: 0;
	cursor: default;
}

.PixScreensaver__stage {
	position: absolute;
	inset: 0;
}

.PixScreensaver--asking {
	cursor: default;
}

/* The PIN pad, over what the screensaver shows, which goes on moving behind it. */
.PixScreensaver__pad {
	position: absolute;
	left: 50%;
	top: 50%;
	transform: translate(-50%, -50%);
	z-index: 1;
	display: flex;
	flex-direction: column;
	align-items: stretch;
	gap: 10px;
	width: 220px;
	padding: 18px;
	background: rgba(20, 22, 27, .86);
	border: 1px solid rgba(255, 255, 255, .14);
	box-shadow: 0 18px 50px rgba(0, 0, 0, .55);
	font: 13px/1.4 Arial, Helvetica, sans-serif;
	color: #e9ecf1;
	text-align: center;
}

.PixScreensaver__pad input {
	background: #101216;
	border: 1px solid #4b515b;
	color: #fff;
	padding: 8px;
	font: 18px/1 Arial, Helvetica, sans-serif;
	letter-spacing: .3em;
	text-align: center;
}

.PixScreensaver__pad input:focus-visible,
.PixScreensaver__pad button:focus-visible {
	outline: 2px solid #4f9dff;
	outline-offset: 1px;
}

.PixScreensaver__pad button {
	background: #333840;
	border: 1px solid #4b515b;
	color: #e4e4e4;
	padding: 6px 12px;
	font: 12px Arial, Helvetica, sans-serif;
	cursor: pointer;
}

.PixScreensaver__padNote {
	margin: 0;
	min-height: 1.4em;
	font-size: 12px;
	color: #f0b8b8;
}

@keyframes pixos-screensaver-in {
	from { opacity: 0; }
}

`;

export var MINUTES = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60];
export var DEFAULT_MINUTES = 5;
// A blank screen: the oldest screensaver there is, and the one that costs nothing.
export var BLANK = {type: 'color', value: '#000000', options: {}};

// How often the idle clock is read. It decides when to start to within this, and a scan for
// playing media happens at most once per wait, only when the wait is over.
export var TICK_MS = 5000;
// A pointer move in the first moment is the hand leaving the mouse after asking for it, and a
// move of a pixel or two is a desk being bumped. Neither wakes it; a click or a key always does.
export var MOVE_GRACE_MS = 1000;
export var MOVE_SLOP = 6;
var FADE_MS = 180;
// The pad goes away, and the screensaver goes on, after this long with nothing typed in it.
export var PAD_IDLE_MS = 30000;
// However the press that woke it ends -- or does not, if it was dragged out of the window -- the
// layer is gone by then.
var RELEASE_WAIT_MS = 1500;

// What /settings/desktop.json holds under `screensaver`: what to show (null is off, which is
// how a fresh system starts), after how many minutes, the hot corners and the PIN (pass 6).
export function normalizeSettings (value) {
	var input = value && typeof value === 'object' ? value : {};
	var minutes = Math.round(Number(input.minutes));
	if (!(minutes >= 1)) {
		minutes = DEFAULT_MINUTES;
	}
	var show = null;
	if (input.show && typeof input.show === 'object' && wallpaper.listTypes().indexOf(input.show.type) > -1) {
		show = wallpaper.normalize(input.show);
	}
	return {show: show, minutes: Math.min(minutes, 24 * 60), corners: normalizeCorners(input.corners), pin: pin.normalizePin(input.pin)};
}

function ask (value) {
	return typeof value === 'function' ? !!value() : !!value;
}

// Whether to start now, and if not, why not. `media` and `opaque` may be functions, and are only
// called once everything else says yes -- each is a walk through every window's document.
//
//   mode       'detector' when IdleDetector is running, 'fallback' otherwise
//   userIdle   the detector's reading, and idleAt when it last turned idle
//   lastSeen   the last input PixOS saw itself; lastBlocked the last time something held it off
//
// The detector's threshold is the wait itself, so when it says idle the last input anywhere was
// that long before `idleAt` -- it is the authority on everything before that, including what
// PixOS saw. Input PixOS sees after it still counts: the detector says so a moment later.
export function decide (s) {
	if (!s.enabled) {
		return 'off';
	}
	if (s.running) {
		return 'running';
	}
	if (s.hidden) {
		return 'hidden';
	}
	if (s.locked) {
		return 'locked';
	}
	var wait = s.minutes * 60000;
	var last;
	if (s.mode === 'detector') {
		var since = (s.lastSeen || 0) > s.idleAt ? s.lastSeen : 0;
		last = s.userIdle ? Math.max(s.idleAt - wait, since, s.lastBlocked || 0) : s.now;
	}
	else {
		last = Math.max(s.lastSeen || 0, s.lastBlocked || 0);
	}
	if (s.now - last < wait) {
		return 'waiting';
	}
	// The pointer resting in a hot corner that says never.
	if (s.held) {
		return 'corner';
	}
	if (ask(s.media)) {
		return 'media';
	}
	// The detector sees typing in a window PixOS cannot; the fallback does not.
	if (s.mode !== 'detector' && ask(s.opaque)) {
		return 'opaque';
	}
	return 'start';
}

// Whether an input on the running screensaver ends it. `elapsed` is the time since it started,
// and `origin` where the pointer was last seen standing still, or null if it has not been seen.
export function wakes (e, elapsed, origin) {
	if (!e) {
		return false;
	}
	if (e.type === 'keydown') {
		// A held chord repeats. The one that started it must not end it a moment later.
		return !e.repeat;
	}
	if (e.type === 'pointerdown' || e.type === 'mousedown' || e.type === 'wheel' || e.type === 'touchstart') {
		return true;
	}
	if (e.type === 'pointermove' || e.type === 'mousemove') {
		if (elapsed < MOVE_GRACE_MS || !origin) {
			return false;
		}
		return Math.hypot(e.clientX - origin.x, e.clientY - origin.y) >= MOVE_SLOP;
	}
	return false;
}

function frameDocument (frame) {
	try {
		return frame.contentDocument || null;
	}
	catch (err) {
		return null;
	}
}

// Whether a video or a sound is playing anywhere in `doc` or the same-origin frames inside it,
// leaving out whatever `skip` says is ours: the background and the screensaver may well play
// something, and must not hold themselves off. Media made through Web Audio alone, or kept
// out of the DOM, cannot be seen from here and is not.
export function mediaPlaying (doc, skip, depth) {
	depth = depth || 0;
	if (!doc || depth > 8 || typeof doc.querySelectorAll !== 'function') {
		return false;
	}
	var media = doc.querySelectorAll('video, audio');
	for (var i = 0; i < media.length; i++) {
		if (skip && skip(media[i])) {
			continue;
		}
		if (!media[i].paused && !media[i].ended) {
			return true;
		}
	}
	var frames = doc.querySelectorAll('iframe, frame');
	for (var j = 0; j < frames.length; j++) {
		if (skip && skip(frames[j])) {
			continue;
		}
		if (mediaPlaying(frameDocument(frames[j]), null, depth + 1)) {
			return true;
		}
	}
	return false;
}

// Whether the focus is inside a frame PixOS cannot read -- a web page opened as a window, or a
// cross-origin frame inside an app, as Photopea has. Followed down through same-origin frames.
// Focus outside the page altogether (the address bar, another program) is not this: that is
// usually someone who has walked away, and says nothing either way.
export function opaqueFocus (doc) {
	if (!doc || typeof doc.hasFocus !== 'function' || !doc.hasFocus()) {
		return false;
	}
	var active = doc.activeElement;
	for (var depth = 0; active && depth < 8; depth++) {
		var tag = String(active.tagName || '').toUpperCase();
		if (tag !== 'IFRAME' && tag !== 'FRAME') {
			return false;
		}
		var inner = frameDocument(active);
		if (!inner) {
			return true;
		}
		active = inner.activeElement;
	}
	return false;
}

var env = null;
var host = null;
var wm = null;
var ignore = [];
var persist = function () { return Promise.resolve(); };
var hooks = {};
var now = Date.now;

var settings = normalizeSettings(null);
var layer = null;
var handle = null;
var running = false;
var closing = false;
var startedAt = 0;
var origin = null;
var pressed = false;
var faded = false;
var previousFocus = null;
var closeTimers = [];

var lastSeen = 0;
var lastBlocked = 0;
var tick = null;

var mode = 'fallback';
var permission = 'unsupported';
var detectorAbort = null;
var userIdle = false;
var idleAt = 0;
var locked = false;

// Held still on battery (pass 6), and held off by a hot corner.
var still = false;
var cornerHeld = false;

// The PIN's lock: whether this tab is locked, the record it opens with, and the pad asking for it.
var storage = null;
var crypto = null;
var pinLocked = false;
var lockRecord = null;
var pad = null;
var padTimer = null;
var checking = false;

var listeners = [];

function ensureStyle () {
	var doc = env.document;
	if (!doc || typeof doc.getElementById !== 'function' || doc.getElementById(STYLE_ID)) {
		return;
	}
	var style = doc.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	doc.head.append(style);
}

// cfg: host (the element the layer goes in), wm, settings (what desktop.json has under
// `screensaver`), persist(patch), ignore (elements whose media is ours), and the hooks onStart,
// onStop, onError(message, config). `env` (the window) and `now` are parameters for the tests.
export function init (cfg) {
	// More than once only in the tests, and each time from nothing.
	stop();
	if (tick && env) {
		env.clearInterval(tick);
	}
	tick = null;
	listeners = [];
	lastBlocked = 0;

	env = cfg.env || window;
	host = cfg.host || null;
	wm = cfg.wm || null;
	ignore = cfg.ignore || [];
	persist = cfg.persist || persist;
	hooks = {
		onStart: cfg.onStart || function () {},
		onStop: cfg.onStop || function () {},
		onError: cfg.onError || null
	};
	now = cfg.now || Date.now;
	storage = 'storage' in cfg ? cfg.storage : localStore(env);
	crypto = 'crypto' in cfg ? cfg.crypto : env.crypto || null;
	pinLocked = false;
	lockRecord = null;
	checking = false;
	cornerHeld = false;
	settings = normalizeSettings(cfg.settings);
	lastSeen = now();
	permission = env.IdleDetector ? 'prompt' : 'unsupported';

	ensureStyle();

	// Before anything else registers a key listener on window: see the header.
	['keydown', 'keypress', 'keyup'].forEach(function (type) {
		env.addEventListener(type, onKey, true);
	});
	['keydown', 'pointerdown', 'pointermove', 'wheel'].forEach(function (type) {
		env.addEventListener(type, onSeen, {capture: true, passive: true});
	});
	if (env.document && env.document.addEventListener) {
		env.document.addEventListener('visibilitychange', onVisibility);
	}
	// Another tab locking or unlocking.
	env.addEventListener('storage', onStorage);
	if (wm) {
		wm.on('activity', onSeen);
		// A key pressed in an app that took the focus back while it ran.
		wm.on('keydown', function (e) {
			if (running) {
				e.preventDefault();
				wake();
			}
		});
	}

	readPermission().then(schedule);
	schedule();
}

// Locked when this tab was reloaded, or opened while another was locked: shown locked at once.
// Called by index.html straight after desktop.init, because starting tells the desktop it is
// covered; true when it locked.
export function restoreLock () {
	var found = pin.readLock(storage);
	if (found) {
		lockFromElsewhere(found);
	}
	return pinLocked;
}

// Reading `localStorage` itself can throw, where the site's data is blocked.
function localStore (win) {
	try {
		return win.localStorage || null;
	}
	catch (err) {
		return null;
	}
}

function emitChange () {
	listeners.slice().forEach(function (listener) {
		try {
			listener();
		}
		catch (err) {
			console.error('screensaver listener failed', err);
		}
	});
}

// For the dialog, which redraws what it says about idle detection when that changes.
export function onChange (listener) {
	listeners.push(listener);
	return function () {
		listeners = listeners.filter(function (other) {
			return other !== listener;
		});
	};
}

// What to show, after how long, and the hot corners. Whether there is a PIN is `hasPin`: nothing
// outside needs its hash.
export function getSettings () {
	return {show: settings.show ? Object.assign({}, settings.show) : null, minutes: settings.minutes,
		corners: Object.assign({}, settings.corners)};
}

// A change is someone at the machine, so the wait starts again from it.
export function setSettings (patch) {
	settings = normalizeSettings(Object.assign({}, settings, patch || {}));
	lastSeen = now();
	lastBlocked = 0;
	schedule();
	emitChange();
	return Promise.resolve(persist({screensaver: settings})).then(function () {
		return getSettings();
	});
}

export function isRunning () {
	return running;
}

export function hasPin () {
	return !!settings.pin;
}

// Whether a PIN can be set and checked in this page at all: not without https or localhost.
export function canUsePin () {
	return pin.canHash(crypto);
}

// Sets the PIN, or rejects with what is wrong with it.
export function setPin (text) {
	return pin.makePin(text, crypto).then(function (record) {
		return setSettings({pin: record});
	});
}

export function removePin () {
	return setSettings({pin: null});
}

export function isLocked () {
	return pinLocked;
}

// On battery: what it shows moves for a moment and then holds still (wallpaper.js).
export function setStill (on) {
	still = !!on;
	if (handle) {
		handle.setStill(still);
	}
}

// The pointer resting in a hot corner that keeps it from starting.
export function setHeld (on) {
	cornerHeld = !!on;
}

// {mode, permission}: whether the whole computer is being watched, and if not, whether it could be.
export function idleStatus () {
	return {mode: mode, permission: permission};
}

function onSeen () {
	lastSeen = now();
}

function onVisibility () {
	if (!env.document.hidden) {
		// Coming back to the tab is someone being there.
		lastSeen = now();
	}
	refreshVisibility();
}

function schedule () {
	if (settings.show && !tick) {
		tick = env.setInterval(check, TICK_MS);
	}
	else if (!settings.show && tick) {
		env.clearInterval(tick);
		tick = null;
	}
	watchIdle();
}

function skipOwn (element) {
	if (layer && layer.contains(element)) {
		return true;
	}
	return ignore.some(function (mine) {
		return mine && mine.contains(element);
	});
}

// Exported for the tests, which move the clock and then ask.
export function check () {
	var verdict = decide({
		enabled: !!settings.show,
		running: running || closing,
		hidden: !!env.document.hidden,
		locked: locked,
		held: cornerHeld,
		mode: mode,
		userIdle: userIdle,
		idleAt: idleAt,
		lastSeen: lastSeen,
		lastBlocked: lastBlocked,
		minutes: settings.minutes,
		now: now(),
		media: function () {
			return mediaPlaying(env.document, skipOwn);
		},
		opaque: function () {
			return opaqueFocus(env.document);
		}
	});
	if (verdict === 'media' || verdict === 'opaque' || verdict === 'corner') {
		lastBlocked = now();
	}
	else if (verdict === 'start') {
		start();
	}
	return verdict;
}

// --- idle detection ------------------------------------------------------------------------------

function readPermission () {
	if (!env.IdleDetector) {
		permission = 'unsupported';
		return Promise.resolve(permission);
	}
	var permissions = env.navigator && env.navigator.permissions;
	if (!permissions || typeof permissions.query !== 'function') {
		return Promise.resolve(permission);
	}
	return permissions.query({name: 'idle-detection'}).then(function (status) {
		permission = status.state;
		status.onchange = function () {
			permission = status.state;
			watchIdle();
			emitChange();
		};
		emitChange();
		return permission;
	}, function () {
		return permission;
	});
}

// Asks for idle detection. Has to be called inside a click: Chrome shows no prompt without one.
// The request is made before the first await, so the click's activation is still there.
export function askForIdle () {
	if (!env.IdleDetector || permission === 'granted' || permission === 'denied') {
		return Promise.resolve(permission);
	}
	var asked;
	try {
		asked = Promise.resolve(env.IdleDetector.requestPermission());
	}
	catch (err) {
		asked = Promise.reject(err);
	}
	return asked.catch(function () {
		return null;
	}).then(readPermission).then(function () {
		watchIdle();
		emitChange();
		return permission;
	});
}

function stopDetector () {
	if (detectorAbort) {
		detectorAbort.abort();
		detectorAbort = null;
	}
	userIdle = false;
	locked = false;
	if (mode !== 'fallback') {
		mode = 'fallback';
		emitChange();
	}
}

function readDetector (detector) {
	var idleNow = detector.userState === 'idle';
	if (idleNow && !userIdle) {
		idleAt = now();
	}
	userIdle = idleNow;
	locked = detector.screenState === 'locked';
	refreshVisibility();
}

// Started with the wait as its threshold, and started again when the wait changes. Anything that
// goes wrong leaves the fallback in charge, which is where it started.
function watchIdle () {
	stopDetector();
	if (!settings.show || permission !== 'granted' || !env.IdleDetector) {
		return;
	}
	var controller = new AbortController();
	var detector;
	detectorAbort = controller;
	try {
		detector = new env.IdleDetector();
	}
	catch (err) {
		detectorAbort = null;
		console.warn('Screensaver: idle detection is not available', err);
		return;
	}
	detector.addEventListener('change', function () {
		if (detectorAbort === controller) {
			readDetector(detector);
			check();
		}
	});
	detector.start({threshold: Math.max(60000, settings.minutes * 60000), signal: controller.signal}).then(function () {
		if (detectorAbort !== controller) {
			return;
		}
		mode = 'detector';
		readDetector(detector);
		emitChange();
	}, function (err) {
		if (detectorAbort !== controller) {
			return;
		}
		detectorAbort = null;
		console.warn('Screensaver: idle detection would not start; counting input PixOS sees instead', err);
	});
}

// --- showing it ----------------------------------------------------------------------------------

function refreshVisibility () {
	if (!handle) {
		return;
	}
	if (env.document.hidden || locked) {
		handle.pause();
	}
	else {
		handle.resume();
	}
}

// Shows `show`, or what was chosen. A preview passes its own and is never locked; anything else is,
// when there is a PIN. False when there is nothing to show or it is already showing.
export function start (show) {
	var config = show || settings.show;
	if (running || closing || !config || !host) {
		return false;
	}
	if (!show && settings.pin && pin.canHash(crypto)) {
		// A lock already written down keeps its wrong tries: a reload does not start them again.
		var kept = pin.readLock(storage);
		lockRecord = kept && kept.hash === settings.pin.hash ? kept : pin.normalizeLock(settings.pin);
		pinLocked = true;
		pin.writeLock(storage, lockRecord);
	}
	openLayer(config);
	return true;
}

function openLayer (config) {
	var doc = env.document;
	hooks.onStart();

	layer = doc.createElement('div');
	layer.className = 'PixScreensaver';
	layer.setAttribute('tabindex', '-1');
	var stage = doc.createElement('div');
	stage.className = 'PixScreensaver__stage';
	layer.append(stage);
	host.append(layer);

	['pointerdown', 'pointermove', 'pointerup', 'wheel', 'contextmenu', 'touchstart'].forEach(function (type) {
		layer.addEventListener(type, onLayerInput, {passive: false});
	});

	running = true;
	startedAt = now();
	origin = null;
	pressed = false;
	previousFocus = doc.activeElement;
	if (typeof layer.focus === 'function') {
		layer.focus({preventScroll: true});
	}
	// On this module's clock, which the tests move by hand.
	handle = wallpaper.mount(stage, config, {
		onError: hooks.onError,
		setTimeout: function (fn, ms) { return env.setTimeout(fn, ms); },
		clearTimeout: function (id) { env.clearTimeout(id); }
	});
	handle.setStill(still);
	refreshVisibility();
	emitChange();
}

// Another tab locked, or this one was locked when it was reloaded: shown at once, locked, with what
// was chosen or a blank screen. A tab that cannot check a PIN is not locked by one.
function lockFromElsewhere (record) {
	if (!pin.canHash(crypto) || !host) {
		return;
	}
	lockRecord = record;
	if (pinLocked && (running || closing)) {
		return;
	}
	pinLocked = true;
	if (closing) {
		finish();
	}
	if (!running) {
		openLayer(settings.show || BLANK);
	}
}

function onStorage (e) {
	if (!e || e.key !== pin.LOCK_KEY) {
		return;
	}
	var record = pin.readLock(storage);
	if (record) {
		lockFromElsewhere(record);
	}
	else if (pinLocked) {
		// Unlocked in another tab: the person is back, and this tab is theirs too.
		pinLocked = false;
		lockRecord = null;
		hidePad();
		wake();
	}
}

// --- the PIN pad -------------------------------------------------------------------------------------

function padElement (tag, className) {
	var element = env.document.createElement(tag);
	if (className) {
		element.className = className;
	}
	return element;
}

function armPad () {
	if (padTimer !== null) {
		env.clearTimeout(padTimer);
	}
	padTimer = env.setTimeout(hidePad, PAD_IDLE_MS);
}

function sayOnPad (text) {
	if (pad) {
		pad.note.textContent = text;
	}
}

function waitText (ms) {
	return 'Too many wrong PINs. Try again in ' + Math.ceil(ms / 1000) + ' s.';
}

function showPad () {
	if (!pad) {
		var box = padElement('div', 'PixScreensaver__pad');
		box.setAttribute('role', 'dialog');
		box.setAttribute('aria-label', 'Locked');
		var title = padElement('div', 'PixScreensaver__padTitle');
		title.textContent = 'Locked. Type the PIN.';
		var input = padElement('input');
		input.type = 'password';
		input.inputMode = 'numeric';
		input.autocomplete = 'off';
		input.maxLength = 8;
		input.setAttribute('aria-label', 'PIN');
		var button = padElement('button');
		button.type = 'button';
		button.textContent = 'Unlock';
		button.addEventListener('click', submitPin);
		var note = padElement('p', 'PixScreensaver__padNote');
		note.setAttribute('role', 'status');
		box.append(title, input, button, note);
		layer.append(box);
		layer.classList.add('PixScreensaver--asking');
		pad = {box: box, input: input, note: note};
		var left = pin.waitLeft(lockRecord, now());
		sayOnPad(left ? waitText(left) : '');
	}
	if (typeof pad.input.focus === 'function') {
		pad.input.focus({preventScroll: true});
	}
	armPad();
}

function hidePad () {
	if (padTimer !== null) {
		env.clearTimeout(padTimer);
		padTimer = null;
	}
	if (!pad) {
		return;
	}
	pad.box.remove();
	pad = null;
	if (layer) {
		layer.classList.remove('PixScreensaver--asking');
		// The keys come back to the layer, not to the page under it.
		if (typeof layer.focus === 'function') {
			layer.focus({preventScroll: true});
		}
	}
}

function submitPin () {
	if (!pad || checking) {
		return;
	}
	armPad();
	// Another tab may have counted a wrong try since.
	var current = pin.readLock(storage) || lockRecord;
	var left = pin.waitLeft(current, now());
	if (left) {
		sayOnPad(waitText(left));
		return;
	}
	var typed = pad.input.value;
	checking = true;
	pin.checkPin(typed, current, crypto).then(function (right) {
		checking = false;
		if (!pinLocked) {
			return;
		}
		if (right) {
			pin.clearLock(storage);
			pinLocked = false;
			lockRecord = null;
			hidePad();
			wake();
			return;
		}
		lockRecord = pin.afterWrong(current, now());
		pin.writeLock(storage, lockRecord);
		if (pad) {
			pad.input.value = '';
		}
		var wait = pin.waitLeft(lockRecord, now());
		sayOnPad(wait ? waitText(wait) : 'That is not the PIN.');
	}, function (err) {
		checking = false;
		console.error('Screensaver: the PIN could not be checked', err);
		sayOnPad('The PIN could not be checked.');
	});
}

// Keys while the pad is up: typed into it, Enter to try, Escape to put it away. None goes further.
function onPadKey (e) {
	e.stopImmediatePropagation();
	var typing = e.target === pad.input;
	if (e.type === 'keydown') {
		armPad();
		if (e.key === 'Escape') {
			e.preventDefault();
			hidePad();
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			submitPin();
			return;
		}
	}
	// Tab would take the focus out of the pad and into the page under it.
	if (!typing || e.key === 'Tab') {
		e.preventDefault();
		if (typeof pad.input.focus === 'function') {
			pad.input.focus({preventScroll: true});
		}
	}
}

function onKey (e) {
	if (!running && !closing) {
		return;
	}
	if (running && pad) {
		onPadKey(e);
		return;
	}
	e.preventDefault();
	e.stopImmediatePropagation();
	if (running && wakes(e, now() - startedAt, origin)) {
		wake();
	}
}

function onLayerInput (e) {
	// The pad is a small form: its field and its button take the pointer as any would.
	if (pad && pad.box.contains(e.target)) {
		armPad();
		return;
	}
	e.preventDefault();
	e.stopPropagation();
	if (e.type === 'pointerdown' || e.type === 'touchstart') {
		pressed = true;
	}
	if (e.type === 'pointerup') {
		pressed = false;
		if (faded) {
			// After the click this press is about to make, which lands here too.
			later(finish, 0);
		}
		return;
	}
	if (!running) {
		return;
	}
	var elapsed = now() - startedAt;
	if (wakes(e, elapsed, origin)) {
		wake();
		return;
	}
	if ((e.type === 'pointermove' || e.type === 'mousemove') && (elapsed < MOVE_GRACE_MS || !origin)) {
		origin = {x: e.clientX, y: e.clientY};
	}
}

function later (fn, ms) {
	closeTimers.push(env.setTimeout(fn, ms));
}

// Ends it: the layer fades and keeps catching input while it does, and is gone once the fade is
// over and nothing is still pressed. Locked, it asks for the PIN instead.
function wake () {
	if (!running) {
		return;
	}
	if (pinLocked) {
		showPad();
		return;
	}
	running = false;
	closing = true;
	faded = false;
	lastSeen = now();
	layer.classList.add('PixScreensaver--closing');
	later(function () {
		faded = true;
		if (!pressed) {
			finish();
		}
	}, FADE_MS);
	later(finish, RELEASE_WAIT_MS);
	hooks.onStop();
	emitChange();
}

function finish () {
	if (!closing) {
		return;
	}
	closing = false;
	closeTimers.forEach(function (timer) {
		env.clearTimeout(timer);
	});
	closeTimers = [];
	teardown();
	var back = previousFocus;
	previousFocus = null;
	if (back && back !== env.document.body && back.isConnected !== false && typeof back.focus === 'function') {
		back.focus({preventScroll: true});
	}
	emitChange();
}

function teardown () {
	hidePad();
	if (handle) {
		handle.unmount();
		handle = null;
	}
	if (layer) {
		layer.remove();
		layer = null;
	}
}

// At once, with no fade: the settings changed under it, or a test is done with it.
export function stop () {
	if (!running && !closing) {
		return;
	}
	var wasRunning = running;
	// Whatever stops it at once is not someone at the pad: the lock stays written down.
	pinLocked = false;
	running = false;
	closing = true;
	finish();
	if (wasRunning) {
		hooks.onStop();
	}
}
