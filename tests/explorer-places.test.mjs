// The pinned places at the top of Explorer's sidebar: apps/explorer/js/places.js.
//
// The shell here is not a stub. It is `js/shell/bookmarks.js`'s real store over a document held in
// memory, so a pin that Explorer asks for in a way the store would refuse, or a move whose index
// means something else on the other side, fails here rather than in a browser. Every edit call is
// recorded on its way through; the reads are not, because every edit reloads and counting reads
// would only be counting that.
//
// Four things in here would each look fine in a quick try and be wrong:
//
//   * **Opening Explorer writes nothing.** With no `Places` group, Root and Apps are drawn and the
//     file is left alone; the group is written by the first edit, with that edit in it.
//   * **An empty group is not a missing one.** Unpin everything and the starters must not come back.
//   * **A place is found by id, not by the row it was drawn in.** A menu is pressed after the list
//     may have been read again.
//   * **A group another window created is not written over** by the starters this one still shows.

import fs from 'node:fs';
import {check, report} from './assert.mjs';
import * as bookmarks from '../js/shell/bookmarks.js';
import {createPlaces, placesFrom, pathOf, urlOf, starterPlaces, STARTERS, GROUP, FILE} from '../apps/explorer/js/places.js';

// --- what a place is ----------------------------------------------------------------------------

check('a folder address is a place', pathOf('/home/docs/'), '/home/docs');
check('the root is its own folder', pathOf('/'), '/');
check('a file is not', pathOf('/home/a.txt'), null);
check('nor a site', pathOf('https://x.test/'), null);
check('nor nothing', [pathOf(undefined), pathOf('')], [null, null]);
check('and a folder path back to its address', [urlOf('/home/docs'), urlOf('/'), urlOf('/home/docs/')],
	['/home/docs/', '/', '/home/docs/']);
check('only folders are drawn, each keeping its position in the whole group',
	placesFrom([{id: 'f', title: 'File', url: '/a.txt'}, {id: 'd', title: 'Docs', url: '/docs/'}]),
	[{id: 'd', title: 'Docs', url: '/docs/', path: '/docs', index: 1}]);
check('the document and the group', [FILE, GROUP], ['/settings/links.json', 'Places']);
check('the starters are Root and Apps', starterPlaces().map(p => [p.title, p.path]), [['Root', '/'], ['Apps', '/apps']]);
check('and they are what the four hardcoded rows kept', STARTERS.length, 2);

// --- the harness --------------------------------------------------------------------------------

function harness (options) {
	options = options || {};
	const h = {
		state: {dialog: null},
		disk: options.disk === undefined ? {version: 1, favicons: false, groups: []} : options.disk,
		calls: [],
		notes: [],
		draws: 0,
		writes: 0
	};
	const store = bookmarks.createBookmarks({
		read: async () => {
			if (h.unreadable) {
				throw new SyntaxError('Unexpected token } in JSON');
			}
			return h.disk === null ? null : JSON.parse(JSON.stringify(h.disk));
		},
		write: async text => {
			h.writes++;
			h.disk = JSON.parse(text);
		},
		notify: note => h.notes.push(note),
		describeError: (title, err) => ({title: title, message: String(err)}),
		openBookmarks: () => {}
	});
	h.unreadable = !!options.unreadable;
	const traced = (name, method) => (...args) => {
		h.calls.push([name].concat(args));
		return store[method](...args);
	};
	h.shell = options.oldShell ? {addBookmark: () => { h.calls.push(['addBookmark']); }} : {
		listBookmarks: options.listBookmarks || (group => store.list(group)),
		addBookmark: traced('addBookmark', 'add'),
		removeBookmark: traced('removeBookmark', 'remove'),
		moveBookmark: traced('moveBookmark', 'move'),
		renameBookmark: traced('renameBookmark', 'rename'),
		ensureBookmarkGroup: traced('ensureBookmarkGroup', 'ensureGroup')
	};
	h.places = createPlaces({
		state: h.state,
		shell: h.shell,
		openDialog: dialog => { h.state.dialog = dialog; },
		renderOverlays: () => {},
		renderSidebar: () => { h.draws++; }
	});
	return h;
}

