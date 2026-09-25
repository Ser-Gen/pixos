// Keyboard shortcuts: js/shell/shortcuts.js, and the shell's hotkey handler that now reads it
// (phase 25).
//
// Four things in here fail without an error:
//
//   * **The handler and the sheet read one spelling.** `matchesChord` is what every shell chord is
//     tested by now, so it has to answer exactly as the hand-written flag tests it replaced did --
//     `Mod` is Cmd *or* Ctrl, a modifier nobody named must not be held, and the letter is read from
//     `e.code`, because on a Mac Alt+D arrives as `∂`.
//   * **A chord the OS takes is not advertised.** Ctrl+Space never reaches a page on a Mac.
//   * **Ctrl/Cmd+/ belongs to the text field while typing.** It is *toggle comment* in both code
//     editors; taking it there would break the editor to show a list.
//   * **An app's list is the app's, and not trusted.** A bad entry is dropped, not drawn, and a
//     window the shell cannot read into lists nothing rather than throwing.

import fs from 'node:fs';
import {check, report} from './assert.mjs';
import * as shortcuts from '../js/shell/shortcuts.js';

const {parseChord, matchesChord, formatChord, availableKeys, describeShortcut, readAppShortcuts,
	buildSections, shellKeys, isMacPlatform, SHELL_SHORTCUTS} = shortcuts;

const key = (code, extra) => Object.assign({code: code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false}, extra || {});

// --- parsing ---------------------------------------------------------------------------------------

check('a chord is its modifiers and a key', parseChord('Mod+Shift+K'), {mod: true, ctrl: false, alt: false, shift: true, key: 'K'});
check('punctuation is a key like any other', parseChord('Mod+/').key, '/');
check('a key alone is a chord', parseChord('Enter'), {mod: false, ctrl: false, alt: false, shift: false, key: 'Enter'});
check('an unknown modifier is not a chord', parseChord('Hyper+K'), null);
check('nor is nothing', [parseChord(''), parseChord(null), parseChord('Mod+')], [null, null, null]);

// --- matching: the same answers the hand-written tests gave --------------------------------------

check('Mod is Cmd', matchesChord(key('KeyK', {metaKey: true}), 'Mod+K'), true);
check('or Ctrl', matchesChord(key('KeyK', {ctrlKey: true}), 'Mod+K'), true);
check('but not neither', matchesChord(key('KeyK'), 'Mod+K'), false);
check('a modifier the chord does not name must not be held', matchesChord(key('KeyK', {metaKey: true, shiftKey: true}), 'Mod+K'), false);
check('which is what keeps the palette and the overview apart',
	[matchesChord(key('KeyK', {metaKey: true, shiftKey: true}), 'Mod+Shift+K'), matchesChord(key('KeyK', {metaKey: true}), 'Mod+Shift+K')],
	[true, false]);
check('Ctrl named alone is Ctrl, not Cmd', [matchesChord(key('Space', {ctrlKey: true}), 'Ctrl+Space'),
	matchesChord(key('Space', {metaKey: true}), 'Ctrl+Space')], [true, false]);
check('a chord with no Ctrl refuses Cmd too', matchesChord(key('Enter', {metaKey: true}), 'Enter'), false);
check('the letter is read from the code: Alt+D on a Mac arrives as ∂',
	matchesChord(Object.assign(key('KeyD', {metaKey: true, altKey: true}), {key: '∂'}), 'Mod+Alt+D'), true);
check('1…9 is any of the nine digits', ['Digit1', 'Digit9', 'Digit0'].map(code => matchesChord(key(code, {ctrlKey: true, shiftKey: true}), 'Ctrl+Shift+1…9')),
	[true, true, false]);
check('` and / are their codes', [matchesChord(key('Backquote', {ctrlKey: true}), 'Ctrl+`'), matchesChord(key('Slash', {metaKey: true}), 'Mod+/')],
	[true, true]);
check('a non-chord matches nothing', matchesChord(key('KeyK', {metaKey: true}), 'Hyper+K'), false);

// --- writing a chord for a person ----------------------------------------------------------------

check('on a Mac, symbols in Apple\'s order', ['Mod+K', 'Mod+Shift+K', 'Mod+Alt+D', 'Ctrl+Shift+1…9', 'Mod+/'].map(s => formatChord(s, true)),
	['⌘K', '⇧⌘K', '⌥⌘D', '⌃⇧1…9', '⌘/']);
