// The mount table written down, and brought back at boot: js/shell/mount-table.js, and the part
// of js/mount-manager.js it depends on.
//
// Before phase 22 a mount lived in memory and died with the tab. What makes bringing one back
// harder than writing it down is that the four types cannot come back the same way:
//
//   * a zip or an iso is read again from its file -- so it has to know which file, which it did not;
//   * Files3 mounts again only while its token is in localStorage, because getting a new one is a
//     popup, and a popup with no click behind it is blocked;
//   * a local folder mounts silently only if the browser still says `granted`, and otherwise
//     waits for a click, because `requestPermission()` answers nowhere else;
//   * a peer is not written down at all.
//
// And what cannot come back *waits* rather than disappearing, since the disappearing was the
// complaint. None of it needs a browser: the mount manager, the file, the handle store, the token
// and the notification are all parameters.

import fs from 'node:fs';
import {check, report} from './assert.mjs';
import {createMountTable, toRecord, readRecords, describeRestoreFailures, VERSION} from '../js/shell/mount-table.js';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const FILES3 = {
	baseUrl: 'https://s.example/api',
	rootFolderId: 7,
	localStorageId: 'files3_token_s',
	callbackUrl: 'https://pixos.example/apps/explorer/index.html'
};
const files3Rec = {mountPoint: '/mnt/s3', type: 'files3', name: 's.example', files3: FILES3};
const zipRec = (mountPoint, source) => ({mountPoint, type: 'zip', name: source.split('/').pop(), source});
const nativeRec = (mountPoint, name) => ({mountPoint, type: 'native', name});
const doc = (...mounts) => ({version: 1, mounts});

function folderHandle (name, permission, answer) {
	const h = {name, permission: permission || 'granted', asked: 0};
	h.queryPermission = async () => h.permission;
	h.requestPermission = () => { h.asked++; return Promise.resolve(answer || 'granted'); };
	return h;
}

const brokenStore = {
	get: async () => { throw new Error('no IndexedDB'); },
	put: async () => { throw new Error('no IndexedDB'); },
	remove: async () => { throw new Error('no IndexedDB'); },
	keys: async () => { throw new Error('no IndexedDB'); }
};

function harness (options) {
	options = options || {};
	const h = {
		doc: options.doc === undefined ? null : options.doc,
		writes: [],
		notes: [],
		announced: [],
		logs: [],
		calls: [],
		mounts: {},
		held: {},
		tokens: new Set(options.tokens || []),
		owner: options.owner !== false,
		store: new Map(Object.entries(options.handles || {})),
		failing: Object.assign({}, options.failing),
		hanging: new Set(options.hanging || [])
	};

	function complete (mountPoint, info, cb) {
		const err = h.failing[mountPoint];
		if (err) { cb(err); return; }
		h.mounts[mountPoint] = info;
		h.manager.onChange();
		cb(null);
	}
	function answer (mountPoint, info, cb) {
		if (h.hanging.has(mountPoint)) {
			h.held[mountPoint] = () => complete(mountPoint, info, cb);
			return;
		}
		complete(mountPoint, info, cb);
	}

	h.manager = {
		listMounts: () => Object.keys(h.mounts).map(mp => ({mountPoint: mp, type: h.mounts[mp].type, name: h.mounts[mp].name, readOnly: false})),
		getMountInfo: mp => h.mounts[mp] || null,
		isMountPoint: mp => !!h.mounts[mp],
		mountZipFile: (source, mp, name, cb) => { h.calls.push(['zip', source, mp, name]); answer(mp, {type: 'zip', name, source}, cb); },
		mountIsoFile: (source, mp, name, cb) => { h.calls.push(['iso', source, mp, name]); answer(mp, {type: 'iso', name, source}, cb); },
		mountNativeDir: (handle, mp, name, cb) => { h.calls.push(['native', handle.name, mp, name]); answer(mp, {type: 'native', name, handle}, cb); },
		mountFiles3: (config, mp, name, cb) => {
			h.calls.push(['files3', config.baseUrl, mp, name]);
			h.lastFiles3Config = config;
			answer(mp, {type: 'files3', name, config}, cb);
		},
		umount: mp => { delete h.mounts[mp]; h.manager.onChange(); },
		// What the shell does in index.html: every change reaches the table.
		onChange: () => h.table.changed()
	};

	h.table = createMountTable({
		mountManager: h.manager,
		read: async () => {
			if (options.readThrows) { throw new Error('unreadable'); }
			return h.doc;
		},
		write: async written => { h.writes.push(JSON.parse(JSON.stringify(written))); },
		canWrite: () => h.owner,
		handles: options.brokenHandles ? brokenStore : {
			get: async key => h.store.get(key),
			put: async (key, value) => { h.store.set(key, value); },
			remove: async key => { h.store.delete(key); },
			keys: async () => [...h.store.keys()]
		},
		hasToken: config => h.tokens.has(config.localStorageId),
		notify: note => { h.notes.push(note); },
		announce: point => { h.announced.push(point); },
		log: message => { h.logs.push(message); }
	});
	return h;
}

