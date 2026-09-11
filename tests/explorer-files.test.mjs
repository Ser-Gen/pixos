// Writing a file into a folder that already has one by that name.
//
// Two routes lead here: a path being copied or moved, and a File with no path of its own
// (dropped, pasted from the clipboard, or picked with Upload). The second route used to
// overwrite silently, with no prompt and no undo — you pasted a screenshot and the
// image.png already in the folder was gone.
//
// Extracted from apps/explorer/index.html rather than duplicated, so reorganising the
// conflict logic fails these tests instead of escaping them.

import fs from 'fs';
import {check, report} from './assert.mjs';
import {createFormat} from '../apps/explorer/js/format.js';

const source = fs.readFileSync(new URL('../apps/explorer/index.html', import.meta.url), 'utf8');

function region (from, to) {
	const start = source.indexOf(from);
	const end = source.indexOf(to, start);
	if (start === -1 || end === -1) {
		console.error('explorer-files.test.mjs: could not find "' + from + '"');
		process.exit(1);
	}
	return source.slice(start, end);
}

const code = region('async function resolveIncomingDestination', 'function getInitialCwd')
	+ region('async function refuseOversizedFile', '\n\tasync function getOpenWithApps');

// --- a filesystem that remembers what happened -----------------------------------------

let tree, writes, unlinked, renamed, prompts, answer, reported, fails, limit;

const pathStub = {
	join: (...parts) => parts.join('/').replace(/\/+/g, '/'),
	basename: p => String(p).split('/').pop(),
	dirname: p => String(p).replace(/\/[^/]*$/, '') || '/',
	extname: p => {
		const base = String(p).split('/').pop();
		const dot = base.lastIndexOf('.');
		return dot > 0 ? base.slice(dot) : '';
	}
};

const state = {cwd: '/home', dialog: null};

const api = new Function(
	'path', 'state', 'stat', 'unlink', 'unlinkFile', 'fsRename', 'writeFile', 'fileToAB', 'Buffer',
	'openDialog', 'renderOverlays', 'parent', 'window', 'report', 'reportFailure',
	'splitNameAndExtension',
	code + '\n; return {resolveIncomingDestination, resolvePasteDestination, writeNewFile, writeIncomingFile, onFileHandler, addIncomingFile};'
)(
	pathStub, state,
	// stat
	async p => tree[p] || null,
	// unlink
	async p => { unlinked.push(p); delete tree[p]; },
	// unlinkFile — the raw one, which rejects when there is nothing there
	async p => {
		if (!tree[p]) { throw Object.assign(new Error('ENOENT'), {code: 'ENOENT'}); }
		unlinked.push(p);
		delete tree[p];
	},
	// fsRename
	async (from, to) => { renamed.push([from, to]); tree[to] = tree[from]; delete tree[from]; },
	// writeFile — `fails` is the path a write is told to refuse, which is how a 150 MB
	// drop is reproduced without a 150 MB file.
	async (p, contents) => {
		writes.push({path: p, contents: contents});
		// The inode first, the data second — which is the order BrowserFS commits them in,
		// and the whole reason a refused write leaves a 0-byte file sitting there.
		tree[p] = {isDirectory: () => false};
		if (fails && p === fails) {
			throw Object.assign(new Error('EIO: Input/output error.'), {code: 'EIO'});
		}
	},
	async file => file.body,
	{from: x => x},
	// askPasteConflict wraps openDialog in a promise; this stands in for the person.
	dialog => { prompts.push(dialog.message); dialog.onSubmit(answer); },
	() => {},
	// parent and window: the shell, and this frame. Different objects, so the size check
	// takes the branch it takes in an iframe.
	{describeWriteLimit: async bytes => (bytes > limit ? {
		title: 'That file is too large to store',
		message: 'Nothing was written.'
	} : null)},
	{},
	// report / reportFailure
	(title, message) => { reported.push([title, message]); },
	(label, err) => { reported.push([label, String(err && err.message)]); },
	// Phase 21 moved this into apps/explorer/js/format.js, so it is the real one, given
	// the same path stub the code under test is given.
	createFormat(pathStub).splitNameAndExtension
);

