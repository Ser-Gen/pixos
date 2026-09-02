// Every window at once, and a number to press.
//
// With more than three or four windows open, finding one means reading the taskbar — and
// a window on another desktop is not in the taskbar at all. This is the overlay that
// answers "where did that go", Exposé-style.
//
// **Why an overlay rather than nine per-window chords.** Binding Ctrl+1..9 to windows
// would need nine free chords, and the browser and the OS between them have claimed most
// of what is free — Ctrl+Alt+D and Ctrl+Space both turned out dead in earlier phases. Here
// the numbers exist *only while the overlay is open*, so exactly one chord has to survive,
// and the same design keeps working past nine windows where a fixed set of number keys
// simply stops.
//
// **Closing lives here too.** In fullscreen, phase 8's keyboard lock makes Ctrl/Cmd+W
// close a PixOS window properly. Outside fullscreen there is no free close chord and
// inventing one that silently never fires is the mistake earlier phases already made, so
// the routes are: a tile's ✕, Delete on the highlighted tile, and a palette command.
//
// There are no thumbnails. A page cannot screenshot its own iframes, and a fake preview
// would be worse than a title — so a tile is the title, the path, the app icon and which
// desktop it is on, which is what you were reading the taskbar for anyway.

import * as icons from './app-icons.js';

var STYLE_ID = 'pixos-overview-style';

var CSS = `
.PixOverview {
	position: absolute;
	/* Stops above the taskbar, the same way #root does. Covering it would hide the button
	   that opened this and every window button beside it, which is the opposite of what an
	   overlay for finding windows should do. */
	inset: 0 0 var(--pixos-taskbar-height, 38px) 0;
	background: rgba(14, 16, 20, .82);
	backdrop-filter: blur(2px);
	display: flex;
	flex-direction: column;
	font-family: Arial, Helvetica, sans-serif;
	color: #e4e4e4;
}

.PixOverview__head {
	flex: none;
	display: flex;
	align-items: baseline;
	gap: 12px;
	padding: 18px 22px 10px;
}

.PixOverview__title {
	font-size: 14px;
	letter-spacing: .04em;
}

.PixOverview__hint {
	font-size: 11px;
	color: #8a919c;
	display: flex;
	gap: 14px;
	flex-wrap: wrap;
}

.PixOverview__body {
	flex: 1;
	overflow-y: auto;
	padding: 4px 16px 22px;
}

.PixOverview__group {
	padding: 12px 6px 6px;
	font-size: 10px;
	text-transform: uppercase;
	letter-spacing: .09em;
	color: #767d88;
}

.PixOverview__grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
	gap: 10px;
}

.PixOverview__tile {
	position: relative;
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 12px 12px;
	min-height: 62px;
	background: #23262b;
	border: 1px solid #434850;
	cursor: pointer;
	min-width: 0;
	text-align: left;
	color: inherit;
	font: inherit;
}

.PixOverview__tile:hover {
	background: #2b2f36;
}

.PixOverview__tile--active {
	border-color: #7aa2f7;
	background: #2f343d;
}

.PixOverview__tile--current::after {
	content: '';
	position: absolute;
	left: -1px;
	top: -1px;
	bottom: -1px;
	width: 2px;
	background: #7aa2f7;
}

.PixOverview__number {
	flex: none;
	width: 18px;
	height: 18px;
	line-height: 18px;
	text-align: center;
	font-size: 10px;
	color: #b8bec7;
	background: rgba(255, 255, 255, .08);
}

.PixOverview__text {
	flex: 1;
	min-width: 0;
}

.PixOverview__name {
	font-size: 13px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.PixOverview__meta {
	font-size: 11px;
	color: #8a919c;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.PixOverview__dirty {
	color: #e3b341;
}

.PixOverview__close {
	flex: none;
	width: 22px;
	height: 22px;
	background: none;
	border: none;
	color: #8a919c;
	font: inherit;
	font-size: 13px;
	cursor: pointer;
	line-height: 1;
}

.PixOverview__close:hover {
	background: rgba(255, 255, 255, .12);
	color: #fff;
}

.PixOverview__empty {
	padding: 26px 8px;
	color: #8a919c;
	font-size: 13px;
}
`;

var host = null;
var options = {};
var element = null;
var body = null;
var tiles = [];
var activeIndex = 0;
var unsubscribe = null;

function ensureStyle () {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) {
		return;
	}
	var style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.append(style);
}

