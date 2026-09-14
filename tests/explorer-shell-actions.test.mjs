// The actions whose work the shell does: apps/explorer/js/shell-actions.js.
//
// What is left in Explorer after handing everything else to the shell is a set of decisions, and
// those are what this checks: a folder is navigated to rather than opened, several files open
// together, *Explorer* chosen for the folder you are already in means another window, the empty
// case is answered here rather than shown as a dialog with no rows, and the dialog underneath is
// closed before the shell's chooser opens over it.
//
// And one thing that is easy to lose in a move: the chooser's *Manage Defaults* button runs after
// `openWith` has returned, so a failure in it has to go through the same guard the action table
// gives everything. Without it, the failure is an unhandled rejection — which this file records.

import {check, report} from './assert.mjs';
import {createShellActions} from '../apps/explorer/js/shell-actions.js';

const unhandled = [];
process.on('unhandledRejection', err => { unhandled.push(String(err && err.message)); });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function harness (options) {
	options = options || {};
	const h = {
		state: {
			cwd: options.cwd || '/home',
			selectedPaths: new Set(options.selected || []),
			dialog: {type: 'context menu, or whatever was open'}
		},
		items: options.items || [],
		calls: [],
		notes: [],
		failures: [],
		dialogs: [],
		chooser: null
	};
	const shell = {
		OPEN_WITH_BROWSER_TAB: 'browser-tab',
		OPEN_WITH_RAW_WINDOW: 'raw-window',
		openFile: (p, app) => { h.calls.push(['openFile', p, app]); },
		openPath: (p, app) => { h.calls.push(['openPath', p, app]); },
		openInBrowserTab: p => { h.calls.push(['browserTab', p]); },
		openRawFile: p => { h.calls.push(['rawWindow', p]); },
		peers: {
			share: dir => {
				h.calls.push(['share', dir]);
				if (options.shareThrows) { throw new Error(options.shareThrows); }
			},
			open: () => { h.calls.push(['peersPanel']); }
		}
	};
	if (!options.noOpenFiles) { shell.openFiles = (paths, app) => { h.calls.push(['openFiles', paths, app]); }; }
	if (!options.noOpenApp) { shell.openApp = id => { h.calls.push(['openApp', id]); }; }
	if (!options.noBookmarks) { shell.addBookmark = async bookmark => { h.calls.push(['bookmark', bookmark]); }; }
	if (!options.noChooser) {
		shell.openWithChooser = async spec => {
			h.chooser = spec;
			h.calls.push(['chooser', h.state.dialog]);
			return options.pick || null;
		};
	}

	h.actions = createShellActions({
		state: h.state,
		shell: shell,
		getItemByPath: p => h.items.find(i => i.path === p) || null,
		getSelectedItems: () => h.items.filter(i => h.state.selectedPaths.has(i.path)),
		getNameByPath: p => String(p).split('/').pop(),
		getOpenWithAppsForItems: async items => {
			h.calls.push(['apps', items.map(i => i.path)]);
			return options.apps || [{id: 'ace'}];
		},
		getSpecificExtension: p => (/\.([^./]+)$/.exec(p) || [])[1] || '',
		buildDefaultAppsManagerDialog: async extension => {
			if (options.managerThrows) { throw new Error('settings unreadable'); }
			return {type: 'defaultApps', prefill: extension};
		},
		openDialog: dialog => { h.dialogs.push(dialog); },
		renderOverlays: () => { h.calls.push(['overlays', h.state.dialog]); },
		navigateTo: p => { h.calls.push(['navigate', p]); },
		refreshCurrentDir: keep => { h.calls.push(['refresh', keep]); return Promise.resolve(); },
		report: (title, message, level, actions) => { h.notes.push({title, message, level, actions}); },
		// The table's wrapper, in miniature: reports whatever the call throws or rejects with.
		guarded: (fn, label) => function () {
			try {
				const result = fn.apply(this, arguments);
				return result && result.then
					? result.catch(err => { h.failures.push([label, err.message]); })
					: result;
			}
			catch (err) {
				h.failures.push([label, err.message]);
			}
		},
		readableActionName: name => 'LABEL(' + name + ')'
	});
	return h;
}

