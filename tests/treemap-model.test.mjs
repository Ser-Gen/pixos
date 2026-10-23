// Disk Treemap's model (apps/treemap): the tree, measuring PixOS's filesystem through a fake `fs`
// with real asynchrony, reading a picked folder, the file kinds, and the words the page says.
// What it has to get right: sizes and counts summed upwards and sorted, many requests in flight but
// never more than asked, one unreadable entry costing only itself, mounts below the folder left out,
// a stop that stops, paths worked out from parents, and opening a file the right way for where it
// came from.

import {check, report} from './assert.mjs';

const tree = await import('../apps/treemap/js/tree.js');
const kinds = await import('../apps/treemap/js/kinds.js');
const format = await import('../apps/treemap/js/format.js');
const pixos = await import('../apps/treemap/js/scan-pixos.js');
const local = await import('../apps/treemap/js/scan-local.js');
const view = await import('../apps/treemap/js/view.js');
const open = await import('../apps/treemap/js/open-file.js');

const names = (node) => node.kids.map((kid) => kid.name);

// --- kinds -----------------------------------------------------------------------------------------

check('an extension is the part after the last dot, lower-cased', ['a.TAR.GZ', 'photo.JPG', 'Makefile', '.bashrc', 'x.', 'a.b', 'notes..'].map(kinds.extensionOf),
	['gz', 'jpg', '', '', '', 'b', '']);
check('kinds by extension', ['app.js', 'a.json', 'b.pdf', 'c.png', 'd.mkv', 'e.flac', 'f.zip', 'g.wasm', 'h.xyz', 'README'].map(kinds.kindOf),
	['code', 'data', 'document', 'image', 'video', 'audio', 'archive', 'binary', 'other', 'other']);
check('every kind has its paint and its label', kinds.KINDS.map((k) => [!!kinds.PAINT[k.id].fill, !!kinds.PAINT[k.id].ink, typeof kinds.LABEL[k.id]]),
	kinds.KINDS.map(() => [true, true, 'string']));
check('the two greys are grey: their fill, edge, ink and swatch at most 10% saturated, the rest more',
	kinds.KINDS.map((k) => ['fill', 'edge', 'ink', 'dim', 'swatch'].every((part) => (Number(kinds.PAINT[k.id][part].split(',')[1].replace('%', '')) <= 10) === !!k.grey)),
	kinds.KINDS.map(() => true));
check('and they are the binaries and the rest', kinds.KINDS.filter((k) => k.grey).map((k) => k.id), ['binary', 'other']);
check('no kind is painted magenta, the colour that means the one under the pointer',
	kinds.KINDS.filter((k) => !k.grey && k.hue >= 300 && k.hue <= 345).length, 0);
check('no extension is in two kinds (the later list would win without saying)', (() => {
	const all = Object.values(kinds.EXTENSIONS).flatMap((list) => list.split(' '));
	return all.filter((ext, i) => all.indexOf(ext) !== i);
})(), []);
check('every listed kind is a kind', Object.keys(kinds.EXTENSIONS).every((id) => kinds.LABEL[id]), true);

// --- format ---------------------------------------------------------------------------------------

check('bytes', [0, -5, NaN, 1, 1023, 1024, 1536, 10 * 1024, 100 * 1024 * 1024, 5 * 1024 ** 4, 3 * 1024 ** 5].map(format.formatBytes),
	['0 B', '0 B', '0 B', '1 B', '1023 B', '1.00 KB', '1.50 KB', '10.0 KB', '100 MB', '5.00 TB', '3072 TB']);
check('a share', [[1, 0], [0, 10], [50, 100], [5, 100], [1, 1000], [1, 1000000]].map(([a, b]) => format.formatPercent(a, b)),
	['0%', '0%', '50.0%', '5.00%', '0.100%', '<0.01%']);
check('a share at each step\'s edge', [[10, 100], [1, 100], [1, 10000]].map(([a, b]) => format.formatPercent(a, b)), ['10.0%', '1.00%', '0.010%']);
check('counts and plurals', [format.formatCount(1234567), format.plural(1, 'file', 'files'), format.plural(2, 'file', 'files'), format.plural(0, 'file', 'files')],
	['1,234,567', '1 file', '2 files', '0 files']);
check('durations', [format.formatDuration(12.4), format.formatDuration(999), format.formatDuration(1234), format.formatDuration(12345)],
	['12 ms', '999 ms', '1.23 s', '12.3 s']);
check('durations at each step\'s edge, and whole seconds', [1000, 8000, 10000].map(format.formatDuration), ['1.00 s', '8.00 s', '10.0 s']);