// The order the tiles appear in, and which of them get a number.
//
// The current desktop comes first because that is where you are: a numbered list whose
// first entry is on a desktop you cannot see would make the numbers mean nothing. Only
// the first nine are numbered — the rest are reachable with the arrows, and a tenth key
// that does not exist is not worth pretending about.
export function plan (windows, workspaces, activeWorkspaceId) {
	var names = {};
	var order = {};
	(workspaces || []).forEach(function (workspace, index) {
		names[workspace.id] = workspace.name;
		order[workspace.id] = index;
	});

	var sorted = (windows || []).slice().sort(function (a, b) {
		var aCurrent = a.workspace === activeWorkspaceId ? 0 : 1;
		var bCurrent = b.workspace === activeWorkspaceId ? 0 : 1;
		if (aCurrent !== bCurrent) {
			return aCurrent - bCurrent;
		}
		var aOrder = order[a.workspace] === undefined ? 99 : order[a.workspace];
		var bOrder = order[b.workspace] === undefined ? 99 : order[b.workspace];
		return aOrder - bOrder;
	});

	return sorted.map(function (win, index) {
		return {
			id: win.id,
			title: win.title || (win.path ? win.path.split('/').pop() : 'Window'),
			path: win.path || '',
			appId: win.appId || null,
			dirty: !!win.dirty,
			workspace: win.workspace,
			desktop: names[win.workspace] || '',
			current: win.workspace === activeWorkspaceId,
			number: index < 9 ? index + 1 : null
		};
	});
}

// One place that decides what a keystroke means, so the overlay's keyboard cannot drift
// from what the hint line at the top claims it does.
export function resolveKey (e, count) {
	if (e.key === 'Escape') {
		return {action: 'cancel'};
	}
	if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
		return {action: 'activate'};
	}
	if (e.key === 'Delete' || e.key === 'Backspace') {
		return {action: 'close'};
	}
	if (e.key === 'Tab') {
		return {action: 'move', delta: e.shiftKey ? -1 : 1};
	}
	// All four arrows move by one rather than by a row. Row-aware movement needs the
	// rendered geometry, and at the counts this overlay is for it buys a step that is
	// already one keypress away.
	if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
		return {action: 'move', delta: 1};
	}
	if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
		return {action: 'move', delta: -1};
	}
	if (/^Digit[1-9]$/.test(e.code || '') && !e.ctrlKey && !e.metaKey && !e.altKey) {
		var index = Number(e.code.slice(5)) - 1;
		// A number nobody is showing does nothing, rather than jumping somewhere arbitrary.
		return index < count ? {action: 'pick', index: index} : {action: 'ignore'};
	}
	return null;
}

// cfg: {host, wm, getApp, onShow(id), onClose(id), onToggle(open)}
export function init (cfg) {
	host = cfg.host;
	options = cfg;
	ensureStyle();

	if (typeof window === 'undefined') {
		return;
	}
	// Capture, and before desktop.js's own Escape handler, for the same reason the palette
	// takes it: one Escape belongs to whatever is on top, not to two things at once.
	window.addEventListener('keydown', onKeyDown, true);
}

export function isOpen () {
	return !!element;
}

export function toggle () {
	if (isOpen()) {
		close();
		return;
	}
	open();
}

export function close () {
	if (!element) {
		return;
	}
	if (unsubscribe) {
		unsubscribe();
		unsubscribe = null;
	}
	element.remove();
	element = null;
	body = null;
	tiles = [];
	announce();
}

export function open () {
	if (element) {
		return;
	}
	ensureStyle();

	element = document.createElement('div');
	element.className = 'PixOverview';
	// Focusable, and focused below, for one reason: the window that was in front is very
	// likely an app iframe, and a keystroke inside an iframe never reaches this document.
	// Without taking focus, the numbers and arrows the overlay advertises would do nothing
	// for exactly the person who opened it to get out of an app.
	element.tabIndex = -1;

	var head = document.createElement('div');
	head.className = 'PixOverview__head';
	var title = document.createElement('div');
	title.className = 'PixOverview__title';
	title.textContent = 'Windows';
	var hint = document.createElement('div');
	hint.className = 'PixOverview__hint';
	hint.innerHTML = '<span>1–9 to jump</span><span>↑↓←→ to move</span>'
		+ '<span>Enter to open</span><span>Delete to close it</span><span>Esc to cancel</span>';
	head.append(title, hint);

	body = document.createElement('div');
	body.className = 'PixOverview__body';

	element.append(head, body);
	// Clicking the background is a cancel, the same as Esc. A click on a tile stops there.
	element.onmousedown = function (e) {
		if (e.target === element || e.target === body) {
			close();
		}
	};
	host.append(element);

	// A window closed from a tile, or by an app, redraws the list underneath the cursor
	// rather than leaving a tile that opens nothing.
	if (options.wm && typeof options.wm.on === 'function') {
		var handler = function () {
			if (element) {
				render();
			}
		};
		options.wm.on('changed', handler);
		unsubscribe = function () {
			options.wm.off('changed', handler);
		};
	}

	activeIndex = 0;
	render();
	element.focus();
	announce();

	// Start on the window you are looking at, so Enter is "put this back" rather than a
	// jump to whichever window happens to be first.
	var active = options.wm.getActiveWindow && options.wm.getActiveWindow();
	if (active) {
		var at = tiles.findIndex(function (tile) {
			return tile.id === active.id;
		});
		if (at > -1) {
			activeIndex = at;
			renderActive();
		}
	}
}

