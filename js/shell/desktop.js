// The desktop layer: what is behind the windows, and what you can do when nothing is in
// front of it.
//
// Three jobs. It owns the wallpaper (and decides when the wallpaper is worth rendering
// at all), it hosts the right-click menu that makes closing every window recoverable,
// and it implements peek -- getting the windows out of the way without touching them.
// The dialog that chooses a wallpaper is wallpaper-dialog.js since phase 26.

import * as wallpaper from './wallpaper.js';
import * as menu from './context-menu.js';
import {matchesAny, shellKeys} from './shortcuts.js';
import * as widgets from './widgets.js';
// Imported for their side effect: registering the 'shader' and 'page' providers.
import './wallpaper-shader.js';
import './wallpaper-page.js';

var STYLE_ID = 'pixos-desktop-style';

var CSS = `
.PixDesktop__wallpaper {
	position: absolute;
	inset: 0;
}

.PixDesktop__hint {
	position: absolute;
	left: 50%;
	top: 50%;
	transform: translate(-50%, -50%);
	text-align: center;
	font-family: Arial, Helvetica, sans-serif;
	color: rgba(255, 255, 255, .38);
	font-size: 13px;
	line-height: 1.9;
	pointer-events: none;
	transition: opacity 200ms ease;
}

.PixDesktop__hint kbd {
	font-family: inherit;
	font-size: 12px;
	border: 1px solid rgba(255, 255, 255, .22);
	border-radius: 3px;
	padding: 1px 5px;
	margin: 0 2px;
}
`;

var shellEl = null;
var desktopEl = null;
var overlaysEl = null;
var wallpaperEl = null;
var hintEl = null;
var wm = null;
var buildMenu = function () { return []; };
var persist = function () { return Promise.resolve(); };
var onPeekChange = function () {};
// The mounted background: wallpaper.js's handle, which owns pausing and unloading it.
var current = null;
var peeking = false;
// Something drawn over the whole desktop: the screensaver.
var obscured = false;

function ensureStyle () {
	if (document.getElementById(STYLE_ID)) {
		return;
	}
	var style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.append(style);
}

export function init (cfg) {
	shellEl = cfg.shell;
	desktopEl = cfg.desktop;
	overlaysEl = cfg.overlays;
	wm = cfg.wm;
	buildMenu = cfg.buildMenu || buildMenu;
	persist = cfg.persist || persist;
	onPeekChange = cfg.onPeekChange || onPeekChange;

	ensureStyle();
	menu.setHost(overlaysEl);

	// The provider owns this element and clears it on every change, so the hint has to
	// be a sibling rather than a child of it.
	wallpaperEl = document.createElement('div');
	wallpaperEl.className = 'PixDesktop__wallpaper';
	desktopEl.append(wallpaperEl);

	hintEl = document.createElement('div');
	hintEl.className = 'PixDesktop__hint';
	// Deliberately not advertising Ctrl+Alt+D: the chord is taken by the OS on at least
	// macOS, so the taskbar's corner button is the reliable route to the desktop.
	hintEl.innerHTML = 'PixOS<br>Right-click for applications<br>'
		+ 'The strip at the far right of the taskbar shows the desktop';
	desktopEl.append(hintEl);

	// A widget leading somewhere is a window arriving, and the peek is over. The `opened`
	// listener below says the same thing, but only once the window exists -- an open that
	// installs an app first would spend that time looking like a click that did nothing.
	widgets.mount(desktopEl, cfg.widgets, {
		onOpen: function () {
			if (peeking) {
				setPeek(false);
			}
		}
	});

	// One listener covers both cases. With no windows the layout is click-through, and
	// while peeking so are the windows, so in either case the right-click lands here.
	desktopEl.addEventListener('contextmenu', onContextMenu);

	// A page as the background takes the pointer through here rather than itself: its frame
	// is click-through, so the right-click above still reaches the desktop.
	['pointermove', 'pointerdown', 'pointerup', 'click'].forEach(function (type) {
		desktopEl.addEventListener(type, onPointer);
	});

	window.addEventListener('keydown', onKeyDown, true);
	document.addEventListener('visibilitychange', refreshWallpaperActivity);

	if (wm) {
		wm.on('changed', refresh);
		wm.on('workspaces-changed', refresh);
		// A window arriving ends the peek. You asked to see the desktop for a moment, and
		// launching something is the end of that moment -- without this, anything opened
		// from the desktop menu, a launcher or a widget lands behind the peek and looks
		// like a click that did nothing.
		wm.on('opened', function () {
			if (peeking) {
				setPeek(false);
			}
		});
		// Input while an app has focus, forwarded out of its iframe by the WM.
		wm.on('keydown', onKeyDown);
		// A click inside an app is a click outside the menu.
		wm.on('mousedown', menu.close);
	}

	apply(cfg.wallpaper);
	refresh();
}