const file = p => ({path: p, name: p.split('/').pop(), isDirectory: false});
const folder = p => ({path: p, name: p.split('/').pop(), isDirectory: true});
const extra = (h, label) => h.chooser.extras.find(e => e.label === label);

// --- Open --------------------------------------------------------------------------------------

{
	const h = harness({items: [file('/home/a.txt'), folder('/home/docs')]});
	let threw = null;
	try {
		h.actions.open('/home/missing');
	}
	catch (err) {
		threw = err.message;
	}
	check('opening something not in the listing does nothing, and does not throw', [threw, h.calls], [null, []]);

	h.actions.open('/home/a.txt');
	h.actions.open('/home/a.txt', 'ace');
	check('a file goes to the shell, with the app if one was forced',
		h.calls, [['openFile', '/home/a.txt', undefined], ['openFile', '/home/a.txt', 'ace']]);

	h.calls.length = 0;
	h.actions.open('/home/docs');
	h.actions.open('/home/docs', 'explorer');
	check('a folder is navigated to in place -- also when Explorer is the app asked for',
		h.calls, [['navigate', '/home/docs'], ['navigate', '/home/docs']]);

	h.calls.length = 0;
	h.actions.open('/home/docs', 'new explorer');
	h.actions.open('/home/docs', 'gallery');
	check('and handed to the shell for anything else, a new Explorer included',
		h.calls, [['openPath', '/home/docs', 'new explorer'], ['openPath', '/home/docs', 'gallery']]);
}

// --- Add to bookmarks --------------------------------------------------------------------------

{
	const h = harness({items: [file('/home/a.txt'), folder('/home/docs')], selected: ['/home/docs']});
	await h.actions.addToBookmarks('/home/a.txt');
	await h.actions.addToBookmarks();
	check('a file and a folder are bookmarked with their names, and the folder says it is one',
		h.calls, [['bookmark', {title: 'a.txt', url: '/home/a.txt', directory: false}],
			['bookmark', {title: 'docs', url: '/home/docs', directory: true}]]);

	h.calls.length = 0;
	await h.actions.addToBookmarks('/home/missing');
	check('something not in the listing is not bookmarked', h.calls, []);
}

{
	const h = harness({noBookmarks: true, items: [file('/home/a.txt')]});
	let threw = null;
	try {
		await h.actions.addToBookmarks('/home/a.txt');
	}
	catch (err) {
		threw = err.message;
	}
	check('a shell with no bookmarks is quietly nothing to do', [threw, h.calls, h.notes], [null, [], []]);
}

// --- Open with: the ordinary case --------------------------------------------------------------

{
	const h = harness({items: [file('/home/sheet.csv')]});
	await h.actions.openWith('/home/sheet.csv');
	check('the apps are asked about the row', h.calls[0], ['apps', ['/home/sheet.csv']]);
	check('the dialog underneath is closed and drawn away before the chooser opens',
		h.calls.slice(1), [['overlays', null], ['chooser', null]]);
	check('which is asked for one file, with its extension, and the two universal routes',
		[h.chooser.paths, h.chooser.extension, h.chooser.title, h.chooser.subtitle, h.chooser.universal],
		[['/home/sheet.csv'], 'csv', 'Open with...', '/home/sheet.csv', true]);
	check('with Explorer\'s own two buttons under the list',
		h.chooser.extras.map(e => e.label), ['App Manager', 'Manage Defaults']);
}

{
	const h = harness({items: [file('/home/sheet.csv')], selected: ['/home/sheet.csv']});
	await h.actions.openWith();
	check('with no row, the selected file', h.chooser && h.chooser.paths, ['/home/sheet.csv']);
}

{
	const h = harness();
	await h.actions.openWith();
	check('with neither, nothing is asked at all', h.calls, []);
}

{
	const h = harness({noChooser: true, items: [file('/home/a.txt')]});
	let threw = null;
	try {
		await h.actions.openWith('/home/a.txt');
	}
	catch (err) {
		threw = err.message;
	}
	check('a shell with no chooser does not make Open with throw', threw, null);
	check('a shell with no chooser is told, as a warning, and no apps are listed',
		[h.notes.map(n => [n.title, n.level]), h.calls], [[['Open with needs PixOS', 'warn']], []]);
}