const statuses = h => h.table.list().map(w => [w.mountPoint, w.status]);
const waitingAt = (h, mountPoint) => h.table.list().find(w => w.mountPoint === mountPoint) || {};
// Nothing written reads as an empty table, so a check about what was written fails rather than
// throwing and taking every check after it down too.
const last = h => h.writes[h.writes.length - 1] || {mounts: []};
const points = written => written.mounts.map(r => r.mountPoint);

// A promise that never settles must fail a check, not hang the file.
const within = promise => Promise.race([
	promise.then(() => 'settled'),
	new Promise(resolve => setTimeout(() => resolve('still waiting'), 50))
]);

// --- what is written ----------------------------------------------------------------------------

check('a zip mounted from a file is kept, with the file',
	toRecord('/mnt/a', {type: 'zip', name: 'a.zip', readOnly: true, source: '/home/a.zip'}),
	zipRec('/mnt/a', '/home/a.zip'));
check('one mounted from bytes is not: there is nothing to read again',
	toRecord('/mnt/a', {type: 'zip', name: 'a.zip', readOnly: true, source: null}), null);
check('an iso the same way',
	toRecord('/mnt/d', {type: 'iso', name: 'd.iso', source: '/home/d.iso'}),
	{mountPoint: '/mnt/d', type: 'iso', name: 'd.iso', source: '/home/d.iso'});
check('a local folder is kept by name alone -- its handle goes to IndexedDB, not into JSON',
	toRecord('/mnt/w', {type: 'native', name: 'work', handle: folderHandle('work')}), nativeRec('/mnt/w', 'work'));
check('but not with no handle to keep', toRecord('/mnt/w', {type: 'native', name: 'work'}), null);
check('a peer is never kept', toRecord('/mnt/p', {type: 'peer', name: 'bob'}), null);
check('a Files3 storage keeps its four strings and nothing else -- no callback, no token',
	toRecord('/mnt/s3', {type: 'files3', name: 's.example', auth: {token: 'secret'},
		config: Object.assign({onUnauthorized: () => {}}, FILES3)}),
	files3Rec);
check('and one missing part of its configuration is not kept at all',
	toRecord('/mnt/s3', {type: 'files3', name: 'x', config: Object.assign({}, FILES3, {callbackUrl: ''})}), null);

// --- what is read back ---------------------------------------------------------------------------

check('a document that is not one reads as no mounts',
	[readRecords(null), readRecords({mounts: 'x'}), readRecords([])], [[], [], []]);
