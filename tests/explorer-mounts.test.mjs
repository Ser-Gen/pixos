// The four things a person can do to a mount: apps/explorer/js/mounts.js.
//
// `js/mount-manager.js` owns what a mount *is*. This owns what asking for one looks like, and
// almost everything here is a rule about the order things happen in or about a refusal, not
// about mounting:
//
//   * **Sidebar first, then navigate.** Every successful mount does those two in that order.
//     Backwards, the window walks into a mount point the sidebar has not drawn yet.
//   * **Cancelling is not failing.** The directory picker reports a person who picked nothing
//     as an `AbortError`, and reporting that as a failure means a dialog for pressing Escape.
//   * **A mount that cannot be read is still mounted**, and has to say so differently from one
//     that did not mount — those were the same message, and the same message was wrong for one
//     of them. Behind a ten-second timer, which is a parameter here for the obvious reason.
//   * **Unmounting the ground you are standing on** has to move the window out first.
//
// None of it needs a browser: the mount manager, the picker, the clock and `localStorage` are
// all parameters.

import fs from 'fs';
import {check, report} from './assert.mjs';
import {createMounts} from '../apps/explorer/js/mounts.js';

const pathStub = {
	basename: p => String(p).split('/').pop(),
	join: (...parts) => ('/' + parts.join('/')).replace(/\/+/g, '/')
};

function harness (options) {
	options = options || {};
	const h = {
		state: {cwd: options.cwd || '/home', dialog: null, selectedPaths: new Set(options.selected || [])},
		items: options.items || [],
		dialogs: [],
		infos: [],
		notes: [],
		failures: [],
		calls: [],
		navigated: [],
		refreshes: 0,
		sidebarDraws: 0,
		overlayDraws: 0,
		timers: [],
		store: Object.assign({}, options.store),
		readdirError: options.readdirError || null,
		readdirNever: !!options.readdirNever,
		mountError: options.mountError || null
	};

	// Every mount call answers through its callback, and each records the order it ran in
	// against the sidebar and the navigation — which is what most of this file is about.
	function mountCall (kind) {
		return function (...args) {
			const done = args[args.length - 1];
			h.calls.push([kind].concat(args.slice(0, -1).map(a => (typeof a === 'object' && a ? '<obj>' : a))));
			done(h.mountError);
		};
	}

	const mountManager = options.noMountManager ? null : {
		suggestMountPoint: name => '/mnt/' + name,
		mountZip: mountCall('zip'),
		mountIso: mountCall('iso'),
		mountNativeDir: mountCall('native'),
		mountFiles3: mountCall('files3'),
		umount: mp => {
			if (options.umountThrows) { throw new Error('still busy'); }
			h.calls.push(['umount', mp]);
		}
	};

	h.mounts = createMounts({
		state: h.state,
		fs: {
			readdir: (dir, cb) => {
				if (h.readdirNever) { return; }
				cb(h.readdirError);
			}
		},
		path: pathStub,
		shell: options.shellPicker
			? {pickNativeDirectory: () => options.shellPicker()}
			: {},
		win: {
			showDirectoryPicker: options.winPicker || undefined,
			localStorage: {
				getItem: key => (key in h.store ? h.store[key] : null),
				setItem: (key, value) => { h.store[key] = value; }
			},
			location: {origin: 'https://pixos.example', pathname: '/app/'},
			URL: URL
		},
		mountManager: mountManager,
		normalizePath: p => String(p).replace(/\/+/g, '/'),
		readFile: async p => 'BYTES:' + p,
		getItemByPath: p => h.items.find(i => i.path === p) || null,
		getNormalizedExtension: p => String(p).split('.').pop().toLowerCase(),
		openDialog: dialog => { h.dialogs.push(dialog); },
		openInfoDialog: (title, message) => { h.infos.push([title, message]); },
		report: (title, message, level) => { h.notes.push([title, message, level]); },
		reportFailure: (label, err) => { h.failures.push([label, String(err && err.message)]); },
		renderOverlays: () => { h.overlayDraws++; h.calls.push(['overlays']); },
		renderSidebar: () => { h.sidebarDraws++; h.calls.push(['sidebar']); },
		navigateTo: p => { h.navigated.push(p); h.calls.push(['navigate', p]); },
		refreshCurrentDir: () => { h.refreshes++; },
		setTimer: (fn, ms) => { h.timers.push({fn, ms}); return h.timers.length; },
		clearTimer: handle => { if (h.timers[handle - 1]) { h.timers[handle - 1].cleared = true; } }
	});
	return h;
}

