// Explorer's context menus, and the clipboard underneath *Copy path*.
//
// Two things are checked here and they fail in different ways. A menu entry naming an
// action that does not exist is a dead click with nothing in the console until you press
// it — so every action every menu names is looked up in the real `actions` table. And the
// clipboard from inside an iframe is allowed to refuse: it needs a secure context and a
// gesture, and Explorer is a frame. A copy that silently did nothing is the failure this
// is written against.
//
// Everything is extracted from apps/explorer/index.html rather than duplicated, so
// rearranging it breaks these tests instead of slipping past them.

import fs from 'fs';
import {check, report} from './assert.mjs';
// The real rule, not a stub: whether *Extract…* is offered on a row is decided by the
// same module the engine uses, and a menu that disagrees with it would offer the entry on
// a text file or hide it on a .rar.
import * as archiveNames from '../apps/7z/js/parse.js';

const source = fs.readFileSync(new URL('../apps/explorer/index.html', import.meta.url), 'utf8');

function fn (name) {
	let start = source.indexOf('function ' + name + ' (');
	// `async` sits outside the match and is load-bearing: extracted without it the
	// function's own `await` is a syntax error rather than a test.
	if (start > 6 && source.slice(start - 6, start) === 'async ') {
		start -= 6;
	}
	if (start === -1) {
		console.error('explorer-menus.test.mjs: could not find function ' + name);
		process.exit(1);
	}
	let depth = 0;
	for (let i = source.indexOf('{', start); i < source.length; i++) {
		if (source[i] === '{') { depth++; }
		else if (source[i] === '}') {
			depth--;
			if (depth === 0) { return source.slice(start, i + 1); }
		}
	}
	console.error('explorer-menus.test.mjs: unbalanced braces in ' + name);
	process.exit(1);
}

// --- what the menus offer -------------------------------------------------------------

// Every action the real table has, as a name. The menus are checked against this rather
// than against a list written here, which would go stale the first time one is renamed.
const actionNames = new Set();
{
	const table = source.slice(source.indexOf('\tvar actions = {'));
	const pattern = /^\t\t([A-Za-z0-9_]+): (?:async )?function/gm;
	let match;
	while ((match = pattern.exec(table))) {
		actionNames.add(match[1]);
	}
}
check('the actions table was found and read', actionNames.size > 15, true);

const menus = new Function('shell', `
	var parent = shell.parent;
	var navigator = {platform: 'MacIntel'};
	var state = ${JSON.stringify({recording: false, selectedPaths: [], cwd: '/home'})};
	state.selectedPaths = new Set(shell.selected.map(function (i) { return i.path; }));
	var actions = shell.actions;
	var mountManager = {isMountPoint: function () { return false; }};
	var archiveNames = shell.archiveNames;
	var ui = {fileInput: {click: function () {}}};
	function refreshCurrentDir () {}
	function getSelectedItems () { return shell.selected; }
	function getItemByPath (p) { return shell.items[p] || null; }
	function getNormalizedExtension (p) { return String(p).split('.').pop().toLowerCase(); }
	function isImageExtension (p) { return /\\.(png|jpg|jpeg|gif|webp)$/i.test(p); }
	function hasInternalClipboard () { return false; }
	${fn('getCurrentFolderItem')}
	${fn('getRowMenuItems')}
	${fn('getMultiMenuItems')}
	${fn('getEmptyAreaMenuItems')}
	return {
		getRowMenuItems: getRowMenuItems,
		getMultiMenuItems: getMultiMenuItems,
		getEmptyAreaMenuItems: getEmptyAreaMenuItems
	};
`);

// A stand-in for every action, so a menu entry can be pressed and say which one it named.
const pressed = [];
const actions = {};
actionNames.forEach(name => {
	actions[name] = (...args) => {
		pressed.push([name].concat(args));
	};
});

