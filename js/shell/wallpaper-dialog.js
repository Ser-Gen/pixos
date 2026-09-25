// The dialog for the background and the screensaver: two tabs over one gallery. Phase 26.
//
// Out of desktop.js since then, and taking both halves as parameters: the desktop owns the
// background and screensaver.js owns the screensaver, and neither should know the other exists.
//
// **One gallery.** Everything that moves -- the built-in shaders and every screensaver page in
// /apps/screensavers -- is one list, offered in both tabs, because anything that can be the
// background can be the screensaver. The Background tab adds the colours and gradients; the
// Screensaver tab adds *None* and *Blank*. A page or shader file chosen from somewhere else gets
// a tile of its own while it is the choice, so the dialog never shows a choice it cannot point at.
//
// **Every choice applies at once, and the dialog stays.** A new background is visible behind it
// on an empty desktop, and the screensaver tab has more than one thing to set.

import * as wallpaper from './wallpaper.js';
import * as shader from './wallpaper-shader.js';
import {isScreensaverPath, pageName} from './wallpaper-page.js';
import * as screensaverModule from './screensaver.js';

export var SCREENSAVERS_DIR = '/apps/screensavers';
export var SLIDESHOW = SCREENSAVERS_DIR + '/Slideshow.xscr';
export var DEFAULT_PICTURES = '/home';

var STYLE_ID = 'pixos-wallpaper-dialog-style';

var CSS = `
.PixDialog {
	position: absolute;
	left: 50%;
	top: 50%;
	transform: translate(-50%, -50%);
	width: min(560px, calc(100vw - 32px));
	max-height: calc(100vh - 48px);
	overflow-y: auto;
	background: #23262b;
	border: 1px solid #434850;
	box-shadow: 0 24px 60px rgba(0, 0, 0, .6);
	font-family: Arial, Helvetica, sans-serif;
	color: #e4e4e4;
	font-size: 13px;
}

.PixDialog:focus {
	outline: none;
}

.PixDialog__head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0 14px 0 6px;
	border-bottom: 1px solid #383c44;
	font-size: 13px;
}

.PixDialog__tabs {
	display: flex;
}

.PixDialog__tab {
	background: none;
	border: 0;
	border-bottom: 2px solid transparent;
	color: #9aa1ac;
	font: inherit;
	padding: 11px 10px 9px;
	cursor: pointer;
}

.PixDialog__tab:hover {
	color: #e4e4e4;
}

.PixDialog__tab[aria-selected="true"] {
	color: #fff;
	border-bottom-color: #4f9dff;
}

.PixDialog__tab:focus-visible,
.PixDialog__close:focus-visible,
.PixSwatch:focus-visible,
.PixButton:focus-visible {
	outline: 2px solid #4f9dff;
	outline-offset: 1px;
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
	overflow: hidden;
}

.PixSwatch:hover {
	border-color: #7d8695;
}

.PixSwatch--active {
	outline: 2px solid #4f9dff;
	outline-offset: -2px;
}

.PixSwatch__name {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	padding: 3px 5px;
	font: 11px/1.3 Arial, Helvetica, sans-serif;
	color: #f1f3f6;
	text-align: left;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	background: linear-gradient(transparent, rgba(0, 0, 0, .55));
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

.PixButton:disabled {
	opacity: .45;
	cursor: default;
}

.PixDialog__note {
	margin: 10px 0 0;
	font-size: 11px;
	color: #8a919c;
	line-height: 1.6;
}

.PixDialog__note .PixButton {
	margin-left: 6px;
	padding: 2px 8px;
	font-size: 11px;
}
`;

// What each moving tile looks like before it moves: a hint of its colours, not a picture of it.
var TILE_BACKGROUNDS = {
	aurora: 'linear-gradient(160deg, #0a1426, #103a40 55%, #2a1740)',
	drift: 'radial-gradient(circle at 30% 60%, #2a4068, transparent 60%), radial-gradient(circle at 80% 30%, #4e2446, transparent 55%), #0d0d12',
	grid: 'repeating-linear-gradient(90deg, #22324a 0 1px, transparent 1px 12px), repeating-linear-gradient(0deg, #22324a 0 1px, transparent 1px 12px), #0c0f16',
	page: 'linear-gradient(150deg, #1d2530, #11151c)',
	file: 'linear-gradient(150deg, #101a2b, #241a33)'
};