const drawn = h => h.state.places.places.map(p => [p.title, p.path]);
const placesGroup = h => ((h.disk && h.disk.groups) || []).find(g => g.name === 'Places') || null;
const placeAt = (h, path) => h.state.places.places.find(p => p.path === path);
const withPlaces = links => ({version: 1, favicons: false, groups: [
	{id: 'g0', name: 'Bookmarks', links: [{id: 'x', title: 'Elsewhere', url: '/home/docs/'}]},
	{id: 'gp', name: 'Places', links: links}
]});

// --- before and after the first read ------------------------------------------------------------

{
	const h = harness();
	check('before the read answers, the starters are drawn', [h.state.places.status, drawn(h)],
		['loading', [['Root', '/'], ['Apps', '/apps']]]);
	await h.places.pinFolder('/home');
	check('and nothing can be changed yet', h.calls, []);

	await h.places.loadPlaces();
	check('with no Places group, the starters are still what is drawn, and they are editable',
		[h.state.places.status, h.state.places.group, drawn(h)], ['ready', null, [['Root', '/'], ['Apps', '/apps']]]);
	check('the sidebar is drawn again once the read answers', h.draws, 1);
	check('and opening Explorer wrote nothing -- the file is not Explorer\'s to create', [h.writes, h.disk.groups], [0, []]);
}

// --- the first edit writes the group, with the edit in it -----------------------------------------

{
	const h = harness();
	await h.places.loadPlaces();
	await h.places.pinFolder('/home/docs');
	check('pinning with no group writes the starters and the pin, as one group, in one call', h.calls, [
		['ensureBookmarkGroup', 'Places', [
			{url: '/', title: 'Root', directory: true},
			{url: '/apps/', title: 'Apps', directory: true},
			{url: '/home/docs/', title: 'docs', directory: true}
		]]
	]);
	check('one write', h.writes, 1);
	check('and the sidebar now draws the group, read back', [h.state.places.group && h.state.places.group.name, drawn(h)],
		['Places', [['Root', '/'], ['Apps', '/apps'], ['docs', '/home/docs']]]);

	await h.places.pinFolder('/tmp');
	check('the next pin is one quiet add into the group', h.calls[1],
		['addBookmark', {url: '/tmp/', title: 'tmp', directory: true, group: 'Places'}, {quiet: true}]);
	check('with no note -- the row appearing is the answer', h.notes, []);
	check('drawn last', drawn(h).map(p => p[1]), ['/', '/apps', '/home/docs', '/tmp']);

	await h.places.pinFolder('/tmp');
	check('a folder already pinned is not pinned twice, nor asked about', h.calls.length, 2);
}

{
	const h = harness({disk: withPlaces([{id: 'r', title: 'Root', url: '/'}])});
	await h.places.loadPlaces();
	await h.places.pinFolder('/home/docs');
	check('a folder already under Bookmarks can still be pinned', drawn(h).map(p => p[1]), ['/', '/home/docs']);
	check('and stays under Bookmarks too', h.disk.groups[0].links.map(l => l.url), ['/home/docs/']);
}

{
	const h = harness();
	await h.places.loadPlaces();
	await h.places.unpinPlace(placeAt(h, '/apps'));
	check('unpinning a starter writes the starters without it', h.calls,
		[['ensureBookmarkGroup', 'Places', [{url: '/', title: 'Root', directory: true}]]]);
	check('and Root is all that is left', drawn(h), [['Root', '/']]);
	await h.places.unpinPlace(placeAt(h, '/'));
	check('unpinning the last one removes it by id', h.calls[1] && h.calls[1][0], 'removeBookmark');
	check('and an empty group is drawn empty -- the starters do not come back',
		[h.state.places.status, h.state.places.group !== null, drawn(h)], ['ready', true, []]);
	await h.places.pinFolder('/');
	check('the root pinned again is called Root, not "/"', drawn(h), [['Root', '/']]);
}