{
	const h = harness({items: [file('/home/a.txt'), file('/home/b.txt')], selected: ['/home/a.txt']});
	await h.actions.openWith('/home/b.txt');
	check('one selected file does not override the row the menu was opened on',
		h.chooser && h.chooser.paths, ['/home/b.txt']);
}

// --- Open with: several files, a folder, nothing to offer ---------------------------------------

{
	const h = harness({
		items: [file('/home/a.csv'), file('/home/b.csv'), folder('/home/docs')],
		selected: ['/home/a.csv', '/home/b.csv', '/home/docs'],
		pick: {appId: 'ace'}
	});
	await h.actions.openWith('/home/a.csv');
	check('several selected files are opened together, whichever row was clicked, folders left out',
		[h.chooser.paths, h.chooser.title, h.chooser.subtitle],
		[['/home/a.csv', '/home/b.csv'], 'Open 2 files with...', '2 files']);
	// "Remember this for all of these" is not a thing one association can express, even when they
	// share an extension.
	check('with no extension to remember and no universal routes', [h.chooser.extension, h.chooser.universal], ['', false]);
	check('and the pick opens them all in one call', h.calls[h.calls.length - 1],
		['openFiles', ['/home/a.csv', '/home/b.csv'], 'ace']);
}

{
	const h = harness({items: [file('/home/README')], pick: {appId: 'ace'}});
	await h.actions.openWith('/home/README');
	check('a file with no extension offers nothing to remember', h.chooser.extension, '');
	check('and the pick opens that file with that app', h.calls[h.calls.length - 1], ['openFile', '/home/README', 'ace']);
}

{
	const h = harness({apps: [], items: [folder('/home/docs')]});
	await h.actions.openWith('/home/docs');
	check('a folder nothing can open is answered here, not with an empty chooser',
		[h.notes.map(n => [n.title, n.message, n.level]), h.chooser],
		[[['Nothing can open all of these', 'No installed app can open a folder.', 'warn']], null]);
	check('and the dialog underneath is left alone', h.calls.some(c => c[0] === 'overlays'), false);
}

{
	const h = harness({apps: [], items: [file('/home/a.x'), file('/home/b.y'), file('/home/c.z')],
		selected: ['/home/a.x', '/home/b.y', '/home/c.z']});
	await h.actions.openWith();
	check('several files with nothing in common say how many, and what to try',
		h.notes.map(n => n.message), ['No installed app takes every one of the 3 files selected. Try them one at a time.']);
}

{
	const h = harness({apps: [], items: [file('/home/odd.qqq')]});
	await h.actions.openWith('/home/odd.qqq');
	check('one file with no apps still gets the chooser -- its universal routes are never empty',
		[h.notes, h.chooser && h.chooser.universal], [[], true]);
}

{
	const h = harness({noOpenFiles: true, items: [file('/home/a.csv'), file('/home/b.csv')],
		selected: ['/home/a.csv', '/home/b.csv'], pick: {appId: 'ace'}});
	let threw = null;
	try {
		await h.actions.openWith();
	}
	catch (err) {
		threw = err.message;
	}
	check('a shell that cannot open several files at once opens none of them -- not one, not a crash',
		[threw, h.calls.filter(c => c[0].startsWith('open'))], [null, []]);
}

// --- Open with: what the answer means ----------------------------------------------------------

{
	const h = harness({items: [file('/home/a.txt')], pick: {kind: 'browser-tab'}});
	await h.actions.openWith('/home/a.txt');
	const g = harness({items: [file('/home/a.txt')], pick: {kind: 'raw-window'}});
	await g.actions.openWith('/home/a.txt');
	check('the two universal routes go to their own shell calls',
		[h.calls[h.calls.length - 1], g.calls[g.calls.length - 1]],
		[['browserTab', '/home/a.txt'], ['rawWindow', '/home/a.txt']]);
}

{
	const h = harness({items: [file('/home/a.txt')]});
	await h.actions.openWith('/home/a.txt');
	check('closing the chooser without a pick opens nothing',
		h.calls.filter(c => /^open|navigate|browserTab|rawWindow/.test(c[0])), []);
}