check('what it holds is checked, since anything can write a file in /settings',
	readRecords({mounts: [
		null,
		nativeRec('mnt/relative', 'r'),
		nativeRec('/', 'root'),
		{mountPoint: '/mnt/a', type: 'zip', name: 'a', source: 'home/a.zip'},
		{mountPoint: '/mnt/p', type: 'peer', name: 'bob'},
		Object.assign({}, files3Rec, {files3: Object.assign({}, FILES3, {rootFolderId: 0})}),
		nativeRec('/mnt/w', 'work'),
		zipRec('/mnt/w', '/home/second.zip')
	]}).map(r => r.mountPoint + ' ' + r.type),
	['/mnt/w native']);
check('and what is valid comes back as it went',
	readRecords(doc(zipRec('/mnt/a', '/home/a.zip'), files3Rec, nativeRec('/mnt/w', 'work'))),
	[zipRec('/mnt/a', '/home/a.zip'), files3Rec, nativeRec('/mnt/w', 'work')]);

// --- the note ---------------------------------------------------------------------------------------

check('nothing failed is no note', describeRestoreFailures([]), null);
check('one failure is named, with its reason, and says where to deal with it',
	describeRestoreFailures([{mountPoint: '/mnt/a', name: 'a.zip', reason: 'ENOENT'}]),
	{
		title: 'A mount did not come back',
		message: 'a.zip (/mnt/a) — ENOENT\n\nIt is still in Explorer\'s sidebar: click it to try again, or forget it there.'
	});
check('several are one note, not one each',
	describeRestoreFailures([{mountPoint: '/mnt/a', name: 'a'}, {mountPoint: '/mnt/b', name: 'b'}]).title,
	'2 mounts did not come back');

// --- restoring --------------------------------------------------------------------------------------

{
	const oldHandle = folderHandle('old', 'prompt');
	const h = harness({
		doc: doc(
			zipRec('/mnt/a', '/home/a.zip'),
			{mountPoint: '/mnt/disc', type: 'iso', name: 'disc.iso', source: '/home/disc.iso'},
			nativeRec('/mnt/work', 'work'),
			nativeRec('/mnt/old', 'old'),
			files3Rec,
			zipRec('/mnt/gone', '/home/gone.zip')
		),
		handles: {'/mnt/work': folderHandle('work', 'granted'), '/mnt/old': oldHandle},
		failing: {'/mnt/gone': new Error('ENOENT: no such file, \'/home/gone.zip\'')}
	});
	await h.table.restore();

	check('zips and isos come back from their files, and a folder the browser still grants comes back silently',
		h.calls, [
			['zip', '/home/a.zip', '/mnt/a', 'a.zip'],
			['iso', '/home/disc.iso', '/mnt/disc', 'disc.iso'],
			['zip', '/home/gone.zip', '/mnt/gone', 'gone.zip'],
			['native', 'work', '/mnt/work', 'work']
		]);
	check('what could not come back is waiting, and says for what', statuses(h), [
		['/mnt/old', 'needs-permission'],
		['/mnt/s3', 'needs-sign-in'],
		['/mnt/gone', 'failed']
	]);
	check('a Files3 storage with no token is not mounted at all -- that would open a popup no click is behind',
		h.calls.some(c => c[0] === 'files3'), false);
	check('a folder waiting for permission was not asked for it: nothing was clicked',
		oldHandle.asked, 0);
	check('a failure keeps its reason', waitingAt(h, '/mnt/gone').reason, 'ENOENT: no such file, \'/home/gone.zip\'');

	await h.table.settled();
	check('what failed is one note -- and waiting for a click is not a failure',
		h.notes.map(n => [n.level, n.title]), [['warn', 'A mount did not come back']]);
	check('naming the mount and why', (h.notes[0] || {message: ''}).message.split('\n')[0],
		'gone.zip (/mnt/gone) — ENOENT: no such file, \'/home/gone.zip\'');

	await h.table.written();
	check('the table written back still holds every one of them, live or waiting',
		points(last(h)).sort(), ['/mnt/a', '/mnt/disc', '/mnt/gone', '/mnt/old', '/mnt/s3', '/mnt/work']);
	check('in the format it was read in', last(h).version, VERSION);
	check('and both folder handles are still kept', [...h.store.keys()].sort(), ['/mnt/old', '/mnt/work']);
}

