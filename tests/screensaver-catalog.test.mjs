// The screensavers PixOS knows of, and downloading one (phase 26, pass 4). js/shell/screensaver-catalog.js
// in its decisions: what it takes from the generated index, what the gallery offers and what each
// look still costs, what a download fetches and in what order -- the page that opens a look last --
// and what is left behind when one is cut short. Then the same through createCatalog, over a
// filesystem and a server made of maps.

import {check, report} from './assert.mjs';
import fs from 'node:fs';

const catalog = await import('../js/shell/screensaver-catalog.js');
const DIR = catalog.SCREENSAVERS_DIR;

check('screensavers live in /apps/screensavers, and the index beside them', [DIR, catalog.INDEX_PATH],
	['/apps/screensavers', '/apps/screensavers/index.json']);

// --- the index ------------------------------------------------------------------------------------

const T = 'Tank.xscr/';
const tankFiles = {
	[T + 'LICENSE']: 10,
	[T + 'looks.json']: 100,
	[T + 'reef/page.html']: 200,
	[T + 'reef/rock.bin']: 500,
	[T + 'river/page.html']: 100,
	[T + 'river/wood.jpg']: 150,
	[T + 'three.js']: 50
};
const shared = [T + 'LICENSE', T + 'looks.json', T + 'three.js'];
const INDEX = {
	version: 1,
	screensavers: [
		{
			name: 'Tank',
			path: 'Tank.xscr',
			files: Object.keys(tankFiles).map(path => ({path, size: tankFiles[path], sha256: 'sha256:x'})),
			looks: [
				{name: 'Reef', entry: 'reef/page.html?quality=eco', tile: 'blue', files: shared.concat([T + 'reef/page.html', T + 'reef/rock.bin']).sort()},
				{name: 'River', entry: 'river/page.html', files: shared.concat([T + 'river/page.html', T + 'river/wood.jpg']).sort()}
			]
		},
		{name: 'Rain', path: 'Rain.xscr.html', files: [{path: 'Rain.xscr.html', size: 42}], looks: [{name: 'Rain', files: ['Rain.xscr.html']}]}
	]
};

const read = catalog.readIndex(INDEX);
check('each screensaver, with its looks by name', read.map(e => [e.name, e.path, e.looks.map(l => l.name)]),
	[['Tank', 'Tank.xscr', ['Reef', 'River']], ['Rain', 'Rain.xscr.html', ['Rain']]]);
check('a look keeps its page, its colours and what it needs',
	[read[0].looks[0].entry, read[0].looks[0].tile, read[0].looks[0].files.length], ['reef/page.html?quality=eco', 'blue', 5]);
check('and every file its size', read[0].sizes[T + 'reef/rock.bin'], 500);
check('anything that is not an index is an empty one', [catalog.readIndex(null), catalog.readIndex({screensavers: 'no'}), catalog.readIndex('[]')], [[], [], []]);

const withOne = extra => catalog.readIndex({screensavers: [Object.assign({}, INDEX.screensavers[0], extra)]});
check('a path that is not one name in the folder is left out, even with files and looks to match it',
	catalog.readIndex({screensavers: [{path: 'x/Tank.xscr', files: [{path: 'x/Tank.xscr/index.html', size: 1}], looks: [{name: 'A', files: ['x/Tank.xscr/index.html']}]}]}), []);
check('and so is one that is not a screensaver', withOne({path: 'Tank'}), []);
check('a name is taken from the path when the index has none', withOne({name: ''})[0].name, 'Tank');
check('a file that climbs out of its folder is not one of its files',
	catalog.readIndex({screensavers: [{path: 'Tank.xscr', files: [{path: 'Tank.xscr/../settings/x.json', size: 1}, {path: 'Tank.xscr/index.html', size: 1}],
		looks: [{name: 'A', files: ['Tank.xscr/../settings/x.json', 'Tank.xscr/index.html']}, {name: 'B', files: ['Tank.xscr/index.html']}]}]})[0].looks.map(l => l.name),
	['B']);
