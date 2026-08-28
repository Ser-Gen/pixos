// The taskbar: what is open, what the machine is doing, and a way back to the desktop.
//
// It owns no state of its own. The window list is rebuilt from wm.listWindows() whenever
// the WM says something changed, and the tray redraws from the shared stats poller.

import * as icons from './app-icons.js';
import * as stats from './system-stats.js';

var STYLE_ID = 'pixos-taskbar-style';

export var HEIGHT = 38;

var CSS = `
.PixTaskbar {
	position: fixed;
	left: 0;
	right: 0;
	bottom: 0;
	height: ${HEIGHT}px;
	display: flex;
	align-items: stretch;
	gap: 6px;
	padding: 0 6px;
	box-sizing: border-box;
	background: rgba(20, 23, 28, .92);
	border-top: 1px solid rgba(255, 255, 255, .09);
	font-family: Arial, Helvetica, sans-serif;
	font-size: 12px;
	color: #d8dce3;
	user-select: none;
}

.PixTaskbar__start {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 0 12px;
	background: none;
	border: none;
	color: #e8ebef;
	font: inherit;
	cursor: pointer;
	letter-spacing: .04em;
}

.PixTaskbar__start:hover,
.PixTaskbar__start--open {
	background: rgba(255, 255, 255, .09);
}

.PixTaskbar__desktops {
	display: flex;
	align-items: stretch;
	gap: 3px;
	flex: none;
	padding: 5px 0;
	border-right: 1px solid rgba(255, 255, 255, .12);
	padding-right: 6px;
}

.PixDesk {
	display: flex;
	align-items: center;
	padding: 0 10px;
	max-width: 130px;
	background: rgba(255, 255, 255, .05);
	border: 1px solid transparent;
	color: #b8bec7;
	font: inherit;
	font-size: 11px;
	cursor: pointer;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.PixDesk:hover {
	background: rgba(255, 255, 255, .1);
}

.PixDesk--active {
	background: rgba(79, 157, 255, .22);
	border-color: rgba(79, 157, 255, .5);
	color: #fff;
}

.PixDesk--drop {
	border-color: #4f9dff;
	background: rgba(79, 157, 255, .3);
}

.PixDesk__rename {
	width: 110px;
	background: #1b1e23;
	border: 1px solid #4f9dff;
	color: #fff;
	font: inherit;
	font-size: 11px;
	padding: 0 8px;
	outline: none;
}

.PixDesk--add {
	padding: 0 9px;
	color: #8a919c;
	font-size: 14px;
}

.PixTaskbar__windows {
	display: flex;
	align-items: stretch;
	gap: 4px;
	flex: 1;
	min-width: 0;
	overflow: hidden;
	padding: 5px 0;
}

.PixTaskbar__window {
	display: flex;
	align-items: center;
	gap: 7px;
	min-width: 0;
	max-width: 190px;
	padding: 0 10px;
	background: rgba(255, 255, 255, .05);
	border: 1px solid transparent;
	border-bottom: 2px solid transparent;
	color: #c6ccd5;
	font: inherit;
	cursor: pointer;
	text-align: left;
}

.PixTaskbar__window:hover {
	background: rgba(255, 255, 255, .1);
}

.PixTaskbar__window--active {
	background: rgba(255, 255, 255, .12);
	border-bottom-color: #4f9dff;
	color: #fff;
}

.PixTaskbar__label {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.PixTaskbar__empty {
	display: flex;
	align-items: center;
	padding: 0 4px;
	color: #767d88;
	font-style: italic;
}

.PixTaskbar__tray {
	display: flex;
	align-items: center;
	gap: 4px;
	flex: none;
}

.PixTray__item {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 0 9px;
	height: 100%;
	color: #c6ccd5;
	white-space: nowrap;
}

.PixTray__item--hidden {
	display: none;
}

.PixTray__clock {
	color: #fff;
	font-variant-numeric: tabular-nums;
}

.PixTray__meter {
	position: relative;
	width: 30px;
	height: 6px;
	background: rgba(255, 255, 255, .16);
	overflow: hidden;
}

.PixTray__meterFill {
	position: absolute;
	inset: 0 auto 0 0;
	background: #6fb3ff;
}

.PixTray__meterFill--warn {
	background: #ffb648;
}

.PixTray__meterFill--critical {
	background: #ff6b5e;
}

.PixTaskbar__peek {
	flex: none;
	width: 12px;
	margin-left: 2px;
	background: none;
	border: none;
	border-left: 1px solid rgba(255, 255, 255, .12);
	cursor: pointer;
	padding: 0;
}

.PixTaskbar__peek:hover,
.PixTaskbar__peek--active {
	background: rgba(255, 255, 255, .12);
}
`;

var host = null;
var wm = null;
var options = {};
var elements = {};