// --- the tree ---------------------------------------------------------------------------------------

function sample() {
	const root = tree.folder('proj');
	const src = tree.childFolder(root, 'src');
	tree.addFile(src, 'a.js', 300);
	tree.addFile(src, 'b.js', 100);
	const deep = tree.childFolder(tree.childFolder(src, 'lib'), 'deep');
	tree.addFile(deep, 'c.png', 1000);
	tree.addFile(root, 'README.md', 50);
	tree.addFile(root, 'neg', -7);
	tree.childFolder(root, 'empty');
	return tree.finish(root);
}
check('a folder is empty until finished', (({size, files, folders, kids}) => [size, files, folders, kids])(tree.folder('x')), [0, 0, 0, []]);
{
	const root = sample();
	check('sizes summed upwards', [root.size, root.kids[0].size], [1450, 1400]);
	check('files and folders counted, empty folders as folders', [root.files, root.folders], [5, 4]);
	check('children sorted largest first', names(root), ['src', 'README.md', 'neg', 'empty']);
	check('and inside', names(root.kids[0]), ['lib', 'a.js', 'b.js']);
	check('a negative size is none', root.kids[2].size, 0);
	check('a file is a node with no kids', [tree.isFolder(root.kids[1]), tree.isFolder(root.kids[3]), tree.isFolder(null)], [false, true, false]);
	check('the name maps are dropped once finished', [root.byName, root.kids[0].byName], [null, null]);
	check('asking twice for one folder gives the same one', (() => {
		const r = tree.folder('r');
		return tree.childFolder(r, 'x') === tree.childFolder(r, 'x') && r.kids.length === 1;
	})(), true);
	const png = root.kids[0].kids[0].kids[0].kids[0];
	check('names from the root down', tree.namesOf(png), ['proj', 'src', 'lib', 'deep', 'c.png']);
	check('ancestors, root first', tree.ancestorsOf(png).map((n) => n.name), ['proj', 'src', 'lib', 'deep', 'c.png']);
	check('the root of anything', tree.rootOf(png) === root, true);
	check('contains', [tree.contains(root.kids[0], png), tree.contains(root.kids[1], png), tree.contains(png, png)], [true, false, true]);
	check('a path on PixOS is the measured folder plus the names below it', (() => {
		root.fsPath = '/home';
		const a = tree.fsPathOf(png);
		const b = tree.fsPathOf(root);
		root.fsPath = '/';
		const c = tree.fsPathOf(png);
		const d = tree.fsPathOf(root);
		delete root.fsPath;
		return [a, b, c, d, tree.fsPathOf(root.kids[1])];
	})(), ['/home/src/lib/deep/c.png', '/home', '/src/lib/deep/c.png', '/', '/README.md']);

	const kindOf = (name) => kinds.kindOf(name);
	check('bytes per kind under a folder', root.kids[0] && tree.kindTotals(root, kindOf), {document: 50, other: 0, code: 400, image: 1000});
	check('kept, and handed back the next time', tree.kindTotals(root, kindOf) === tree.kindTotals(root, kindOf), true);
	check('a file is its own kind', tree.kindTotals(root.kids[1], kindOf), {document: 50});
}
{
	// A very deep tree must not run out of stack.
	const root = tree.folder('r');
	let at = root;
	for (let i = 0; i < 20000; i++) at = tree.childFolder(at, 'd' + i);
	tree.addFile(at, 'leaf', 7);
	tree.finish(root);
	check('twenty thousand folders deep: summed without recursion', [root.size, root.folders, root.files], [7, 20000, 1]);
}
{
	const a = tree.finish((() => { const r = tree.folder('photos'); tree.addFile(r, '1.jpg', 10); return r; })());
	const b = tree.finish((() => { const r = tree.folder('photos'); tree.addFile(r, '2.jpg', 30); return r; })());
	const c = tree.finish((() => { const r = tree.folder('music'); tree.addFile(r, '3.mp3', 5); return r; })());
	const ab = tree.combine(a, b);
	const kindOf = (name) => kinds.kindOf(name);
	check('bytes per kind before a third folder joins', tree.kindTotals(ab, kindOf), {image: 40});
	check('two picked folders join under one root, the same name told apart', [ab.name, ab.combined, names(ab), ab.size, ab.files], ['Selected folders', true, ['photos (2)', 'photos'], 40, 2]);
	check('each knows its new parent', [a.parent === ab, b.parent === ab], [true, true]);
	const abc = tree.combine(ab, c);
	check('a third joins the same root', [abc === ab, names(abc), abc.size, abc.folders], [true, ['photos (2)', 'photos', 'music'], 45, 3]);
	check('and the bytes per kind kept from before are worked out again', tree.kindTotals(abc, kindOf), {audio: 5, image: 40});
	const d = tree.finish((() => { const r = tree.folder('photos'); tree.addFile(r, '4.jpg', 1); return r; })());
	check('and a third of one name is (3)', names(tree.combine(abc, d)).includes('photos (3)'), true);
}