function file (path) {
	return {path: path, name: pathStub.basename(path), isDirectory: false};
}

const order = h => h.calls.map(c => c[0]);

// --- no mount manager, which is Explorer opened with no shell -------------------------------

{
	const h = harness({noMountManager: true});
	await h.mounts.mountArchive('/home/a.zip');
	await h.mounts.mountNativeDir();
	h.mounts.mountFiles3();
	h.mounts.umount('/mnt/x');
	check('each of the three says so rather than throwing',
		h.infos.map(i => i[1]),
		['Mount manager is not available', 'Mount manager is not available',
			'Mount manager is not available']);
	check('and unmounting simply does nothing, having nothing to undo', h.calls, []);
	// Quietly: there is no mount to remove, so there is nothing to tell anybody about. Drop
	// the guard and it reaches for `mountManager.umount` and reports the TypeError as a
	// failed unmount.
	check('without reporting a failure at something nobody asked for', h.failures, []);
}

// --- mounting an archive ---------------------------------------------------------------------

{
	const h = harness({items: [file('/home/disk.zip')]});
	await h.mounts.mountArchive('/home/disk.zip');
	check('it asks where to put it', h.dialogs[0].type, 'prompt');
	check('titled by the format', h.dialogs[0].title, 'Mount ZIP');
	check('with a suggestion already filled in', h.dialogs[0].defaultValue, '/mnt/disk.zip');

	await h.dialogs[0].onSubmit('/mnt/disk');
	check('a zip goes to mountZip with its bytes and its name',
		h.calls.filter(c => c[0] === 'zip'), [['zip', 'BYTES:/home/disk.zip', '/mnt/disk', 'disk.zip']]);
	// The whole point of the pair: a navigate before the sidebar walks into a mount point the
	// sidebar has not drawn.
	check('and the sidebar is drawn before the window goes there',
		order(h).slice(-2), ['sidebar', 'navigate']);
	check('the dialog is closed first of all', h.state.dialog, null);
}

{
	const h = harness({items: [file('/home/disc.iso')]});
	await h.mounts.mountArchive('/home/disc.iso');
	await h.dialogs[0].onSubmit('/mnt/disc');
	check('an iso goes to mountIso', h.calls.filter(c => c[0] === 'iso').length, 1);
}

{
	const h = harness({items: [file('/home/notes.txt')]});
	await h.mounts.mountArchive('/home/notes.txt');
	await h.dialogs[0].onSubmit('/mnt/notes');
	check('a format nothing can mount says which one', h.infos, [['Mount', 'Unsupported format: txt']]);
	check('and mounts nothing', h.calls.filter(c => c[0] === 'zip' || c[0] === 'iso'), []);
}

{
	const h = harness({items: [file('/home/disk.zip')], mountError: new Error('bad central directory')});
	await h.mounts.mountArchive('/home/disk.zip');
	await h.dialogs[0].onSubmit('/mnt/disk');
	check('a mount that fails names the file', h.failures, [['Could not mount disk.zip', 'bad central directory']]);
	check('and the window stays where it was', h.navigated, []);
	check('and the sidebar is not redrawn over nothing', h.sidebarDraws, 0);
}

{
	const h = harness({items: [file('/home/disk.zip')]});
	await h.mounts.mountArchive('/home/disk.zip');
	await h.dialogs[0].onSubmit('');
	check('answering with no mount point mounts nothing', h.calls.filter(c => c[0] === 'zip'), []);
	check('but the dialog still closed', order(h), ['overlays']);
}

{
	const h = harness({items: [file('/home/disk.zip')], selected: ['/home/disk.zip']});
	await h.mounts.mountArchive();
	check('with no path it takes the selection', h.dialogs.length, 1);
}