check('elsewhere, words joined by +', ['Mod+K', 'Mod+Shift+K', 'Mod+Alt+D', 'Ctrl+Shift+1…9', 'Mod+/'].map(s => formatChord(s, false)),
	['Ctrl+K', 'Ctrl+Shift+K', 'Ctrl+Alt+D', 'Ctrl+Shift+1…9', 'Ctrl+/']);
check('named keys, a Mac\'s way and a PC\'s', [['Enter', 'Delete', 'Mod+Backspace', 'Escape', 'ArrowUp'].map(s => formatChord(s, true)),
	['Enter', 'Delete', 'Mod+Backspace', 'Escape', 'ArrowUp'].map(s => formatChord(s, false))],
	[['↩', '⌦', '⌘⌫', 'Esc', '↑'], ['Enter', 'Del', 'Ctrl+Backspace', 'Esc', '↑']]);
check('a pointer gesture reads as one', [formatChord('Shift+Click', true), formatChord('Shift+Click', false)], ['⇧-click', 'Shift+Click']);
check('something that is not a chord is left as it was', formatChord('Hyper+K', true), 'Hyper+K');

check('a Mac is told by its platform', [isMacPlatform({platform: 'MacIntel'}), isMacPlatform({userAgentData: {platform: 'macOS'}}),
	isMacPlatform({platform: 'Win32'}), isMacPlatform({platform: 'Linux x86_64'})], [true, true, false, false]);

// --- what a Mac is not shown ---------------------------------------------------------------------

check('Ctrl+Space is left off a Mac, which keeps it for input sources', availableKeys(shellKeys('palette'), true), ['Mod+K']);
check('and kept elsewhere', availableKeys(shellKeys('palette'), false), ['Mod+K', 'Ctrl+Space']);
check('the peek is left off a Mac too: Ctrl+Alt+D and Cmd+Alt+D are both the system\'s there',
	[describeShortcut('peek', true), describeShortcut('peek', false)], ['', 'Ctrl+Alt+D']);
check('a command prints its first usable chord', [describeShortcut('overview', true), describeShortcut('overview', false)], ['⇧⌘K', 'Ctrl+Shift+K']);
check('a command with none prints nothing', describeShortcut('no-such', false), '');
check('every chord the handler reads by name is on the list',
	['palette', 'overview', 'desktop', 'peek', 'screensaver', 'shortcuts', 'close'].filter(id => !shellKeys(id).length), []);
// Phase 26. Not Ctrl+Alt+<letter>: on Windows that is AltGr, which types ś or @ in half of Europe.
check('the screensaver starts on Mod+Shift+L, drawn for each machine',
	[describeShortcut('screensaver', true), describeShortcut('screensaver', false)], ['⇧⌘L', 'Ctrl+Shift+L']);
check('and no two shell commands share a chord',
	(keys => keys.filter((k, i) => keys.indexOf(k) !== i))(SHELL_SHORTCUTS[0].items.flatMap(i => i.keys)), []);
check('and every chord on the list is one', SHELL_SHORTCUTS.flatMap(g => g.items.flatMap(i => i.keys)).filter(s => !parseChord(s)), []);

// --- an app's own list ---------------------------------------------------------------------------

check('something that is not a list is nothing', [readAppShortcuts(null), readAppShortcuts('Mod+C'), readAppShortcuts({})], [[], [], []]);
check('a good entry is kept, one chord or several', readAppShortcuts([
	{keys: 'Mod+C', label: 'Copy'},
	{keys: ['Delete', 'Mod+Backspace'], label: '  Delete  ', note: 'files'}
]), [{keys: ['Mod+C'], label: 'Copy', note: ''}, {keys: ['Delete', 'Mod+Backspace'], label: 'Delete', note: 'files'}]);
check('a bad one is dropped, not drawn', readAppShortcuts([
	null, {keys: 'Mod+C'}, {keys: 'Mod+C', label: '   '}, {keys: ['Hyper+Q'], label: 'Nothing'}, {keys: ['Hyper+Q', 'Mod+Q'], label: 'Quit'}
]), [{keys: ['Mod+Q'], label: 'Quit', note: ''}]);
check('and a list is not allowed to run on forever', readAppShortcuts(Array.from({length: 90}, (_, i) => ({keys: 'Mod+K', label: 'x' + i}))).length, 40);
check('nor a label', readAppShortcuts([{keys: 'Mod+K', label: 'x'.repeat(300)}])[0].label.length, 80);