// The taskbar button reflects the overlay however it was opened -- a button that lights up
// only when it was the thing clicked is a button that lies about the state.
function announce () {
	if (options.onToggle) {
		options.onToggle(isOpen());
	}
}

function render () {
	tiles = plan(
		options.wm.listWindows(),
		options.wm.listWorkspaces(),
		options.wm.getActiveWorkspace()
	);

	body.replaceChildren();

	if (!tiles.length) {
		var empty = document.createElement('div');
		empty.className = 'PixOverview__empty';
		empty.textContent = 'No windows are open. Esc to go back, or open something from the '
			+ 'start menu.';
		body.append(empty);
		return;
	}

	if (activeIndex >= tiles.length) {
		activeIndex = tiles.length - 1;
	}

	var lastDesktop = null;
	var grid = null;
	tiles.forEach(function (tile, index) {
		if (tile.workspace !== lastDesktop) {
			lastDesktop = tile.workspace;
			var heading = document.createElement('div');
			heading.className = 'PixOverview__group';
			heading.textContent = tile.desktop + (tile.current ? ' — this desktop' : '');
			body.append(heading);
			grid = document.createElement('div');
			grid.className = 'PixOverview__grid';
			body.append(grid);
		}
		grid.append(buildTile(tile, index));
	});

	renderActive();
}

function buildTile (tile, index) {
	var item = document.createElement('div');
	item.className = 'PixOverview__tile' + (tile.current ? ' PixOverview__tile--current' : '');
	item.dataset.index = String(index);

	var number = document.createElement('span');
	number.className = 'PixOverview__number';
	number.textContent = tile.number === null ? '' : String(tile.number);
	item.append(number);

	if (options.getApp) {
		var app = options.getApp(tile.appId) || {id: tile.appId || tile.title, name: tile.title};
		item.append(icons.render(app, 22));
	}

	var text = document.createElement('div');
	text.className = 'PixOverview__text';
	var name = document.createElement('div');
	name.className = 'PixOverview__name';
	if (tile.dirty) {
		var dot = document.createElement('span');
		dot.className = 'PixOverview__dirty';
		dot.textContent = '● ';
		name.append(dot);
	}
	name.append(document.createTextNode(tile.title));
	var meta = document.createElement('div');
	meta.className = 'PixOverview__meta';
	meta.textContent = tile.path || tile.desktop;
	text.append(name, meta);
	item.append(text);

	var closeButton = document.createElement('button');
	closeButton.className = 'PixOverview__close';
	closeButton.textContent = '✕';
	closeButton.title = 'Close this window';
	closeButton.onmousedown = function (e) {
		e.preventDefault();
		e.stopPropagation();
		closeAt(index);
	};
	item.append(closeButton);

	item.onmousedown = function (e) {
		e.preventDefault();
		e.stopPropagation();
		activeIndex = index;
		activate();
	};
	return item;
}

function renderActive () {
	if (!body) {
		return;
	}
	body.querySelectorAll('.PixOverview__tile').forEach(function (item) {
		var active = Number(item.dataset.index) === activeIndex;
		item.classList.toggle('PixOverview__tile--active', active);
		if (active) {
			item.scrollIntoView({block: 'nearest'});
		}
	});
}

function move (delta) {
	if (!tiles.length) {
		return;
	}
	activeIndex = (activeIndex + delta + tiles.length) % tiles.length;
	renderActive();
}

function activate () {
	var tile = tiles[activeIndex];
	if (!tile) {
		return;
	}
	close();
	options.onShow(tile.id);
}

function closeAt (index) {
	var tile = tiles[index];
	if (!tile) {
		return;
	}
	// The list redraws from the WM's `changed` event, so nothing is removed by hand here;
	// closing the last window leaves the empty state rather than the overlay vanishing,
	// because a disappearing overlay reads as a mis-click.
	if (options.onClose) {
		options.onClose(tile.id);
		return;
	}
	options.wm.closeWindow(tile.id);
}

function onKeyDown (e) {
	if (!element) {
		return;
	}
	var resolved = resolveKey(e, tiles.length);
	if (!resolved) {
		return;
	}
	e.preventDefault();
	e.stopImmediatePropagation();

	if (resolved.action === 'cancel') {
		close();
		return;
	}
	if (resolved.action === 'move') {
		move(resolved.delta);
		return;
	}
	if (resolved.action === 'pick') {
		activeIndex = resolved.index;
		activate();
		return;
	}
	if (resolved.action === 'activate') {
		activate();
		return;
	}
	if (resolved.action === 'close') {
		closeAt(activeIndex);
	}
}