// --- a picked folder ---------------------------------------------------------------------------------

{
	const files = [
		{name: 'a.js', size: 10, webkitRelativePath: 'proj/src/a.js'},
		{name: 'b.js', size: 20, webkitRelativePath: 'proj/src/b.js'},
		{name: 'top.txt', size: 5, webkitRelativePath: 'proj/top.txt'},
		{name: 'odd', size: 1, webkitRelativePath: 'proj//odd'},
	];
	check('the root is named after the picked folder', [local.rootNameOf(files), local.rootNameOf([{name: 'x'}])], ['proj', 'Folder']);
	check('the first path that names a folder names it, however short', [local.rootNameOf([{name: 'a'}, {webkitRelativePath: '/a'}, {webkitRelativePath: 'p/a'}]),
		local.rootNameOf([{webkitRelativePath: 'q/a'}, {webkitRelativePath: 'r/b'}])], ['p', 'q']);
	const seen = [];
	const root = await local.scanFiles(files, {onProgress: (p) => seen.push(p)});
	check('the picked folder is the root, not a folder inside it', [root.name, names(root)], ['proj', ['src', 'top.txt', 'odd']]);
	check('sizes and counts', [root.size, root.files, root.folders, root.kids[0].size], [36, 4, 1, 30]);
	check('each file carries its File, to be opened later', root.kids[0].kids[1].file === files[0], true);
	check('progress said where it got to', seen[seen.length - 1], {files: 4, total: 4, bytes: 36});
	check('nothing picked is nothing', await local.scanFiles([]), null);
	check('a file with no folder lands in the root', names(await local.scanFiles([{name: 'solo.bin', size: 3}])), ['solo.bin']);

	// Big enough to need more than one slice, so the stop is looked at.
	const many = Array.from({length: 200000}, (_, i) => ({name: i + '.x', size: 1, webkitRelativePath: 'big/d' + (i % 50) + '/' + i + '.x'}));
	let asked = 0;
	const stopped = await local.scanFiles(many, {stopped: () => ++asked > 0});
	check('a stopped read gives nothing back', [stopped, asked > 0], [null, true]);
	const all = await local.scanFiles(many);
	check('and one not stopped reads them all', [all.files, all.folders, all.size], [200000, 50, 200000]);
}
{
	// Slices by the clock handed in: 4 ms a file against a slice of 12 makes three files a slice.
	const ten = Array.from({length: 10}, (_, i) => ({name: i + '.x', size: 1, webkitRelativePath: 'p/' + i + '.x'}));
	let clock = 0;
	const seen = [];
	const scan = local.scanFiles(ten, {now: () => (clock += 4), onProgress: (p) => seen.push(p.files)});
	const before = seen.slice();
	await scan;
	check('a slice ends once 12 ms have gone, and the browser is given its turn before the next', [before, seen], [[3], [3, 6, 9, 10]]);
	check('a read that fits in one slice is never asked whether it was stopped', (await local.scanFiles(ten.slice(0, 2), {stopped: () => true})).files, 2);
}

// --- PixOS's filesystem ---------------------------------------------------------------------------

// A filesystem of plain objects whose callbacks come later, as IndexedDB's do. `active` and `peak`
// count calls in flight.
function fakeFs(layout, {fail = new Set(), delay = (cb) => setImmediate(cb)} = {}) {
	const fsys = {active: 0, peak: 0, calls: 0};
	const lookup = (p) => {
		if (p === '/') return layout;
		let at = layout;
		for (const part of p.split('/').filter(Boolean)) {
			if (!at || typeof at !== 'object' || !(part in at)) return undefined;
			at = at[part];
		}
		return at;
	};
	const begin = () => {
		fsys.active++;
		fsys.calls++;
		fsys.peak = Math.max(fsys.peak, fsys.active);
	};
	fsys.stat = (p, cb) => {
		begin();
		delay(() => {
			fsys.active--;
			const at = lookup(p);
			if (fail.has(p) || at === undefined) return cb(Object.assign(new Error('ENOENT ' + p), {code: 'ENOENT'}));
			cb(null, {size: typeof at === 'number' ? at : 4096, isDirectory: () => typeof at === 'object'});
		});
	};
	fsys.readdir = (p, cb) => {
		begin();
		delay(() => {
			fsys.active--;
			const at = lookup(p);
			if (fail.has('readdir:' + p) || typeof at !== 'object') return cb(new Error('ENOTDIR ' + p));
			cb(null, Object.keys(at));
		});
	};
	return fsys;
}