check('nor one in another folder', catalog.readIndex({screensavers: [{path: 'Tank.xscr',
	files: [{path: 'Tank.xscr/index.html', size: 1}, {path: 'Tent.xscr/x.png', size: 1}],
	looks: [{name: 'A', files: ['Tank.xscr/index.html', 'Tent.xscr/x.png']}, {name: 'B', files: ['Tank.xscr/index.html']}]}]})[0].looks.map(l => l.name), ['B']);
check('a look that needs a file the index does not list is left out',
	withOne({looks: [{name: 'Reef', entry: 'reef/page.html', files: [T + 'reef/page.html', T + 'reef/missing.bin']}]}), []);
check('and so is one whose page is not among what it needs',
	withOne({looks: [{name: 'Reef', entry: 'river/page.html', files: [T + 'reef/page.html']}]}), []);
check('or that needs nothing', withOne({looks: [{name: 'Reef', entry: 'reef/page.html', files: []}]}), []);
check('or whose page is outside its folder', withOne({looks: [{name: 'Reef', entry: '../x.html', files: [T + 'reef/page.html']}]}), []);
check('a look with no page opens index.html, which it has to need',
	withOne({looks: [{name: 'Plain', files: [T + 'reef/page.html']}]}), []);

// --- the page a look opens ---------------------------------------------------------------------------

check('a look\'s page is its entry, without the query or the hash, in its folder',
	[catalog.entryFile('Tank.xscr', 'reef/page.html?quality=eco'), catalog.entryFile('Pipes.xscr', 'index.html#%7B%7D')],
	['Tank.xscr/reef/page.html', 'Pipes.xscr/index.html']);
check('unescaped', catalog.entryFile('Tank.xscr', 'my%20page.html'), 'Tank.xscr/my page.html');
check('index.html when it names none', catalog.entryFile('Tank.xscr/', undefined), 'Tank.xscr/index.html');
check('and a single page is its own', catalog.entryFile('Rain.xscr.html', 'anything'), 'Rain.xscr.html');

// --- what the gallery offers ---------------------------------------------------------------------------

const here = new Set([T + 'LICENSE', T + 'looks.json', T + 'three.js', T + 'river/page.html', T + 'river/wood.jpg']);
const offered = catalog.gallery(read, [
	{name: 'Tank.xscr', looks: null, present: here},
	{name: 'Slideshow.xscr', looks: null, present: null},
	{name: 'Mine.xscr/', looks: [{name: 'Dawn', entry: 'dawn.html'}, {name: 'Dusk', tile: 'red'}], present: null},
	{name: 'README.md', looks: null, present: null}
]);
check('every screensaver, the index\'s and the disk\'s, by name, as paths',
	offered.map(e => [e.name, e.path]),
	[['Mine', DIR + '/Mine.xscr'], ['Rain', DIR + '/Rain.xscr.html'], ['Slideshow', DIR + '/Slideshow.xscr'], ['Tank', DIR + '/Tank.xscr']]);
const tank = offered.find(e => e.name === 'Tank');
check('a look says what it still has to download: what it needs that is not here',
	tank.looks.map(l => [l.name, l.missing]), [['Reef', 700], ['River', 0]]);
check('and keeps its page and its colours', [tank.looks[0].entry, tank.looks[0].tile], ['reef/page.html?quality=eco', 'blue']);
check('one the index knows and the disk does not costs everything it needs', offered.find(e => e.name === 'Rain').looks, [{name: 'Rain', missing: 42}]);
check('a folder of the user\'s own has the looks its looks.json names, with nothing to download',
	offered.find(e => e.name === 'Mine').looks, [{name: 'Dawn', missing: 0, entry: 'dawn.html'}, {name: 'Dusk', missing: 0, tile: 'red'}]);
check('and one with no looks.json has no looks: one page, one tile', offered.find(e => e.name === 'Slideshow').looks, null);
check('offline, a folder the index would know lists only the looks whose page is here',
	catalog.gallery([], [{name: 'Tank.xscr', looks: [{name: 'Reef', entry: 'reef/page.html'}, {name: 'River', entry: 'river/page.html'}], present: here}])[0].looks,
	[{name: 'River', missing: 0, entry: 'river/page.html'}]);