{
	const elsewhere = harness({cwd: '/home', items: [folder('/home/docs')], pick: {appId: 'explorer'}});
	await elsewhere.actions.openWith('/home/docs');
	check('Explorer picked for a folder row navigates to it', elsewhere.calls[elsewhere.calls.length - 1],
		['navigate', '/home/docs']);

	// The empty-area menu hands over the folder being shown as an item, so a highlighted file
	// inside it cannot take its place.
	const here = harness({cwd: '/home/docs', items: [file('/home/docs/a.txt')], selected: ['/home/docs/a.txt'],
		pick: {appId: 'explorer'}});
	await here.actions.openWith(folder('/home/docs'));
	check('the current folder, handed over as an item, is asked about -- not the selection',
		here.chooser && here.chooser.paths, ['/home/docs']);
	check('and Explorer picked for the folder you are in opens another one, since navigating there does nothing',
		here.calls[here.calls.length - 1], ['openPath', '/home/docs', 'new explorer']);

	const other = harness({items: [folder('/home/docs')], pick: {appId: 'gallery'}});
	await other.actions.openWith('/home/docs');
	check('any other app is handed the folder', other.calls[other.calls.length - 1], ['openPath', '/home/docs', 'gallery']);
}

// --- the chooser's own buttons -----------------------------------------------------------------

{
	const h = harness({items: [file('/home/sheet.csv')]});
	await h.actions.openWith('/home/sheet.csv');
	extra(h, 'App Manager').run();
	check('App Manager is opened as an app', h.calls[h.calls.length - 1], ['openApp', 'app-manager']);

	const old = harness({noOpenApp: true, items: [file('/home/sheet.csv')]});
	await old.actions.openWith('/home/sheet.csv');
	try {
		extra(old, 'App Manager').run();
	}
	catch (err) {
		old.calls.push(['threw', err.message]);
	}
	check('or by its page, in a shell that cannot open apps by id',
		old.calls[old.calls.length - 1], ['openFile', '/apps/app-manager/index.html', undefined]);
}

{
	const h = harness({items: [file('/home/sheet.csv')]});
	await h.actions.openWith('/home/sheet.csv');
	extra(h, 'Manage Defaults').run();
	await settle();
	check('Manage Defaults opens the defaults dialog, filled in with the file\'s extension',
		h.dialogs, [{type: 'defaultApps', prefill: 'csv'}]);
}

{
	const h = harness({managerThrows: true, items: [file('/home/sheet.csv')]});
	await h.actions.openWith('/home/sheet.csv');
	extra(h, 'Manage Defaults').run();
	await settle();
	check('and a failure in it, long after openWith returned, is reported under the table\'s own label',
		h.failures, [['LABEL(manageDefaultApps)', 'settings unreadable']]);
	check('rather than escaping as an unhandled rejection', unhandled, []);
}

{
	const h = harness();
	await h.actions.manageDefaultApps('md');
	check('Manage Defaults from anywhere else passes its extension through', h.dialogs, [{type: 'defaultApps', prefill: 'md'}]);
}

// --- sharing with peers ------------------------------------------------------------------------

{
	const h = harness();
	h.actions.shareWithPeers('/home/docs');
	check('sharing hands the folder to the shell, then refreshes the listing',
		h.calls, [['share', '/home/docs'], ['refresh', false]]);
	const note = h.notes[0];
	check('and says what a peer can and cannot do with it', [note.title, note.level, /cannot write/.test(note.message)],
		['Sharing docs', 'info', true]);
	note.actions[0].run();
	check('with a button that opens the Peers panel', [note.actions[0].label, h.calls[h.calls.length - 1]],
		['Show the Peers panel', ['peersPanel']]);
}

{
	const h = harness({shareThrows: 'Sharing / is refused'});
	h.actions.shareWithPeers('/');
	check('a refused share says why, in the shell\'s words', h.notes.map(n => [n.title, n.message]),
		[['Could not share that folder', 'Sharing / is refused']]);
	check('and neither claims it is sharing nor refreshes', h.calls, [['share', '/']]);
}

{
	const h = harness();
	h.actions.stopSharing();
	check('stopping hands the shell nothing to share, then refreshes', h.calls, [['share', null], ['refresh', false]]);
	check('and says what that did to anyone who had it open', h.notes.map(n => [n.title, n.level]),
		[['Stopped sharing', 'info']]);
}

process.exit(report('explorer-shell-actions') ? 1 : 0);