check('paths normalized', ['', '  ', 'home', '/home/', '//home//x/./y', '/'].map(pixos.normalizePath), ['/', '/', '/home', '/home', '/home/x/y', '/']);
check('joined', [pixos.joinPath('/', 'a'), pixos.joinPath('/a', 'b')], ['/a', '/a/b']);
check('mounts strictly below a folder', [pixos.mountsBelow('/', ['/mnt/a', '/mnt/b', '/']), pixos.mountsBelow('/mnt', ['/mnt/a', '/mnta']),
	pixos.mountsBelow('/mnt/a', ['/mnt/a', '/mnt/a/x'])], [['/mnt/a', '/mnt/b'], ['/mnt/a'], ['/mnt/a/x']]);
check('no shell, no filesystem and no mounts', [pixos.getPixosFs(globalThis), pixos.getPixosFs(null), pixos.listMountPoints(null)], [null, null, []]);
check('a shell\'s filesystem and mount points', [!!pixos.getPixosFs({fs: {readdir () {}}}),
	pixos.listMountPoints({mountManager: {listMounts: () => [{mountPoint: '/mnt/x'}, {}]}})], [true, ['/mnt/x']]);
check('a filesystem with no readdir is none, and a window is not its own shell', [pixos.getPixosFs({fs: {}}), (() => {
	globalThis.fs = {readdir () {}};
	try { return pixos.getPixosFs(globalThis); } finally { delete globalThis.fs; }
})()], [null, null]);
check('a shell whose mount list throws has none', pixos.listMountPoints({mountManager: {listMounts () { throw new Error('x'); }}}), []);

{
	// The pool: never more than the limit at once, and every job run, in order of arrival.
	const run = pixos.makePool(3);
	let active = 0;
	let peak = 0;
	const started = [];
	const job = (i) => run(() => {
		started.push(i);
		active++;
		peak = Math.max(peak, active);
		return new Promise((resolve) => setTimeout(() => { active--; resolve(i * 10); }, 1));
	});
	const results = await Promise.all(Array.from({length: 10}, (_, i) => job(i)));
	check('the pool runs at most its limit at once, and fills it', peak, 3);
	check('and runs every job in the order it was asked', [started, results], [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]]);
	const failing = await run(() => Promise.reject(new Error('no'))).catch((e) => e.message);
	check('a job that fails rejects its own promise and frees its place', [failing, await run(() => Promise.resolve('next'))], ['no', 'next']);
}