{
	const h = harness();
	await h.places.loadPlaces();
	await h.places.movePlace(placeAt(h, '/apps'), -1);
	check('moving a starter writes the starters in the new order', h.calls,
		[['ensureBookmarkGroup', 'Places', [
			{url: '/apps/', title: 'Apps', directory: true}, {url: '/', title: 'Root', directory: true}
		]]]);
	check('and they are drawn that way', drawn(h).map(p => p[0]), ['Apps', 'Root']);
}

{
	const h = harness();
	await h.places.loadPlaces();
	h.places.renamePlace(placeAt(h, '/'));
	const dialog = h.state.dialog;
	check('renaming asks, starting from the name it has', dialog && [dialog.type, dialog.title, dialog.defaultValue],
		['prompt', 'Rename place', 'Root']);
	check('and says the folder itself is not what is renamed', !!(dialog && /keeps its name/.test(dialog.message)), true);
	if (dialog) {
		await dialog.onSubmit('Everything');
	}
	check('a starter renamed writes the starters with the new name', h.calls,
		[['ensureBookmarkGroup', 'Places', [
			{url: '/', title: 'Everything', directory: true}, {url: '/apps/', title: 'Apps', directory: true}
		]]]);
	check('the dialog is closed', h.state.dialog, null);
}

// --- edits to a group that exists -------------------------------------------------------------------

{
	const h = harness({disk: withPlaces([
		{id: 'r', title: 'Root', url: '/'},
		{id: 'a', title: 'Apps', url: '/apps/'},
		{id: 'd', title: 'Docs', url: '/home/docs/'}
	])});
	await h.places.loadPlaces();

	await h.places.movePlace(placeAt(h, '/home/docs'), -1);
	check('up one is a move to the index of the place above', h.calls[0], ['moveBookmark', 'd', 1]);
	check('and lands above it', drawn(h).map(p => p[0]), ['Root', 'Docs', 'Apps']);

	await h.places.movePlace(placeAt(h, '/'), 1);
	check('down one is a move to the index of the place below, plus one', h.calls[1], ['moveBookmark', 'r', 2]);
	check('and lands below it', drawn(h).map(p => p[0]), ['Docs', 'Root', 'Apps']);

	await h.places.movePlace(placeAt(h, '/home/docs'), -1);
	await h.places.movePlace(placeAt(h, '/apps'), 1);
	await h.places.movePlace(placeAt(h, '/home/docs'), 2);
	await h.places.movePlace(placeAt(h, '/home/docs'), 0);
	check('past either end, by more than one place, or by none, nothing is asked', h.calls.length, 2);

	h.places.renamePlace(placeAt(h, '/apps'));
	await h.state.dialog.onSubmit('Applications');
	check('a rename is one call on the link', h.calls[2], ['renameBookmark', 'a', 'Applications']);
	check('and is drawn', placeAt(h, '/apps').title, 'Applications');

	h.places.renamePlace(placeAt(h, '/apps'));
	await h.state.dialog.onSubmit('Applications');
	h.places.renamePlace(placeAt(h, '/apps'));
	await h.state.dialog.onSubmit('');
	check('the same name, or none, asks nothing and closes', [h.calls.length, h.state.dialog], [3, null]);

	h.places.renamePlace(placeAt(h, '/apps'));
	const refuse = h.state.dialog.refuse;
	check('a name another place has is refused, saying which', refuse('root'), 'Another place is already called “Root”.');
	check('a name nobody has is not', refuse('Programs'), null);
	check('nor is its own name in another case', refuse('APPLICATIONS'), null);
	h.state.dialog = null;

	await h.places.unpinPlace(placeAt(h, '/home/docs'));
	check('an unpin is one call on the link', h.calls[3], ['removeBookmark', 'd']);
	check('and every edit drew the sidebar again from what was written', drawn(h).map(p => p[0]), ['Root', 'Applications']);
	check('nothing outside Places was touched', h.disk.groups[0].links.map(l => l.id), ['x']);
}

