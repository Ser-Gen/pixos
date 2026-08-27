// The desktop layer: what is behind the windows, and what you can do when nothing is in
// front of it.
//
// Three jobs. It owns the wallpaper (and decides when the wallpaper is worth rendering
// at all), it hosts the right-click menu that makes closing every window recoverable,
// and it implements peek -- getting the windows out of the way without touching them.

import * as wallpaper from './wallpaper.js';
import * as menu from './context-menu.js';

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

.PixPeekZone {
	position: fixed;
	right: 0;
	bottom: 0;
	width: 132px;
	height: 10px;
	z-index: 200;
	cursor: pointer;
}

.PixPeekChip {
	position: fixed;
	right: 10px;
	bottom: 10px;
	z-index: 201;
	padding: 5px 11px;
	font-family: Arial, Helvetica, sans-serif;
	font-size: 11px;
	color: #d8dce3;
	background: rgba(24, 27, 32, .82);
	border: 1px solid rgba(255, 255, 255, .14);
	cursor: pointer;
	opacity: 0;
	transition: opacity 160ms ease;
	pointer-events: none;
}

.PixPeekZone:hover + .PixPeekChip,
.PixPeekChip:hover,
.PixShell--peek .PixPeekChip {
	opacity: 1;
	pointer-events: auto;
}

.PixDialog {
	position: absolute;
	left: 50%;
	top: 50%;
	transform: translate(-50%, -50%);
	width: min(520px, calc(100vw - 32px));
	max-height: calc(100vh - 48px);
	overflow-y: auto;
	background: #23262b;
	border: 1px solid #434850;
	box-shadow: 0 24px 60px rgba(0, 0, 0, .6);
	font-family: Arial, Helvetica, sans-serif;
	color: #e4e4e4;
	font-size: 13px;
}

.PixDialog__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 14px;
	border-bottom: 1px solid #383c44;
	font-size: 13px;
}

.PixDialog__close {
	background: none;
	border: none;
	color: #9aa1ac;
	font-size: 16px;
	cursor: pointer;
	line-height: 1;
}

.PixDialog__close:hover {
	color: #fff;
}

.PixDialog__body {
	padding: 14px;
}

.PixDialog__label {
	display: block;
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: .06em;
	color: #8a919c;
	margin: 0 0 8px;
}

.PixDialog__section + .PixDialog__section {
	margin-top: 18px;
}

