// The Settings window: a sidebar of pages, and the page chosen in it. Phase 27; docs/settings-plan.md.
//
// **A shell dialog, not an app.** Every value it sets is the shell's, and an iframe app would need a
// bridge for each of them; and wm.js positions iframes only, so a tiled window could not hold shell
// DOM. It is drawn into the overlays layer the way the Wallpaper dialog was, and that dialog is now
// two of its pages (js/shell/wallpaper-dialog.js adds them).
//
// **This module knows nothing about any page.** A page is `{id, label, render(body, ctx), enter(ctx)}`,
// added with `addPage`; the sidebar lists them in PAGE_ORDER whatever order they were added in, so the
// module that adds one does not have to know which others exist. `enter` is called when the page is
// shown and may return what to call when it stops being shown -- a subscription, say.
//
// **Every redraw goes through `ctx`, and a stale one does nothing.** A page's work can settle long
// after the click that started it (a download, the browser finding where this is), by which time the
// window may be closed, or open again on another page. Each showing of a page gets a `ctx` of its own,
// and its `render` and `refresh` do nothing once that showing is over.
//
// **`refresh` leaves a page alone while someone is typing in it**; `render` does not. A change made
// somewhere else -- Explorer's *Set as wallpaper*, a battery reading -- is a refresh, and wiping out a
// path half typed would be worse than drawing the change a moment late. A page's own click is a render.

var STYLE_ID = 'pixos-settings-style';

// Where each page goes in the sidebar. A page not named here goes after these, in the order added.
export var PAGE_ORDER = ['display', 'background', 'screensaver', 'location', 'network', 'system', 'privacy'];

var CSS = `
.PixSettings {
	position: absolute;
	left: 50%;
	top: 50%;
	transform: translate(-50%, -50%);
	width: min(860px, calc(100vw - 32px));
	height: min(640px, calc(100vh - 48px));
	box-sizing: border-box;
	display: grid;
	grid-template-columns: 180px minmax(0, 1fr);
	grid-template-rows: auto minmax(0, 1fr);
	background: #23262b;
	border: 1px solid #434850;
	box-shadow: 0 24px 60px rgba(0, 0, 0, .6);
	font-family: Arial, Helvetica, sans-serif;
	color: #e4e4e4;
	font-size: 13px;
}

.PixSettings:focus {
	outline: none;
}

.PixSettings__title {
	grid-column: 1;
	grid-row: 1;
	padding: 12px 14px 10px;
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: .08em;
	color: #8a919c;
	background: #1d2025;
	border-right: 1px solid #383c44;
}

.PixSettings__nav {
	grid-column: 1;
	grid-row: 2;
	display: flex;
	flex-direction: column;
	padding: 2px 0 10px;
	overflow-y: auto;
	background: #1d2025;
	border-right: 1px solid #383c44;
}

.PixSettings__page {
	background: none;
	border: 0;
	border-left: 2px solid transparent;
	color: #b7bec9;
	font: inherit;
	text-align: left;
	padding: 8px 14px 8px 12px;
	cursor: pointer;
}

.PixSettings__page:hover {
	color: #fff;
	background: #262a30;
}

.PixSettings__page[aria-selected="true"] {
	color: #fff;
	background: #2c3138;
	border-left-color: #4f9dff;
}

.PixSettings__head {
	grid-column: 2;
	grid-row: 1;
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0 14px;
	border-bottom: 1px solid #383c44;
}

.PixSettings__heading {
	margin: 0;
	font-size: 14px;
	font-weight: normal;
	color: #fff;
}

.PixSettings__body {
	grid-column: 2;
	grid-row: 2;
	overflow-y: auto;
	padding: 14px;
}

/* Narrow: the pages become a row above the page. */
@media (max-width: 600px) {
	.PixSettings {
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: auto auto minmax(0, 1fr);
	}

	.PixSettings__title {
		display: none;
	}

	.PixSettings__nav {
		grid-row: 1;
		flex-direction: row;
		overflow-x: auto;
		padding: 0;
		border-right: 0;
		border-bottom: 1px solid #383c44;
	}

	.PixSettings__page {
		border-left: 0;
		border-bottom: 2px solid transparent;
		white-space: nowrap;
	}

	.PixSettings__page[aria-selected="true"] {
		border-bottom-color: #4f9dff;
	}

	.PixSettings__head {
		grid-column: 1;
		grid-row: 2;
		padding: 8px 14px;
	}

	.PixSettings__body {
		grid-column: 1;
		grid-row: 3;
	}
}

.PixSettings__page:focus-visible,
.PixDialog__close:focus-visible,
.PixButton:focus-visible {
	outline: 2px solid #4f9dff;
	outline-offset: -2px;
}

.PixDialog__close {
	background: none;
	border: none;
	color: #9aa1ac;
	font-size: 16px;
	cursor: pointer;
	line-height: 1;
	padding: 10px 0 10px 10px;
}

.PixDialog__close:hover {
	color: #fff;
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
	max-width: 64ch;
}

.PixDialog__note .PixButton {
	margin-left: 6px;
	padding: 2px 8px;
	font-size: 11px;
}

.PixDialog__check {
	display: flex;
	gap: 8px;
	align-items: center;
	cursor: pointer;
}

.PixDialog__check input {
	margin: 0;
	accent-color: #4f9dff;
}
`;

