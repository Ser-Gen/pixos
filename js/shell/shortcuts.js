// Keyboard shortcuts: which ones there are, how a key is written on this machine, and the sheet
// that lists them (Ctrl/Cmd+/, the palette's *Keyboard shortcuts*, the start menu).
//
// **One spelling, read by the handler and by the sheet.** A chord is written once, as a string
// such as `Mod+Shift+K`, and the same string is what `matchesChord` tests a keydown against and
// what `formatChord` draws. Before this the handlers in index.html and desktop.js tested
// modifier flags by hand and the only place a chord was written for a person was one tooltip,
// so the two could disagree and nothing would say so. `Mod` is Cmd or Ctrl, whichever is held,
// which is how every shell chord has always matched; it is drawn as ⌘ on a Mac and Ctrl
// elsewhere.
//
// **A chord the OS takes is not advertised.** `Ctrl+Space` is the input-source switch on macOS
// and never reaches the page (phase 3), and the peek's `Ctrl+Alt+D` was taken on a Mac in phase 1,
// its `Cmd+Alt+D` being the Dock's own show-and-hide -- so the Mac sheet leaves both out rather than
// listing keys that do nothing. They stay bound: the handler costs nothing, and a Mac with those
// system shortcuts turned off still gets them.
//
// **An app's shortcuts come from the app, at the moment the sheet opens.** An app sets
// `window.pixosShortcuts` to a list of `{keys, label}`, beside the handler that answers to
// them; the sheet reads it from the window in front. Not a manifest field: a field added to
// `pixos.app.json` has to be named by hand in four record builders in js/app-registry.js or it
// silently does not exist (see *Launching, and the app contract* in docs/not-so-simple.md), and
// a list kept in the manifest is a list kept away from the code it describes.

var STYLE_ID = 'pixos-shortcuts-style';

// `id` is what the handlers and the palette ask for by name.
export var SHELL_SHORTCUTS = [
	{
		title: 'PixOS',
		items: [
			{id: 'palette', keys: ['Mod+K', 'Ctrl+Space'], label: 'Search apps, windows, files and commands'},
			{id: 'overview', keys: ['Mod+Shift+K', 'Ctrl+`'], label: 'All windows, numbered'},
			{id: 'desktop', keys: ['Ctrl+Shift+1…9'], label: 'Go to desktop 1 to 9'},
			{id: 'peek', keys: ['Mod+Alt+D'], label: 'Show the desktop, and back'},
			{id: 'shortcuts', keys: ['Mod+/'], label: 'This list'},
			{id: 'close', keys: ['Mod+W'], label: 'Close the window in front', note: 'in fullscreen only'}
		]
	},
	{
		title: 'In the palette and the overview',
		items: [
			{keys: ['ArrowUp', 'ArrowDown'], label: 'Move'},
			{keys: ['Enter'], label: 'Open'},
			{keys: ['Escape'], label: 'Close'},
			{keys: ['1…9'], label: 'Go to that window', note: 'overview'},
			{keys: ['Delete'], label: 'Close the highlighted window', note: 'overview'}
		]
	}
];

// Chords the OS keeps for itself, by platform. See the header.
var TAKEN_ON_MAC = ['Ctrl+Space', 'Mod+Alt+D'];

var MODIFIERS = ['Mod', 'Ctrl', 'Alt', 'Shift'];

var CODES = {
	'`': 'Backquote',
	'/': 'Slash',
	'Space': 'Space',
	'Enter': 'Enter',
	'Escape': 'Escape',
	'Delete': 'Delete',
	'Backspace': 'Backspace',
	'Tab': 'Tab',
	'ArrowUp': 'ArrowUp',
	'ArrowDown': 'ArrowDown',
	'ArrowLeft': 'ArrowLeft',
	'ArrowRight': 'ArrowRight'
};

var MAC_KEYS = {
	'Enter': '↩',
	'Escape': 'Esc',
	'Delete': '⌦',
	'Backspace': '⌫',
	'Tab': '⇥',
	'ArrowUp': '↑',
	'ArrowDown': '↓',
	'ArrowLeft': '←',
	'ArrowRight': '→'
};

var OTHER_KEYS = {
	'Escape': 'Esc',
	'Delete': 'Del',
	'ArrowUp': '↑',
	'ArrowDown': '↓',
	'ArrowLeft': '←',
	'ArrowRight': '→'
};

// Apple's order, which is also the order a Mac menu draws them in.
var MAC_MODIFIERS = [['Ctrl', '⌃'], ['Alt', '⌥'], ['Shift', '⇧'], ['Mod', '⌘']];
var OTHER_MODIFIERS = [['Mod', 'Ctrl'], ['Ctrl', 'Ctrl'], ['Alt', 'Alt'], ['Shift', 'Shift']];