{
	// A file in the group is not drawn, and a move still has to be written against the positions
	// the store sees -- which include it.
	const h = harness({disk: withPlaces([
		{id: 'r', title: 'Root', url: '/'},
		{id: 'f', title: 'Notes', url: '/home/notes.txt'},
		{id: 'a', title: 'Apps', url: '/apps/'}
	])});
	await h.places.loadPlaces();
	check('a file in Places is not drawn', drawn(h).map(p => p[0]), ['Root', 'Apps']);
	await h.places.movePlace(placeAt(h, '/apps'), -1);
	check('a move over it still swaps the two drawn places', drawn(h).map(p => p[0]), ['Apps', 'Root']);
	await h.places.movePlace(placeAt(h, '/apps'), 1);
	check('and back', drawn(h).map(p => p[0]), ['Root', 'Apps']);
	check('and the file is still in the group', placesGroup(h).links.some(l => l.id === 'f'), true);
}

// --- a place is found by id ---------------------------------------------------------------------------

{
	const h = harness({disk: withPlaces([{id: 'r', title: 'Root', url: '/'}, {id: 'a', title: 'Apps', url: '/apps/'}])});
	await h.places.loadPlaces();
	const menuWasBuiltFor = placeAt(h, '/apps');
	// Another window pins a folder at the top, and this one hears it before the menu is pressed.
	h.disk.groups[1].links.unshift({id: 'n', title: 'New', url: '/new/'});
	await h.places.loadPlaces();
	await h.places.unpinPlace(menuWasBuiltFor);
	check('the menu unpins the place it was built for, not the row that is now where it was drawn',
		placesGroup(h).links.map(l => l.id), ['n', 'r']);

	h.disk.groups[1].links = h.disk.groups[1].links.filter(l => l.id !== 'r');
	const gone = placeAt(h, '/');
	await h.places.loadPlaces();
	await h.places.unpinPlace(gone);
	await h.places.movePlace(gone, 1);
	h.places.renamePlace(gone);
	check('a place removed elsewhere is asked about by nothing', [h.calls.length, h.state.dialog], [1, null]);
}

{
	const h = harness();
	await h.places.loadPlaces();
	h.places.renamePlace(placeAt(h, '/apps'));
	const dialog = h.state.dialog;
	// While the dialog is open, somebody unpins Apps in the Bookmarks app.
	h.disk = withPlaces([{id: 'r', title: 'Root', url: '/'}]);
	await h.places.loadPlaces();
	let submitted = null;
	try {
		await dialog.onSubmit('Programs');
	}
	catch (err) {
		submitted = err.message;
	}
	check('a rename submitted after its place went is dropped, not written over the group',
		[submitted, h.calls, placesGroup(h).links.map(l => l.title)], [null, [], ['Root']]);
}

// --- a group another window created ------------------------------------------------------------------

{
	const h = harness();
	await h.places.loadPlaces();
	// Another Explorer pins first; this one has not heard yet and still shows the starters.
	h.disk = withPlaces([{id: 'o', title: 'Theirs', url: '/theirs/'}]);
	await h.places.pinFolder('/mine');
	check('the starters are not written over a group that appeared meanwhile',
		placesGroup(h).links.map(l => l.url), ['/theirs/']);
	check('and what is drawn is that group', drawn(h), [['Theirs', '/theirs']]);
}

// --- when the places cannot be edited ------------------------------------------------------------------

{
	const h = harness({unreadable: true});
	await h.places.loadPlaces();
	check('a bookmarks file that will not read draws the starters and says it is unreadable',
		[h.state.places.status, drawn(h), h.state.places.error && h.state.places.error.name],
		['unreadable', [['Root', '/'], ['Apps', '/apps']], 'SyntaxError']);
	await h.places.pinFolder('/home');
	await h.places.unpinPlace(placeAt(h, '/'));
	check('and offers nothing that would only raise a note', [h.calls, h.writes, h.notes], [[], 0, []]);

	h.unreadable = false;
	await h.places.loadPlaces();
	check('once it reads again, the places are editable again', h.state.places.status, 'ready');
}

{
	const h = harness({oldShell: true});
	await h.places.loadPlaces();
	check('a shell with no listBookmarks: the starters, not editable', [h.state.places.status, drawn(h).length],
		['unavailable', 2]);
	await h.places.pinFolder('/home');
	check('and nothing is asked of it', h.calls, []);
}

// --- two reads, answered out of order -----------------------------------------------------------------

