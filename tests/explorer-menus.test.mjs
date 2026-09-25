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
import {createFailure} from '../apps/explorer/js/failure.js';
import {createSelection} from '../apps/explorer/js/selection.js';
import {createMenuItems} from '../apps/explorer/js/menu-items.js';
import {createShellActions} from '../apps/explorer/js/shell-actions.js';
import {createFormat} from '../apps/explorer/js/format.js';
import path from 'path';

const source = fs.readFileSync(new URL('../apps/explorer/index.html', import.meta.url), 'utf8');

// Phase 21's ninth pass moved all four builders into apps/explorer/js/menu-items.js, so
// they are imported rather than cut out of the HTML with brace counting. `actions` is still
// read out of index.html below, because that is still where the table lives — and reading the
// real one rather than a list written here is the whole point of the first two checks.

// --- what the menus offer -------------------------------------------------------------

// Every action the real table has, as a name. The menus are checked against this rather
// than against a list written here, which would go stale the first time one is renamed.
const actionNames = new Set();
const actionOrder = [];
{
	// Bounded at both ends. It used to run to the end of the file, which was harmless only
	// while the pattern below matched nothing but inline functions -- widen that and the
	// module constructions underneath start answering as actions.
	const from = source.indexOf('\tvar actions = {');
	const to = source.indexOf('\n\t};', from);
	if (from === -1 || to === -1) {
		console.error('explorer-menus.test.mjs: could not find the actions table in index.html');
		process.exit(1);
	}
	const table = source.slice(from, to);
	// Two shapes, because an action can be written into the table or handed to it by a
	// module: `rename: function () {...}` and `mountArchive: mountArchive,`. Reading only the
	// first left every action a module provides out of this set, which quietly excused the
	// menu entries that name one.
	const pattern = /^\t\t([A-Za-z0-9_]+): (?:(?:async )?function|[A-Za-z0-9_]+,?$)/gm;
	let match;
	while ((match = pattern.exec(table))) {
		actionNames.add(match[1]);
		actionOrder.push(match[1]);
	}
}
check('the actions table was found and read', actionNames.size > 15, true);
// This is not tidiness. The peer share and the old share both wrote a `stopSharing`, and
// in one object literal the second silently wins — so *Stop sharing with peers* in the
// folder menu called the old one with no argument and did nothing at all, with no error
// anywhere. Every other check in this file passed while that was true: the entry named an
// action that existed, and it ran.
check('and no action is written twice, where the second would silently shadow the first',
	actionOrder.filter((name, i) => actionOrder.indexOf(name) !== i), []);

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
const SCR = {path: '/home/Rain.xscr.html', name: 'Rain.xscr.html', isDirectory: false};
const SCR_DIR = {path: '/home/Slideshow.xscr', name: 'Slideshow.xscr', isDirectory: true};
const PAGE = {path: '/home/page.html', name: 'page.html', isDirectory: false};
const PNG_DIR = {path: '/home/shots.png', name: 'shots.png', isDirectory: true};
const items = {'/home/notes.csv': FILE, '/home/shot.png': IMAGE, '/home/docs': DIR,
	'/home/holiday.tar.gz': ZIP, '/home/Rain.xscr.html': SCR, '/home/Slideshow.xscr': SCR_DIR, '/home/page.html': PAGE,
	'/home/shots.png': PNG_DIR};
const isScreensaver = createFormat(path.posix).isScreensaver;