function reset (existing) {
	tree = {};
	(existing || []).forEach(p => { tree[p] = {isDirectory: () => p.endsWith('/dir')}; });
	writes = [];
	unlinked = [];
	renamed = [];
	prompts = [];
	reported = [];
	answer = 'cancel';
	fails = null;
	limit = Infinity;
	state.dialog = null;
}

const file = (name, body, size) => ({name: name, body: body || 'BODY', size: size || 4});

// --- the bug: a pasted file replacing one that was there ---------------------------------

reset([]);
await api.onFileHandler(file('image.png'));
check('a new name is written straight through', writes.map(w => w.path), ['/home/image.png']);
check('with nothing to ask about', prompts.length, 0);

reset(['/home/image.png']);
answer = 'cancel';
await api.onFileHandler(file('image.png'));
check('an existing name asks first', prompts.length, 1);
check('and names the file and the folder', prompts[0],
	'A file named "image.png" already exists in /home.');
// This is the whole point of the file: before the fix there was no prompt and this wrote.
check('cancel writes nothing at all', writes, []);
check('and removes nothing', unlinked, []);

reset(['/home/image.png']);
answer = 'replace';
await api.onFileHandler(file('image.png', 'NEW'));
// Not over the name: the new bytes go beside it and only take its place once they
// are actually stored. The old order — unlink, then write — destroyed the file being
// replaced whenever the write failed, which is what a 150 MB drop did.
check('replace writes somewhere else first', writes.map(w => w.path), ['/home/image.png.pixos-part']);
check('with the new contents', writes[0].contents, 'NEW');
check('then removes the old file', unlinked, ['/home/image.png']);
check('and moves the new one into place', renamed, [['/home/image.png.pixos-part', '/home/image.png']]);

reset(['/home/image.png']);
answer = 'rename';
await api.onFileHandler(file('image.png', 'NEW'));
check('keep-both writes beside it', writes.map(w => w.path), ['/home/image-1.png']);
check('and leaves the original alone', unlinked, []);
check('which is still there', !!tree['/home/image.png'], true);

reset(['/home/image.png', '/home/image-1.png', '/home/image-2.png']);
answer = 'rename';
await api.onFileHandler(file('image.png'));
check('keep-both counts past the copies already made', writes.map(w => w.path), ['/home/image-3.png']);

reset(['/home/notes']);
answer = 'rename';
await api.onFileHandler(file('notes'));
check('a name with no extension still gets a suffix', writes.map(w => w.path), ['/home/notes-1']);

// A directory is never replaced by a dropped file, so Replace must not be offered.
reset([]);
tree['/home/stuff'] = {isDirectory: () => true};
answer = 'cancel';
let asked = null;
const withDialog = new Function(
	'path', 'state', 'stat', 'unlink', 'writeFile', 'fileToAB', 'Buffer',
	'openDialog', 'renderOverlays',
	code + '\n; return {onFileHandler};'
)(
	pathStub, state,
	async p => tree[p] || null,
	async () => {},
	async () => {},
	async f => f.body,
	{from: x => x},
	dialog => { asked = dialog; dialog.onSubmit('cancel'); },
	() => {}
);
await withDialog.onFileHandler(file('stuff'));
check('a folder in the way cannot be replaced', asked.canReplace, false);

// --- a dropped folder is not prompted per file --------------------------------------------
//
// A folder drop arrives one call per file with a relative path. Prompting hundreds of times
// would be worse than the problem; that limitation is recorded in docs/backlog.md.

reset(['/home/pics/a.png']);
answer = 'cancel';
await api.onFileHandler(file('a.png'), 'pics/a.png');
check('a nested path from a folder drop does not prompt', prompts.length, 0);
check('and still writes', writes.map(w => w.path), ['/home/pics/a.png']);

// --- the path-based route keeps working -----------------------------------------------------

reset([]);
let resolved = await api.resolvePasteDestination('/other/report.pdf', '/home', 'copy');
check('a free name needs no prompt', resolved, {destPath: '/home/report.pdf', replaceExisting: false});