function onContextMenu (e) {
	e.preventDefault();
	menu.open(buildMenu(), e.clientX, e.clientY);
}

function onPointer (e) {
	if (current && isBackgroundInput(e, wallpaperEl, desktopEl)) {
		current.forward(e);
	}
}

// Whether a pointer event on the desktop is the background's to have. A move is, wherever the
// pointer is -- it moves over a widget as well as over the background -- but a press on a
// widget is the widget's. Exported for the tests.
export function isBackgroundInput (e, wallpaperElement, desktopElement) {
	return e.type === 'pointermove' || e.target === wallpaperElement || e.target === desktopElement;
}

function onKeyDown (e) {
	if (e.key === 'Escape' && peeking) {
		setPeek(false);
		return;
	}
	// Matched by e.code inside matchesChord: on macOS Alt is a compose modifier, so Ctrl+Alt+D
	// arrives with e.key === '∂' and matching on the letter silently never fires.
	if (matchesAny(e, shellKeys('peek'))) {
		e.preventDefault();
		togglePeek();
	}
}

export function isPeeking () {
	return peeking;
}

export function setPeek (on) {
	peeking = !!on;
	shellEl.classList.toggle('PixShell--peek', peeking);
	if (peeking) {
		menu.close();
	}
	onPeekChange(peeking);
	refresh();
}

export function togglePeek () {
	setPeek(!peeking);
}

// The screensaver covers the desktop as surely as a window does, widgets and all.
export function setObscured (on) {
	obscured = !!on;
	refresh();
}

// Nothing above the fold decides this: the wallpaper renders only when it can actually
// be seen. Phase 2's shader provider turns this into real battery savings, and the handle
// unloads an animated one that stays out of sight (see wallpaper.js).
function refreshWallpaperActivity () {
	if (!current) {
		return;
	}
	// The active desktop's windows, not every window: an empty desktop next to a busy
	// one still shows its wallpaper, and would otherwise sit frozen.
	var covered = (!!(wm && wm.count(wm.getActiveWorkspace()) > 0) && !peeking) || obscured;
	if (document.hidden || covered) {
		current.pause();
	}
	else {
		current.resume();
	}
}

function refresh () {
	var empty = !wm || wm.count(wm.getActiveWorkspace()) === 0;
	if (shellEl) {
		shellEl.classList.toggle('PixShell--empty', empty);
	}
	if (hintEl) {
		hintEl.style.opacity = (empty || peeking) ? '1' : '0';
	}
	widgets.setVisible((empty || peeking) && !obscured);
	refreshWallpaperActivity();
}

export function getWallpaper () {
	return current ? Object.assign({}, current.config) : null;
}

// A background that cannot be drawn shows the default gradient and says why. The choice
// stays as it was in /settings/desktop.json: a file that is missing today may be back
// tomorrow, and the dialog is where it is changed. `surface` is 'background' or 'screensaver',
// whose layer falls back the same way.
export function wallpaperErrorNote (message, failed, surface) {
	var name = failed.type === 'page' ? 'That screensaver page' : failed.type === 'shader' ? 'That shader' : 'The picture';
	return {
		level: 'error',
		title: 'The ' + (surface || 'background') + ' could not be drawn',
		message: name + ' failed: ' + message + '. The default gradient is showing instead.',
		source: 'PixOS'
	};
}

function onWallpaperError (message, failed) {
	if (typeof window.notify === 'function') {
		window.notify(wallpaperErrorNote(message, failed, 'background'));
	}
}

function apply (next) {
	if (current) {
		current.unmount();
	}
	current = wallpaper.mount(wallpaperEl, next, {onError: onWallpaperError});
	refreshWallpaperActivity();
	return current.config;
}

export async function setWallpaper (next) {
	var applied = apply(next);
	await persist({wallpaper: applied});
	return applied;
}

export function setWallpaperImage (filePath, options) {
	return setWallpaper({type: 'image', value: filePath, options: options || {fit: 'cover'}});
}
