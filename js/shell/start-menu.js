// The start menu: everything installed, laid out to be scanned rather than read.
//
// Reads the same model as the desktop menu and the palette, so all three agree about
// what exists and what was used recently.

import * as icons from './app-icons.js';
import * as appsModel from './apps-model.js';

var STYLE_ID = 'pixos-start-menu-style';

var CSS = `
.PixStart {
	position: absolute;
	width: 380px;
	max-height: 60vh;
	display: flex;
	flex-direction: column;
	background: #23262b;
	border: 1px solid #434850;
	box-shadow: 0 -18px 50px rgba(0, 0, 0, .55);
	font-family: Arial, Helvetica, sans-serif;
	color: #e4e4e4;
}

.PixStart__search {
	width: 100%;
	box-sizing: border-box;
	padding: 11px 14px;
	background: transparent;
	border: none;
	border-bottom: 1px solid #383c44;
	color: #e4e4e4;
	font: inherit;
	font-size: 13px;
	outline: none;
}

.PixStart__search::placeholder {
	color: #767d88;
}

.PixStart__body {
	overflow-y: auto;
	padding: 6px 0 8px;
}

.PixStart__group {
	padding: 10px 14px 6px;
	font-size: 10px;
	text-transform: uppercase;
	letter-spacing: .09em;
	color: #767d88;
}

.PixStart__grid {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 2px;
	padding: 0 8px;
}

.PixStart__app {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 7px;
	padding: 10px 4px;
	background: none;
	border: none;
	color: #d4d9e0;
	font: inherit;
	font-size: 11px;
	cursor: pointer;
	text-align: center;
	min-width: 0;
}

.PixStart__app:hover,
.PixStart__app:focus-visible {
	background: #333840;
	outline: none;
}

.PixStart__appName {
	width: 100%;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.PixStart__files {
	display: flex;
	flex-direction: column;
	padding: 0 8px;
}

.PixStart__file {
	display: flex;
	align-items: baseline;
	gap: 8px;
	padding: 6px 6px;
	background: none;
	border: none;
	color: #d4d9e0;
	font: inherit;
	font-size: 12px;
	cursor: pointer;
	text-align: left;
	min-width: 0;
}

.PixStart__file:hover,
.PixStart__file:focus-visible {
	background: #333840;
	outline: none;
}

.PixStart__fileName {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	flex: none;
	max-width: 55%;
}

.PixStart__filePath {
	font-size: 11px;
	color: #767d88;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	direction: rtl;
	flex: 1;
	min-width: 0;
}

.PixStart__empty {
	padding: 16px 14px;
	color: #8a919c;
	font-size: 12px;
}

.PixStart__footer {
	display: flex;
	border-top: 1px solid #383c44;
}

.PixStart__action {
	flex: 1;
	padding: 10px 8px;
	background: none;
	border: none;
	color: #b8bec7;
	font: inherit;
	font-size: 12px;
	cursor: pointer;
}

.PixStart__action:hover {
	background: #333840;
	color: #fff;
}
`;

var host = null;
var options = {};
var element = null;
var anchorElement = null;

function ensureStyle () {
	if (document.getElementById(STYLE_ID)) {
		return;
	}
	var style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.append(style);
}

// cfg: {host, openApp, openRecentFile, actions: [{label, run}]}
export function init (cfg) {
	host = cfg.host;
	options = cfg;
	ensureStyle();
}

export function isOpen () {
	return !!element;
}

export function close () {
	if (!element) {
		return;
	}
	element.remove();
	element = null;
	anchorElement = null;
	if (options.onClose) {
		options.onClose();
	}
}

export function toggle (anchorRect, anchor) {
	if (isOpen()) {
		close();
		return;
	}
	open(anchorRect, anchor);
}

export function open (anchorRect, anchor) {
	close();
	anchorElement = anchor || null;

	element = document.createElement('div');
	element.className = 'PixStart';

	var search = document.createElement('input');
	search.className = 'PixStart__search';
	search.type = 'text';
	search.spellcheck = false;
	search.placeholder = 'Search applications';

	var body = document.createElement('div');
	body.className = 'PixStart__body';

	var footer = document.createElement('div');
	footer.className = 'PixStart__footer';
	(options.actions || []).forEach(function (action) {
		var button = document.createElement('button');
		button.className = 'PixStart__action';
		button.textContent = action.label;
		button.onclick = function () {
			close();
			action.run();
		};
		footer.append(button);
	});

	search.oninput = function () {
		renderBody(body, search.value);
	};
	search.onkeydown = function (e) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			close();
			return;
		}
		// Enter on a filtered list opens the obvious single answer.
		if (e.key === 'Enter') {
			var matches = appsModel.search(search.value, 1);
			if (matches.length) {
				e.preventDefault();
				launch(matches[0].id);
			}
		}
	};

	element.append(search, body, footer);
	host.append(element);
	renderBody(body, '');
	position(anchorRect);
	search.focus();

	return element;
}