function build (selected, shellApi, opts) {
	// Passing null means "opened outside PixOS", where `shell` *is* `win` and every entry
	// that needs the shell has to notice. `opts.sameWindow` is the nastier version of that:
	// a standalone Explorer whose window happens to carry the API anyway, which is the only
	// arrangement that can tell `shell !== win` apart from `shell.peers &&`.
	opts = opts || {};
	var noShell = shellApi === null;
	var stand = opts.sameWindow ? Object.assign({}, opts.sameWindow) : {};
	var state = {recording: !!opts.recording, selectedPaths: new Set(selected.map(i => i.path)), cwd: '/home'};
	var shellSide = noShell ? stand : (shellApi || {});
	// *Preview* or *Open* is asked of the real shell-actions, which *Open* itself asks: the menu
	// saying one thing while double-click does the other is what this keeps from happening.
	var previews = createShellActions({
		state: state, shell: shellSide, isScreensaver: isScreensaver,
		guarded: fn => fn, readableActionName: name => name
	}).previews;
	return createMenuItems({
		state: state,
		ui: {fileInput: {click () {}}},
		shell: noShell ? stand : (shellApi || {}),
		win: noShell ? stand : {},
		mountManager: {isMountPoint: p => (opts.mountPoints || []).indexOf(p) !== -1},
		actions: actions,
		archiveNames: archiveNames,
		getSelectedItems: () => selected,
		getItemByPath: p => items[p] || null,
		// Phase 21 moved this into js/selection.js. The harness builds its own state object,
		// so the module is built around that one rather than the function being copied out.
		getCurrentFolderItem: createSelection({
			state: state,
			ui: {},
			rootElem: null,
			doc: {},
			closeContextMenu () {},
			renderStatus () {},
			renderToolbarState () {}
		}).getCurrentFolderItem,
		hasInternalClipboard: () => !!opts.clipboard,
		refreshCurrentDir () {},
		report () {},
		getNameByPath: p => String(p).split('/').pop(),
		getNormalizedExtension: p => String(p).split('.').pop().toLowerCase(),
		isImageExtension: p => /\.(png|jpg|jpeg|gif|webp)$/i.test(p),
		isScreensaver: isScreensaver,
		previews: previews,
		keyHint: opts.keyHint
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

// --- a screensaver (phase 26) -------------------------------------------------------------
//
// Double-click shows one rather than opening it, so the entry that does what double-click does is
// called *Preview*; a folder one gets *Show contents* for going in. Both can be set as either.
const saverShell = Object.assign({}, shell, {
	previewScreensaver () {}, setWallpaperPage () {}, setScreensaverPage () {}
});
const scrFileMenu = build([SCR], saverShell).getRowMenuItems('/home/Rain.xscr.html');
const scrDirMenu = build([SCR_DIR], saverShell).getRowMenuItems('/home/Slideshow.xscr');
check('a screensaver page starts with Preview, where Open was', labels(scrFileMenu).slice(0, 2), ['Preview', 'Open with...']);
check('and keeps the chord double-click and Enter share',
	build([SCR], saverShell, {keyHint: name => name === 'open' ? '↵' : ''}).getRowMenuItems('/home/Rain.xscr.html')[0].hint, '↵');
check('a screensaver folder starts with Preview and Show contents',
	labels(scrDirMenu).slice(0, 3), ['Preview', 'Show contents', 'Open in New Explorer']);
check('both end with the shell\'s three, in one group', [labels(scrFileMenu).slice(-3), labels(scrDirMenu).slice(-3)],
	[['Add to bookmarks', 'Set as wallpaper', 'Set as screensaver'], ['Add to bookmarks', 'Set as wallpaper', 'Set as screensaver']]);
check('behind one separator', [scrFileMenu[scrFileMenu.length - 4].separator, scrDirMenu[scrDirMenu.length - 4].separator], [true, true]);
const pressedBefore = pressed.length;
scrDirMenu.find(e => e.label === 'Show contents').action();
scrDirMenu.find(e => e.label === 'Set as screensaver').action();
scrFileMenu.find(e => e.label === 'Set as wallpaper').action();
scrFileMenu.find(e => e.label === 'Preview').action();
check('each names its own action, with the row it was opened on', pressed.slice(pressedBefore),
	[['showContents', '/home/Slideshow.xscr'], ['setAsScreensaver', '/home/Slideshow.xscr'],
		['setAsWallpaper', '/home/Rain.xscr.html'], ['open', '/home/Rain.xscr.html']]);
const imageMenu = build([IMAGE], saverShell).getRowMenuItems('/home/shot.png');
imageMenu.find(e => e.label === 'Set as wallpaper').action();
check('an image\'s Set as wallpaper is the same action', pressed[pressed.length - 1], ['setAsWallpaper', '/home/shot.png']);
check('but an image is no screensaver', labels(imageMenu).includes('Set as screensaver'), false);
// The entries are shared by the file and the folder menus now, so a folder is asked too.
check('a folder named like a picture is not one', labels(build([PNG_DIR], saverShell).getRowMenuItems('/home/shots.png'))
	.some(l => /^Set as/.test(l)), false);
check('and a shell that cannot set a picture is not offered one',
	labels(build([IMAGE], {addBookmark () {}}).getRowMenuItems('/home/shot.png')).includes('Set as wallpaper'), false);
check('nor is a plain page', [labels(build([PAGE], saverShell).getRowMenuItems('/home/page.html'))[0],
	labels(build([PAGE], saverShell).getRowMenuItems('/home/page.html')).some(l => /^Set as/.test(l))], ['Open', false]);
check('nor a plain folder', [labels(build([DIR], saverShell).getRowMenuItems('/home/docs'))[0],
	labels(build([DIR], saverShell).getRowMenuItems('/home/docs')).some(l => l === 'Show contents' || /^Set as/.test(l))], ['Open', false]);
// A shell that cannot show one: *Open* opens it, as before, and goes into a folder one.
const noPreview = build([SCR_DIR], shell).getRowMenuItems('/home/Slideshow.xscr');
check('where the shell cannot show one, it is Open, and there is nothing to Show contents for',
	labels(noPreview).slice(0, 2), ['Open', 'Open in New Explorer']);
check('and nothing to set it as', labels(noPreview).some(l => /^Set as/.test(l)), false);
const scrAlone = build([SCR_DIR], null).getRowMenuItems('/home/Slideshow.xscr');
check('standalone, a screensaver folder is a folder', labels(scrAlone)[0], 'Open');
check('and its menu does not end on a separator', scrAlone[scrAlone.length - 1].separator, undefined);

// The point of the whole file: an entry that names an action nobody wrote is a dead
// click, and nothing else would catch it.
const everyEntry = []
	.concat(fileMenu, dirMenu, multiMenu, emptyMenu, archiveMenu, scrFileMenu, scrDirMenu)
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
const folderOpenWithCall = pressed.filter(call =>
	call[0] === 'openWith' && call[1] && typeof call[1] === 'object').pop();
// Guarded: an entry that stops being offered at all would otherwise end this file here
// rather than fail the line that is about it.
check('the background offers an Open with that was actually pressed', !!folderOpenWithCall, true);
const folderOpenWith = folderOpenWithCall && folderOpenWithCall[1];
check('Open with from the background names the folder itself',
	folderOpenWith && folderOpenWith.path, '/home');
check('as an item, so nothing selected inside it can stand in',
	folderOpenWith && folderOpenWith.isDirectory, true);

// --- the clipboard ---------------------------------------------------------------------

// The real function, bound to a browser that behaves however each case needs. Phase 21
// moved it into js/failure.js, so this builds a reporter per case instead of cutting the
// function back out of the HTML -- the browser it talks to is the `doc` and `nav` handed
// to the factory, which is the whole reason those became parameters.
function clipboard (nav, doc) {
	return createFailure({
		shell: {},
		win: {addEventListener () {}},
		doc: doc,
		nav: nav,
		openInfoDialog () {}
	}).copyTextToClipboard('/home/notes.csv');
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
// The module warns through the real console when the clipboard refuses; that refusal is
// what half of these cases are, and it is not news here.
console.warn = quiet.warn;

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

// --- sending a file to a connected peer -------------------------------------------------
//
// The shell owns the connection; Explorer only asks who is on it. An entry that opens an
// empty picker is the dead end this project keeps having to undo, so with nobody connected
// the entry says so and leads to the panel instead.

function rowMenu (item, shellApi) {
	return build([item], shellApi).getRowMenuItems(item.path);
}

const noPeers = rowMenu(FILE, {peers: {list: () => [], open: () => {}}});
const withPeers = rowMenu(FILE, {peers: {
	list: () => [{id: 'pixos-aaaaaaaa', name: 'Laptop'}, {id: 'pixos-bbbbbbbb', name: 'Phone'}],
	sendFile: () => Promise.resolve(),
	open: () => {}
}});

const entry = list => list.filter(row => row.label && row.label.indexOf('Send to peer') === 0)[0];

check('with nobody connected the entry says so rather than opening an empty list',
	entry(noPeers).label.includes('nobody connected'), true);
check('and it leads somewhere anyway', typeof entry(noPeers).action, 'function');
check('with peers connected it is a submenu of them', entry(withPeers).submenu.length, 2);
check('named by the names they gave', entry(withPeers).submenu[0].label, 'Laptop');
check('outside the shell entirely there is nothing to send to, and it is disabled',
	entry(rowMenu(FILE, null)).disabled, true);

// --- sharing a folder with peers ---------------------------------------------------------
//
// The shell holds which folder is shared, because it is the shell that answers when
// somebody asks to open it. Explorer only offers the folder — and the entry has to say
// which of the two things it will do, or "Share" on an already-shared folder is a button
// whose meaning you have to remember.

const peerApi = shared => ({
	peers: {
		share: () => {},
		getShare: () => shared,
		open: () => {},
		list: () => [],
		sendFile: () => {}
	}
});

const sharedFolderMenu = shared => build([DIR], peerApi(shared)).getRowMenuItems('/home/docs');
const shareEntry = list => list.filter(row => row.label && /shar/i.test(row.label))[0];

check('an unshared folder is offered for sharing',
	shareEntry(sharedFolderMenu(null)).label, 'Share with peers…');
check('the folder that is already shared offers to stop',
	shareEntry(sharedFolderMenu('/home/docs')).label, 'Stop sharing with peers');
check('a different folder being shared does not change this one\'s entry',
	shareEntry(sharedFolderMenu('/home/other')).label, 'Share with peers…');
check('and outside the shell there is nobody to share with, so nothing is offered',
	shareEntry(build([DIR], null).getRowMenuItems('/home/docs')), undefined);

// --- which menu you get, which is decided before any of the above ---------------------------
//
// Added in phase 21's ninth pass, when the builders became js/menu-items.js and it turned out
// a mutation run could take ten of these apart without failing a single check. Every one below
// is a rule the file already had and nothing had ever asked about.

{
	const multi = build([FILE, IMAGE], shell).getRowMenuItems('/home/notes.csv');
	check('right-clicking one row of several gives the selection menu, not that row\'s',
		labels(multi).includes('Copy selected'), true);
	check('and not the single-row one', labels(multi).includes('Copy path'), false);
}

{
	const stray = build([], shell).getRowMenuItems('/home/vanished.txt');
	check('a row whose item has gone falls back to the empty-area menu',
		labels(stray).includes('New Folder'), true);
	check('rather than to an empty menu, which reads as a broken right-click',
		stray.length > 0, true);
}

{
	const empty = build([], shell).getEmptyAreaMenuItems();
	// Guarded: a mutation that drops the entry would otherwise crash this file on [0].
	check('the empty area leads to Open with for the folder you are inside',
		labels(empty).includes('Open this folder with...'), true);
	check('and it is the first entry, because there is no row to name',
		labels(empty)[0], 'Open this folder with...');
}

{
	const mixed = build([FILE, DIR], shell).getMultiMenuItems();
	check('a selection of files and folders is not offered Open with',
		labels(mixed).includes('Open with...'), false);
	const allFiles = build([FILE, IMAGE], shell).getMultiMenuItems();
	check('a selection of only files is', labels(allFiles).includes('Open with...'), true);
}

// --- the entries that are greyed out rather than hidden ---------------------------------------

{
	const noClip = build([DIR], shell).getRowMenuItems('/home/docs');
	const withClip = build([DIR], shell, {clipboard: true}).getRowMenuItems('/home/docs');
	const paste = list => list.find(e => e.label === 'Paste into Folder');
	check('with nothing copied, Paste into Folder is greyed', paste(noClip).disabled, true);
	check('with something copied it is live', paste(withClip).disabled, false);
}

{
	const paste = list => list.find(e => e.label === 'Paste');
	check('the same for Paste in empty space',
		paste(build([], shell).getEmptyAreaMenuItems()).disabled, true);
	check('and live once there is something to paste',
		paste(build([], shell, {clipboard: true}).getEmptyAreaMenuItems()).disabled, false);
}

{
	const ZIPFILE = {path: '/home/pack.zip', name: 'pack.zip', isDirectory: false};
	items['/home/pack.zip'] = ZIPFILE;
	const mount = list => tools(list).find(e => e.label === 'Mount as filesystem');
	check('a zip can be mounted', mount(build([ZIPFILE], shell).getRowMenuItems('/home/pack.zip')).disabled, false);
	check('a text file cannot', mount(build([FILE], shell).getRowMenuItems('/home/notes.csv')).disabled, true);
	// .tar.gz is an archive 7-Zip reads and not a filesystem anything mounts. The two
	// questions have different answers and are asked of different things.
	check('and neither can a tar.gz, which Extract does take',
		mount(build([ZIP], shell).getRowMenuItems('/home/holiday.tar.gz')).disabled, true);
}

{
	check('a folder that is not a mount point is not offered Unmount',
		labels(build([DIR], shell).getRowMenuItems('/home/docs')).includes('Unmount'), false);
	check('one that is, is',
		labels(build([DIR], shell, {mountPoints: ['/home/docs']}).getRowMenuItems('/home/docs'))
			.includes('Unmount'), true);
}

// --- the recording entry, which is the same entry in three menus -------------------------------

{
	// Every entry at any depth: the recording entry lives under *Tools* in one menu, under
	// *Tools for selected* in another, and at the top level in the third.
	const flat = list => list.reduce((acc, e) => acc.concat([e], e.submenu ? flat(e.submenu) : []), []);
	const rec = list => flat(list).find(e => /Screen Recording/.test(e.label || ''));
	check('with nothing recording it offers to start',
		rec(build([FILE], shell).getRowMenuItems('/home/notes.csv')).label, 'Screen Recording');
	check('while recording it offers to stop',
		rec(build([FILE], shell, {recording: true}).getRowMenuItems('/home/notes.csv')).label,
		'Stop Screen Recording');
	check('and so does the selection menu',
		rec(build([FILE, IMAGE], shell, {recording: true}).getMultiMenuItems()).label,
		'Stop Screen Recording');
	check('and the empty-area one',
		rec(build([], shell, {recording: true}).getEmptyAreaMenuItems()).label,
		'Stop Screen Recording');
}

// --- standalone, the hard way -------------------------------------------------------------
//
// `shell !== win` is the question, not "is there a peers object" — and the only arrangement
// that tells those two apart is an Explorer running in its own tab whose window happens to
// carry the API. Without these, `shell !== win` can be deleted from both places and nothing
// notices.

{
	const asOwnWindow = {peers: {
		list: () => [{id: 'pixos-aaaaaaaa', name: 'Laptop'}],
		share: () => {}, getShare: () => null, open: () => {}, sendFile: () => {}
	}};
	const fileMenuAlone = build([FILE], null, {sameWindow: asOwnWindow}).getRowMenuItems('/home/notes.csv');
	check('with no shell, Send to peer is disabled even when a peers API is in reach',
		entry(fileMenuAlone).disabled, true);
	const dirMenuAlone = build([DIR], null, {sameWindow: asOwnWindow}).getRowMenuItems('/home/docs');
	check('and sharing a folder is not offered at all',
		labels(dirMenuAlone).some(l => /shar/i.test(l)), false);
}

// --- the chord beside a command (phase 25) ------------------------------------------------------
//
// Printed from js/keys.js through the shell, so the test hands in a stand-in that names the command
// and checks each entry asks for the right one: an entry printing Cut's chord beside Copy is the
// mistake nothing else would catch.
{
	const hint = name => '<' + name + '>';
	const hints = entries => entries.filter(e => !e.separator && e.hint).map(e => e.label + ' ' + e.hint);
	check('a file\'s menu prints the chords of the five commands that have one',
		hints(build([FILE], shell, {keyHint: hint}).getRowMenuItems('/home/notes.csv')),
		['Open <open>', 'Copy <copy>', 'Cut <cut>', 'Delete <delete>']);
	check('a folder\'s the same four', hints(build([DIR], shell, {keyHint: hint}).getRowMenuItems('/home/docs')),
		['Open <open>', 'Copy <copy>', 'Cut <cut>', 'Delete <delete>']);
	check('a selection\'s, its three', hints(build([FILE, IMAGE], shell, {keyHint: hint}).getMultiMenuItems()),
		['Copy selected <copy>', 'Cut selected <cut>', 'Delete selected <delete>']);
	check('empty space: Paste', hints(build([], shell, {keyHint: hint}).getEmptyAreaMenuItems()), ['Paste <paste>']);
	check('with no shell to write them, no chord is printed',
		hints(build([FILE], shell).getRowMenuItems('/home/notes.csv')), []);
}

process.exit(report('explorer-menus') ? 1 : 0);
