// Type-to-find, over everything.
//
// Providers are resolved in a fixed order and each returns scored results, so apps beat
// windows beat commands for the same query. Files are separate: a query starting with /
// searches the filesystem instead, because otherwise every path fragment would drown the
// app list.
//
// A file query answers in two stages, and that is deliberate. The directory listing is
// instant and appears immediately; the walk of the tree underneath it is debounced, capped
// and time-budgeted, and its results are **appended** when they arrive. Appending rather
// than re-sorting is the whole trick: the entry under the highlight does not move while
// you are reaching for Enter.

import * as icons from './app-icons.js';
import * as appsModel from './apps-model.js';

var STYLE_ID = 'pixos-palette-style';

var CSS = `
.PixPalette {
	position: absolute;
	left: 50%;
	top: 14vh;
	transform: translateX(-50%);
	width: min(620px, calc(100vw - 32px));
	background: #23262b;
	border: 1px solid #434850;
	box-shadow: 0 30px 80px rgba(0, 0, 0, .6);
	font-family: Arial, Helvetica, sans-serif;
	color: #e4e4e4;
	display: flex;
	flex-direction: column;
	max-height: 66vh;
}

.PixPalette__input {
	width: 100%;
	box-sizing: border-box;
	padding: 14px 16px;
	background: transparent;
	border: none;
	border-bottom: 1px solid #383c44;
	color: #e4e4e4;
	font: inherit;
	font-size: 15px;
	outline: none;
}

.PixPalette__input::placeholder {
	color: #767d88;
}

.PixPalette__list {
	list-style: none;
	margin: 0;
	padding: 6px;
	overflow-y: auto;
}

.PixPalette__group {
	padding: 8px 10px 4px;
	font-size: 10px;
	text-transform: uppercase;
	letter-spacing: .09em;
	color: #767d88;
}

.PixPalette__item {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 7px 10px;
	cursor: pointer;
	min-width: 0;
}

.PixPalette__item--active {
	background: #333840;
}

.PixPalette__text {
	min-width: 0;
	flex: 1;
}

.PixPalette__title {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 13px;
}

.PixPalette__subtitle {
	font-size: 11px;
	color: #8a919c;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.PixPalette__badge {
	flex: none;
	font-size: 10px;
	text-transform: uppercase;
	letter-spacing: .06em;
	color: #767d88;
}

.PixPalette__empty {
	padding: 18px 16px;
	color: #8a919c;
	font-size: 13px;
}

.PixPalette__note {
	padding: 6px 16px;
	border-top: 1px solid #383c44;
	font-size: 11px;
	color: #c9a227;
}

.PixPalette__note--hidden {
	display: none;
}

.PixPalette__hint {
	padding: 8px 16px;
	border-top: 1px solid #383c44;
	font-size: 11px;
	color: #767d88;
	display: flex;
	gap: 14px;
}
`;

var host = null;
var options = {};
var element = null;
var input = null;
var list = null;
var results = [];
var activeIndex = 0;
var searchToken = 0;
var deepTimer = null;
var deepToken = null;
var note = null;

// Long enough that typing a path does not start a walk per keystroke, short enough that
// stopping to think produces an answer without asking for one.
var DEEP_DELAY = 160;
// Two characters. One matches most of the filesystem and answers a question nobody asked.
var DEEP_MINIMUM = 2;

function ensureStyle () {
	if (document.getElementById(STYLE_ID)) {
		return;
	}
	var style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.append(style);
}

// cfg: {host, wm, launch, commands, listFiles, searchFiles, describeSearch, openPath,
// openFile, openRecentFile, getApp}
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
	cancelDeepSearch();
	element.remove();
	element = null;
	input = null;
	list = null;
	note = null;
	results = [];
}

export function toggle () {
	if (isOpen()) {
		close();
		return;
	}
	open();
}

export function open (initialQuery) {
	if (element) {
		input.focus();
		input.select();
		return;
	}

	element = document.createElement('div');
	element.className = 'PixPalette';

	input = document.createElement('input');
	input.className = 'PixPalette__input';
	input.type = 'text';
	input.spellcheck = false;
	input.placeholder = 'Search apps and windows, or type / to search files';
	input.value = initialQuery || '';
	input.oninput = function () {
		refresh();
	};
	input.onkeydown = onKeyDown;

	list = document.createElement('ul');
	list.className = 'PixPalette__list';

	note = document.createElement('div');
	note.className = 'PixPalette__note PixPalette__note--hidden';

	var hint = document.createElement('div');
	hint.className = 'PixPalette__hint';
	hint.innerHTML = '<span>↑↓ to move</span><span>Enter to open</span><span>Esc to close</span>';

	element.append(input, list, note, hint);
	host.append(element);
	input.focus();
	refresh();
}