{
	const h = harness({
		doc: doc(zipRec('/mnt/a', '/home/a.zip'), files3Rec),
		tokens: [FILES3.localStorageId],
		hanging: ['/mnt/s3']
	});
	check('boot waits for a zip, and not for a server',
		[await within(h.table.restore()), h.manager.isMountPoint('/mnt/a'), statuses(h)],
		['settled', true, [['/mnt/s3', 'restoring']]]);
	check('a storage whose token is still there is mounted with nothing asked',
		h.calls[1], ['files3', FILES3.baseUrl, '/mnt/s3', 's.example']);
	check('from its record, with a callback of its own for a session that expires',
		[h.lastFiles3Config.localStorageId, h.lastFiles3Config.callbackUrl, typeof h.lastFiles3Config.onUnauthorized],
		[FILES3.localStorageId, FILES3.callbackUrl, 'function']);
	h.lastFiles3Config.onUnauthorized('/mnt/s3');
	check('which says so', h.notes.map(n => [n.level, n.title]), [['warn', 'Files3 session expired']]);

	// Raced, so a reconnect that starts a second mount and waits on it fails this check rather
	// than hanging the file.
	const again = await Promise.race([
		h.table.reconnect('/mnt/s3'),
		new Promise(resolve => setTimeout(() => resolve('still waiting'), 50))
	]);
	check('one being tried can be neither reconnected nor forgotten',
		[again, h.table.forget('/mnt/s3'), h.calls.length],
		[{mounted: false, status: 'restoring', error: null}, false, 2]);

	h.held['/mnt/s3']();
	check('and when the server answers, it is mounted',
		[await within(h.table.settled()), h.manager.isMountPoint('/mnt/s3'), statuses(h)], ['settled', true, []]);
}

{
	// Refused for its token: the Files3 backend clears the token when the server says 401, which
	// this fake does by hand.
	const h = harness({doc: doc(files3Rec), tokens: [FILES3.localStorageId], failing: {'/mnt/s3': new Error('401')}});
	const mountFiles3 = h.manager.mountFiles3;
	h.manager.mountFiles3 = (config, mp, name, cb) => { h.tokens.delete(config.localStorageId); mountFiles3(config, mp, name, cb); };
	await h.table.restore();
	await h.table.settled();
	check('a storage refused for its token waits for a sign-in, and is not a failure',
		[statuses(h), h.notes], [[['/mnt/s3', 'needs-sign-in']], []]);

	const g = harness({doc: doc(files3Rec), tokens: [FILES3.localStorageId], failing: {'/mnt/s3': new Error('Failed to fetch')}});
	await g.table.restore();
	await g.table.settled();
	check('one that could not be reached, token intact, did fail', statuses(g), [['/mnt/s3', 'failed']]);
}

{
	const h = harness({readThrows: true});
	check('a table that cannot be read restores nothing, and says so in the log',
		[await h.table.restore(), h.logs], [[], ['Could not read the mount table']]);
}

{
	// IndexedDB was cleared, or the handle never got there: the document names a folder the
	// browser no longer has.
	const h = harness({doc: doc(nativeRec('/mnt/lost', 'lost'))});
	await h.table.restore();
	check('a folder whose handle was not kept did not come back, and says why in words',
		h.table.list().map(w => [w.status, w.reason]), [['failed', 'the browser did not keep this folder']]);
}

{
	const h = harness({doc: doc(zipRec('/mnt/a', '/home/a.zip'))});
	h.manager.mountZipFile('/home/a.zip', '/mnt/a', 'a.zip', () => {});
	await h.table.restore();
	check('a mount point already in use is not restored over, nor listed as waiting',
		[h.calls.length, statuses(h)], [1, []]);
}