check('no index at all is what is on disk', catalog.gallery([], [{name: 'Slideshow.xscr', looks: null, present: null}]).map(e => e.name), ['Slideshow']);

// --- what a download fetches --------------------------------------------------------------------------

const reefPlan = catalog.downloadPlan(read[0], 'Reef', here);
check('only what the look needs and is not here, the page that opens it last',
	reefPlan, [{path: T + 'reef/rock.bin', size: 500}, {path: T + 'reef/page.html', size: 200}]);
check('from nothing, everything it needs, still page last',
	catalog.downloadPlan(read[0], 'River', new Set()).map(f => f.path),
	[T + 'LICENSE', T + 'looks.json', T + 'river/wood.jpg', T + 'three.js', T + 'river/page.html']);
check('all here, nothing', catalog.downloadPlan(read[0], 'River', here), []);
check('a look it does not have is no plan at all', catalog.downloadPlan(read[0], 'Desert', here), null);

// --- the catalog, over a filesystem and a server made of maps -------------------------------------------

function fakeFs (initial) {
	const files = new Map(Object.entries(initial || {}));
	const dirs = new Set(['/']);
	const addParents = path => {
		const parts = path.split('/').filter(Boolean);
		for (let i = 1; i < parts.length; i++) {
			dirs.add('/' + parts.slice(0, i).join('/'));
		}
	};
	for (const path of files.keys()) {
		addParents(path);
	}
	const log = [];
	const parentOf = path => path.slice(0, path.lastIndexOf('/')) || '/';
	const enoent = path => Object.assign(new Error('ENOENT: no such file or directory, \'' + path + '\''), {code: 'ENOENT'});
	return {
		files, dirs, log,
		failWrite: null,
		readdir (path) {
			if (!dirs.has(path)) {
				return Promise.reject(enoent(path));
			}
			const names = new Set();
			for (const entry of [...files.keys(), ...dirs]) {
				if (entry.startsWith(path + '/')) {
					names.add(entry.slice(path.length + 1).split('/')[0]);
				}
			}
			return Promise.resolve([...names]);
		},
		stat (path) {
			return Promise.resolve(dirs.has(path) ? {isDirectory: true} : (files.has(path) ? {isDirectory: false} : null));
		},
		readText (path) {
			return files.has(path) ? Promise.resolve(String(files.get(path))) : Promise.reject(enoent(path));
		},
		mkdir (path) {
			log.push('mkdir ' + path);
			if (!dirs.has(parentOf(path))) {
				return Promise.reject(enoent(path));
			}
			dirs.add(path);
			return Promise.resolve();
		},
		writeFile (path, bytes) {
			log.push('write ' + path);
			if (this.failWrite === path) {
				return Promise.reject(Object.assign(new Error('EIO'), {code: 'EIO'}));
			}
			if (!dirs.has(parentOf(path))) {
				return Promise.reject(enoent(path));
			}
			files.set(path, bytes);
			return Promise.resolve();
		}
	};
}

function fakeServer (sizes) {
	const served = [];
	const server = {
		served,
		broken: null,
		short: null,
		fetchFile (path) {
			served.push(path);
			const relative = path.slice(DIR.length + 1);
			if (server.broken === relative || !(relative in sizes)) {
				return Promise.reject(new Error(path + ': 404 Not Found'));
			}
			return Promise.resolve(new Uint8Array(server.short === relative ? sizes[relative] - 1 : sizes[relative]).buffer);
		}
	};
	return server;
}

const allSizes = Object.assign({'Rain.xscr.html': 42}, tankFiles);

function make (disk, index) {
	const bfs = fakeFs(disk);
	const server = fakeServer(allSizes);
	const made = catalog.createCatalog({
		loadIndex: () => (index instanceof Error ? Promise.reject(index) : Promise.resolve(index === undefined ? INDEX : index)),
		readdir: path => bfs.readdir(path),
		stat: path => bfs.stat(path),
		readText: path => bfs.readText(path),
		fetchFile: path => server.fetchFile(path),
		writeFile: (path, bytes) => bfs.writeFile(path, bytes),
		mkdir: path => bfs.mkdir(path)
	});
	return {bfs, server, made};
}