function onKeyDown (e) {
	if (e.key === 'Escape') {
		e.preventDefault();
		e.stopPropagation();
		close();
		return;
	}
	if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
		e.preventDefault();
		move(1);
		return;
	}
	if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
		e.preventDefault();
		move(-1);
		return;
	}
	if (e.key === 'Enter') {
		e.preventDefault();
		runActive();
	}
}

function move (delta) {
	if (!results.length) {
		return;
	}
	activeIndex = (activeIndex + delta + results.length) % results.length;
	renderActive();
}

function runActive () {
	var result = results[activeIndex];
	if (!result) {
		return;
	}
	close();
	result.run();
}

// Every query re-runs every provider, and a token guards against an earlier async file
// listing landing after a later one.
function refresh () {
	var query = input.value;
	var token = ++searchToken;
	cancelDeepSearch();
	setNote(null);

	Promise.resolve(collect(query)).then(function (collected) {
		if (token !== searchToken || !element) {
			return;
		}
		results = collected;
		activeIndex = 0;
		render();
		scheduleDeepSearch(query, token);
	});
}

// A walk in flight belongs to a query that no longer exists. Cancelling it is not an
// optimisation: eight keystrokes would otherwise leave eight walks reading the filesystem
// to produce answers that are already thrown away.
function cancelDeepSearch () {
	if (deepTimer !== null) {
		clearTimeout(deepTimer);
		deepTimer = null;
	}
	if (deepToken) {
		deepToken.cancel();
		deepToken = null;
	}
}

function scheduleDeepSearch (query, token) {
	if (!options.searchFiles) {
		return;
	}
	var trimmed = String(query || '').trim();
	if (trimmed.charAt(0) !== '/') {
		return;
	}
	var cut = trimmed.lastIndexOf('/');
	var dir = trimmed.slice(0, cut) || '/';
	var partial = trimmed.slice(cut + 1).trim();
	if (partial.length < DEEP_MINIMUM) {
		return;
	}

	deepTimer = setTimeout(function () {
		deepTimer = null;
		var request = options.searchFiles({query: partial, root: dir});
		deepToken = request.token || null;
		Promise.resolve(request.done || request).then(function (found) {
			if (token !== searchToken || !element || !found || found.cancelled) {
				return;
			}
			appendDeepResults(found, dir);
		});
	}, DEEP_DELAY);
}

// Appended, never merged into the sort: whatever is highlighted stays where it is.
function appendDeepResults (found, dir) {
	var seen = {};
	results.forEach(function (result) {
		if (result.path) {
			seen[result.path] = true;
		}
	});

	var added = found.matches
		.filter(function (match) {
			return !seen[match.path];
		})
		.map(function (match) {
			return fileResult(match.path, match.name, match.isDirectory, 'Elsewhere in ' + dir);
		});

	if (!added.length && !found.partial) {
		setNote(results.length ? null : 'Nothing in ' + dir + ' matches that');
		return;
	}
	results = results.concat(added);
	render();
	setNote(options.describeSearch ? options.describeSearch(found) : null);
}

function setNote (text) {
	if (!note) {
		return;
	}
	note.textContent = text || '';
	note.classList.toggle('PixPalette__note--hidden', !text);
}

function collect (query) {
	var trimmed = String(query || '').trim();

	// A leading slash means "I am looking for a file", and nothing else competes.
	if (trimmed.charAt(0) === '/') {
		return collectFiles(trimmed);
	}

	return [].concat(
		collectRecentFiles(trimmed),
		collectApps(trimmed),
		collectWindows(trimmed),
		collectCommands(trimmed)
	);
}

// Only on an empty query. Typing anything is a search, and a file you opened yesterday
// outranking the app you just named would be the wrong answer to it.
function collectRecentFiles (query) {
	if (query || !options.openRecentFile) {
		return [];
	}
	return appsModel.listRecentFiles(6).map(function (entry) {
		var name = entry.path.split('/').pop() || entry.path;
		return {
			group: 'Recent files',
			title: name,
			subtitle: entry.path,
			badge: entry.dir ? 'folder' : 'file',
			path: entry.path,
			run: function () {
				options.openRecentFile(entry);
			}
		};
	});
}

function collectApps (query) {
	return appsModel.search(query, 8).map(function (app) {
		return {
			group: 'Applications',
			title: app.name,
			subtitle: app.id,
			icon: app,
			run: function () {
				options.openApp(app.id);
			}
		};
	});
}