// --- writing -----------------------------------------------------------------------------------------

{
	const h = harness({doc: doc(nativeRec('/mnt/old', 'old')), handles: {'/mnt/old': folderHandle('old', 'prompt')}});
	h.manager.mountZipFile('/home/early.zip', '/mnt/early', 'early.zip', () => {});
	await h.table.written();
	check('a mount made before the table is read writes nothing -- it would write over the table about to be restored',
		h.writes, []);
	await h.table.restore();
	await h.table.written();
	check('and it is written once the table has been read, beside what was already there',
		points(last(h)), ['/mnt/early', '/mnt/old']);
}

{
	const h = harness({
		doc: doc(zipRec('/mnt/a', '/home/a.zip'), nativeRec('/mnt/work', 'work')),
		handles: {'/mnt/work': folderHandle('work', 'granted')}
	});
	await h.table.restore();
	await h.table.written();
	h.manager.umount('/mnt/work');
	await h.table.written();
	check('an unmount takes a mount out of the table', points(last(h)), ['/mnt/a']);
	check('and its handle out of IndexedDB', [...h.store.keys()], []);
}

{
	const h = harness({
		owner: false,
		doc: doc(zipRec('/mnt/a', '/home/a.zip'), nativeRec('/mnt/work', 'work')),
		handles: {'/mnt/work': folderHandle('work', 'granted')}
	});
	await h.table.restore();
	h.manager.umount('/mnt/a');
	h.manager.umount('/mnt/work');
	await h.table.written();
	check('a follower tab restores what is written', h.calls.map(c => c[2]), ['/mnt/a', '/mnt/work']);
	check('and writes nothing, not even an unmount -- the tab that owns the settings does',
		[h.writes, [...h.store.keys()]], [[], ['/mnt/work']]);
}

{
	const h = harness({brokenHandles: true});
	await h.table.restore();
	h.manager.mountZipFile('/home/a.zip', '/mnt/a', 'a.zip', () => {});
	h.manager.mountNativeDir(folderHandle('work'), '/mnt/work', 'work', () => {});
	await h.table.written();
	check('a handle store that will not open costs the folder its handle, not the zip its place in the table',
		points(last(h)), ['/mnt/a', '/mnt/work']);
	check('and says so', h.logs.includes('Could not keep a local folder handle'), true);
}

{
	const h = harness({doc: doc(nativeRec('/mnt/old', 'old')), handles: {'/mnt/old': folderHandle('old', 'prompt')}});
	await h.table.restore();
	h.manager.mountZipFile('/home/b.zip', '/mnt/old', 'b.zip', () => {});
	await h.table.written();
	check('something mounted where a waiting one would go takes its place',
		[statuses(h), last(h).mounts], [[], [zipRec('/mnt/old', '/home/b.zip')]]);
	check('and the waiting one\'s handle goes with it', [...h.store.keys()], []);
	h.manager.umount('/mnt/old');
	await h.table.written();
	check('so unmounting what replaced it does not bring the waiting one back',
		[statuses(h), points(last(h))], [[], []]);
}

// --- reconnecting, from a click in Explorer ----------------------------------------------------------

{
	const old = folderHandle('old', 'prompt', 'granted');
	const h = harness({doc: doc(nativeRec('/mnt/old', 'old')), handles: {'/mnt/old': old}});
	await h.table.restore();
	const before = h.announced.length;
	const running = h.table.reconnect('/mnt/old');
	check('reconnecting a folder asks the browser at once, before anything is awaited', old.asked, 1);
	check('and shows it being tried meanwhile', statuses(h), [['/mnt/old', 'restoring']]);
	const result = await running;
	check('granted, it mounts', [result, h.calls, statuses(h)],
		[{mounted: true, status: null, error: null}, [['native', 'old', '/mnt/old', 'old']], []]);
	check('and Explorer heard each step -- being tried, then mounted', h.announced.length - before, 2);
}