// --- the pure half, exported for the tests ---------------------------------------------------------

// What the file field sets, from what was typed in it.
export function configForPath (typed, fit) {
	var value = String(typed || '').trim();
	if (!value) {
		return null;
	}
	if (isScreensaverPath(value)) {
		return {type: 'page', value: value};
	}
	if (/\.(glsl|frag)$/i.test(value)) {
		return {type: 'shader', value: value};
	}
	return {type: 'image', value: value, options: {fit: fit || 'cover'}};
}

function bare (value) {
	return String(value || '').replace(/\/+$/, '');
}

// Whether two choices are the same picture. A folder page is the same with or without its slash,
// and the same slideshow whatever folder it shows -- that is a setting of it, drawn beside it.
export function samePicture (a, b) {
	if (!a || !b || a.type !== b.type) {
		return false;
	}
	if (a.type === 'page' || a.type === 'shader' || a.type === 'image') {
		return bare(a.value) === bare(b.value);
	}
	return a.value === b.value;
}

// The screensaver pages in a folder's listing, as paths, by name.
export function pagesIn (names, dir) {
	return (names || []).filter(function (name) {
		return isScreensaverPath(String(name));
	}).sort(function (a, b) {
		return pageName(a).localeCompare(pageName(b));
	}).map(function (name) {
		return bare(dir) + '/' + bare(name);
	});
}

export function slideshowConfig (folder) {
	var chosen = String(folder || '').trim() || DEFAULT_PICTURES;
	return {type: 'page', value: SLIDESHOW, options: {entry: 'index.html?folder=' + encodeURIComponent(chosen)}};
}

