// The dialog for the background and the screensaver: two tabs over one gallery. Phase 26.
//
// Out of desktop.js since then, and taking both halves as parameters: the desktop owns the
// background and screensaver.js owns the screensaver, and neither should know the other exists.
//
// **One gallery.** Everything that moves -- the built-in shaders and every screensaver in
// /apps/screensavers, or that PixOS can download into it -- is one list, offered in both tabs,
// because anything that can be the background can be the screensaver. The Background tab adds the
// colours and gradients; the Screensaver tab adds *None* and *Blank*. A page or shader file chosen
// from somewhere else gets a tile of its own while it is the choice, so the dialog never shows a
// choice it cannot point at.
//
// **A folder with looks is a tile per look** (pass 4), and a look not downloaded yet says on its
// tile what it costs. Choosing it downloads it first, under a progress note, and then chooses it
// -- unless something else was chosen in the meantime, which wins. js/shell/screensaver-catalog.js
// knows what is there and what can be fetched; this only asks it.
//
// **Every choice applies at once, and the dialog stays.** A new background is visible behind it
// on an empty desktop, and the screensaver tab has more than one thing to set.

import * as wallpaper from './wallpaper.js';
import * as shader from './wallpaper-shader.js';
import {isScreensaverPath, pageName} from './wallpaper-page.js';
import * as screensaverModule from './screensaver.js';
import {SCREENSAVERS_DIR} from './screensaver-catalog.js';
import * as failure from './failure.js';

export {SCREENSAVERS_DIR};
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

.PixSwatch__group {
	display: block;
	font-size: 9px;
	letter-spacing: .04em;
	text-transform: uppercase;
	color: #b7bec9;
}

/* What a look not downloaded yet costs, top right, where the name is not. */
.PixSwatch__size {
	position: absolute;
	top: 3px;
	right: 3px;
	padding: 1px 4px;
	font: 9px/1.3 Arial, Helvetica, sans-serif;
	color: #e9edf2;
	background: rgba(8, 10, 14, .78);
	white-space: nowrap;
	font-variant-numeric: tabular-nums;
}