const FILE = {path: '/home/notes.csv', name: 'notes.csv', isDirectory: false};
const IMAGE = {path: '/home/shot.png', name: 'shot.png', isDirectory: false};
const DIR = {path: '/home/docs', name: 'docs', isDirectory: true};
const ZIP = {path: '/home/holiday.tar.gz', name: 'holiday.tar.gz', isDirectory: false};
const items = {'/home/notes.csv': FILE, '/home/shot.png': IMAGE, '/home/docs': DIR,
	'/home/holiday.tar.gz': ZIP};

function build (selected, shellApi) {
	return menus({
		selected: selected,
		items: items,
		actions: actions,
		archiveNames: archiveNames,
		parent: shellApi || {}
	});
}

function labels (entries) {
	return entries.filter(e => !e.separator).map(e => e.label);
}

// Under the shell: both of the entries this phase adds are there.
const shell = {addBookmark () {}, setWallpaperImage () {}, openInBrowserTab () {}};

let fileMenu = build([FILE], shell).getRowMenuItems('/home/notes.csv');
check('a file offers Copy path', labels(fileMenu).includes('Copy path'), true);
check('and Add to bookmarks', labels(fileMenu).includes('Add to bookmarks'), true);

let dirMenu = build([DIR], shell).getRowMenuItems('/home/docs');
check('a folder offers Copy path too — a path is a path', labels(dirMenu).includes('Copy path'), true);
check('and can be bookmarked, since a bookmark may be a folder',
	labels(dirMenu).includes('Add to bookmarks'), true);

// Phase 12: one *Extract…*, for every format 7-Zip reads. There were two before, and
// neither did what its name said.
const tools = menu => (menu.find(e => e.label === 'Tools') || {submenu: []}).submenu;
const archiveMenu = build([ZIP], shell).getRowMenuItems('/home/holiday.tar.gz');
check('an archive offers one Extract entry, not two',
	tools(archiveMenu).filter(e => /Extract/.test(e.label)).map(e => e.label), ['Extract…']);
check('and it is live for an archive',
	tools(archiveMenu).find(e => e.label === 'Extract…').disabled, false);
check('a text file gets the entry disabled rather than hidden — an Extract that opens a '
	+ 'dialog to say "this is not an archive" is the worse answer',
	tools(fileMenu).find(e => e.label === 'Extract…').disabled, true);

// Compress is at the top level in all three menus, where Extract… is inside Tools: one
// applies to anything, the other only to an archive.
check('a file can be compressed', labels(fileMenu).includes('Compress…'), true);
check('so can a folder', labels(dirMenu).includes('Compress…'), true);
check('and it is not buried in Tools, where only archives belong',
	tools(fileMenu).some(e => e.label === 'Compress…'), false);

let multiMenu = build([FILE, IMAGE], shell).getMultiMenuItems();
check('several files offer Copy paths, plural', labels(multiMenu).includes('Copy paths'), true);
check('and can be compressed together', labels(multiMenu).includes('Compress…'), true);

// The background of a folder is the only place *Open with...* can be asked for the folder
// you are already inside; every other route needs a row to right-click, and the folder is
// not a row in itself.
let emptyMenu = build([], shell).getEmptyAreaMenuItems();
check('the empty area offers Open with for the folder itself',
	labels(emptyMenu).includes('Open this folder with...'), true);
check('and says which folder it means, since there is no row to imply one',
	labels(emptyMenu)[0], 'Open this folder with...');

// Standalone — opened directly rather than in a PixOS window — there is no shell to ask,
// so the entries that need one are not offered rather than being offered and failing.
const alone = build([FILE], {}).getRowMenuItems('/home/notes.csv');
check('with no shell there is nothing to bookmark into', labels(alone).includes('Add to bookmarks'), false);
check('but the clipboard is the browser\'s, so Copy path stays',
	labels(alone).includes('Copy path'), true);
check('and the menu does not end on a separator with nothing after it',
	alone[alone.length - 1].separator, undefined);