{
	const h = harness({items: [{path: '/home/pics', name: 'pics', isDirectory: true}]});
	await h.mounts.mountArchive('/home/pics');
	check('a folder is not an archive and is not asked about', h.dialogs, []);
	const gone = harness({});
	await gone.mounts.mountArchive('/home/vanished.zip');
	check('and neither is a row that is no longer there', gone.dialogs, []);
}

// --- mounting a local folder ------------------------------------------------------------------

{
	const h = harness({shellPicker: async () => ({name: 'Projects'})});
	await h.mounts.mountNativeDir();
	check('the shell is asked for the folder first -- Explorer is in an iframe',
		h.dialogs[0].title, 'Mount Local Folder');
	check('and the suggestion is named after it', h.dialogs[0].defaultValue, '/mnt/Projects');

	h.dialogs[0].onSubmit('/mnt/proj');
	check('it mounts', h.calls.filter(c => c[0] === 'native').length, 1);
	check('the sidebar is drawn before the read is even attempted',
		order(h).indexOf('sidebar') < order(h).indexOf('navigate'), true);
	check('and the window goes there once the folder answers', h.navigated, ['/mnt/proj']);
	check('the watchdog is cancelled by the answer', h.timers[0].cleared, true);
}

{
	const h = harness({winPicker: async () => ({name: 'Local'})});
	await h.mounts.mountNativeDir();
	check('a window with no shell falls back to its own picker', h.dialogs.length, 1);
}

{
	const h = harness({});
	await h.mounts.mountNativeDir();
	check('a browser with neither says so instead of throwing',
		h.infos, [['Mount', 'File System Access API is not supported in this browser']]);
}

{
	// Pressing Escape in the picker. The browser calls that an error; a person calls it
	// changing their mind, and a dialog about it is noise.
	const h = harness({shellPicker: async () => {
		throw Object.assign(new Error('The user aborted a request.'), {name: 'AbortError'});
	}});
	await h.mounts.mountNativeDir();
	check('picking nothing is not a failure', h.failures, []);
	check('and nothing is asked', h.dialogs, []);
}

{
	const h = harness({shellPicker: async () => { throw new Error('no permission'); }});
	await h.mounts.mountNativeDir();
	check('but a real failure in the picker is reported',
		h.failures, [['Could not mount that folder', 'no permission']]);
}

{
	const h = harness({
		shellPicker: async () => ({name: 'Projects'}),
		readdirError: Object.assign(new Error('EACCES: permission denied'), {code: 'EACCES'})
	});
	await h.mounts.mountNativeDir();
	h.dialogs[0].onSubmit('/mnt/proj');
	check('a folder that mounts but cannot be read says both halves',
		h.failures, [['Mounted /mnt/proj, but cannot read it', 'EACCES: permission denied']]);
	check('and the window does not go into it', h.navigated, []);
	check('while the sidebar still shows it, because it is mounted', h.sidebarDraws, 1);
}

{
	// The native backend can take an unbounded time to answer the first read, and a window
	// that waits for it looks hung. The timer is a parameter, so this is instant.
	const h = harness({shellPicker: async () => ({name: 'Slow'}), readdirNever: true});
	await h.mounts.mountNativeDir();
	h.dialogs[0].onSubmit('/mnt/slow');
	check('nothing is said while the read is merely slow', h.notes, []);
	check('and the watch is ten seconds', h.timers[0].ms, 10000);
	h.timers[0].fn();
	check('after which it says the mount worked and the read did not',
		h.notes, [['Mounted, but slow to read',
			'/mnt/slow is mounted, but reading it timed out. Open it from the '
			+ 'Mounts sidebar when it responds.', 'warn']]);
	check('as a warning, not a failure', h.failures, []);
	check('and the window is still where it was', h.navigated, []);
}

{
	// Both halves race, and exactly one of them may speak. A read that answers after the
	// timer has fired must not then navigate into a folder the person was just told about.
	const h = harness({shellPicker: async () => ({name: 'Slow'}), readdirNever: true});
	await h.mounts.mountNativeDir();
	h.dialogs[0].onSubmit('/mnt/slow');
	h.timers[0].fn();
	h.timers[0].fn();
	check('the timeout speaks once however often it is fired', h.notes.length, 1);
}