let c = make({[DIR + '/Slideshow.xscr/index.html']: 'x', [DIR + '/Tank.xscr/LICENSE']: 'x', [DIR + '/Tank.xscr/three.js']: 'x',
	[DIR + '/Mine.xscr/looks.json']: JSON.stringify({looks: [{name: 'Dawn'}, {name: 'Dusk', entry: 'dusk.html'}]}), [DIR + '/Mine.xscr/index.html']: 'x',
	[DIR + '/Odd.xscr/looks.json']: '{not json', [DIR + '/Odd.xscr/index.html']: 'x',
	[DIR + '/Empty.xscr/looks.json']: JSON.stringify({looks: [{name: 'Gone', entry: 'gone.html'}]})});
let listing = await c.made.list();
check('listed: the index\'s screensavers and the disk\'s', listing.map(e => e.name), ['Mine', 'Odd', 'Rain', 'Slideshow', 'Tank']);
check('what is on disk is taken off what a look costs, from a walk of its folder',
	listing.find(e => e.name === 'Tank').looks.map(l => l.missing), [800, 350]);
check('a folder of the user\'s own gets its looks from its looks.json, those whose page is here',
	listing.find(e => e.name === 'Mine').looks, [{name: 'Dawn', missing: 0}]);
check('and one with looks and none of their pages is left out: there is nothing in it to show', listing.some(e => e.name === 'Empty'), false);
check('and one whose looks.json does not parse has none', listing.find(e => e.name === 'Odd').looks, null);

c = make({[DIR + '/Slideshow.xscr/index.html']: 'x'}, new Error('offline'));
check('with no index -- offline, say -- the gallery is what is on disk', (await c.made.list()).map(e => e.name), ['Slideshow']);
c = make({}, null);
check('with no folder and an empty index, nothing', await c.made.list(), []);

// Downloading River into a system that has none of Tank.
c = make({[DIR + '/Slideshow.xscr/index.html']: 'x'});
const reports = [];
const result = await c.made.download(DIR + '/Tank.xscr/', 'River', (done, total, file) => reports.push([done, total, file]));
check('every file the look needs is fetched, one at a time, its page last', c.server.served, [
	DIR + '/' + T + 'LICENSE', DIR + '/' + T + 'looks.json', DIR + '/' + T + 'river/wood.jpg', DIR + '/' + T + 'three.js', DIR + '/' + T + 'river/page.html'
]);
check('and written where it will be served from', [...c.bfs.files.keys()].filter(p => p.includes('Tank')).sort(),
	[DIR + '/' + T + 'LICENSE', DIR + '/' + T + 'looks.json', DIR + '/' + T + 'river/page.html', DIR + '/' + T + 'river/wood.jpg', DIR + '/' + T + 'three.js']);
check('each folder made once, parents first, before the first file inside it',
	c.bfs.log.filter(l => l.startsWith('mkdir')), ['mkdir /apps', 'mkdir /apps/screensavers', 'mkdir /apps/screensavers/Tank.xscr', 'mkdir /apps/screensavers/Tank.xscr/river']);
check('progress in bytes: nothing first, then after each file, named inside its folder', reports, [
	[0, 410, null], [10, 410, 'LICENSE'], [110, 410, 'looks.json'], [260, 410, 'river/wood.jpg'], [310, 410, 'three.js'], [410, 410, 'river/page.html']
]);
check('it resolves to what it did', result, {files: 5, bytes: 410});
check('now River costs nothing, and Reef only what it adds', (await c.made.list()).find(e => e.name === 'Tank').looks.map(l => l.missing), [700, 0]);
c.server.served.length = 0;
await c.made.download(DIR + '/Tank.xscr', 'Reef');
check('the second look fetches only its own', c.server.served, [DIR + '/' + T + 'reef/rock.bin', DIR + '/' + T + 'reef/page.html']);
c.server.served.length = 0;
await c.made.download(DIR + '/Tank.xscr', 'Reef');
check('and a look that is all here fetches nothing', c.server.served, []);