{
	// The browser's question is still open when something else is mounted at the same point.
	const old = folderHandle('old', 'prompt');
	old.requestPermission = () => { old.asked++; return new Promise(() => {}); };
	const h = harness({doc: doc(nativeRec('/mnt/old', 'old')), handles: {'/mnt/old': old}});
	await h.table.restore();
	h.table.reconnect('/mnt/old');
	h.manager.mountZipFile('/home/b.zip', '/mnt/old', 'b.zip', () => {});
	check('a point that is mounted is never also listed as waiting, even in the middle of a reconnect',
		statuses(h), []);
}

{
	const old = folderHandle('old', 'prompt', 'denied');
	const h = harness({doc: doc(nativeRec('/mnt/old', 'old')), handles: {'/mnt/old': old}});
	await h.table.restore();
	const result = await h.table.reconnect('/mnt/old');
	check('refused, it waits again, and nothing is wrong',
		[result, statuses(h), h.calls], [{mounted: false, status: 'needs-permission', error: null}, [['/mnt/old', 'needs-permission']], []]);
}

{
	const h = harness({doc: doc(files3Rec)});
	await h.table.restore();
	const running = h.table.reconnect('/mnt/s3');
	check('signing in starts the mount inside the click, where its popup is allowed to open',
		h.calls, [['files3', FILES3.baseUrl, '/mnt/s3', 's.example']]);
	check('and mounts', (await running).mounted, true);
}

{
	const h = harness({doc: doc(zipRec('/mnt/gone', '/home/gone.zip')), failing: {'/mnt/gone': new Error('ENOENT')}});
	await h.table.restore();
	const again = await h.table.reconnect('/mnt/gone');
	check('a failed one is tried again, and a second failure says why',
		[h.calls.length, again.mounted, again.status, again.error.message], [2, false, 'failed', 'ENOENT']);
	delete h.failing['/mnt/gone'];
	const third = await h.table.reconnect('/mnt/gone');
	check('and once the file is back, it mounts', [third.mounted, statuses(h)], [true, []]);
}

{
	const h = harness({
		doc: doc(nativeRec('/mnt/old', 'old'), zipRec('/mnt/a', '/home/a.zip')),
		handles: {'/mnt/old': folderHandle('old', 'prompt')}
	});
	await h.table.restore();
	await h.table.written();
	check('forgetting a waiting mount', h.table.forget('/mnt/old'), true);
	await h.table.written();
	check('takes it off the list, out of the table and out of IndexedDB',
		[statuses(h), points(last(h)), [...h.store.keys()]], [[], ['/mnt/a'], []]);
	check('and what is not waiting cannot be forgotten -- that is an unmount',
		[h.table.forget('/mnt/a'), h.table.forget('/mnt/nothing')], [false, false]);
}

// --- js/mount-manager.js: a mount that knows where it came from ---------------------------------------