// `Mod+Shift+K` -> {mod, ctrl, alt, shift, key: 'K'}, or null for something that is not a chord.
export function parseChord (spec) {
	if (typeof spec !== 'string' || !spec) {
		return null;
	}
	// The last part is the key, and may itself be `+`-free punctuation such as `/` or `` ` ``.
	var parts = spec.split('+');
	var key = parts.pop();
	if (!key) {
		return null;
	}
	var chord = {mod: false, ctrl: false, alt: false, shift: false, key: key};
	for (var i = 0; i < parts.length; i++) {
		if (MODIFIERS.indexOf(parts[i]) === -1) {
			return null;
		}
		chord[parts[i].toLowerCase()] = true;
	}
	return chord;
}

function codeMatches (key, code) {
	if (key === '1…9') {
		return /^Digit[1-9]$/.test(code || '');
	}
	if (/^[A-Z]$/.test(key)) {
		return code === 'Key' + key;
	}
	if (/^[0-9]$/.test(key)) {
		return code === 'Digit' + key;
	}
	return !!CODES[key] && code === CODES[key];
}

// By `e.code`, never `e.key`: on macOS Alt is a compose modifier, so Ctrl+Alt+D arrives with
// `e.key === '∂'` and a match on the letter silently never fires. A modifier the chord does not
// name must not be held -- except that `Mod` is satisfied by either Cmd or Ctrl.
export function matchesChord (e, spec) {
	var chord = parseChord(spec);
	if (!chord || !e) {
		return false;
	}
	if (chord.mod) {
		if (!e.metaKey && !e.ctrlKey) {
			return false;
		}
	}
	else if (e.metaKey || (!!e.ctrlKey !== chord.ctrl)) {
		return false;
	}
	if (!!e.altKey !== chord.alt || !!e.shiftKey !== chord.shift) {
		return false;
	}
	return codeMatches(chord.key, e.code);
}

export function matchesAny (e, specs) {
	return (specs || []).some(function (spec) {
		return matchesChord(e, spec);
	});
}

export function isMacPlatform (nav) {
	nav = nav || (typeof navigator !== 'undefined' ? navigator : null);
	if (!nav) {
		return false;
	}
	var platform = (nav.userAgentData && nav.userAgentData.platform) || nav.platform || '';
	return /mac|iphone|ipad/i.test(platform);
}

// How a chord is written for a person: `⌘⇧K` on a Mac, `Ctrl+Shift+K` elsewhere. Something that
// is not a chord comes back as it was, so a label can never turn into an empty hint.
export function formatChord (spec, mac) {
	var chord = parseChord(spec);
	if (!chord) {
		return String(spec || '');
	}
	var key = chord.key;
	if (key === 'Click') {
		key = mac ? 'click' : 'Click';
	}
	else {
		key = (mac ? MAC_KEYS : OTHER_KEYS)[key] || key;
	}
	var names = (mac ? MAC_MODIFIERS : OTHER_MODIFIERS).filter(function (pair) {
		return chord[pair[0].toLowerCase()];
	}).map(function (pair) {
		return pair[1];
	});
	if (mac) {
		// A pointer action reads as `⇧-click`, the way a Mac manual writes it.
		return names.join('') + (chord.key === 'Click' && names.length ? '-' : '') + key;
	}
	return names.concat([key]).join('+');
}

export function availableKeys (keys, mac) {
	return (keys || []).filter(function (spec) {
		return !(mac && TAKEN_ON_MAC.indexOf(spec) > -1);
	});
}

export function shellKeys (id) {
	for (var g = 0; g < SHELL_SHORTCUTS.length; g++) {
		for (var i = 0; i < SHELL_SHORTCUTS[g].items.length; i++) {
			if (SHELL_SHORTCUTS[g].items[i].id === id) {
				return SHELL_SHORTCUTS[g].items[i].keys.slice();
			}
		}
	}
	return [];
}

// The one chord to print beside a command: the first this machine can use.
export function describeShortcut (id, mac) {
	var keys = availableKeys(shellKeys(id), mac);
	return keys.length ? formatChord(keys[0], mac) : '';
}

// What an app put in `window.pixosShortcuts`, kept only as far as it makes sense: an app is not
// trusted to hand the shell a well-formed list, and one bad entry is dropped rather than taking
// the whole sheet down with it.
export function readAppShortcuts (value) {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.slice(0, 40).map(function (entry) {
		if (!entry || typeof entry.label !== 'string' || !entry.label.trim()) {
			return null;
		}
		var keys = (Array.isArray(entry.keys) ? entry.keys : [entry.keys]).filter(function (spec) {
			return !!parseChord(spec);
		});
		if (!keys.length) {
			return null;
		}
		return {
			keys: keys,
			label: entry.label.trim().slice(0, 80),
			note: typeof entry.note === 'string' ? entry.note.slice(0, 40) : ''
		};
	}).filter(Boolean);
}