// The folder a slideshow choice shows, or null when the choice is not the slideshow.
export function slideshowFolder (config) {
	if (!config || config.type !== 'page' || bare(config.value) !== SLIDESHOW) {
		return null;
	}
	var entry = String((config.options && config.options.entry) || '');
	var match = /[?&]folder=([^&#]*)/.exec(entry);
	if (!match) {
		return DEFAULT_PICTURES;
	}
	try {
		return decodeURIComponent(match[1]) || DEFAULT_PICTURES;
	}
	catch (err) {
		return DEFAULT_PICTURES;
	}
}

function fileName (value) {
	return String(value || '').split('/').filter(Boolean).pop() || String(value || '');
}

// The shared gallery: the shaders, then the pages, then the current choice if it is something
// that moves and is neither -- a .glsl file, or a page kept somewhere else.
export function animatedTiles (pages, chosen) {
	var tiles = Object.keys(shader.BUILT_IN).map(function (key) {
		return {
			title: shader.BUILT_IN[key].label,
			look: TILE_BACKGROUNDS[key] || TILE_BACKGROUNDS.file,
			config: {type: 'shader', value: key}
		};
	});
	(pages || []).forEach(function (page) {
		tiles.push({
			title: pageName(page) || fileName(page),
			look: TILE_BACKGROUNDS.page,
			config: bare(page) === SLIDESHOW ? slideshowConfig(slideshowFolder(chosen)) : {type: 'page', value: page}
		});
	});
	var moving = chosen && (chosen.type === 'page' || chosen.type === 'shader');
	if (moving && !tiles.some(function (tile) { return samePicture(tile.config, chosen); })) {
		tiles.push({
			title: chosen.type === 'page' ? (pageName(chosen.value) || fileName(chosen.value)) : fileName(chosen.value),
			look: TILE_BACKGROUNDS.file,
			config: chosen
		});
	}
	return tiles.map(function (tile) {
		tile.active = samePicture(tile.config, chosen);
		return tile;
	});
}

// The Screensaver tab's gallery: off, a blank screen, and then the same tiles as the background's.
export function screensaverTiles (pages, chosen) {
	return [
		{title: 'None', look: '#1b1e23', config: null, active: !chosen},
		{title: 'Blank', look: '#000', config: screensaverModule.BLANK, active: samePicture(screensaverModule.BLANK, chosen)}
	].concat(animatedTiles(pages, chosen));
}

// What choosing the file at `path` makes of it: a new choice by the file field's rule, or the choice
// as it stands when it is already that file -- *Set as screensaver* on the slideshow that is the
// screensaver keeps the folder it shows.
export function choiceForFile (path, current) {
	var next = configForPath(path);
	return next && samePicture(current, next) ? current : next;
}

// The note after Explorer's *Set as screensaver*. Nothing on screen changes, so it says what will.
export function screensaverNote (show, minutes) {
	var name = (show && show.type === 'page' && pageName(show.value)) || fileName(show && show.value);
	return {
		level: 'info',
		title: name + ' is the screensaver',
		message: 'It starts after ' + minutes + (minutes === 1 ? ' minute' : ' minutes') + ' with nobody there.',
		source: 'PixOS'
	};
}

// What the Screensaver tab says about how idle is measured, and whether to offer to ask.
export function idleNote (status) {
	var always = 'It waits while a video or a sound is playing, and never starts in a hidden tab.';
	var mode = status && status.mode;
	var permission = status && status.permission;
	if (mode === 'detector') {
		return {text: 'Counts the whole computer as idle: typing anywhere, even in another program, keeps it away. ' + always, allow: false};
	}
	if (permission === 'unsupported') {
		return {text: 'This browser cannot tell when the whole computer is idle, so the wait counts from the last key, click, '
			+ 'pointer move or scroll in PixOS, and it does not start while a web page open in a window has the focus. ' + always, allow: false};
	}
	if (permission === 'denied') {
		return {text: 'The browser was told not to say when the computer is idle, so only input in PixOS counts. '
			+ 'The site\'s settings in the browser can change that. ' + always, allow: false};
	}
	if (permission === 'granted') {
		return {text: 'Idle detection is allowed but would not start, so only input in PixOS counts. ' + always, allow: false};
	}
	return {text: 'Only input in PixOS counts for now. The browser can count the whole computer, and asks first. ' + always, allow: true};
}

// --- the dialog ------------------------------------------------------------------------------------

var host = null;
var getWallpaper = function () { return null; };
var setWallpaper = function () { return Promise.resolve(); };
var saver = null;
var listDir = function () { return Promise.resolve([]); };
var describeKey = function () { return ''; };
var notify = function () {};

var dialog = null;
var unsubscribe = null;
var redraw = function () {};

function ensureStyle () {
	if (document.getElementById(STYLE_ID)) {
		return;
	}
	var style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.append(style);
}

// cfg: host, getWallpaper, setWallpaper(config), screensaver (the module's own functions),
// listDir(path) -> names, describeKey(id) -> the chord to print beside *Start screensaver*,
// notify(note) for what Explorer's *Set as screensaver* says.
export function init (cfg) {
	host = cfg.host;
	getWallpaper = cfg.getWallpaper || getWallpaper;
	setWallpaper = cfg.setWallpaper || setWallpaper;
	saver = cfg.screensaver || null;
	listDir = cfg.listDir || listDir;
	describeKey = cfg.describeKey || describeKey;
	notify = cfg.notify || notify;
}

export function isOpen () {
	return !!dialog;
}

// Explorer's commands for a screensaver file or folder (pass 3). The path becomes a choice here, so
// Explorer never learns what one looks like. False when there is nothing to show, or one is showing.
export function previewFile (path) {
	var config = configForPath(path);
	return !!(saver && config) && saver.start(config);
}

// `surface` is 'screensaver' or 'background'. Resolves to what was set, or null. A screensaver set
// this way says so, since nothing on screen changes.
export function useFile (path, surface) {
	var done = function (value) {
		redraw();
		return value;
	};
	if (surface === 'screensaver') {
		var before = saver ? saver.getSettings().show : null;
		var show = saver ? choiceForFile(path, before) : null;
		if (!show) {
			return Promise.resolve(null);
		}
		// The same rule as the gallery: turning it on is when to ask. The click was on Explorer's
		// menu, and a click in a frame is its parent's too, so the browser still takes it for one.
		if (!before) {
			saver.askForIdle();
		}
		return Promise.resolve(saver.setSettings({show: show})).then(function (settings) {
			if (settings && settings.show) {
				notify(Object.assign(screensaverNote(settings.show, settings.minutes), {actions: [
					{label: 'Preview', run: function () { saver.start(settings.show); }},
					{label: 'Screensaver...', run: function () { open('screensaver'); }}
				]}));
			}
			return done(settings);
		});
	}
	var config = choiceForFile(path, getWallpaper());
	if (!config) {
		return Promise.resolve(null);
	}
	return Promise.resolve(setWallpaper(config)).then(done);
}

export function close () {
	if (unsubscribe) {
		unsubscribe();
		unsubscribe = null;
	}
	if (dialog) {
		dialog.remove();
		dialog = null;
	}
}

// Opens on `tab`, 'background' or 'screensaver'. Opening it again while it is open switches tab.
export function open (tab) {
	ensureStyle();
	var current = tab === 'screensaver' && saver ? 'screensaver' : 'background';
	close();

	var pages = [];
	dialog = document.createElement('div');
	dialog.className = 'PixDialog';
	dialog.setAttribute('role', 'dialog');
	dialog.setAttribute('tabindex', '-1');
	dialog.setAttribute('aria-label', 'Background and screensaver');
	dialog.innerHTML = '<div class="PixDialog__head"><div class="PixDialog__tabs" role="tablist"></div>'
		+ '<button class="PixDialog__close" title="Close" aria-label="Close">×</button></div>'
		+ '<div class="PixDialog__body"></div>';
	var tabs = dialog.querySelector('.PixDialog__tabs');
	var body = dialog.querySelector('.PixDialog__body');
	dialog.querySelector('.PixDialog__close').onclick = close;
	dialog.addEventListener('keydown', function (e) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			close();
		}
	});

	[['background', 'Background'], ['screensaver', 'Screensaver']].forEach(function (pair) {
		if (pair[0] === 'screensaver' && !saver) {
			return;
		}
		var button = document.createElement('button');
		button.className = 'PixDialog__tab';
		button.setAttribute('role', 'tab');
		button.dataset.tab = pair[0];
		button.textContent = pair[1];
		button.onclick = function () {
			current = pair[0];
			render();
			button.focus();
		};
		tabs.append(button);
	});

	// Drawn again after every choice. The focus goes back to the tile it was on, or to the dialog
	// itself -- left on a removed button it would fall out onto the page, and take Escape with it.
	function render () {
		var active = document.activeElement;
		var had = dialog.contains(active) && body.contains(active);
		var onTile = had && active.classList.contains('PixSwatch') ? active.title : null;
		tabs.querySelectorAll('.PixDialog__tab').forEach(function (button) {
			button.setAttribute('aria-selected', button.dataset.tab === current ? 'true' : 'false');
		});
		body.replaceChildren();
		if (current === 'screensaver') {
			renderScreensaver(body, pages, render);
		}
		else {
			renderBackground(body, pages, render);
		}
		if (had) {
			var again = onTile === null ? null : Array.from(body.querySelectorAll('.PixSwatch')).find(function (tile) {
				return tile.title === onTile;
			});
			(again || dialog).focus();
		}
	}

	// A choice made somewhere else -- Explorer's menu -- is drawn, unless that would wipe out a path
	// being typed.
	redraw = function () {
		var typing = dialog && dialog.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
		if (dialog && !typing) {
			render();
		}
	};
	if (saver && typeof saver.onChange === 'function') {
		// Idle detection allowed, or the preview over.
		unsubscribe = saver.onChange(function () {
			if (current === 'screensaver') {
				redraw();
			}
		});
	}

	render();
	host.append(dialog);
	var selected = tabs.querySelector('[aria-selected="true"]');
	if (selected) {
		selected.focus();
	}

	// The gallery grows when the listing arrives; a missing folder is an empty one.
	var shown = dialog;
	Promise.resolve(listDir(SCREENSAVERS_DIR)).catch(function () {
		return [];
	}).then(function (names) {
		pages = pagesIn(names, SCREENSAVERS_DIR);
		if (dialog === shown && pages.length) {
			render();
		}
	});
	return dialog;
}