// --- the pure half, exported for the tests ---------------------------------------------------------

// The pages in the order the sidebar lists them.
export function orderPages (pages) {
	return pages.map(function (page, index) {
		var place = PAGE_ORDER.indexOf(page.id);
		return {page: page, rank: place > -1 ? place : PAGE_ORDER.length + index};
	}).sort(function (a, b) {
		return a.rank - b.rank;
	}).map(function (entry) {
		return entry.page;
	});
}

// The page to show for `wanted`: that one if there is one by that id, else the one last shown, else
// the first. Null when there are no pages.
export function pickPage (pages, wanted, last) {
	var find = function (id) {
		return id ? pages.find(function (page) { return page.id === id; }) : null;
	};
	return find(wanted) || find(last) || pages[0] || null;
}

// The page an arrow key moves to from `id`: up and down, wrapping, and Home and End.
export function stepPage (pages, id, key) {
	if (!pages.length) {
		return null;
	}
	var index = pages.findIndex(function (page) { return page.id === id; });
	if (key === 'Home') {
		return pages[0];
	}
	if (key === 'End') {
		return pages[pages.length - 1];
	}
	var step = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 0;
	if (!step) {
		return null;
	}
	return pages[(Math.max(index, 0) + step + pages.length) % pages.length];
}

// --- the window ------------------------------------------------------------------------------------

var host = null;
var pages = [];
// The window while it is open: the element, and the parts of it that change.
var element = null;
var parts = null;
var shown = null;
var lastShown = null;
// Counts every showing of a page, so a ctx can tell it is out of date.
var showing = 0;
var leave = null;
var draw = function () {};

function ensureStyle () {
	if (document.getElementById(STYLE_ID)) {
		return;
	}
	var style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.append(style);
}

// cfg: host, the overlays layer it is drawn in.
export function init (cfg) {
	host = cfg.host;
}

// Adds a page, or replaces the one with its id.
export function addPage (page) {
	pages = pages.filter(function (other) { return other.id !== page.id; }).concat([page]);
}

export function isOpen () {
	return !!element;
}

// The id of the page being shown, or null when the window is closed.
export function currentPage () {
	return shown ? shown.id : null;
}

// Drawn again, if open, unless someone is typing in it.
export function refresh () {
	if (element) {
		draw(false);
	}
}

function stopShowing () {
	showing++;
	if (leave) {
		var was = leave;
		leave = null;
		try {
			was();
		}
		catch (err) {
			console.warn('A settings page failed to stop', err);
		}
	}
}

export function close () {
	stopShowing();
	if (element) {
		element.remove();
		element = null;
		parts = null;
	}
	shown = null;
	draw = function () {};
}

// Whether the focus is in a field being typed in, inside `container`. A checkbox, a radio button or
// a slider with the focus is not typing, and does not hold a redraw back.
export function typingIn (container, active) {
	return !!active && !!container && container.contains(active) && (active.tagName === 'TEXTAREA'
		|| (active.tagName === 'INPUT' && ['checkbox', 'radio', 'range'].indexOf(active.type) === -1));
}

function make (tag, className, text) {
	var node = document.createElement(tag);
	if (className) {
		node.className = className;
	}
	if (text) {
		node.textContent = text;
	}
	return node;
}

