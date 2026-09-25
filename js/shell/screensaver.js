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

import * as wallpaper from './wallpaper.js';
// For their side effect, as in desktop.js: what it shows may be a shader or a page.
import './wallpaper-shader.js';
import './wallpaper-page.js';

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

@keyframes pixos-screensaver-in {
	from { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
	.PixScreensaver {
		animation: none;
		transition: none;
	}
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
// However the press that woke it ends -- or does not, if it was dragged out of the window -- the
// layer is gone by then.
var RELEASE_WAIT_MS = 1500;

// What /settings/desktop.json holds under `screensaver`: what to show (null is off, which is
// how a fresh system starts) and after how many minutes.
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
	return {show: show, minutes: Math.min(minutes, 24 * 60)};
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

export function getSettings () {
	return {show: settings.show ? Object.assign({}, settings.show) : null, minutes: settings.minutes};
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
	if (verdict === 'media' || verdict === 'opaque') {
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

// Shows `show`, or what was chosen. A preview passes its own. False when there is nothing to show
// or it is already showing.
export function start (show) {
	var config = show || settings.show;
	if (running || closing || !config || !host) {
		return false;
	}
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
	handle = wallpaper.mount(stage, config, {onError: hooks.onError});
	refreshVisibility();
	emitChange();
	return true;
}

function onKey (e) {
	if (!running && !closing) {
		return;
	}
	e.preventDefault();
	e.stopImmediatePropagation();
	if (running && wakes(e, now() - startedAt, origin)) {
		wake();
	}
}

function onLayerInput (e) {
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
// over and nothing is still pressed.
function wake () {
	if (!running) {
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
	running = false;
	closing = true;
	finish();
	if (wasRunning) {
		hooks.onStop();
	}
}
