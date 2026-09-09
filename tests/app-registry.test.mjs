// Installing an app had no counterpart. The only way to remove one was to delete its
// folder in Explorer, which left the registry believing it was still installed until
// somebody pressed Rescan — an app that had stopped working and could not be got rid of.
//
// This drives the real registry against an in-memory filesystem and the repo's real
// catalog, because the interesting parts of an uninstall are all "which files, exactly":
// which folder an app occupies (not always its id), what it refuses to touch, and what it
// leaves behind on purpose.

import fs from 'node:fs';
import nodePath from 'node:path';
import {createRequire} from 'node:module';
import {check, report} from './assert.mjs';

const repo = new URL('..', import.meta.url).pathname;

// The registry fetches the catalog over HTTP; here that is the repo on disk.
globalThis.fetch = async url => {
	const file = nodePath.join(repo, String(url).split('?')[0].replace(/^\//, ''));
	if (!fs.existsSync(file)) {
		return {ok: false, status: 404, json: async () => ({}), text: async () => ''};
	}
	const text = fs.readFileSync(file, 'utf8');
	return {ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text};
};

// --- an in-memory filesystem, shaped like the callbacks BrowserFS hands out -------------

const files = new Map();
const dirs = new Set(['/', '/apps', '/settings']);

function addFile (path, content) {
	files.set(path, content || '');
	let dir = nodePath.posix.dirname(path);
	while (dir && dir !== '/') {
		dirs.add(dir);
		dir = nodePath.posix.dirname(dir);
	}
}

const fakeFs = {
	stat (path, cb) {
		if (files.has(path)) {
			return cb(null, {isDirectory: () => false, isFile: () => true});
		}
		if (dirs.has(path)) {
			return cb(null, {isDirectory: () => true, isFile: () => false});
		}
		cb(new Error('ENOENT: ' + path));
	},
	readdir (path, cb) {
		if (!dirs.has(path)) {
			return cb(new Error('ENOENT: ' + path));
		}
		const prefix = path === '/' ? '/' : path + '/';
		const names = new Set();
		[...files.keys(), ...dirs].forEach(entry => {
			if (entry !== path && entry.startsWith(prefix)) {
				names.add(entry.slice(prefix.length).split('/')[0]);
			}
		});
		cb(null, [...names]);
	},
	readFile (path, cb) {
		if (!files.has(path)) {
			return cb(new Error('ENOENT: ' + path));
		}
		cb(null, Buffer.from(files.get(path)));
	},
	unlink (path, cb) {
		if (!files.has(path)) {
			return cb(new Error('ENOENT: ' + path));
		}
		files.delete(path);
		cb(null);
	},
	rename (from, to, cb) {
		const prefix = from + '/';
		[...files.keys()].forEach(entry => {
			if (entry === from || entry.startsWith(prefix)) {
				files.set(to + entry.slice(from.length), files.get(entry));
				files.delete(entry);
			}
		});
		[...dirs].forEach(entry => {
			if (entry === from || entry.startsWith(prefix)) {
				dirs.add(to + entry.slice(from.length));
				dirs.delete(entry);
			}
		});
		cb(null);
	},
	rmdir (path, cb) {
		const prefix = path + '/';
		const busy = [...files.keys(), ...dirs].some(entry => entry.startsWith(prefix));
		if (busy) {
			return cb(new Error('ENOTEMPTY: ' + path));
		}
		dirs.delete(path);
		cb(null);
	}
};

// Two catalog apps as they actually land on disk. `monaco` is the one that matters: its
// folder is `monaco-cdn`, so anything that builds a path out of the id deletes nothing and
// reports success.
addFile('/apps/treemap/index.html', '<html>');
addFile('/apps/treemap/pixos.app.json', '{}');
addFile('/apps/monaco-cdn/index.html', '<html>');
addFile('/apps/monaco-cdn/vendor/vs/loader.js', '// monaco');
addFile('/settings/installed-apps/treemap.json', '{"id":"treemap"}');
// A file of the user's, in a folder no app owns. Nothing here should ever reach it.
addFile('/home/notes.md', '# mine');

const removedAssociations = [];
const writes = new Map();

const require = createRequire(import.meta.url);
require('../js/app-registry.js');
const registry = globalThis.PixosAppRegistry;

registry.init({
	fs: fakeFs,
	path: nodePath.posix,
	scope: '',
	legacyCatalog: {},
	readJsonFile: async (path, fallback) => (files.has(path) ? JSON.parse(files.get(path)) : fallback),
	writeFile: async (path, contents) => {
		writes.set(path, String(contents));
		addFile(path, String(contents));
	},
	ensureDir: async path => dirs.add(path),
	updateDefaultAppAssociations: async (oldId, newId) => {
		removedAssociations.push([oldId, newId]);
	}
});

await registry.buildAppRegistry();

// --- what it refuses -------------------------------------------------------------------

async function fails (promise) {
	try {
		await promise;
		return null;
	}
	catch (err) {
		return err.message;
	}
}

check('the shell\'s own apps cannot be uninstalled',
	(await fails(registry.uninstallAppById('explorer')) || '').includes('part of PixOS itself'), true);
check('nor can app-manager, from inside app-manager',
	(await fails(registry.uninstallAppById('app-manager')) || '').includes('cannot be uninstalled'), true);
check('an app nobody has heard of is an error, not a silent success',
	await fails(registry.uninstallAppById('no-such-app')), 'Unknown app: no-such-app');

// --- what it removes -------------------------------------------------------------------

const result = await registry.uninstallAppById('treemap');
check('it says which folder went', result.folder, '/apps/treemap');
check('the entry point is gone', files.has('/apps/treemap/index.html'), false);
check('and so is the rest of the folder', files.has('/apps/treemap/pixos.app.json'), false);
check('the folder itself too, not just its contents', dirs.has('/apps/treemap'), false);
check('the record of what was installed goes with it — otherwise a reinstall compares '
	+ 'against hashes of files that are no longer there',
	files.has('/settings/installed-apps/treemap.json'), false);
check('and any file type it was the default for is asked about again',
	removedAssociations, [['treemap', null]]);
check('nothing outside the app folder is touched', files.has('/home/notes.md'), true);

// The whole reason the folder is read off the app rather than built from its id.
const monaco = await registry.uninstallAppById('monaco');
check('an app whose folder is not its id still loses the right folder',
	monaco.folder, '/apps/monaco-cdn');
check('including what is nested inside it', files.has('/apps/monaco-cdn/vendor/vs/loader.js'), false);
check('and the folder is gone rather than left empty', dirs.has('/apps/monaco-cdn'), false);

// --- what it deliberately leaves alone ---------------------------------------------------
//
// /settings/preinstalled.json records what preinstall has already done, and the rule is
// that anything it put there and the user then removed stays removed. Clearing it here
// would reinstall the app on the next boot — the opposite of what was just asked for.
check('the preinstall record is not rewritten', writes.has('/settings/preinstalled.json'), false);

// --- an app that has been renamed ------------------------------------------------------------
//
// Renaming a local app already carried its default-app associations across. What it did not
// carry was everything *else* that names an app by id — above all a saved session, so a
// window that had been open on the renamed app came back as "App <old id> has no launch
// path". Rather than hunting those files down one at a time, the old name resolves to the
// new one, in one place, for whatever asks next.

addFile('/apps/notes/index.html', '<html>');
addFile('/apps/notes/pixos.app.json', JSON.stringify({id: 'notes', entryPath: '/apps/notes/index.html'}));
await registry.buildAppRegistry();

check('the app is there under its own name', !!registry.getApp('notes'), true);
check('and nothing answers to a name nobody has used', registry.getApp('scratch'), null);

await registry.renameLocalApp('notes', 'scratch');
check('renaming moves the folder', files.has('/apps/scratch/index.html'), true);
check('the new name is the one that works', !!registry.getApp('scratch'), true);
check('associations follow it, as they already did',
	removedAssociations[removedAssociations.length - 1], ['notes', 'scratch']);

// The part that was missing.
check('the old name still resolves, so a saved session still opens',
	registry.resolveAppId('notes'), 'scratch');
check('and finds the same app rather than a copy of it',
	registry.getApp('notes'), registry.getApp('scratch'));
check('it is written down, or it would not survive the reload it exists for',
	JSON.parse(writes.get('/settings/app-aliases.json')), {notes: 'scratch'});

// A chain would otherwise grow one link per rename and eventually loop.
await registry.renameLocalApp('scratch', 'jotter');
check('renaming twice collapses the chain rather than lengthening it',
	registry.getAppAliases(), {notes: 'jotter', scratch: 'jotter'});
check('the first name still lands on the current app', registry.resolveAppId('notes'), 'jotter');
check('a name nobody renamed is returned untouched', registry.resolveAppId('treemap'), 'treemap');
check('and so is nothing at all', registry.resolveAppId(null), null);

// A name that comes back into use is a real app again, not a pointer somewhere else.
addFile('/apps/notes/index.html', '<html>');
addFile('/apps/notes/pixos.app.json', JSON.stringify({id: 'notes', entryPath: '/apps/notes/index.html'}));
await registry.buildAppRegistry();
check('a reused name is itself, not an alias for what took it over',
	registry.getApp('notes').entryPath, '/apps/notes/index.html');

// --- the fallback catalog cannot disagree with the manifests --------------------------------
//
// `apps/app-catalog.js` is what App Manager installs from when `apps/registry.json` cannot
// be fetched. It was hand-written and it rotted: `monaco` and `tinymce` gained vendored
// editors of 98 and 137 files while the catalog went on naming two each, so installing
// either from the fallback produced an app that opened and stayed blank — and four apps
// added later were not in it at all. It is generated now, and this is what says so.

const catalogSource = fs.readFileSync(new URL('../apps/app-catalog.js', import.meta.url), 'utf8');
const catalogSandbox = {window: {}};
new Function('window', catalogSource)(catalogSandbox.window);
const catalog = catalogSandbox.window.PIXOS_APP_CATALOG;

check('it says it is generated, so nobody edits it by hand',
	/Generated by scripts\/generate-apps-catalog\.js/.test(catalogSource), true);

const registryIds = JSON.parse(fs.readFileSync(new URL('../apps/registry.json', import.meta.url), 'utf8'))
	.apps.map(entry => entry.id).sort();
check('every app in the registry is in the fallback',
	registryIds.filter(id => !catalog[id]), []);
check('and the fallback invents none of its own',
	Object.keys(catalog).filter(id => id !== 'base' && !registryIds.includes(id)), []);

// The rot, precisely: a file list that is shorter than the manifest's is an app that
// installs and does not run.
const drift = registryIds.map(id => {
	const manifest = JSON.parse(fs.readFileSync(
		new URL('../apps/' + nodePath.basename(nodePath.dirname(catalog[id].entryPath)) + '/pixos.app.json',
			import.meta.url), 'utf8'));
	const manifestFiles = manifest.files.map(item => item.path).sort();
	const catalogFiles = catalog[id].files.map(item => (typeof item === 'string' ? item : item.path)).sort();
	return {id, same: JSON.stringify(manifestFiles) === JSON.stringify(catalogFiles), manifest, entry: catalog[id]};
}).filter(row => !row.same).map(row => row.id);
check('every entry names exactly the files its manifest names', drift, []);

check('monaco in particular, which is the one that was broken',
	catalog.monaco.files.length > 90, true);

// `needsNetwork` and `autosave` were dropped by the old conversion, which is exactly the
// pair that exists to warn you before an app fails.
const fieldGaps = registryIds.filter(id => {
	const folder = nodePath.basename(nodePath.dirname(catalog[id].entryPath));
	const manifest = JSON.parse(fs.readFileSync(
		new URL('../apps/' + folder + '/pixos.app.json', import.meta.url), 'utf8'));
	return !!manifest.needsNetwork !== !!catalog[id].needsNetwork
		|| !!manifest.autosave !== !!catalog[id].autosave
		|| (manifest.icon || null) !== (catalog[id].icon || null)
		|| manifest.version !== catalog[id].version;
});
check('and carries the fields an install depends on, not just the paths', fieldGaps, []);
check('at least one app actually declares needsNetwork, or that check proves nothing',
	registryIds.some(id => catalog[id].needsNetwork), true);

// `base` is the bootstrap file list. Two hand-kept copies of "what a fresh system needs" is
// one too many, so it comes from the file that already answers that.
const preinstallFiles = JSON.parse(fs.readFileSync(new URL('../settings/preinstall.json', import.meta.url), 'utf8'))
	.files.map(entry => entry.path);
check('base is preinstall.json, not a second opinion about it', catalog.base.files, preinstallFiles);
check('and is not installable, because it is a list of files rather than an app',
	catalog.base.entryPath, undefined);

process.exit(report('app-registry') ? 1 : 0);