const imageAlone = build([IMAGE], {setWallpaperImage () {}}).getRowMenuItems('/home/shot.png');
check('an image still offers the wallpaper on its own', labels(imageAlone).includes('Set as wallpaper'), true);
check('and an ordinary file does not',
	labels(build([FILE], shell).getRowMenuItems('/home/notes.csv')).includes('Set as wallpaper'), false);

// The point of the whole file: an entry that names an action nobody wrote is a dead
// click, and nothing else would catch it.
const everyEntry = []
	.concat(fileMenu, dirMenu, multiMenu, emptyMenu, archiveMenu)
	.filter(entry => !entry.separator);
const dead = [];
everyEntry.forEach(entry => {
	(entry.submenu || [entry]).forEach(leaf => {
		if (typeof leaf.action !== 'function') {
			return;
		}
		try {
			leaf.action();
		}
		catch (err) {
			// Which is exactly what pressing it in Explorer would do, except there it
			// happens in front of the user with the menu already closed.
			dead.push(leaf.label + ' — ' + err.message);
		}
	});
});
check('every menu entry named an action that exists', dead, []);
check('and named one from the real table', pressed.filter(call => !actionNames.has(call[0])), []);
check('and something was actually pressed, or the check above proves nothing',
	pressed.length > 20, true);

check('Copy path passes the row it was opened on, not whatever is selected',
	pressed.find(call => call[0] === 'copyPath')[1], '/home/notes.csv');
check('Copy paths passes nothing, so the action reads the selection',
	pressed.some(call => call[0] === 'copyPath' && call.length === 1), true);

// Handed the folder as an item rather than as a path: a path would be looked up among the
// rows, where the folder you are inside is not, and the selection would answer instead.
// Found by shape rather than by position — several menus offer *Open with...*.
const folderOpenWith = pressed.filter(call =>
	call[0] === 'openWith' && call[1] && typeof call[1] === 'object').pop()[1];
check('Open with from the background names the folder itself',
	folderOpenWith && folderOpenWith.path, '/home');
check('as an item, so nothing selected inside it can stand in',
	folderOpenWith && folderOpenWith.isDirectory, true);

// --- the clipboard ---------------------------------------------------------------------

// The real function, bound to a browser that behaves however each case needs.
const withBrowser = new Function('navigator', 'document', 'console', fn('copyTextToClipboard')
	+ '\n; return copyTextToClipboard;');
function clipboard (nav, doc) {
	return withBrowser(nav, doc, quiet)('/home/notes.csv');
}

const area = {
	value: '', style: {}, setAttribute () {}, select () { area.selected = true; }, remove () { area.removed = true; }
};
function fakeDocument (execResult) {
	area.selected = false;
	area.removed = false;
	return {
		createElement: () => area,
		body: {appendChild () {}},
		execCommand: () => {
			if (execResult instanceof Error) { throw execResult; }
			return execResult;
		}
	};
}
const quiet = {warn () {}, error () {}};

check('the modern API is used when it works',
	await clipboard({clipboard: {writeText: async () => {}}}, fakeDocument(false)), true);

// Refused inside an iframe without clipboard permission — which is exactly what Explorer
// is — and the old API still works there.
check('a refusal falls through to execCommand rather than giving up',
	await clipboard({clipboard: {writeText: async () => { throw new Error('denied'); }}},
		fakeDocument(true)), true);
check('and the text was selected first, or there is nothing for it to copy', area.selected, true);
check('the scratch element is cleaned up', area.removed, true);

check('a browser with no clipboard API at all still tries the old one',
	await clipboard({}, fakeDocument(true)), true);

// Both refused. Saying so is what lets the caller show the text instead, which is a copy
// you can finish by hand — a silent false would be the bug this replaces.
check('when both refuse it reports failure rather than pretending',
	await clipboard({clipboard: {writeText: async () => { throw new Error('denied'); }}},
		fakeDocument(false)), false);
check('and an execCommand that throws is a failure, not an exception',
	await clipboard({}, fakeDocument(new Error('no'))), false);

process.exit(report('explorer-menus') ? 1 : 0);