// Clicking a window button means "show me that window", which is not the same thing as
// GoldenLayout selecting a tab -- it also has to end a peek, or the button appears dead.
// The shell supplies the peek-aware version; focusWindow alone is the fallback.
function showWindow (id) {
	if (options.onShowWindow) {
		options.onShowWindow(id);
		return;
	}
	wm.focusWindow(id);
}

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
	host = cfg.host;
	wm = cfg.wm;
	options = cfg;

	ensureStyle();
	// Published so the shell's layout can inset the window area by exactly this much
	// without the number being written down twice.
	document.documentElement.style.setProperty('--pixos-taskbar-height', HEIGHT + 'px');

	var bar = document.createElement('div');
	bar.className = 'PixTaskbar';

	elements.start = document.createElement('button');
	elements.start.className = 'PixTaskbar__start';
	elements.start.innerHTML = '<span>◈</span><span>Start</span>';
	// The menu treats this button as its anchor, so a click here does not count as a
	// click outside and the menu is still open by the time this handler runs. That is
	// what makes the second click close it rather than reopen it.
	elements.start.onclick = function (e) {
		e.stopPropagation();
		if (options.isMenuOpen && options.isMenuOpen()) {
			options.onCloseMenu();
			return;
		}
		setStartOpen(true);
		options.onStart(elements.start.getBoundingClientRect(), elements.start, function () {
			setStartOpen(false);
		});
	};

	elements.desktops = document.createElement('div');
	elements.desktops.className = 'PixTaskbar__desktops';

	elements.windows = document.createElement('div');
	elements.windows.className = 'PixTaskbar__windows';

	elements.tray = buildTray();

	elements.peek = document.createElement('button');
	elements.peek.className = 'PixTaskbar__peek';
	elements.peek.title = 'Show desktop';
	elements.peek.onclick = options.onPeek;

	bar.append(elements.start, elements.desktops, elements.windows, elements.tray, elements.peek);
	host.append(bar);
	elements.bar = bar;

	wm.on('changed', render);
	wm.on('workspaces-changed', render);
	stats.subscribe(renderTray);
	render();

	return bar;
}

// Called by the shell when peek is toggled from anywhere, so the button reflects it.
export function setPeeking (peeking) {
	if (elements.peek) {
		elements.peek.classList.toggle('PixTaskbar__peek--active', !!peeking);
	}
}

export function setStartOpen (open) {
	if (elements.start) {
		elements.start.classList.toggle('PixTaskbar__start--open', !!open);
	}
}

function render () {
	renderDesktops();
	renderWindows();
}

function renderDesktops () {
	var workspaces = wm.listWorkspaces();
	elements.desktops.replaceChildren();

	workspaces.forEach(function (workspace) {
		var button = document.createElement('button');
		button.className = 'PixDesk' + (workspace.active ? ' PixDesk--active' : '');
		button.textContent = workspace.name;
		button.title = workspace.name + ' — ' + workspace.windowCount
			+ (workspace.windowCount === 1 ? ' window' : ' windows')
			+ '\nDouble-click to rename, right-click for more';

		button.onclick = function () {
			wm.switchTo(workspace.id);
		};
		button.ondblclick = function (e) {
			e.preventDefault();
			startRename(button, workspace);
		};
		button.oncontextmenu = function (e) {
			e.preventDefault();
			options.onDesktopMenu(workspace, e.clientX, e.clientY, function () {
				startRename(button, workspace);
			});
		};

		// Dropping a window button here moves that window to this desktop. The iframe
		// never moves in the DOM, so the app carries on untouched.
		button.ondragover = function (e) {
			if (!workspace.active) {
				e.preventDefault();
				button.classList.add('PixDesk--drop');
			}
		};
		button.ondragleave = function () {
			button.classList.remove('PixDesk--drop');
		};
		button.ondrop = function (e) {
			e.preventDefault();
			button.classList.remove('PixDesk--drop');
			var id = Number(e.dataTransfer.getData('text/pixos-window'));
			if (!isNaN(id)) {
				wm.moveWindow(id, workspace.id);
			}
		};

		elements.desktops.append(button);
	});

	var add = document.createElement('button');
	add.className = 'PixDesk PixDesk--add';
	add.textContent = '+';
	add.title = 'New desktop';
	add.onclick = function () {
		var workspace = wm.createWorkspace({name: 'Desktop ' + (workspaces.length + 1)});
		wm.switchTo(workspace.id);
	};
	elements.desktops.append(add);
}