// Cut short.
c = make({});
c.server.broken = T + 'reef/rock.bin';
let failure = null;
await c.made.download(DIR + '/Tank.xscr', 'Reef').catch(err => { failure = err; });
check('a file the server will not give fails the download, saying which', /reef\/rock\.bin: 404/.test(failure && failure.message), true);
check('what came before it is kept, and nothing after it -- the page that opens it least of all',
	[c.bfs.files.has(DIR + '/' + T + 'looks.json'), c.bfs.files.has(DIR + '/' + T + 'three.js'), c.bfs.files.has(DIR + '/' + T + 'reef/page.html')],
	[true, false, false]);
c.server.broken = null;
c.server.served.length = 0;
await c.made.download(DIR + '/Tank.xscr', 'Reef');
check('chosen again, it fetches only what is missing', c.server.served,
	[DIR + '/' + T + 'reef/rock.bin', DIR + '/' + T + 'three.js', DIR + '/' + T + 'reef/page.html']);

c = make({});
c.server.short = T + 'looks.json';
failure = null;
await c.made.download(DIR + '/Tank.xscr', 'River').catch(err => { failure = err; });
check('a file of the wrong size -- a host\'s fallback page, say -- is refused, and not written',
	[failure && failure.message, c.bfs.files.has(DIR + '/' + T + 'looks.json')],
	['Tank.xscr/looks.json should be 100 bytes, and the server sent 99.', false]);

c = make({});
c.bfs.failWrite = DIR + '/' + T + 'three.js';
failure = null;
await c.made.download(DIR + '/Tank.xscr', 'River').catch(err => { failure = err; });
check('a write the filesystem refuses fails the download with its own error', failure && failure.code, 'EIO');

c = make({});
const one = c.made.download(DIR + '/Tank.xscr', 'River');
const same = c.made.download(DIR + '/Tank.xscr/', 'River');
await Promise.all([one, same]);
check('asked twice while it runs, it is one download', [one === same, c.server.served.length], [true, 5]);
c.bfs.files.delete(DIR + '/' + T + 'river/wood.jpg');
c.server.served.length = 0;
await c.made.download(DIR + '/Tank.xscr', 'River');
check('and once it is over, asking again is a new download of what is missing now', c.server.served, [DIR + '/' + T + 'river/wood.jpg']);

const refused = async (path, look) => {
	try {
		await make({}).made.download(path, look);
		return 'downloaded';
	}
	catch (err) {
		return err.message;
	}
};
check('a screensaver the index does not have is refused, by name', await refused(DIR + '/Mine.xscr', 'Dawn'),
	'Mine is not a screensaver PixOS can download.');
check('and so is one outside /apps/screensavers, even where its name would match',
	await refused('/apps/screensaverz/Tank.xscr', 'River'), 'Tank is not a screensaver PixOS can download.');
check('and a look it does not have', await refused(DIR + '/Tank.xscr', 'Desert'), 'Tank has no look called Desert.');

c = make({});
await c.made.download(DIR + '/Rain.xscr.html', 'Rain');
check('a single page is one file, written beside the folders', [c.server.served, c.bfs.files.has(DIR + '/Rain.xscr.html')],
	[[DIR + '/Rain.xscr.html'], true]);

// --- the shell's half, in index.html -------------------------------------------------------------------

const shell = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
check('the index is read from the served repo, not from BrowserFS',
	/loadIndex: function \(\) \{\s*return fetchServed\(SCREENSAVER_INDEX\)/.test(shell), true);
check('a file the server does not give is an error, not a 404 page written as the file',
	/fetchFile: function \(filePath\) \{[\s\S]{0,200}if \(!response\.ok\) \{\s*throw new Error/.test(shell), true);
check('each part of its path escaped', /filePath\.split\('\/'\)\.map\(encodeURIComponent\)\.join\('\/'\)/.test(shell), true);
check('a refused write is passed on, not swallowed the way writeFilePromise would',
	/writeFile: function \(filePath, bytes\) \{[\s\S]{0,200}return err \? reject\(err\) : resolve\(\);/.test(shell), true);
check('a folder already there is not an error', /return !err \|\| err\.code === 'EEXIST' \? resolve\(\) : reject\(err\);/.test(shell), true);

process.exit(report('screensaver-catalog') ? 1 : 0);