{
	const app = {name: 'Explorer', items: readAppShortcuts([{keys: ['Mod+C'], label: 'Copy'}, {keys: ['Ctrl+Space'], label: 'Only a PC has this'}])};
	const mac = buildSections(app, true);
	check('the window in front comes first, named', mac.map(s => s.title),
		['Explorer — the window in front', 'PixOS', 'In the palette and the overview']);
	check('its keys written for the machine', mac[0].items[0], {keys: ['⌘C'], label: 'Copy', note: ''});
	check('an entry left with no key this machine can press is not drawn', mac[0].items.length, 1);
	check('the PixOS list on a Mac has no Ctrl+Space', mac[1].items[0].keys, ['⌘K']);
	check('a PC\'s has both', buildSections(app, false)[1].items[0].keys, ['Ctrl+K', 'Ctrl+Space']);
	check('a note travels with its entry', mac[1].items.find(i => i.label === 'Close the window in front').note, 'in fullscreen only');
	check('with no window in front, PixOS alone', buildSections(null, false).map(s => s.title), ['PixOS', 'In the palette and the overview']);
	check('nor for a window that listed nothing', buildSections({name: 'Ace', items: []}, false).length, 2);
}

// --- the shell's handler, lifted out of index.html ----------------------------------------------

const shell = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const from = shell.indexOf('\t// Every chord here is spelled once');
const to = shell.indexOf('\tasync function persistDesktopSettings', from);
if (from === -1 || to === -1) {
	console.error('shortcuts.test.mjs: could not find the hotkey handler in index.html');
	process.exit(1);
}

function world (opts) {
	opts = opts || {};
	const w = {trace: [], locked: !!opts.locked};
	const overlay = name => ({
		open: () => w.trace.push(name + ':open'),
		close: () => w.trace.push(name + ':close'),
		toggle: () => w.trace.push(name + ':toggle')
	});
	const sheet = Object.assign({}, shortcuts, overlay('sheet'));
	w.frames = opts.frames || {};
	w.winManager = {
		getActiveWindow: () => opts.front || null,
		getFrame: id => w.frames[id] || null,
		listWorkspaces: () => [{id: 'w1'}, {id: 'w2'}, {id: 'w3'}],
		switchTo: id => w.trace.push('switch:' + id),
		listWindows: () => [],
		getActiveWorkspace: () => 'w1',
		closeWindow: id => w.trace.push('close:' + id)
	};
	w.api = new Function('shortcuts', 'winManager', 'startMenu', 'palette', 'overview', 'fullscreen', 'getLaunchableApp',
		shell.slice(from, to) + '\n; return {onShellHotkey, frontAppShortcuts, isTypingTarget};')(
		sheet, w.winManager, overlay('start'), overlay('palette'), overlay('overview'),
		{isKeyboardLocked: () => w.locked},
		id => (id === 'explorer' ? {name: 'Explorer'} : null)
	);
	w.press = (code, extra) => {
		w.trace.length = 0;
		const e = Object.assign(key(code, extra), {prevented: false, preventDefault () { this.prevented = true; }, stopPropagation () {}});
		w.api.onShellHotkey(e);
		return {trace: w.trace.slice(), prevented: e.prevented};
	};
	return w;
}

{
	const w = world();
	check('Cmd+/ opens the sheet and closes whatever else is open', w.press('Slash', {metaKey: true}),
		{trace: ['start:close', 'palette:close', 'overview:close', 'sheet:toggle'], prevented: true});
	check('Ctrl+/ too', w.press('Slash', {ctrlKey: true}).trace.includes('sheet:toggle'), true);
	check('but not while typing in a text field -- it is toggle comment in an editor',
		w.press('Slash', {metaKey: true, target: {tagName: 'TEXTAREA'}}), {trace: [], prevented: false});
	check('nor in something editable', w.press('Slash', {metaKey: true, target: {tagName: 'DIV', isContentEditable: true}}).trace, []);
	check('a checkbox is not typing', w.press('Slash', {metaKey: true, target: {tagName: 'INPUT', type: 'checkbox'}}).trace.includes('sheet:toggle'), true);
	check('a text input is', w.press('Slash', {metaKey: true, target: {tagName: 'INPUT'}}).trace, []);

	check('the palette closes the sheet', w.press('KeyK', {metaKey: true}).trace, ['start:close', 'sheet:close', 'palette:toggle']);
	check('and so does the overview', w.press('KeyK', {metaKey: true, shiftKey: true}).trace,
		['start:close', 'palette:close', 'sheet:close', 'overview:toggle']);
	check('Ctrl+` is the overview\'s second chord', w.press('Backquote', {ctrlKey: true}).trace.includes('overview:toggle'), true);
	check('Ctrl+Space the palette\'s', w.press('Space', {ctrlKey: true}).trace.includes('palette:toggle'), true);

	check('Ctrl+Shift+2 goes to the second desktop', w.press('Digit2', {ctrlKey: true, shiftKey: true}), {trace: ['switch:w2'], prevented: true});
	check('a desktop that is not there is left to the browser', w.press('Digit7', {ctrlKey: true, shiftKey: true}), {trace: [], prevented: false});
	check('Ctrl+2 alone is the browser\'s tab switch, and not ours', w.press('Digit2', {ctrlKey: true}).trace, []);

	check('Cmd+W outside fullscreen is the browser\'s', w.press('KeyW', {metaKey: true}), {trace: [], prevented: false});
}