function section (label) {
	var element = document.createElement('div');
	element.className = 'PixDialog__section';
	if (label) {
		var heading = document.createElement('span');
		heading.className = 'PixDialog__label';
		heading.textContent = label;
		element.append(heading);
	}
	return element;
}

function swatches (tiles, pick) {
	var row = document.createElement('div');
	row.className = 'PixSwatches';
	tiles.forEach(function (tile) {
		var button = document.createElement('button');
		button.className = 'PixSwatch' + (tile.active ? ' PixSwatch--active' : '');
		button.style.background = tile.look;
		button.title = tile.title;
		button.setAttribute('aria-pressed', tile.active ? 'true' : 'false');
		if (tile.named) {
			var name = document.createElement('span');
			name.className = 'PixSwatch__name';
			name.textContent = tile.title;
			button.append(name);
		}
		button.onclick = function () {
			pick(tile.config);
		};
		row.append(button);
	});
	return row;
}

function named (tiles) {
	return tiles.map(function (tile) {
		tile.named = true;
		return tile;
	});
}

function note (text) {
	var element = document.createElement('p');
	element.className = 'PixDialog__note';
	element.textContent = text;
	return element;
}

// The slideshow's one setting, drawn under the gallery while it is the choice.
function picturesRow (folder, apply) {
	var element = section('Pictures from');
	var row = document.createElement('div');
	row.className = 'PixDialog__row';
	var input = document.createElement('input');
	input.type = 'text';
	input.value = folder;
	input.setAttribute('aria-label', 'Folder of pictures');
	var set = document.createElement('button');
	set.className = 'PixButton';
	set.textContent = 'Set';
	set.onclick = function () {
		apply(slideshowConfig(input.value));
	};
	input.addEventListener('keydown', function (e) {
		if (e.key === 'Enter') {
			set.click();
		}
	});
	row.append(input, set);
	element.append(row, note('Every picture in that folder and the folders inside it, in random order.'));
	return element;
}