{
	const source = read('js/mount-manager.js');
	const sandbox = {};
	new Function('window', 'navigator', source)(sandbox, {});
	const files = {'/home/a.zip': 'ZIPBYTES', '/home/d.iso': 'ISOBYTES'};
	const rooted = [];
	const changes = [];
	const bfs = {FileSystem: {
		ZipFS: {Create: (o, cb) => cb(null, {kind: 'zip', data: o.zipData})},
		IsoFS: {Create: (o, cb) => cb(null, {kind: 'iso', data: o.data})},
		FileSystemAccess: {Create: (o, cb) => cb(null, {kind: 'native', data: o.handle.name})}
	}};
	const fakeFs = {
		readFile: (p, cb) => (p in files ? cb(null, files[p]) : cb(new Error('ENOENT: ' + p))),
		stat: (p, cb) => cb(null, {isDirectory: () => true}),
		mkdir: (p, cb) => cb(null),
		getRootFS: () => ({mount: (mp, f) => rooted.push([mp, f.kind, f.data]), umount: () => {}})
	};
	const mm = new sandbox.MountManager(bfs, fakeFs);
	mm.onChange = list => changes.push(list.slice());

	const answers = [];
	mm.mountZipFile('/home/a.zip', '/mnt/a', 'a.zip', err => answers.push(err));
	mm.mountIsoFile('/home/d.iso', '/mnt/d', 'd.iso', err => answers.push(err));
	check('a zip and an iso are mounted from the file they are named by',
		[answers, rooted], [[null, null], [['/mnt/a', 'zip', 'ZIPBYTES'], ['/mnt/d', 'iso', 'ISOBYTES']]]);
	check('and each record says which file',
		[mm.getMountInfo('/mnt/a'), mm.getMountInfo('/mnt/d').source],
		[{type: 'zip', name: 'a.zip', readOnly: true, source: '/home/a.zip'}, '/home/d.iso']);
	check('announcing the whole table each time', changes, [['/mnt/a'], ['/mnt/a', '/mnt/d']]);
	check('while listMounts says exactly what it always said',
		mm.listMounts()[0], {mountPoint: '/mnt/a', type: 'zip', name: 'a.zip', readOnly: true});

	mm.mountZip('BYTES', '/mnt/b', 'b.zip', () => {});
	check('from bytes, the record names no file -- so the table cannot keep it',
		toRecord('/mnt/b', mm.getMountInfo('/mnt/b')), null);

	mm.mountZipFile('/home/missing.zip', '/mnt/m', 'missing.zip', err => answers.push(err && err.message));
	check('a file that is not there is an answer, not a mount',
		[answers[answers.length - 1], mm.isMountPoint('/mnt/m')], ['ENOENT: /home/missing.zip', false]);
	files['/home/missing.zip'] = 'LATE';
	mm.mountZipFile('/home/missing.zip', '/mnt/m', 'missing.zip', () => {});
	check('and leaves nothing half-started: the same mount point works once the file exists',
		mm.isMountPoint('/mnt/m'), true);

	const work = {name: 'work'};
	mm.mountNativeDir(work, '/mnt/w', 'work', () => {});
	check('a local folder keeps its handle, which is the part that can be written down',
		mm.getMountInfo('/mnt/w').handle === work, true);
}

// --- where the shell calls it ---------------------------------------------------------------------------

{
	const shell = read('index.html');
	const builtAt = shell.indexOf('window.mountTable = createMountTable(');
	check('the table is built in the shell, after the mount manager it reads',
		builtAt > shell.indexOf('new MountManager('), true);
	check('and hears every change from the one place they all pass through',
		/knownMounts = now\.slice\(\);\s*\n(\s*\/\/[^\n]*\n)*\s*window\.mountTable\.changed\(\);/.test(shell), true);
	const restoreAt = shell.indexOf('await window.mountTable.restore()');
	check('mounts are restored before the session reopens any window',
		restoreAt > -1 && restoreAt < shell.indexOf('await initSession();'), true);
	check('a Files3 token is looked for in localStorage during boot, never fetched',
		/return !!localStorage\.getItem\(config\.localStorageId\)/.test(shell), true);
	check('and only the tab that owns the settings writes the table',
		/canWrite: function \(\) \{ return tabs\.isOwner\(\); \}/.test(shell.slice(builtAt, builtAt + 2000)), true);

	const terminal = read('apps/terminal/index.html');
	const explorer = read('apps/explorer/js/mounts.js');
	check('the terminal and Explorer both mount archives by path, the only kind that can be kept', [
		/mountManager\.mount(Zip|Iso)\(/.test(terminal), /mountManager\.mount(Zip|Iso)\(/.test(explorer),
		/mountManager\.mountZipFile\(/.test(terminal), /mountManager\.mountZipFile\(/.test(explorer)
	], [false, false, true, true]);
}

report('mount-table');