{
	const w = world({locked: true, front: {id: 7}});
	check('with the keyboard locked, Cmd+W closes the window in front', w.press('KeyW', {metaKey: true}).trace, ['close:7']);
}

// --- the keys of the window in front --------------------------------------------------------------

{
	const list = [{keys: ['Mod+C'], label: 'Copy'}];
	const w = world({front: {id: 3, appId: 'explorer', title: '/home'}, frames: {3: {contentWindow: {pixosShortcuts: list}}}});
	check('the window in front hands over its list, under its app\'s name', w.api.frontAppShortcuts(),
		{name: 'Explorer', items: [{keys: ['Mod+C'], label: 'Copy', note: ''}]});
}

{
	const w = world({front: {id: 4, appId: 'unknown', title: 'notes.txt'}, frames: {4: {contentWindow: {pixosShortcuts: [{keys: 'Mod+S', label: 'Save'}]}}}});
	check('an app the shell cannot name is named by its window', w.api.frontAppShortcuts().name, 'notes.txt');
}

{
	const frame = {get contentWindow () { throw new Error('SecurityError'); }};
	const w = world({front: {id: 5, appId: 'photopea'}, frames: {5: frame}});
	check('a window the shell cannot read into lists nothing, and throws nothing', w.api.frontAppShortcuts(), null);
}

{
	const w = world({front: {id: 6, appId: 'ace'}, frames: {6: {contentWindow: {}}}});
	check('nor does an app that declared nothing', w.api.frontAppShortcuts(), null);
	check('nor no window at all', world().api.frontAppShortcuts(), null);
}

// desktop.js has its own keydown listener for the peek, and reads the chord by name like the rest.
check('the desktop answers to the peek\'s chord as listed, not one of its own',
	/matchesAny\(e, shellKeys\('peek'\)\)/.test(fs.readFileSync(new URL('../js/shell/desktop.js', import.meta.url), 'utf8')), true);

// --- the sheet itself ----------------------------------------------------------------------------

{
	function node (tag) {
		const n = {
			tagName: tag.toUpperCase(), className: '', textContent: '', children: [], attributes: {},
			append (...kids) { kids.forEach(k => { k.parent = n; n.children.push(k); }); },
			remove () { n.removed = true; if (n.parent) { n.parent.children = n.parent.children.filter(k => k !== n); } },
			setAttribute (name, value) { n.attributes[name] = value; },
			focus () { n.focused = true; }
		};
		return n;
	}
	globalThis.document = {createElement: node, getElementById: () => ({}), head: node('head')};
	const text = n => n.textContent + n.children.map(text).join('');
	const host = node('div');
	let asked = 0;
	shortcuts.init({host: host, getApp: () => { asked++; throw new Error('gone mid-read'); }});
	shortcuts.open();
	const sheet = host.children[0];
	check('a window that fails while being read does not stop the sheet opening', [shortcuts.isOpen(), asked], [true, 1]);
	check('it takes the focus, so Esc reaches it from inside an app', sheet.focused, true);
	check('and says what it is', sheet.attributes['aria-label'], 'Keyboard shortcuts');
	check('it lists PixOS\'s keys', /Search apps, windows, files and commands/.test(text(sheet)), true);
	sheet.onkeydown({key: 'Escape', preventDefault () {}, stopPropagation () {}});
	check('Esc closes it', [shortcuts.isOpen(), host.children.length], [false, 0]);

	shortcuts.init({host: host, getApp: () => ({name: 'Explorer', items: readAppShortcuts([{keys: 'Mod+C', label: 'Copy the selection'}])})});
	shortcuts.toggle();
	check('the window in front is listed', /Explorer — the window in front/.test(text(host.children[0])) && /Copy the selection/.test(text(host.children[0])), true);
	host.children[0].onmousedown({target: host.children[0]});
	check('a click beside the panel closes it', shortcuts.isOpen(), false);
	delete globalThis.document;
}

report('shortcuts');