function fileRow (placeholder, chosen, apply) {
	var element = section('A file from the filesystem');
	element.insertAdjacentHTML('beforeend', '<div class="PixDialog__row">'
		+ '<input type="text" aria-label="Path">'
		+ '<select aria-label="Fit"><option value="cover">Cover</option><option value="contain">Contain</option>'
		+ '<option value="center">Center</option><option value="tile">Tile</option></select>'
		+ '<button class="PixButton">Set</button></div>');
	var input = element.querySelector('input');
	var fit = element.querySelector('select');
	input.placeholder = placeholder;
	if (chosen && (chosen.type === 'image' || chosen.type === 'page' || (chosen.type === 'shader' && !shader.BUILT_IN[chosen.value]))) {
		input.value = chosen.value || '';
		fit.value = (chosen.options && chosen.options.fit) || 'cover';
	}
	element.querySelector('button').onclick = function () {
		var typed = configForPath(input.value, fit.value);
		if (!typed) {
			return;
		}
		apply(typed);
	};
	return element;
}

function renderBackground (body, pages, render) {
	var chosen = getWallpaper() || wallpaper.DEFAULT_WALLPAPER;
	var pick = function (config) {
		Promise.resolve(setWallpaper(config)).then(render, render);
	};

	var gradients = section('Gradients');
	gradients.append(swatches(Object.keys(wallpaper.PRESETS).map(function (key) {
		var preset = wallpaper.PRESETS[key];
		return {title: preset.label, look: wallpaper.gradientCss(preset), active: chosen.type === 'gradient' && chosen.value === key,
			config: {type: 'gradient', value: key}};
	}), pick));

	var colours = section('Solid colours');
	colours.append(swatches(['#1a1a2e', '#12141a', '#20262e', '#2b2118', '#182a20'].map(function (color) {
		return {title: color, look: color, active: chosen.type === 'color' && chosen.value === color,
			config: {type: 'color', value: color}};
	}), pick));

	var moving = section('Animated');
	moving.append(swatches(named(animatedTiles(pages, chosen)), pick),
		note('These stop while a window covers them, and are unloaded if it stays there, so they cost '
			+ 'nothing when you are not looking. Any of them can be the screensaver too.'));

	body.append(gradients, colours, moving);
	var folder = slideshowFolder(chosen);
	if (folder !== null) {
		body.append(picturesRow(folder, pick));
	}
	var file = fileRow('/home/pictures/sea.jpg, /home/plasma.glsl or /home/Rain.xscr.html', chosen, pick);
	file.append(note('Easier: right-click an image or a screensaver in Explorer and choose Set as wallpaper. A .glsl file '
		+ '(Shadertoy-style mainImage()) or a screensaver page (Name.xscr.html, or a Name.xscr folder) works too.'));
	body.append(file);
}

