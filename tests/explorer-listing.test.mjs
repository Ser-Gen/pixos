// The folder you are standing in, deleted from another window.
//
// `readdir` resolves `contents || []` — it swallows the error — so a folder that has been
// deleted underneath a window answers exactly like a folder with nothing in it. The window
// emptied its listing, went on showing the dead path in the breadcrumbs, and said nothing.
// Phase 20 made the window notice a change; it did not make it notice that the change was
// the ground it was standing on.
//
// An empty listing is the only ambiguous case — a folder with files in it is a folder that
// is there — so that is the only case that pays for the extra `stat`.

import fs from 'fs';
import {check, report} from './assert.mjs';

const source = fs.readFileSync(new URL('../apps/explorer/index.html', import.meta.url), 'utf8');

const start = source.indexOf('async function refreshCurrentDir');
const end = source.indexOf('\n\tfunction sortItems', start);
if (start === -1 || end === -1) {
	console.error('explorer-listing.test.mjs: could not find refreshCurrentDir');
	process.exit(1);
}
const code = source.slice(start, end);

// --- a filesystem that can lose a folder while you are in it ----------------------------

let tree, notes, failures, rendered;

const state = {cwd: '/home/docs', items: [], selectedPaths: new Set(),
	lastSelectedPath: null, busy: false, pendingRefresh: null};

const api = new Function(
	'state', 'withFsTimeout', 'listDirectory', 'stat', 'normalizePath', 'getParentPath',
	'sortItems', 'renderBreadcrumbs', 'renderSidebar', 'renderRows', 'renderStatus',
	'renderToolbarState', 'report', 'reportFailure',
	code + '\n; return {refreshCurrentDir, nearestExistingFolder};'
)(
	state,
	promise => promise,
	// listDirectory — every path in the tree that sits directly under this one. A folder
	// that is not in the tree lists as empty, which is the lie being corrected.
	async dir => Object.keys(tree)
		.filter(p => p !== dir && p.slice(0, dir.length) === dir
			&& p.slice(dir === '/' ? dir.length : dir.length + 1).indexOf('/') === -1
			&& p !== dir)
		.map(p => ({name: p.split('/').pop(), path: p})),
	async p => (tree[p] ? {isDirectory: () => true} : false),
	p => p,
	p => (!p || p === '/' ? '/' : p.replace(/\/[^/]*$/, '') || '/'),
	() => {}, () => { rendered++; }, () => {}, () => {}, () => {}, () => {},
	(title, message, level) => { notes.push([title, message, level]); },
	(label, err) => { failures.push([label, String(err && err.message)]); }
);

function reset (paths, cwd) {
	tree = {'/': true};
	paths.forEach(p => { tree[p] = true; });
	state.cwd = cwd;
	state.items = [];
	state.selectedPaths = new Set();
	state.busy = false;
	state.pendingRefresh = null;
	notes = [];
	failures = [];
	rendered = 0;
}

// --- an ordinary folder, and an ordinary empty one --------------------------------------

reset(['/home', '/home/docs', '/home/docs/a.txt'], '/home/docs');
await api.refreshCurrentDir(false);
check('a folder with files in it lists them', state.items.map(i => i.path), ['/home/docs/a.txt']);
check('and nothing is reported', notes, []);
check('and the window stays where it was', state.cwd, '/home/docs');

// The case that must not regress: empty is a perfectly ordinary thing for a folder to be.
reset(['/home', '/home/docs'], '/home/docs');
await api.refreshCurrentDir(false);
check('a folder that is simply empty is left alone', state.cwd, '/home/docs');
check('with nothing said about it', notes, []);

// --- the bug ------------------------------------------------------------------------------

reset(['/home'], '/home/docs');
await api.refreshCurrentDir(false);
check('a folder deleted underneath the window is noticed', state.cwd, '/home');
check('and the window says which one went, and where it is now',
	notes, [['That folder is gone',
		'/home/docs was deleted or unmounted. Showing /home instead.', 'warn']]);
check('this is a warning, not an error — nothing failed', notes[0][2], 'warn');
check('and it is not reported as a failure to open a folder', failures, []);

// Deleting a tree takes the folder you are in and its parent with it. Landing on a second
// dead folder would report twice and still show nothing.
reset(['/home'], '/home/projects/app/src');
await api.refreshCurrentDir(false);
check('it walks up past every folder that is also gone', state.cwd, '/home');
check('and reports once, naming where it actually landed', notes.length, 1);

// Nothing left at all above it: the root always exists.
reset([], '/mnt/usb/photos');
await api.refreshCurrentDir(false);
check('with nothing surviving above it, the window falls back to the root',
	state.cwd, '/');

// The root itself is never suspected, however empty it is.
reset([], '/');
await api.refreshCurrentDir(false);
check('an empty root is not treated as a deleted folder', state.cwd, '/');
check('and says nothing', notes, []);

// --- and the window is redrawn afterwards, at the new place ---------------------------------

reset(['/home'], '/home/docs');
await api.refreshCurrentDir(false);
check('the breadcrumbs are redrawn once the window has moved', rendered, 1);

// --- the ambiguity is only paid for when it exists ------------------------------------------

check('the stat is asked only for an empty listing',
	/if \(!state\.items\.length && state\.cwd !== '\/' && !\(await stat\(state\.cwd\)\)\)/.test(code),
	true);

process.exit(report('explorer-listing') ? 1 : 0);