.PixSwatches {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.PixSwatch {
	width: 76px;
	height: 46px;
	border: 1px solid #434850;
	cursor: pointer;
	padding: 0;
	position: relative;
}

.PixSwatch:hover {
	border-color: #7d8695;
}

.PixSwatch--active {
	outline: 2px solid #4f9dff;
	outline-offset: -2px;
}

.PixDialog__row {
	display: flex;
	gap: 8px;
	align-items: center;
}

.PixDialog__row input[type="text"],
.PixDialog__row select {
	flex: 1;
	min-width: 0;
	background: #1b1e23;
	border: 1px solid #434850;
	color: #e4e4e4;
	padding: 6px 8px;
	font-size: 12px;
	font-family: inherit;
}

.PixDialog__row select {
	flex: 0 0 110px;
}

.PixButton {
	background: #333840;
	border: 1px solid #4b515b;
	color: #e4e4e4;
	padding: 6px 12px;
	font-size: 12px;
	font-family: inherit;
	cursor: pointer;
}

.PixButton:hover {
	background: #3d434d;
}

.PixDialog__note {
	margin: 10px 0 0;
	font-size: 11px;
	color: #8a919c;
	line-height: 1.6;
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
var config = {wallpaper: null};
var peeking = false;

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

	ensureStyle();
	menu.setHost(overlaysEl);

	// The provider owns this element and clears it on every change, so the hint has to
	// be a sibling rather than a child of it.
	wallpaperEl = document.createElement('div');
	wallpaperEl.className = 'PixDesktop__wallpaper';
	desktopEl.append(wallpaperEl);

	hintEl = document.createElement('div');
	hintEl.className = 'PixDesktop__hint';
	hintEl.innerHTML = 'PixOS<br>Right-click for applications<br>'
		+ '<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> shows the desktop';
	desktopEl.append(hintEl);

	var zone = document.createElement('div');
	zone.className = 'PixPeekZone';
	zone.title = 'Show desktop';
	zone.onclick = togglePeek;

	var chip = document.createElement('div');
	chip.className = 'PixPeekChip';
	chip.textContent = 'Show desktop';
	chip.onclick = togglePeek;
	shellEl.append(zone, chip);

	// One listener covers both cases. With no windows the layout is click-through, and
	// while peeking so are the windows, so in either case the right-click lands here.
	desktopEl.addEventListener('contextmenu', onContextMenu);

	window.addEventListener('keydown', onKeyDown, true);
	document.addEventListener('visibilitychange', refreshWallpaperActivity);

	if (wm) {
		wm.on('changed', refresh);
		// Keys pressed while an app has focus, forwarded out of its iframe by the WM.
		wm.on('keydown', onKeyDown);
	}

	apply(cfg.wallpaper);
	refresh();
}

function onContextMenu (e) {
	e.preventDefault();
	menu.open(buildMenu(), e.clientX, e.clientY);
}

function onKeyDown (e) {
	if (e.key === 'Escape' && peeking) {
		setPeek(false);
		return;
	}
	// e.code, not e.key: on macOS Alt is a compose modifier, so Ctrl+Alt+D arrives with
	// e.key === '∂' and matching on the letter silently never fires.
	if ((e.ctrlKey || e.metaKey) && e.altKey && e.code === 'KeyD') {
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
	refresh();
}

export function togglePeek () {
	setPeek(!peeking);
}

// Nothing above the fold decides this: the wallpaper renders only when it can actually
// be seen. Phase 2's shader provider turns this into real battery savings.
function refreshWallpaperActivity () {
	var covered = !!(wm && wm.count() > 0) && !peeking;
	if (document.hidden || covered) {
		wallpaper.pause();
	}
	else {
		wallpaper.resume();
	}
}

function refresh () {
	var empty = !wm || wm.count() === 0;
	if (shellEl) {
		shellEl.classList.toggle('PixShell--empty', empty);
	}
	if (hintEl) {
		hintEl.style.opacity = (empty || peeking) ? '1' : '0';
	}
	refreshWallpaperActivity();
}

export function getWallpaper () {
	return wallpaper.getConfig();
}

function apply (next) {
	config.wallpaper = wallpaper.apply(wallpaperEl, next);
	refreshWallpaperActivity();
	return config.wallpaper;
}

export async function setWallpaper (next) {
	var applied = apply(next);
	await persist({wallpaper: applied});
	return applied;
}

export function setWallpaperImage (filePath, options) {
	return setWallpaper({type: 'image', value: filePath, options: options || {fit: 'cover'}});
}

export function openWallpaperPicker () {
	var current = wallpaper.getConfig() || wallpaper.DEFAULT_WALLPAPER;

	var dialog = document.createElement('div');
	dialog.className = 'PixDialog';
	dialog.innerHTML = '<div class="PixDialog__head"><span>Wallpaper</span>'
		+ '<button class="PixDialog__close" title="Close">×</button></div>'
		+ '<div class="PixDialog__body"></div>';

	var body = dialog.querySelector('.PixDialog__body');
	var close = function () {
		dialog.remove();
	};
	dialog.querySelector('.PixDialog__close').onclick = close;

	body.append(
		buildSwatchSection('Gradients', Object.keys(wallpaper.PRESETS).map(function (key) {
			var preset = wallpaper.PRESETS[key];
			return {
				title: preset.label,
				css: 'linear-gradient(' + preset.angle + 'deg, ' + preset.stops.join(', ') + ')',
				active: current.type === 'gradient' && current.value === key,
				config: {type: 'gradient', value: key}
			};
		}), close),
		buildSwatchSection('Solid colours', ['#1a1a2e', '#12141a', '#20262e', '#2b2118', '#182a20'].map(function (color) {
			return {
				title: color,
				css: color,
				active: current.type === 'color' && current.value === color,
				config: {type: 'color', value: color}
			};
		}), close)
	);

	var imageSection = document.createElement('div');
	imageSection.className = 'PixDialog__section';
	imageSection.innerHTML = '<span class="PixDialog__label">Image from the filesystem</span>'
		+ '<div class="PixDialog__row">'
		+ '<input type="text" placeholder="/home/pictures/sea.jpg">'
		+ '<select><option value="cover">Cover</option><option value="contain">Contain</option>'
		+ '<option value="center">Center</option><option value="tile">Tile</option></select>'
		+ '<button class="PixButton">Set</button></div>'
		+ '<p class="PixDialog__note">Easier: right-click any image in Explorer and choose '
		+ '<b>Set as wallpaper</b>.</p>';

	var input = imageSection.querySelector('input');
	var fit = imageSection.querySelector('select');
	if (current.type === 'image') {
		input.value = current.value || '';
		fit.value = (current.options && current.options.fit) || 'cover';
	}
	imageSection.querySelector('button').onclick = function () {
		if (!input.value.trim()) {
			return;
		}
		setWallpaper({type: 'image', value: input.value.trim(), options: {fit: fit.value}});
		close();
	};
	body.append(imageSection);

	overlaysEl.append(dialog);
	return dialog;
}

function buildSwatchSection (label, entries, close) {
	var section = document.createElement('div');
	section.className = 'PixDialog__section';

	var heading = document.createElement('span');
	heading.className = 'PixDialog__label';
	heading.textContent = label;
	section.append(heading);

	var row = document.createElement('div');
	row.className = 'PixSwatches';
	entries.forEach(function (entry) {
		var button = document.createElement('button');
		button.className = 'PixSwatch' + (entry.active ? ' PixSwatch--active' : '');
		button.style.background = entry.css;
		button.title = entry.title;
		button.onclick = function () {
			setWallpaper(entry.config);
			close();
		};
		row.append(button);
	});
	section.append(row);
	return section;
}