// --- Files3 ---------------------------------------------------------------------------------

{
	const h = harness({});
	h.mounts.mountFiles3();
	check('the form opens empty the first time', h.dialogs[0].type, 'files3Mount');
	check('with a storage id derived from nothing at all',
		h.dialogs[0].localStorageId, 'files3_token_storage');

	const fields = {baseUrl: 'https://files3.example/api', rootFolderId: '4',
		localStorageId: 'files3_token_files3_example', mountPoint: '/mnt/cloud'};
	h.dialogs[0].onSubmit(fields);
	check('it mounts with the callback URL this page was served from',
		h.calls.filter(c => c[0] === 'files3').length, 1);
	check('the sidebar goes before the navigation here too',
		order(h).slice(-2), ['sidebar', 'navigate']);

	// Read through a guard: a mount that stops writing its settings leaves nothing here, and
	// this check should say that rather than throw on the way to saying it.
	const saved = h.store.pixos_files3_config ? JSON.parse(h.store.pixos_files3_config) : null;
	check('and what was typed is remembered',
		saved, {baseUrl: 'https://files3.example/api', rootFolderId: 4,
			localStorageId: 'files3_token_files3_example'});

	const again = harness({store: h.store});
	again.mounts.mountFiles3();
	check('so the next time the form is already filled in',
		[again.dialogs[0].baseUrl, again.dialogs[0].rootFolderId],
		['https://files3.example/api', 4]);
}

{
	const h = harness({});
	h.mounts.mountFiles3();
	const base = {baseUrl: 'https://f.example', rootFolderId: '2',
		localStorageId: 'files3_token_f_example', mountPoint: '/mnt/c'};
	[
		[Object.assign({}, base, {baseUrl: ''}), 'Base URL API is required'],
		[Object.assign({}, base, {rootFolderId: '0'}), 'Root Folder ID must be a positive number'],
		[Object.assign({}, base, {rootFolderId: 'abc'}), 'Root Folder ID must be a positive number'],
		[Object.assign({}, base, {rootFolderId: '-5'}), 'Root Folder ID must be a positive number'],
		[Object.assign({}, base, {localStorageId: ''}), 'localStorage ID is required'],
		[Object.assign({}, base, {mountPoint: 'mnt/c'}), 'Mount point must start with /']
	].forEach(([fields, message]) => {
		h.infos = [];
		h.mounts.mountFiles3();
		h.dialogs[h.dialogs.length - 1].onSubmit(fields);
		check('it refuses: ' + message, h.infos.map(i => i[1]), [message]);
	});
	check('and none of the refusals mounted anything',
		h.calls.filter(c => c[0] === 'files3'), []);
	check('nor wrote the settings it was refusing', h.store.pixos_files3_config, undefined);
}

{
	// Three failures that are not failures of mounting, each with its own sentence, because
	// "could not mount" is no help when the answer is "allow popups".
	const cases = [
		['Auth window closed without token.', 'info',
			'Authorization window was closed without completing login.'],
		['Popup blocked by the browser', 'info',
			'Popup blocked by the browser Allow popups for this site and try again.'],
		['500 Internal Server Error', 'note', '500 Internal Server Error']
	];
	cases.forEach(([message, kind, expected]) => {
		const h = harness({mountError: new Error(message)});
		h.mounts.mountFiles3();
		h.dialogs[0].onSubmit({baseUrl: 'https://f.example', rootFolderId: '2',
			localStorageId: 'k', mountPoint: '/mnt/c'});
		check('files3 failure: ' + expected,
			kind === 'info' ? h.infos.map(i => i[1]) : h.notes.map(n => n[1]), [expected]);
		check('and it did not navigate', h.navigated, []);
	});
}