{
	const pending = [];
	const h = harness({listBookmarks: () => new Promise(resolve => pending.push(resolve))});
	const first = h.places.loadPlaces();
	const second = h.places.loadPlaces();
	pending[1]({group: {id: 'g', name: 'Places'}, links: [{id: 'n', title: 'Newer', url: '/newer/'}]});
	await second;
	pending[0]({group: {id: 'g', name: 'Places'}, links: [{id: 'o', title: 'Older', url: '/older/'}]});
	await first;
	check('the read asked for last is the one drawn, whichever answered last', drawn(h), [['Newer', '/newer']]);
	check('and the older answer did not draw at all', h.draws, 1);
}

// --- where Explorer connects it ------------------------------------------------------------------------
//
// apps/explorer/index.html is a module that cannot run in node, so the lines that connect this file
// and the drawer to the window are read rather than run. Each is a line whose absence looks fine
// until somebody uses the thing it connects.

const entry = fs.readFileSync(new URL('../apps/explorer/index.html', import.meta.url), 'utf8');
const boot = entry.slice(entry.lastIndexOf('renderLayout();'));
check('the drawer is fitted, then the places read, before the first refresh -- which then draws them, '
	+ 'not the starters', /^renderLayout\(\);[\s\S]*?fitSidebar\(\);[\s\S]*?await loadPlaces\(\);\s*await refreshCurrentDir\(false\);/.test(boot), true);
check('and the width is watched from then on', /fitSidebar\(\);\s*watchSidebarWidth\(\);/.test(boot), true);
check('a change to the bookmarks document reads the places again',
	/if \(change\.touches\(LINKS_FILE\)\) \{\s*loadPlaces\(\);/.test(entry), true);
check('where LINKS_FILE is the file this module names',
	entry.indexOf('import { createPlaces, FILE as LINKS_FILE } from "./js/places.js";') > -1, true);
const table = entry.slice(entry.indexOf('var actions = {'), entry.indexOf('Object.keys(actions).forEach'));
check('every place action is in the table, so the guard loop reports its failures',
	['pinFolder', 'unpinPlace', 'movePlace', 'renamePlace'].filter(name => table.indexOf(name + ': ' + name + ',') === -1), []);
check('the toolbar toggle opens and closes the drawer',
	/ui\.sidebarToggle\.onclick = function \(\) \{\s*toggleSidebar\(\);/.test(entry), true);

// --- the narrow drawer closes when the window goes somewhere --------------------------------------
//
// In navigateTo, not in the rows: walking the checklist, a place closed the drawer and reconnecting
// a mount, or mounting from the footer, did not -- each of those reaches navigateTo by its own route.
{
	const start = entry.indexOf('\tfunction navigateTo (');
	const source = entry.slice(start, entry.indexOf('\n\t}\n', start) + 3);
	const run = (cwd, path) => {
		const trace = [];
		const state = {cwd: cwd, historyBack: [], historyForward: []};
		new Function('state', 'sidebarChosen', 'normalizePath', 'refreshCurrentDir',
			source + '\n; return navigateTo;')(
			state, () => trace.push('chosen'), p => p, () => trace.push('refresh:' + state.cwd))(path);
		return trace;
	};
	check('going to a folder closes a narrow drawer before the listing is drawn', run('/', '/mnt/work'), ['chosen', 'refresh:/mnt/work']);
	check('choosing the folder the window is already in still counts as chosen', run('/home', '/home'), ['chosen']);
	check('nowhere to go is not a choice', run('/home', ''), []);
	check('the sidebar\'s own click leaves closing to navigateTo',
		/navigateTo\(item\.dataset\.path\);\s*\};/.test(entry), true);
	const history = entry.slice(entry.indexOf('ui.back.onclick'), entry.indexOf('ui.up.onclick'));
	check('Back and Forward change folder without navigateTo, and close it too',
		(history.match(/state\.cwd = state\.history(Back|Forward)\.pop\(\);\s*sidebarChosen\(\);\s*refreshCurrentDir\(false\);/g) || []).length, 2);
}
check('the sidebar is handed the context menu a place\'s menu opens in',
	/createSidebar\(\{[^}]*openContextMenu: openContextMenu\s*\}\);/.test(entry), true);

report('explorer-places');