function renderScreensaver (body, pages, render) {
	var current = saver.getSettings();
	var chosen = current.show;
	var pick = function (config) {
		// The click that turns it on is the one Chrome needs to ask about idle detection.
		if (config && !chosen) {
			saver.askForIdle();
		}
		Promise.resolve(saver.setSettings({show: config})).then(render, render);
	};

	var gallery = section('Screensaver');
	gallery.append(swatches(named(screensaverTiles(pages, chosen)), pick));
	body.append(gallery);

	var folder = slideshowFolder(chosen);
	if (folder !== null) {
		body.append(picturesRow(folder, pick));
	}

	var timing = section('Start after');
	var row = document.createElement('div');
	row.className = 'PixDialog__row';
	var minutes = document.createElement('select');
	minutes.setAttribute('aria-label', 'Minutes');
	var offered = screensaverModule.MINUTES.indexOf(current.minutes) > -1
		? screensaverModule.MINUTES
		: screensaverModule.MINUTES.concat([current.minutes]).sort(function (a, b) { return a - b; });
	offered.forEach(function (count) {
		var option = document.createElement('option');
		option.value = String(count);
		option.textContent = count + (count === 1 ? ' minute' : ' minutes');
		minutes.append(option);
	});
	minutes.value = String(current.minutes);
	minutes.style.flex = '0 0 130px';
	minutes.onchange = function () {
		Promise.resolve(saver.setSettings({minutes: Number(minutes.value)})).then(render, render);
	};
	var preview = document.createElement('button');
	preview.className = 'PixButton';
	preview.textContent = 'Preview';
	preview.disabled = !chosen;
	preview.onclick = function () {
		saver.start(chosen);
	};
	var spacer = document.createElement('span');
	spacer.style.flex = '1';
	row.append(minutes, spacer, preview);
	timing.append(row);

	if (chosen) {
		var said = idleNote(saver.idleStatus());
		var line = note(said.text);
		if (said.allow) {
			var allow = document.createElement('button');
			allow.className = 'PixButton';
			allow.textContent = 'Allow';
			allow.onclick = function () {
				saver.askForIdle();
			};
			line.append(allow);
		}
		timing.append(line);
		var key = describeKey('screensaver');
		timing.append(note('To start it now: Start screensaver, in the desktop menu or the search'
			+ (key ? ', or ' + key : '') + '.'));
	}
	body.append(timing);

	var file = fileRow('/home/pictures/sea.jpg, /home/plasma.glsl or /home/Rain.xscr.html', chosen, pick);
	file.append(note('Or right-click a screensaver in Explorer and choose Set as screensaver.'));
	body.append(file);
}