const disk = {
	home: {user: {'a.txt': 100, 'b.png': 5000, docs: {'c.pdf': 700}}},
	apps: {x: {'index.html': 40}},
	mnt: {usb: {'huge.iso': 999999}},
	'top.log': 3,
};
{
	const fsys = fakeFs(disk);
	const result = await pixos.scanPixos({fs: fsys, path: '/', inFlight: 4});
	const root = result.root;
	check('measured from /', [root.name, root.fsPath, root.size, root.files, root.folders], ['/', '/', 5843 + 999999, 6, 7]);
	check('largest first, all the way down', [names(root), names(root.kids[0])], [['mnt', 'home', 'apps', 'top.log'], ['usb']]);
	check('never more in flight than asked, and more than one', [fsys.peak <= 4, fsys.peak > 1], [true, true]);
	check('a path worked out from the tree', tree.fsPathOf(root.kids[1].kids[0].kids[1].kids[0]), '/home/user/docs/c.pdf');
	check('nothing unreadable, no mount', [result.unreadable, result.mounts], [0, []]);
}
{
	const fsys = fakeFs(disk);
	const result = await pixos.scanPixos({fs: fsys, path: '/', mounts: ['/mnt/usb', '/gone/x']});
	check('a mount below the folder is left out, and named; one under a folder that is not there is not met', [result.root.size, names(result.root.kids.find((k) => k.name === 'mnt')), result.mounts],
		[5843, [], ['/mnt/usb']]);
	const inside = await pixos.scanPixos({fs: fakeFs(disk), path: '/mnt/usb', mounts: ['/mnt/usb']});
	check('measuring the mount point itself measures the mount', [inside.root.name, inside.root.size, inside.mounts], ['usb', 999999, []]);
}
{
	const fsys = fakeFs(disk, {fail: new Set(['/home/user/b.png', 'readdir:/apps/x'])});
	const result = await pixos.scanPixos({fs: fsys, path: '/home/'});
	check('measured from a folder below /', [result.root.name, result.root.fsPath], ['home', '/home']);
	check('one entry that cannot be read costs only itself, and is counted', [result.root.size, result.unreadable], [800, 1]);
	const apps = await pixos.scanPixos({fs: fakeFs(disk, {fail: new Set(['readdir:/apps/x'])}), path: '/apps'});
	check('a folder that cannot be listed is there, empty, and counted', [names(apps.root), apps.root.kids[0].size, apps.unreadable], [['x'], 0, 1]);
}
{
	const refused = await pixos.scanPixos({fs: fakeFs(disk), path: '/top.log'}).catch((e) => e.message);
	check('a file is not a folder to measure', refused, '/top.log is not a folder');
	const missing = await pixos.scanPixos({fs: fakeFs(disk), path: '/nope'}).catch((e) => e.code);
	check('a folder that is not there rejects with the filesystem\'s own error', missing, 'ENOENT');
}
{
	let stop = false;
	const fsys = fakeFs(disk);
	let calls = 0;
	const result = await pixos.scanPixos({fs: fsys, path: '/', stopped: () => (++calls > 3 ? (stop = true) : false)});
	check('a stopped scan gives no tree, and stops asking', [result.root, fsys.calls < 12], [null, true]);
	// Stopped once three calls are made: the start, /'s listing, and home's stat — which, answered
	// after the stop, is not walked into.
	const exact = fakeFs(disk);
	const none = await pixos.scanPixos({fs: exact, path: '/', stopped: () => exact.calls >= 3});
	check('nothing is asked once stopped, not even of a folder whose stat was already on its way', [none.root, exact.calls], [null, 3]);
}
{
	// Progress: at most every 100 ms by the clock handed in, and once more at the end.
	let clock = 0;
	const seen = [];
	// 60 a read: the start at 60, files at 120, 180 (120 since the start: reported) and 240 (60 since).
	await pixos.scanPixos({fs: fakeFs(disk), path: '/home', inFlight: 1, now: () => (clock += 60), onProgress: (p) => seen.push(p)});
	check('progress is reported once 100 ms have passed, not on every file, and finally with the totals',
		[seen.length, seen[0].files, seen[1]], [2, 2, {files: 3, bytes: 5800, at: '/home'}]);
	// 50 a read: the start at 50, files at 100, 150 (exactly 100 since: reported) and 200.
	clock = 0;
	const edge = [];
	await pixos.scanPixos({fs: fakeFs(disk), path: '/home', inFlight: 1, now: () => (clock += 50), onProgress: (p) => edge.push(p.files)});
	check('exactly 100 ms is enough', edge, [2, 3]);
}