reset(['/home/report.pdf']);
tree['/other/report.pdf'] = {isDirectory: () => false};
answer = 'replace';
resolved = await api.resolvePasteDestination('/other/report.pdf', '/home', 'copy');
check('a taken name prompts and can replace', resolved, {destPath: '/home/report.pdf', replaceExisting: true});

reset(['/home/report.pdf']);
tree['/other/report.pdf'] = {isDirectory: () => false};
answer = 'cancel';
check('cancelling a paste yields nothing to do',
	await api.resolvePasteDestination('/other/report.pdf', '/home', 'copy'), null);

// Copying a folder onto a folder of the same name: Replace would mean deleting a tree.
reset([]);
tree['/home/src'] = {isDirectory: () => true};
tree['/other/src'] = {isDirectory: () => true};
answer = 'cancel';
await api.resolvePasteDestination('/other/src', '/home', 'copy');
check('a folder onto a folder is a conflict', prompts.length, 1);

// --- writeNewFile, which every producing route now shares ---------------------------------

reset([]);
check('a free name is written and its path returned',
	await api.writeNewFile('/home', 'out.mp4', 'DATA'), '/home/out.mp4');
check('with no question asked', prompts.length, 0);

reset(['/home/out.mp4']);
answer = 'cancel';
check('cancel returns null', await api.writeNewFile('/home', 'out.mp4', 'DATA'), null);
check('and writes nothing', writes, []);

reset(['/home/out.mp4']);
answer = 'rename';
check('keep-both returns where it actually went',
	await api.writeNewFile('/home', 'out.mp4', 'DATA'), '/home/out-1.mp4');

reset(['/home/out.mp4']);
answer = 'replace';
await api.writeNewFile('/home', 'out.mp4', 'DATA');
check('replace stages, unlinks and renames, in that order',
	[writes.map(w => w.path), unlinked, renamed],
	[['/home/out.mp4.pixos-part'], ['/home/out.mp4'], [['/home/out.mp4.pixos-part', '/home/out.mp4']]]);

// --- every route that produces a file goes through it ---------------------------------------
//
// This is the check that matters longest. Five separate places wrote a new file into the
// current folder by name, and every one of them clobbered whatever was already there --
// rename, create, download, extract, convert. A sixth added later must not reintroduce it,
// so no raw writeFile/fsRename into state.cwd is allowed to exist.

const producers = [
	['createFile', 'createFile: function ()'],
	['addOnlineFile', 'addOnlineFile: function ()'],
	// Phase 13. The suggested name is already a free one, so this is only ever the race —
	// but it is the same funnel, and being on this list is what keeps it that way.
	['compress', 'async function runCompress (dialog)'],
	['ffmpeg convert', 'window.ffmpeg.exec']
];