// Anchored above the button that opened it, clamped to stay on screen.
function position (anchorRect) {
	var margin = 6;
	var rect = element.getBoundingClientRect();
	var left = anchorRect ? anchorRect.left : margin;
	var bottom = anchorRect ? anchorRect.top : window.innerHeight - margin;
	element.style.left = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin)) + 'px';
	element.style.top = Math.max(margin, bottom - rect.height - 4) + 'px';
}

function launch (appId) {
	close();
	options.openApp(appId);
}

function renderBody (body, query) {
	body.replaceChildren();

	if (String(query || '').trim()) {
		var matches = appsModel.search(query, 24);
		if (!matches.length) {
			var empty = document.createElement('div');
			empty.className = 'PixStart__empty';
			empty.textContent = 'No application matches "' + query + '"';
			body.append(empty);
			return;
		}
		body.append(buildGrid(matches));
		return;
	}

	var groups = appsModel.ordered();
	if (groups.recent.length) {
		body.append(heading('Recent'), buildGrid(groups.recent));
	}
	// Files, not only apps: "open the thing I was just working on" is a different question
	// from "start something", and the start menu could only answer the second one.
	var files = options.openRecentFile ? appsModel.listRecentFiles(6) : [];
	if (files.length) {
		body.append(heading('Recent files'), buildFiles(files));
	}
	if (groups.rest.length) {
		body.append(heading(groups.recent.length ? 'All applications' : 'Applications'), buildGrid(groups.rest));
	}
	if (!groups.recent.length && !groups.rest.length) {
		var none = document.createElement('div');
		none.className = 'PixStart__empty';
		none.textContent = 'No applications installed yet. Open App Manager to install some.';
		body.append(none);
	}
}

function heading (text) {
	var node = document.createElement('div');
	node.className = 'PixStart__group';
	node.textContent = text;
	return node;
}

function buildFiles (files) {
	var wrap = document.createElement('div');
	wrap.className = 'PixStart__files';
	files.forEach(function (entry) {
		var button = document.createElement('button');
		button.className = 'PixStart__file';
		button.title = entry.path;

		var name = document.createElement('span');
		name.className = 'PixStart__fileName';
		name.textContent = (entry.path.split('/').pop() || entry.path) + (entry.dir ? '/' : '');

		var where = document.createElement('span');
		where.className = 'PixStart__filePath';
		// The end of a path is the part that identifies it, so a truncated one keeps its
		// tail rather than its root -- which every path in the system shares anyway.
		where.textContent = entry.path;

		button.append(name, where);
		button.onclick = function () {
			close();
			options.openRecentFile(entry);
		};
		wrap.append(button);
	});
	return wrap;
}

function buildGrid (apps) {
	var grid = document.createElement('div');
	grid.className = 'PixStart__grid';
	apps.forEach(function (app) {
		var button = document.createElement('button');
		button.className = 'PixStart__app';
		button.title = app.name;
		button.append(icons.render(app, 30));

		var name = document.createElement('span');
		name.className = 'PixStart__appName';
		name.textContent = app.name;
		button.append(name);

		button.onclick = function () {
			launch(app.id);
		};
		grid.append(button);
	});
	return grid;
}

// A click on the anchor is the toggle, not a click outside -- otherwise the button that
// opened the panel could never be the one that closes it.
window.addEventListener('mousedown', function (e) {
	if (element && !element.contains(e.target) && !(anchorElement && anchorElement.contains(e.target))) {
		close();
	}
}, true);

// Escape belongs to whatever is on top. desktop.js registers its own Escape handler in
// init(), which runs after every module body, so this capture listener gets there first
// -- otherwise one Escape would close this *and* drop out of peek.
window.addEventListener('keydown', function (e) {
	if (element && e.key === 'Escape') {
		e.preventDefault();
		e.stopImmediatePropagation();
		close();
	}
}, true);