.PixSwatch[aria-busy="true"] .PixSwatch__size {
	color: #8fc2ff;
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

// The look a choice names, '' for none.
function lookOf (config) {
	return config && config.options && typeof config.options.look === 'string' ? config.options.look : '';
}

// Whether two choices are the same picture. A folder page is the same with or without its slash,
// and the same slideshow whatever folder it shows -- that is a setting of it, drawn beside it. Its
// look is not a setting: Matrix's Classic and its 3D are two pictures.
export function samePicture (a, b) {
	if (!a || !b || a.type !== b.type) {
		return false;
	}
	if (a.type === 'page') {
		return bare(a.value) === bare(b.value) && lookOf(a) === lookOf(b);
	}
	if (a.type === 'shader' || a.type === 'image') {
		return bare(a.value) === bare(b.value);
	}
	return a.value === b.value;
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

// What a choice is called: a page by its name, and by its look too when that says more -- Matrix
// has a look called 3D, and Pipes one called Pipes.
export function choiceName (config) {
	if (!config) {
		return '';
	}
	if (config.type !== 'page') {
		return fileName(config.value);
	}
	var name = pageName(config.value) || fileName(config.value);
	var look = lookOf(config);
	return look && look !== name ? name + ' · ' + look : name;
}

function lookConfig (screensaver, look) {
	var options = {look: look.name};
	if (look.entry !== undefined) {
		options.entry = look.entry;
	}
	return {type: 'page', value: screensaver.path, options: options};
}

// A folder chosen by its path alone -- from Explorer, or typed -- opens its first look that is
// here, so that look's tile is the one marked for it. `firstOf` is that folder, on that tile only.
function marks (tile, chosen) {
	if (samePicture(tile.config, chosen)) {
		return true;
	}
	return !!(tile.firstOf && chosen && chosen.type === 'page' && !lookOf(chosen)
		&& bare(chosen.value) === bare(tile.firstOf));
}

// The shared gallery: the shaders, then the screensavers, then the current choice if it is
// something that moves and is neither -- a .glsl file, or a page kept somewhere else.
//
// `screensavers` is what the catalog lists: [{name, path, looks}], where `looks` is null for a page
// with none and otherwise [{name, entry, tile, missing}], `missing` being the bytes it would still
// download. A look's tile carries that as `download`, and its screensaver's name as `group` when
// the look's own does not say it.
export function animatedTiles (screensavers, chosen) {
	var tiles = Object.keys(shader.BUILT_IN).map(function (key) {
		return {
			title: shader.BUILT_IN[key].label,
			look: TILE_BACKGROUNDS[key] || TILE_BACKGROUNDS.file,
			config: {type: 'shader', value: key}
		};
	});
	(screensavers || []).forEach(function (saver) {
		if (bare(saver.path) === SLIDESHOW) {
			tiles.push({title: saver.name || 'Slideshow', look: TILE_BACKGROUNDS.page,
				config: slideshowConfig(slideshowFolder(chosen))});
			return;
		}
		if (!saver.looks || !saver.looks.length) {
			tiles.push({title: saver.name || pageName(saver.path) || fileName(saver.path), look: TILE_BACKGROUNDS.page,
				config: {type: 'page', value: saver.path}});
			return;
		}
		// What the folder opens by its path alone: its first look that is here, as the page provider
		// decides it, or its first look.
		var opens = saver.looks.findIndex(function (look) {
			return !(look.missing > 0);
		});
		saver.looks.forEach(function (look, index) {
			tiles.push({
				title: look.name,
				group: saver.looks.length > 1 || look.name !== saver.name ? saver.name : '',
				look: look.tile || TILE_BACKGROUNDS.page,
				download: look.missing > 0 ? look.missing : 0,
				config: lookConfig(saver, look),
				firstOf: index === Math.max(opens, 0) ? saver.path : null
			});
		});
	});
	var moving = chosen && (chosen.type === 'page' || chosen.type === 'shader');
	if (moving && !tiles.some(function (tile) { return marks(tile, chosen); })) {
		tiles.push({
			title: choiceName(chosen),
			look: TILE_BACKGROUNDS.file,
			config: chosen
		});
	}
	return tiles.map(function (tile) {
		tile.active = marks(tile, chosen);
		return tile;
	});
}

// The Screensaver tab's gallery: off, a blank screen, and then the same tiles as the background's.
export function screensaverTiles (screensavers, chosen) {
	return [
		{title: 'None', look: '#1b1e23', config: null, active: !chosen},
		{title: 'Blank', look: '#000', config: screensaverModule.BLANK, active: samePicture(screensaverModule.BLANK, chosen)}
	].concat(animatedTiles(screensavers, chosen));
}

// What a tile says when pointed at, and what it costs when it has something to download.
export function tileTip (tile, busy) {
	var name = tile.group ? tile.group + ' · ' + tile.title : tile.title;
	if (busy) {
		return name + ', downloading';
	}
	return tile.download > 0 ? name + ', ' + failure.formatBytes(tile.download) + ' to download' : name;
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
	return {
		level: 'info',
		title: choiceName(show) + ' is the screensaver',
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
var catalog = null;
var describeKey = function () { return ''; };
var notify = function () {};
var progress = function () {
	return {update: function () {}, done: function () {}, fail: function () {}};
};
var describeError = failure.describeError;

var dialog = null;
var unsubscribe = null;
var redraw = function () {};
var relist = function () {};

// Every choice counts one, wherever it was made, so that a download finishing late chooses its
// look only if nothing was chosen after the click that asked for it.
var choices = 0;
// The looks downloading now, by folder and look, each the download's promise.
var downloading = {};

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
// catalog (screensaver-catalog.js's list and download), describeKey(id) -> the chord to print
// beside *Start screensaver*, notify(note) for what Explorer's *Set as screensaver* says,
// progress(cfg) for a download's note, and describeError(context, error) for its failure.
export function init (cfg) {
	host = cfg.host;
	getWallpaper = cfg.getWallpaper || getWallpaper;
	setWallpaper = cfg.setWallpaper || setWallpaper;
	saver = cfg.screensaver || null;
	catalog = cfg.catalog || null;
	describeKey = cfg.describeKey || describeKey;
	notify = cfg.notify || notify;
	progress = cfg.progress || progress;
	describeError = cfg.describeError || failure.describeError;
}

export function isOpen () {
	return !!dialog;
}

function downloadKey (config) {
	return bare(config.value) + '\n' + lookOf(config);
}

// Downloads the look a tile shows, under a progress note that becomes the error if it fails.
// Resolves true once every file is written, false when it failed; asked again while it runs, it
// is the same download and the same note.
function fetchLook (tile) {
	var key = downloadKey(tile.config);
	if (downloading[key]) {
		return downloading[key];
	}
	var name = choiceName(tile.config);
	var note = progress({title: 'Downloading ' + name, total: tile.download, unit: 'bytes', source: 'PixOS'});
	var job = Promise.resolve().then(function () {
		return catalog.download(tile.config.value, lookOf(tile.config), function (done, total, file) {
			note.update({value: done, total: total, message: file || ''});
		});
	}).then(function () {
		note.done({title: name + ' is downloaded', message: 'It works offline from now on.'});
		return true;
	}, function (err) {
		var said = describeError('Could not download ' + name, err);
		note.fail({title: said.title, message: said.message});
		return false;
	}).then(function (fetched) {
		delete downloading[key];
		relist();
		return fetched;
	});
	downloading[key] = job;
	redraw();
	return job;
}

// Every choice goes through here. One that needs a download is made once it is downloaded, and
// only if it is still the last choice made; `apply` sets it and returns what setting it returns.
// Exported for the tests, which have no dialog to click in.
export function choose (tile, config, apply) {
	var mine = ++choices;
	if (!catalog || !tile || !(tile.download > 0)) {
		return Promise.resolve(apply(config));
	}
	return fetchLook(tile).then(function (fetched) {
		return fetched && mine === choices ? apply(config) : null;
	});
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
		choices++;
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
	choices++;
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

	var screensavers = [];
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
	// A tile is found again by its key, not its tooltip, which changes once its look is downloaded.
	function render () {
		var active = document.activeElement;
		var had = dialog.contains(active) && body.contains(active);
		var onTile = had && active.classList.contains('PixSwatch') ? active.dataset.key : null;
		tabs.querySelectorAll('.PixDialog__tab').forEach(function (button) {
			button.setAttribute('aria-selected', button.dataset.tab === current ? 'true' : 'false');
		});
		body.replaceChildren();
		if (current === 'screensaver') {
			renderScreensaver(body, screensavers, render);
		}
		else {
			renderBackground(body, screensavers, render);
		}
		if (had) {
			var again = onTile === null ? null : Array.from(body.querySelectorAll('.PixSwatch')).find(function (tile) {
				return tile.dataset.key === onTile;
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

	// The gallery grows when the listing arrives, and is listed again when a download ends, so the
	// size comes off the tile it paid for. Without the index -- offline, say -- it is what is on disk.
	var shown = dialog;
	relist = function () {
		if (!catalog || dialog !== shown) {
			return;
		}
		Promise.resolve(catalog.list()).catch(function () {
			return [];
		}).then(function (listed) {
			if (dialog === shown) {
				screensavers = listed || [];
				redraw();
			}
		});
	};
	relist();
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
		var busy = !!(tile.download > 0 && tile.config && downloading[downloadKey(tile.config)]);
		var button = document.createElement('button');
		button.className = 'PixSwatch' + (tile.active ? ' PixSwatch--active' : '');
		button.style.background = tile.look;
		button.title = tileTip(tile, busy);
		button.dataset.key = (tile.group || '') + '\n' + tile.title;
		button.setAttribute('aria-pressed', tile.active ? 'true' : 'false');
		if (busy) {
			button.setAttribute('aria-busy', 'true');
		}
		if (tile.named) {
			var name = document.createElement('span');
			name.className = 'PixSwatch__name';
			if (tile.group) {
				var group = document.createElement('span');
				group.className = 'PixSwatch__group';
				group.textContent = tile.group;
				name.append(group);
			}
			name.append(tile.title);
			button.append(name);
		}
		if (tile.download > 0) {
			var size = document.createElement('span');
			size.className = 'PixSwatch__size';
			size.textContent = busy ? '↓ …' : '↓ ' + failure.formatBytes(tile.download);
			size.setAttribute('aria-hidden', 'true');
			button.append(size);
		}
		button.onclick = function () {
			pick(tile.config, tile);
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

function hasDownloads (screensavers) {
	return (screensavers || []).some(function (saver) {
		return (saver.looks || []).some(function (look) {
			return look.missing > 0;
		});
	});
}

function downloadNote () {
	return note('A size on a tile is what it downloads the first time it is chosen. After that it works offline, '
		+ 'and deleting its folder in /apps/screensavers gives the space back.');
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

// A choice may settle after a download, with the dialog closed or opened again since: it is
// drawn again only if it is still the dialog it was made in.
function redrawIfSame (render) {
	var drawn = dialog;
	return function () {
		if (dialog && dialog === drawn) {
			render();
		}
	};
}

function renderBackground (body, screensavers, render) {
	var chosen = getWallpaper() || wallpaper.DEFAULT_WALLPAPER;
	var pick = function (config, tile) {
		var again = redrawIfSame(render);
		choose(tile, config, setWallpaper).then(again, again);
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
	moving.append(swatches(named(animatedTiles(screensavers, chosen)), pick),
		note('These stop while a window covers them, and are unloaded if it stays there, so they cost '
			+ 'nothing when you are not looking. Any of them can be the screensaver too.'));
	if (hasDownloads(screensavers)) {
		moving.append(downloadNote());
	}

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

function renderScreensaver (body, screensavers, render) {
	var current = saver.getSettings();
	var chosen = current.show;
	var pick = function (config, tile) {
		// The click that turns it on is the one Chrome needs to ask about idle detection -- before
		// a download, which would take the click's activation with it.
		if (config && !chosen) {
			saver.askForIdle();
		}
		var again = redrawIfSame(render);
		choose(tile, config, function (next) {
			return saver.setSettings({show: next});
		}).then(again, again);
	};

	var gallery = section('Screensaver');
	gallery.append(swatches(named(screensaverTiles(screensavers, chosen)), pick));
	if (hasDownloads(screensavers)) {
		gallery.append(downloadNote());
	}
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