producers.forEach(function (entry) {
	const at = source.indexOf(entry[1]);
	const chunk = source.slice(at, at + 1600);
	check(entry[0] + ' writes through writeNewFile', chunk.includes('writeNewFile('), true);
	check(entry[0] + ' does not writeFile into the cwd directly',
		/await writeFile\(path\.join\(state\.cwd/.test(chunk), false);
});

// Extraction is no longer on that list because it no longer produces a file in the current
// folder at all: it makes a folder of its own, and the name is one nothing else is using.
// Same rule, one level up — and the folder is what phase 12 replaced a stray `.zip` with.
const extraction = source.slice(source.indexOf('async function writeExtracted'));
check('extraction picks a folder name that is free',
	extraction.slice(0, 1200).includes('destinationFor('), true);
check('and writes underneath that folder, never into the current one',
	/writeFile\(path\.join\(destPath/.test(extraction.slice(0, 1200)), true);

// Rename is the one that uses fsRename rather than writeFile, and fsRename replaces its
// destination POSIX-style: the reported bug was a renamed file destroying an existing one.
const renameAction = source.slice(source.indexOf('rename: function (itemPath)'),
	source.indexOf('deleteSelected: function ()'));
check('rename asks before replacing', renameAction.includes('resolveIncomingDestination('), true);
check('and unlinks the target it was told to replace', renameAction.includes('unlink('), true);
check('and never renames straight onto a joined path',
	/await fsRename\(item\.path, newPath\)/.test(renameAction), false);

check('no writeFile into the cwd is left anywhere in the app',
	(source.match(/await writeFile\(path\.join\(state\.cwd/g) || []).length, 0);

// --- a dialog that declines keeps itself open -------------------------------------------
//
// wireSimpleDialog latches on submit so a click and an Enter cannot both fire. A handler
// that returns false has not submitted, so the latch has to release or the dialog is dead.

const wiring = source.slice(source.indexOf('function wireSimpleDialog'),
	source.indexOf('function focusDialogInput'));
check('the submit latch releases when a handler declines',
	wiring.includes('if (onSubmit() === false)'), true);

[['rename', "if (dialog.type === 'rename')"],
	['newFile', "dialog.type === 'newFile'"],
	['newFolder', "dialog.type === 'newFolder'"],
	['onlineFile', "dialog.type === 'onlineFile'"]].forEach(function (entry) {
	const at = source.indexOf(entry[1]);
	const chunk = source.slice(at, at + 1400);
	check(entry[0] + ' declines an empty value instead of closing', chunk.includes('return false;'), true);
});

// --- the call sites must not prompt in parallel ------------------------------------------
//
// There is one state.dialog. Two concurrent prompts overwrite each other and every one but
// the last waits forever, so every route that handles several files has to be sequential.

['ui.fileInput.onchange', "addEventListener('paste'", 'async function onDrop'].forEach(function (site) {
	const at = source.indexOf(site);
	const chunk = source.slice(at, at + 2200);
	check(site + ' does not Promise.all over onFileHandler',
		/Promise\.all\([\s\S]{0,200}onFileHandler/.test(chunk), false);
});
check('and the screen recorder awaits its write',
	/await onFileHandler\(blobToFile\(blob, name\)\)/.test(source), true);

// --- a file the browser will not store ------------------------------------------------------
//
// Dropping a 150 MB file wrote a 0-byte one and reported `EIO: Input/output error.`
// BrowserFS commits the inode before it stores the data, so a refused write leaves a file
// of the right name and no contents, looking for all the world like it worked.

reset([]);
limit = 1000;
await api.onFileHandler(file('huge.mov', 'BODY', 150 * 1024 * 1024));
check('an oversized file is refused', reported.map(entry => entry[0]),
	['That file is too large to store']);
check('and nothing is written at all', writes, []);
// The check is asked before `fileToAB`, so the bytes never reach memory either. That is
// only observable here as the absence of the write.
check('nor is anything removed', unlinked, []);

reset([]);
limit = 1000;
await api.onFileHandler(file('fine.txt', 'BODY', 12));
check('a file under the limit is written as before', writes.map(w => w.path), ['/home/fine.txt']);

// A file that passes the check and is refused anyway — no room left, or a limit this
// browser has and did not announce.
reset([]);
fails = '/home/big.bin';
let thrown = null;
try {
	await api.onFileHandler(file('big.bin'));
}
catch (err) {
	thrown = err.code;
}
check('a write that fails is still a failure', thrown, 'EIO');
check('and the empty file it left behind is removed', unlinked, ['/home/big.bin']);

// The worse half of the same bug: replacing used to delete the existing file first.
reset(['/home/video.mp4']);
answer = 'replace';
fails = '/home/video.mp4.pixos-part';
thrown = null;
try {
	await api.onFileHandler(file('video.mp4', 'NEW'));
}
catch (err) {
	thrown = err.code;
}
check('a failed replace reports', thrown, 'EIO');
check('removes only its own staging file', unlinked, ['/home/video.mp4.pixos-part']);
check('and leaves the file it was replacing exactly where it was',
	!!tree['/home/video.mp4'], true);

// Every route a file arrives by is an event listener, and nothing awaits one of those: a
// rejection escaping it is an unhandled rejection reported without naming the file.
reset([]);
fails = '/home/one.bin';
await api.addIncomingFile(file('one.bin'));
check('a failure on one file is caught and named', reported.map(entry => entry[0]),
	['Could not add one.bin']);
reset([]);
await api.addIncomingFile(file('two.bin'));
check('and the next file still goes in', writes.map(w => w.path), ['/home/two.bin']);

process.exit(report('explorer-files') ? 1 : 0);