// The node under `root` whose data-key is `key`, depth first.
function findKey (root, key) {
	var children = root.children || [];
	for (var i = 0; i < children.length; i++) {
		if (children[i].dataset && children[i].dataset.key === key) {
			return children[i];
		}
		var inside = findKey(children[i], key);
		if (inside) {
			return inside;
		}
	}
	return null;
}

// Opens on the page `id`, or the one last shown. Opening it again while it is open goes to that page.
export function open (id) {
	var listed = orderPages(pages);
	var page = pickPage(listed, id, lastShown);
	if (!page) {
		return null;
	}
	ensureStyle();
	if (element) {
		show(page);
		return element;
	}

	element = make('div', 'PixSettings');
	element.setAttribute('role', 'dialog');
	element.setAttribute('tabindex', '-1');
	element.setAttribute('aria-label', 'Settings');
	var nav = make('div', 'PixSettings__nav');
	nav.setAttribute('role', 'tablist');
	nav.setAttribute('aria-orientation', 'vertical');
	nav.setAttribute('aria-label', 'Settings pages');
	var head = make('div', 'PixSettings__head');
	var heading = make('h2', 'PixSettings__heading');
	var shut = make('button', 'PixDialog__close', '×');
	shut.title = 'Close';
	shut.setAttribute('aria-label', 'Close');
	shut.onclick = close;
	head.append(heading, shut);
	var body = make('div', 'PixSettings__body');
	body.setAttribute('role', 'tabpanel');
	element.append(make('div', 'PixSettings__title', 'Settings'), nav, head, body);
	element.addEventListener('keydown', function (e) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			close();
		}
	});

	var buttons = listed.map(function (each) {
		var tab = make('button', 'PixSettings__page', each.label);
		tab.setAttribute('role', 'tab');
		tab.dataset.page = each.id;
		tab.onclick = function () {
			show(each);
			tab.focus();
		};
		tab.addEventListener('keydown', function (e) {
			var next = stepPage(listed, each.id, e.key);
			if (next) {
				e.preventDefault();
				show(next);
				buttons[listed.indexOf(next)].focus();
			}
		});
		nav.append(tab);
		return tab;
	});
	parts = {heading: heading, body: body, buttons: buttons};

	host.append(element);
	show(page);
	var selected = buttons.find(function (tab) { return tab.dataset.page === page.id; });
	(selected || element).focus();
	return element;
}

function show (page) {
	stopShowing();
	shown = page;
	lastShown = page.id;
	var mine = showing;
	var body = parts.body;
	parts.heading.textContent = page.label;
	parts.buttons.forEach(function (tab) {
		var on = tab.dataset.page === page.id;
		tab.setAttribute('aria-selected', on ? 'true' : 'false');
		tab.tabIndex = on ? 0 : -1;
	});
	body.scrollTop = 0;

	// Drawn again after every choice. The focus goes back to the control it was on, found by its
	// `data-key`, or to the window itself -- left on a removed button it would fall out onto the
	// page, and take Escape with it.
	var paint = function (force) {
		if (mine !== showing || !element) {
			return;
		}
		var active = document.activeElement;
		if (!force && typingIn(body, active)) {
			return;
		}
		var had = !!active && body.contains(active);
		var key = had && active.dataset ? active.dataset.key : undefined;
		body.replaceChildren();
		try {
			page.render(body, ctx);
		}
		catch (err) {
			console.error('The settings page ' + page.id + ' could not be drawn', err);
			body.append(note('This page could not be drawn: ' + ((err && err.message) || err)));
		}
		if (had) {
			var again = key === undefined ? null : findKey(body, key);
			(again || element).focus();
		}
	};
	var ctx = {
		render: function () { paint(true); },
		refresh: function () { paint(false); },
		isShown: function () { return mine === showing && !!element; }
	};
	draw = paint;
	paint(true);
	if (typeof page.enter === 'function') {
		var stop = page.enter(ctx);
		if (typeof stop === 'function') {
			if (mine === showing) {
				leave = stop;
			}
			else {
				stop();
			}
		}
	}
}

// What every page draws with: a section with its small heading, a note, a button.
export function section (label) {
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

export function note (text) {
	var element = document.createElement('p');
	element.className = 'PixDialog__note';
	element.textContent = text;
	return element;
}

export function button (label, onclick) {
	var element = document.createElement('button');
	element.className = 'PixButton';
	element.textContent = label;
	if (onclick) {
		element.onclick = onclick;
	}
	return element;
}