// Everything the sheet draws, already written for this machine. `app` is `{name, items}` for the
// window in front, or null.
export function buildSections (app, mac) {
	var sections = [];
	if (app && app.items && app.items.length) {
		sections.push({title: app.name + ' — the window in front', items: app.items});
	}
	sections = sections.concat(SHELL_SHORTCUTS);
	return sections.map(function (section) {
		return {
			title: section.title,
			items: section.items.map(function (item) {
				return {
					keys: availableKeys(item.keys, mac).map(function (spec) {
						return formatChord(spec, mac);
					}),
					label: item.label,
					note: item.note || ''
				};
			}).filter(function (item) {
				return item.keys.length;
			})
		};
	}).filter(function (section) {
		return section.items.length;
	});
}

// --- the sheet ------------------------------------------------------------------------------------

var CSS = `
.PixKeys {
	position: absolute;
	inset: 0 0 var(--pixos-taskbar-height, 38px) 0;
	background: rgba(14, 16, 20, .72);
	display: flex;
	align-items: flex-start;
	justify-content: center;
	padding: 10vh 16px 16px;
	box-sizing: border-box;
	font-family: Arial, Helvetica, sans-serif;
	color: #e4e4e4;
	outline: none;
}

.PixKeys__panel {
	width: min(560px, 100%);
	max-height: 100%;
	overflow-y: auto;
	background: #23262b;
	border: 1px solid #434850;
	box-shadow: 0 30px 80px rgba(0, 0, 0, .6);
	padding: 6px 18px 16px;
	box-sizing: border-box;
}

.PixKeys__head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
	padding: 10px 0 2px;
}

.PixKeys__title {
	font-size: 14px;
	letter-spacing: .04em;
}

.PixKeys__hint {
	font-size: 11px;
	color: #8a919c;
}

.PixKeys__group {
	padding: 14px 0 6px;
	font-size: 10px;
	text-transform: uppercase;
	letter-spacing: .09em;
	color: #767d88;
}

.PixKeys__list {
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 6px 16px;
	margin: 0;
	align-items: baseline;
}

.PixKeys__keys {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	justify-content: flex-end;
	margin: 0;
}

.PixKeys__key {
	font: 12px/1 ui-monospace, Menlo, Consolas, monospace;
	padding: 3px 6px;
	background: rgba(255, 255, 255, .08);
	border: 1px solid #434850;
	border-bottom-width: 2px;
	white-space: nowrap;
}

.PixKeys__label {
	margin: 0;
	font-size: 13px;
}

.PixKeys__note {
	margin-left: 6px;
	font-size: 11px;
	color: #8a919c;
}
`;

var host = null;
var element = null;
var options = {};

function ensureStyle () {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) {
		return;
	}
	var style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.append(style);
}

// `cfg.getApp()` answers `{name, items}` for the window in front, or null.
export function init (cfg) {
	host = cfg.host;
	options = cfg;
	ensureStyle();
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
	element.remove();
	element = null;
}

export function open () {
	if (element || !host) {
		return;
	}
	ensureStyle();
	var mac = isMacPlatform();
	var app = null;
	try {
		app = options.getApp ? options.getApp() : null;
	}
	catch (err) {
		// A window that went away while it was being read lists nothing of its own.
		app = null;
	}

	element = document.createElement('div');
	element.className = 'PixKeys';
	element.setAttribute('role', 'dialog');
	element.setAttribute('aria-label', 'Keyboard shortcuts');
	// Focused, like the overview, because the window in front is usually an app iframe and Esc
	// pressed in there would never reach this document.
	element.tabIndex = -1;

	var panel = document.createElement('div');
	panel.className = 'PixKeys__panel';

	var head = document.createElement('div');
	head.className = 'PixKeys__head';
	var title = document.createElement('div');
	title.className = 'PixKeys__title';
	title.textContent = 'Keyboard shortcuts';
	var hint = document.createElement('div');
	hint.className = 'PixKeys__hint';
	hint.textContent = 'Esc to close';
	head.append(title, hint);
	panel.append(head);

	buildSections(app, mac).forEach(function (section) {
		var group = document.createElement('div');
		group.className = 'PixKeys__group';
		group.textContent = section.title;
		var list = document.createElement('dl');
		list.className = 'PixKeys__list';
		section.items.forEach(function (item) {
			var keys = document.createElement('dt');
			keys.className = 'PixKeys__keys';
			item.keys.forEach(function (text) {
				var key = document.createElement('kbd');
				key.className = 'PixKeys__key';
				key.textContent = text;
				keys.append(key);
			});
			var label = document.createElement('dd');
			label.className = 'PixKeys__label';
			label.textContent = item.label;
			if (item.note) {
				var note = document.createElement('span');
				note.className = 'PixKeys__note';
				note.textContent = item.note;
				label.append(note);
			}
			list.append(keys, label);
		});
		panel.append(group, list);
	});

	element.append(panel);
	element.onmousedown = function (e) {
		if (e.target === element) {
			close();
		}
	};
	element.onkeydown = function (e) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			close();
		}
	};
	host.append(element);
	element.focus();
}