{
	// BrowserFS's key-value backend, read directly. Its methods take a transaction that, like
	// IndexedDB's, is active only while it is being created and while one of its callbacks runs:
	// a request made at any other time throws, as IndexedDB's TransactionInactiveError does.
	function fakeKv(layout, {fail = new Set(), mountedAt = null, locked = false} = {}) {
		const fsys = fakeFs(layout);
		// `open` counts transactions not yet done: one is done once a callback leaves nothing asked of it.
		const kv = {transactions: 0, lookups: 0, inodes: 0, inactive: 0, open: 0, peak: 0};
		const ids = new Map();
		const nodes = new Map();
		let next = 0;
		const add = (at, path) => {
			const id = 'id' + next++;
			ids.set(path, id);
			nodes.set(id, {at, path});
			if (typeof at === 'object') for (const name of Object.keys(at)) add(at[name], (path === '/' ? '' : path) + '/' + name);
			return id;
		};
		add(layout, '/');
		const inodeOf = (id) => {
			const {at} = nodes.get(id);
			return {id, size: typeof at === 'number' ? at : 4096, isDirectory: () => typeof at === 'object'};
		};
		const later = (tx, cb) => setImmediate(() => {
			tx.active = true;
			try { cb(); } finally {
				tx.active = false;
				if (--tx.asked === 0) kv.open--;
			}
		});
		const live = (tx) => {
			if (!tx.active) { kv.inactive++; throw new Error('TransactionInactiveError'); }
			tx.asked++;
		};
		const backend = {
			store: {beginTransaction (mode) {
				kv.transactions++;
				kv.peak = Math.max(kv.peak, ++kv.open);
				const tx = {mode, active: true, asked: 0};
				setImmediate(() => { tx.active = false; });
				return tx;
			}},
			findINode (tx, path, cb) {
				live(tx);
				kv.lookups++;
				later(tx, () => ids.has(path) ? cb(null, inodeOf(ids.get(path))) : cb(Object.assign(new Error('ENOENT'), {code: 'ENOENT'})));
			},
			getDirListing (tx, path, inode, cb) {
				live(tx);
				const {at} = nodes.get(inode.id);
				later(tx, () => fail.has('list:' + path) ? cb(new Error('EIO')) : typeof at === 'object'
					? cb(null, Object.fromEntries(Object.keys(at).map((name) => [name, ids.get((path === '/' ? '' : path) + '/' + name)])))
					: cb(new Error('ENOTDIR')));
			},
			getINode (tx, path, id, cb) {
				live(tx);
				kv.inodes++;
				later(tx, () => fail.has(nodes.get(id).path) ? cb(new Error('ENOENT')) : cb(null, inodeOf(id)));
			},
		};
		const mounted = locked ? {getFSUnlocked: () => backend} : backend;
		fsys.getRootFS = () => ({_getFs: (p) => mountedAt && (p === mountedAt || p.startsWith(mountedAt + '/'))
			? {fs: {other: true}, path: p.slice(mountedAt.length) || '/'}
			: {fs: mounted, path: p}});
		fsys.kv = kv;
		return fsys;
	}

	const fsys = fakeKv(disk);
	const result = await pixos.scanPixos({fs: fsys, path: '/', inFlight: 4});
	check('read directly: the same tree as through stat', [result.root.size, result.root.files, result.root.folders, names(result.root), names(result.root.kids[1])],
		[5843 + 999999, 6, 7, ['mnt', 'home', 'apps', 'top.log'], ['user']]);
	check('one transaction per folder, a path looked up once, and fs asked only whether the start is a folder',
		[fsys.kv.transactions, fsys.kv.lookups, fsys.kv.inodes, fsys.calls], [8, 1, 13, 1]);
	check('and nothing asked of a transaction after it closed', fsys.kv.inactive, 0);
	check('a scan that will not read directly reads through readdir and stat', await (async () => {
		const slow = fakeKv(disk);
		const r = await pixos.scanPixos({fs: slow, path: '/', direct: false});
		return [r.root.size, slow.kv.transactions, slow.calls];
	})(), [5843 + 999999, 0, 22]);
	check('a backend behind a lock is unwrapped', await (async () => {
		const locked = fakeKv(disk, {locked: true});
		const r = await pixos.scanPixos({fs: locked, path: '/home'});
		return [r.root.size, locked.kv.transactions, locked.kv.lookups];
	})(), [5800, 3, 1]);

	const odd = await pixos.scanPixos({fs: fakeKv({...disk, empty: {}}, {fail: new Set(['list:/apps/x'])}), path: '/'});
	check('read directly: an empty folder is there, and one whose listing cannot be read is there empty and counted',
		[names(odd.root).includes('empty'), odd.root.kids.find((k) => k.name === 'apps').kids[0].kids, odd.unreadable], [true, [], 1]);
	check('a backend missing any of the four is not read directly', [
		{store: {beginTransaction () {}}},
		{getDirListing () {}, getINode () {}},
		{getINode () {}},
		{store: {beginTransaction () {}}, findINode () {}, getDirListing () {}},
	].map((backend) => pixos.keyValueBackend({getRootFS: () => ({_getFs: () => ({fs: backend, path: '/'})})}, '/')), [null, null, null, null]);
	const below = fakeKv(disk, {fail: new Set(['/home/user/b.png'])});
	const home = await pixos.scanPixos({fs: below, path: '/home/'});
	check('read directly from a folder below /: an inode that cannot be read costs only itself', [home.root.name, home.root.size, home.unreadable], ['home', 800, 1]);

	const mounted = fakeKv(disk, {mountedAt: '/mnt/usb'});
	const left = await pixos.scanPixos({fs: mounted, path: '/', mounts: ['/mnt/usb', '/apps/drive']});
	check('a mount below is left out and named, also one the store under it has no folder for',
		[left.root.size, left.mounts, names(left.root.kids.find((k) => k.name === 'apps').kids[0])], [5843, ['/apps/drive', '/mnt/usb'], ['index.html']]);
	const usb = await pixos.scanPixos({fs: mounted, path: '/mnt/usb', mounts: ['/mnt/usb']});
	check('measuring a mount point that is not that store reads it through stat', [usb.root.size, mounted.kv.transactions], [999999, 7]);
	check('a filesystem with no root to ask, or one that throws, is read through stat', [pixos.keyValueBackend({}, '/'),
		pixos.keyValueBackend({getRootFS () { throw new Error('x'); }}, '/'), pixos.keyValueBackend({getRootFS: () => ({_getFs: () => ({fs: {store: {}}, path: '/'})})}, '/')], [null, null, null]);
	const wide = {};
	for (let i = 0; i < 20; i++) wide['d' + i] = {f: 1};
	const many = fakeKv(wide);
	await pixos.scanPixos({fs: many, path: '/'});
	const slow = fakeFs(Object.fromEntries(Array.from({length: 20}, (_, i) => ['f' + i, 1])));
	await pixos.scanPixos({fs: slow, path: '/'});
	check('unless told, FOLDERS_IN_FLIGHT folders read directly at once, and IN_FLIGHT calls through stat',
		[many.kv.peak, many.kv.open, slow.peak], [pixos.FOLDERS_IN_FLIGHT, 0, pixos.IN_FLIGHT]);
	check('which are not the same number', pixos.FOLDERS_IN_FLIGHT !== pixos.IN_FLIGHT, true);
	const gone = await pixos.scanPixos({fs: fakeKv(disk), path: '/home', stopped: (() => { let n = 0; return () => ++n > 2; })()});
	check('a stopped direct scan gives no tree', gone.root, null);
}