function collectWindows (query) {
	return options.wm.listWindows()
		.map(function (win) {
			var title = win.path ? win.path.split('/').pop() : win.title;
			return {win: win, title: title, score: appsModel.score(title + ' ' + (win.path || ''), query)};
		})
		.filter(function (entry) {
			return entry.score !== null;
		})
		.sort(function (a, b) {
			return b.score - a.score;
		})
		.slice(0, 6)
		.map(function (entry) {
			return {
				group: 'Open windows',
				title: entry.title,
				subtitle: entry.win.path || '',
				badge: 'window',
				icon: options.getApp(entry.win.appId) || {id: entry.win.appId || entry.title, name: entry.title},
				run: function () {
					options.wm.focusWindow(entry.win.id);
				}
			};
		});
}

function collectCommands (query) {
	// A function, so entries that depend on current state -- the list of desktops --
	// are built fresh for every query rather than frozen at init.
	var commands = typeof options.commands === 'function' ? options.commands() : (options.commands || []);
	return commands
		.map(function (command) {
			return {command: command, score: appsModel.score(command.title, query)};
		})
		.filter(function (entry) {
			return entry.score !== null;
		})
		.sort(function (a, b) {
			return b.score - a.score;
		})
		.slice(0, 6)
		.map(function (entry) {
			return {
				group: 'Commands',
				title: entry.command.title,
				subtitle: entry.command.subtitle || '',
				badge: 'command',
				run: entry.command.run
			};
		});
}

// Lists one directory rather than walking the tree: the deepest complete directory in
// the query, filtered by whatever was typed after it. Predictable, and it stays instant
// on a filesystem of any size.
async function collectFiles (query) {
	if (!options.listFiles) {
		return [];
	}
	var cut = query.lastIndexOf('/');
	var dir = query.slice(0, cut) || '/';
	var partial = query.slice(cut + 1).toLowerCase();

	var entries = await options.listFiles(dir);
	return entries
		.map(function (entry) {
			return {entry: entry, score: partial ? appsModel.score(entry.name, partial) : 0};
		})
		.filter(function (item) {
			return item.score !== null;
		})
		.sort(function (a, b) {
			return b.score - a.score || a.entry.name.localeCompare(b.entry.name);
		})
		.slice(0, 20)
		.map(function (item) {
			var full = (dir === '/' ? '' : dir) + '/' + item.entry.name;
			return fileResult(full, item.entry.name, item.entry.isDirectory, dir);
		});
}

function fileResult (full, name, isDirectory, group) {
	return {
		group: group,
		title: name,
		subtitle: full,
		badge: isDirectory ? 'folder' : 'file',
		path: full,
		run: function () {
			if (isDirectory) {
				options.openPath(full);
			}
			else {
				options.openFile(full);
			}
		}
	};
}

function render () {
	list.replaceChildren();

	if (!results.length) {
		var empty = document.createElement('li');
		empty.className = 'PixPalette__empty';
		empty.textContent = 'Nothing matches';
		list.append(empty);
		return;
	}

	var lastGroup = null;
	results.forEach(function (result, index) {
		if (result.group !== lastGroup) {
			lastGroup = result.group;
			var heading = document.createElement('li');
			heading.className = 'PixPalette__group';
			heading.textContent = result.group;
			list.append(heading);
		}

		var item = document.createElement('li');
		item.className = 'PixPalette__item';
		item.dataset.index = String(index);

		if (result.icon) {
			item.append(icons.render(result.icon, 18));
		}

		var text = document.createElement('div');
		text.className = 'PixPalette__text';
		var title = document.createElement('div');
		title.className = 'PixPalette__title';
		title.textContent = result.title;
		text.append(title);
		if (result.subtitle) {
			var subtitle = document.createElement('div');
			subtitle.className = 'PixPalette__subtitle';
			subtitle.textContent = result.subtitle;
			text.append(subtitle);
		}
		item.append(text);

		if (result.badge) {
			var badge = document.createElement('span');
			badge.className = 'PixPalette__badge';
			badge.textContent = result.badge;
			item.append(badge);
		}

		// mousedown, not click: the input must not lose focus before the action runs.
		item.onmousedown = function (e) {
			e.preventDefault();
			activeIndex = index;
			runActive();
		};
		list.append(item);
	});

	renderActive();
}

function renderActive () {
	list.querySelectorAll('.PixPalette__item').forEach(function (item) {
		var active = Number(item.dataset.index) === activeIndex;
		item.classList.toggle('PixPalette__item--active', active);
		if (active) {
			item.scrollIntoView({block: 'nearest'});
		}
	});
}

// Clicking away closes it, the same way the context menu behaves.
window.addEventListener('mousedown', function (e) {
	if (element && !element.contains(e.target)) {
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