{
	const h = harness({});
	h.mounts.mountFiles3();
	h.dialogs[0].onSubmit({baseUrl: 'https://f.example', rootFolderId: '2',
		localStorageId: 'k', mountPoint: '/mnt/c'});
	const expired = h.calls.find(c => c[0] === 'files3');
	check('the mount went through', !!expired, true);
	check('a storage id is derived from the host -- port, path and dots gone, hyphens kept',
		h.mounts.defaultFiles3LocalStorageId('https://my-files.example.com:8443/x'),
		'files3_token_my-files_example_com');
	check('and a URL it cannot parse still gives a usable one',
		h.mounts.defaultFiles3LocalStorageId('not a url'), 'files3_token_storage');
	// Parses, and has no host: `files:` is a scheme, and the key would have been the bare
	// prefix with nothing after it -- the same key for every such mount.
	check('so does one that parses but names no host',
		h.mounts.defaultFiles3LocalStorageId('files:///local'), 'files3_token_storage');
}

{
	// Anything can be in localStorage -- another tab, an older version, a person with the
	// console open. Reading it is the one place that must not throw, because every route into
	// the Files3 form goes through it.
	const h = harness({store: {pixos_files3_config: '{not json'}});
	let escaped = null;
	let loaded;
	try { loaded = h.mounts.loadFiles3Config(); }
	catch (err) { escaped = err; }
	check('a settings value that is not JSON does not throw', escaped, null);
	check('and reads as nothing', loaded, null);
	// And the form still opens over it. Guarded too, or a `loadFiles3Config` that throws
	// takes this file down before the check above gets to report what it found.
	try { h.mounts.mountFiles3(); }
	catch (err) { escaped = err; }
	check('and the form still opens over it', h.dialogs.length, 1);
}

// --- unmounting ------------------------------------------------------------------------------

{
	const h = harness({cwd: '/home'});
	h.mounts.umount('/mnt/zip');
	check('it unmounts and redraws the sidebar', order(h), ['umount', 'sidebar']);
	check('and refreshes where you are, since it is not in there', h.refreshes, 1);
	check('without moving the window', h.navigated, []);
}

{
	// Unmounting the ground you are standing on. Refreshing would list a path that is no
	// longer served by anything.
	const h = harness({cwd: '/mnt/zip/docs'});
	h.mounts.umount('/mnt/zip');
	check('unmounting the folder you are inside moves you out', h.navigated, ['/']);
	check('and does not refresh a folder that has gone', h.refreshes, 0);
}

{
	const h = harness({cwd: '/home', umountThrows: true});
	h.mounts.umount('/mnt/zip');
	check('an unmount that refuses is reported',
		h.failures, [['Could not unmount that', 'still busy']]);
	check('and nothing is redrawn over it', [h.sidebarDraws, h.refreshes], [0, 0]);
}

// --- the copy that is not in a module --------------------------------------------------------
//
// Files3 authorises in a popup that comes back to Explorer with `?token=`, and the script that
// catches it runs at parse time, before a module has loaded. So the first `<script>` in
// index.html carries its own copy of the settings key and of the host-to-storage-id rule.
// Neither copy can import the other, and a rename on one side would send the token to a key
// the mount never reads -- a login that says nothing and does nothing.

{
	const entry = fs.readFileSync(new URL('../apps/explorer/index.html', import.meta.url), 'utf8');
	const boot = entry.slice(0, entry.indexOf('</script>'));
	const module = fs.readFileSync(new URL('../apps/explorer/js/mounts.js', import.meta.url), 'utf8');

	const keyOf = src => (src.match(/FILES3_CONFIG_KEY = '([^']+)'/) || [])[1];
	check('the boot script and the module agree on the settings key',
		[keyOf(boot), keyOf(module)], ['pixos_files3_config', 'pixos_files3_config']);

	const fallbackOf = src => (src.match(/'files3_token_' \+ \(?(?:host|new URL\(cfg\.baseUrl\)\.hostname) \|\| '([^']+)'/) || [])[1];
	check('and on what a host with no name falls back to',
		[fallbackOf(boot), fallbackOf(module)], ['storage', 'storage']);
	check('and both spell the default id the same way',
		[boot.indexOf("'files3_token_storage'") > -1, module.indexOf("'files3_token_storage'") > -1],
		[true, true]);
}

report('explorer-mounts');