// Renaming in place rather than through a dialog: the name is one short string and the
// button is already the right shape for an input.
function startRename (button, workspace) {
	var input = document.createElement('input');
	input.className = 'PixDesk__rename';
	input.value = workspace.name;

	var commit = function (apply) {
		if (!input.parentNode) {
			return;
		}
		var value = input.value;
		input.replaceWith(button);
		if (apply) {
			wm.renameWorkspace(workspace.id, value);
		}
	};

	input.onkeydown = function (e) {
		e.stopPropagation();
		if (e.key === 'Enter') {
			commit(true);
		}
		else if (e.key === 'Escape') {
			commit(false);
		}
	};
	input.onblur = function () {
		commit(true);
	};

	button.replaceWith(input);
	input.focus();
	input.select();
}

function renderWindows () {
	// Only the current desktop's windows: the strip to the left is what shows the rest.
	var windows = wm.listWindows(wm.getActiveWorkspace());
	elements.windows.replaceChildren();

	if (!windows.length) {
		var empty = document.createElement('span');
		empty.className = 'PixTaskbar__empty';
		empty.textContent = 'No open windows';
		elements.windows.append(empty);
		return;
	}

	windows.forEach(function (win) {
		var button = document.createElement('button');
		button.className = 'PixTaskbar__window' + (win.active ? ' PixTaskbar__window--active' : '');
		button.title = win.path || win.title;

		// The window title is the full path for a file; the basename is what fits.
		var text = win.path ? win.path.split('/').pop() : win.title;
		// A window opened straight onto a path has no app behind it, so the monogram
		// comes from the filename rather than from a path full of separators.
		var app = (options.getApp && options.getApp(win.appId)) || {id: win.appId || text, name: text};

		button.append(icons.render(app, 16));

		var label = document.createElement('span');
		label.className = 'PixTaskbar__label';
		label.textContent = text;
		button.append(label);

		button.onclick = function () {
			showWindow(win.id);
		};
		// Middle-click closes, as it does on a browser tab.
		button.onauxclick = function (e) {
			if (e.button === 1) {
				e.preventDefault();
				wm.closeWindow(win.id);
			}
		};
		button.draggable = true;
		button.ondragstart = function (e) {
			e.dataTransfer.setData('text/pixos-window', String(win.id));
			e.dataTransfer.effectAllowed = 'move';
		};
		elements.windows.append(button);
	});
}

function buildTray () {
	var tray = document.createElement('div');
	tray.className = 'PixTaskbar__tray';

	elements.storage = document.createElement('div');
	elements.storage.className = 'PixTray__item';
	elements.storage.innerHTML = '<span class="PixTray__meter"><span class="PixTray__meterFill"></span></span><span></span>';

	elements.battery = document.createElement('div');
	elements.battery.className = 'PixTray__item';
	elements.battery.innerHTML = '<span class="PixTray__meter"><span class="PixTray__meterFill"></span></span><span></span>';

	elements.clock = document.createElement('div');
	elements.clock.className = 'PixTray__item PixTray__clock';

	tray.append(elements.storage, elements.battery, elements.clock);
	return tray;
}

function renderTray (state) {
	elements.clock.textContent = stats.formatClock(state.now);
	elements.clock.title = stats.formatDate(state.now);

	renderMeter(elements.storage, state.storage && state.storage.supported
		? {
			ratio: state.storage.quota ? state.storage.usage / state.storage.quota : 0,
			label: stats.formatBytes(state.storage.usage),
			title: 'Storage: ' + stats.formatBytes(state.storage.usage) + ' of '
				+ stats.formatBytes(state.storage.quota) + ' used by this origin',
			invert: false
		}
		: null);

	renderMeter(elements.battery, state.battery && state.battery.supported
		? {
			ratio: state.battery.level,
			label: Math.round(state.battery.level * 100) + '%' + (state.battery.charging ? ' ⚡' : ''),
			title: batteryTitle(state.battery),
			invert: true
		}
		: null);
}

// A hidden item, not an empty one: a browser without the Battery API should show no
// battery at all rather than a permanently blank slot.
function renderMeter (element, data) {
	element.classList.toggle('PixTray__item--hidden', !data);
	if (!data) {
		return;
	}
	var fill = element.querySelector('.PixTray__meterFill');
	var ratio = Math.max(0, Math.min(1, data.ratio || 0));
	fill.style.width = (ratio * 100) + '%';
	// Storage is alarming when it is full, a battery when it is empty.
	var severity = data.invert ? 1 - ratio : ratio;
	fill.className = 'PixTray__meterFill'
		+ (severity > 0.9 ? ' PixTray__meterFill--critical' : severity > 0.75 ? ' PixTray__meterFill--warn' : '');
	element.lastChild.textContent = data.label;
	element.title = data.title;
}

function batteryTitle (battery) {
	if (battery.charging) {
		var full = stats.formatDuration(battery.chargingTime);
		return full ? 'Charging, ' + full + ' until full' : 'Charging';
	}
	var left = stats.formatDuration(battery.dischargingTime);
	return left ? left + ' remaining' : 'On battery';
}