// --- what the page says ------------------------------------------------------------------------------

{
	const root = sample();
	root.fsPath = '/work';
	const src = root.kids[0];
	const png = src.kids[0].kids[0].kids[0];
	check('a root holding only a folder opens on it, and down', (() => {
		const r = tree.folder('r');
		tree.addFile(tree.childFolder(tree.childFolder(r, 'only'), 'inner'), 'f', 1);
		tree.finish(r);
		return view.startView(r).name;
	})(), 'inner');
	check('a root holding files opens on itself', view.startView(root) === root, true);
	check('the crumbs start with the folder measured', view.crumbs(png.parent).map((c) => c.label), ['/work', 'src', 'lib', 'deep']);
	check('and each is its node', view.crumbs(png.parent).map((c) => c.node.name), ['proj', 'src', 'lib', 'deep']);
	check('paths as shown', [view.displayPath(png), view.displayPath(root)], ['/work/src/lib/deep/c.png', '/work']);
	root.fsPath = '/';
	check('from /', view.displayPath(png), '/src/lib/deep/c.png');
	delete root.fsPath;
	check('a picked folder\'s path starts with its name', view.displayPath(png), 'proj/src/lib/deep/c.png');

	check('a file under the pointer', view.describe(src.kids[1], root, true),
		{name: 'a.js', meta: '300 B · 20.7% · code', hint: 'Click to open', line: 'proj/src/a.js · 300 B · 20.7% · code'});
	check('one that cannot be opened has no hint', view.describe(src.kids[1], root, false).hint, '');
	check('a folder', view.describe(src, root, false),
		{name: 'src', meta: '1.37 KB · 96.6% · 3 files', hint: 'Click to go in', line: 'proj/src · 1.37 KB · 96.6% · 3 files'});
	check('an empty folder cannot be gone into, one with one thing in it can', [view.canGoIn(root.kids[3]), view.canGoIn(src), view.canGoIn(null), view.canGoIn(src.kids[0].kids[0])], [false, true, false, true]);
	const restHere = {rest: true, parent: root, size: 20, count: 12, kids: null, name: ''};
	const restDeep = {rest: true, parent: src, size: 1, count: 1, kids: null, name: ''};
	check('the smaller items here', view.describe(restHere, root, false),
		{name: '12 smaller items', meta: '20 B · 1.38% · here', hint: '', line: '12 smaller items here · 20 B'});
	check('the smaller items in a folder inside', [view.describe(restDeep, root, false).name, view.describe(restDeep, root, false).hint], ['1 smaller item', 'Click to go into src']);
	check('the line under the title, at the root', view.summary(root, root, 1234), '1.42 KB · 5 files · 4 folders · measured in 1.23 s');
	check('and in a folder', view.summary(src, root, 1234), '1.37 KB · 3 files · 2 folders · 96.6% of proj');
	check('and before anything was timed', view.summary(root, root, null), '1.42 KB · 5 files · 4 folders');
	check('what was not measured', [view.notes({}), view.notes({unreadable: 1234, mounts: ['/mnt/a', '/mnt/b']})],
		['', 'Not measured: /mnt/a, /mnt/b (mounted) · 1,234 could not be read']);
}

// --- opening ---------------------------------------------------------------------------------------------

