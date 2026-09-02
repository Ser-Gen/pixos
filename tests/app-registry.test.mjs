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

process.exit(report('app-registry') ? 1 : 0);