{
	const root = tree.folder('r');
	root.fsPath = '/home';
	const onDisk = tree.addFile(root, 'notes.bin', 1);
	const picked = tree.addFile(root, 'pic.png', 1, {name: 'pic.png', type: ''});
	const pickedBin = tree.addFile(root, 'blob.bin', 1, {name: 'blob.bin', type: ''});
	const pickedText = tree.addFile(root, 'blob.bin2', 1, {name: 'blob.bin2', type: 'text/x-weird'});
	const opened = [];
	const opener = (p) => opened.push(p);
	check('viewable in a tab', ['a.png', 'a.PDF', 'a.rs', 'a.zip', 'a'].map((n) => open.isViewable(n)), [true, true, true, false, false]);
	check('a file the browser calls text is viewable whatever its name', open.isViewable('x.zzz', {type: 'text/plain'}), true);
	check('types for a tab', [open.mimeOf('a.png'), open.mimeOf('a.rs'), open.mimeOf('a.zip'), open.mimeOf('a.png', {type: 'image/x'})],
		['image/png', 'text/plain', 'application/octet-stream', 'image/x']);
	check('a file on PixOS opens through the shell, whatever it is', [open.canOpen(onDisk, opener), open.canOpen(onDisk, null)], [true, false]);
	check('a picked file opens in a tab only if the browser can show it', [open.canOpen(picked, null), open.canOpen(pickedBin, opener), open.canOpen(pickedText, null)],
		[true, false, true]);
	check('folders and the smaller items do not open', [open.canOpen(root, opener), open.canOpen({rest: true, kids: null}, opener), open.canOpen(null, opener)], [false, false, false]);
	check('opened on PixOS by its full path', [open.openNode(onDisk, opener), opened], [null, ['/home/notes.bin']]);
	const tabs = [];
	check('a picked file goes to a tab', [open.openNode(picked, opener, (f) => tabs.push(f.name)), tabs, opened.length], [null, ['pic.png'], 1]);
	check('and says why when it cannot', [open.openNode(pickedBin, opener, () => tabs.push('no')), open.openNode(onDisk, null)],
		['The browser cannot show this kind of file', 'Nothing here can open it']);
	check('a shell\'s openFile, bound to the shell', (() => {
		const shell = {seen: null, openFile (p) { this.seen = p; }};
		open.getShellOpener(shell)('/x');
		return [shell.seen, open.getShellOpener(globalThis), open.getShellOpener({})];
	})(), ['/x', null, null]);
	check('a window is not its own shell, even with an openFile of its own', (() => {
		globalThis.openFile = () => {};
		try { return open.getShellOpener(globalThis); } finally { delete globalThis.openFile; }
	})(), null);
	check('a picked file opens in a new tab: typed by its name when it came untyped, the link gone after, the URL let go later', (() => {
		const made = [];
		const saved = {document: globalThis.document, setTimeout: globalThis.setTimeout, create: URL.createObjectURL, revoke: URL.revokeObjectURL};
		const body = [];
		globalThis.document = {
			createElement: (tag) => ({tag, click () { made.push(['click', this.href, this.target, this.rel, body.includes(this)]); }, remove () { body.splice(body.indexOf(this), 1); }}),
			body: {append: (el) => body.push(el)},
		};
		const later = [];
		globalThis.setTimeout = (fn, ms) => later.push([fn, ms]);
		URL.createObjectURL = (blob) => { made.push(['url', blob.type, blob.name]); return 'blob:1'; };
		URL.revokeObjectURL = (url) => made.push(['revoke', url]);
		try {
			const untyped = new File(['x'], 'pic.png');
			const typed = new File(['x'], 'pic.png', {type: 'image/x-mine'});
			open.openNode(tree.file('pic.png', 1, null, untyped), null);
			const tabbed = body.length;
			later.forEach(([fn]) => fn());
			open.openNode(tree.file('pic.png', 1, null, typed), null);
			return [made, tabbed, later.map(([, ms]) => ms)];
		} finally {
			globalThis.document = saved.document;
			globalThis.setTimeout = saved.setTimeout;
			URL.createObjectURL = saved.create;
			URL.revokeObjectURL = saved.revoke;
		}
	})(), [[['url', 'image/png', 'pic.png'], ['click', 'blob:1', '_blank', 'noopener noreferrer', true], ['revoke', 'blob:1'],
		['url', 'image/x-mine', 'pic.png'], ['click', 'blob:1', '_blank', 'noopener noreferrer', true]], 0, [600000, 600000]]);
}

process.exit(report('treemap-model') ? 1 : 0);
