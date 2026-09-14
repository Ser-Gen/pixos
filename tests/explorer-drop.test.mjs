// Dropping a folder onto an Explorer window.
//
// It had never worked. A dropped folder arrives in two places at once: `dataTransfer.files`
// carries a single entry named after the folder, and `dataTransfer.items` carries a
// directory entry that can actually be walked. The handler chose between them with
// `if (!files || !files.length)` — and Chrome always fills `files` — so the walk never ran,
// the directory went down the loose-file path, and `FileReader` was handed a directory:
//
//     Could not add pkg
//     A requested file or directory could not be found at the time an operation was
//     processed.
//
// The other half is a timing rule with no visible symptom until it is broken:
// `webkitGetAsEntry()` has to be called synchronously inside the drop handler, because the
// item list is emptied the moment that handler yields.

import fs from 'fs';
import {check, report} from './assert.mjs';
import {createFsHelpers} from '../apps/explorer/js/fs-helpers.js';
import {createFileOps} from '../apps/explorer/js/file-ops.js';
import {createFormat} from '../apps/explorer/js/format.js';

const source = fs.readFileSync(new URL('../apps/explorer/index.html', import.meta.url), 'utf8');

function region (from, to) {
	const start = source.indexOf(from);
	const end = source.indexOf(to, start);
	// Both ends, named separately. Phase 21 moves code out of this file every week, and a
	// scrape whose end marker has left is a slice of the wrong length rather than an error.
	if (start === -1) {
		console.error('explorer-drop.test.mjs: could not find the start "' + from + '"');
		process.exit(1);
	}
	if (end === -1) {
		console.error('explorer-drop.test.mjs: could not find the end "' + to + '" -- it has '
			+ 'probably moved into a module, and this scrape needs repointing');
		process.exit(1);
	}
	return source.slice(start, end);
}

// --- a drag carrying a folder ------------------------------------------------------------
//
// The shape the browser hands over: entries that answer isFile/isDirectory, a directory
// reader that returns its children in batches and then an empty batch.

function fileEntry (fullPath, body) {
	return {
		isFile: true,
		isDirectory: false,
		fullPath: fullPath,
		name: fullPath.split('/').pop(),
		file: cb => cb({name: fullPath.split('/').pop(), body: body || 'BODY', size: 4})
	};
}

function dirEntry (fullPath, children) {
	return {
		isFile: false,
		isDirectory: true,
		fullPath: fullPath,
		// The entry's own name, which is what the top-level roots of a drop are resolved by.
		name: fullPath.split('/').pop(),
		createReader () {
			let handed = false;
			return {
				readEntries (resolve) {
					// Two calls: the children, then an empty batch to say that is all.
					// A reader that is asked once and never again loses everything past
					// the first hundred entries, which is the whole reason for the loop.
					resolve(handed ? [] : children);
					handed = true;
				}
			};
		}
	};
}

const helpers = createFsHelpers({fs: {}, path: {}, mountManager: null, normalizePath: p => p});

// --- the walk ------------------------------------------------------------------------------

const tree = dirEntry('/pkg', [
	fileEntry('/pkg/readme.md'),
	dirEntry('/pkg/src', [fileEntry('/pkg/src/a.js'), fileEntry('/pkg/src/b.js')]),
	fileEntry('/pkg/LICENSE')
]);

let walked = await helpers.getAllFileEntries([tree]);
check('every file under a dropped folder is found', walked.map(e => e.fullPath).sort(),
	['/pkg/LICENSE', '/pkg/readme.md', '/pkg/src/a.js', '/pkg/src/b.js']);
check('and folders themselves are not in the list',
	walked.every(e => e.isFile), true);

// webkitGetAsEntry() answers null for anything that is not a file or a folder — a dragged
// selection of text, most often. The old loop pushed the null and then read .isFile off it.
walked = await helpers.getAllFileEntries([null, fileEntry('/a.txt'), null]);
check('a null entry is skipped rather than dereferenced',
	walked.map(e => e.fullPath), ['/a.txt']);

check('an empty drag walks to nothing', await helpers.getAllFileEntries([]), []);

// --- the drop handler itself -----------------------------------------------------------------

const code = region('async function onDrop', '\n\t// The shell opens a second Explorer');

let added, refreshed;

const state = {dragPaths: [], dragHoverFolderPath: null, cwd: '/home'};

// The two functions that decide what a dropped *folder* is called once it is inside are
// real, not stubbed: the question they ask is the whole subject of the last block in this
// file, and a stub would only prove the handler calls something.
const pathStub = {
	join: (...parts) => ('/' + parts.join('/')).replace(/\/+/g, '/'),
	basename: p => String(p).split('/').pop(),
	dirname: p => String(p).replace(/\/[^/]*$/, '') || '/',
	extname: p => ''
};

const existing = new Set();
let asked = [];
let conflictAnswer = 'cancel';

const ops = createFileOps({
	path: pathStub,
	state: state,
	Buffer: {from: x => x},
	shell: {},
	win: {},
	normalizePath: p => p,
	splitNameAndExtension: createFormat(pathStub).splitNameAndExtension,
	stat: async p => (existing.has(p) ? {isDirectory: () => true} : null),
	readFile: async () => '',
	writeFile: async () => {},
	readdir: async () => [],
	ensureDir: async () => {},
	fsRename: async () => {},
	unlink: async () => {},
	unlinkFile: async () => {},
	fileToAB: async file => file.body,
	report: () => {},
	reportFailure: () => {},
	openDialog: dialog => { asked.push(dialog.message); dialog.onSubmit(conflictAnswer); },
	renderOverlays: () => {},
	refreshCurrentDir: async () => {}
});

const api = new Function(
	'state', 'updateDragHoverFromPoint', 'getAllFileEntries', 'getFileFromFileEntry',
	'addIncomingFile', 'refreshCurrentDir', 'commitPendingDragMove', 'clearTimeout',
	'resolveIncomingRoots', 'rerootIncomingPath',
	code + '\n; return {onDrop, dropEntries};'
)(
	state,
	() => {},
	helpers.getAllFileEntries,
	helpers.getFileFromFileEntry,
	async (file, filePath, folderPath) => { added.push([file.name, filePath, folderPath]); },
	async () => { refreshed++; },
	async () => {},
	() => {},
	ops.resolveIncomingRoots,
	ops.rerootIncomingPath
);

// A folder drop, exactly as Chrome presents one: `files` has the folder in it, and so do
// the items. This is the reported bug.
function drop (entries, files) {
	added = [];
	refreshed = 0;
	return {
		preventDefault () {},
		clientX: 0,
		clientY: 0,
		dataTransfer: {
			getData: () => '',
			files: files || [],
			items: entries.map(entry => ({webkitGetAsEntry: () => entry}))
		}
	};
}

await api.onDrop(drop([tree], [{name: 'pkg', size: 0}]));

check('a dropped folder is walked, not handed to FileReader',
	added.map(entry => entry[0]).sort(), ['LICENSE', 'a.js', 'b.js', 'readme.md']);
check('and each file keeps the path it had inside the folder',
	added.map(entry => entry[1]).sort(),
	['pkg/LICENSE', 'pkg/readme.md', 'pkg/src/a.js', 'pkg/src/b.js']);
// No leading slash. The drag gives "/pkg/readme.md" — rooted at the drag, not at the disk —
// and `onFileHandler` tells a loose file from a folder's contents by looking for a slash, so
// that leading one made a file dropped on its own beside a folder look like folder contents
// and skip the conflict question entirely.
check('and none of those paths starts at the root',
	added.some(entry => String(entry[1]).startsWith('/')), false);
check('the folder itself is never added as a file',
	added.some(entry => entry[0] === 'pkg'), false);
check('and the listing is refreshed once, at the end', refreshed, 1);

// Loose files still take the short path: no entries walk, one call each, name only.
await api.onDrop(drop([fileEntry('/one.txt'), fileEntry('/two.txt')],
	[{name: 'one.txt', size: 4}, {name: 'two.txt', size: 4}]));
check('loose files go straight through dataTransfer.files',
	added.map(entry => entry[0]), ['one.txt', 'two.txt']);
check('with no path, so they land in the current folder',
	added.map(entry => entry[1]), [undefined, undefined]);

// A folder and a loose file dropped together: the presence of a directory decides, and the
// entries walk covers both.
await api.onDrop(drop([tree, fileEntry('/notes.txt')],
	[{name: 'pkg', size: 0}, {name: 'notes.txt', size: 4}]));
check('a mixed drop is walked whole', added.map(entry => entry[0]).sort(),
	['LICENSE', 'a.js', 'b.js', 'notes.txt', 'readme.md']);
check('and the loose file among them reads as a loose file, not as folder contents',
	added.filter(entry => entry[0] === 'notes.txt').map(entry => entry[1]), ['notes.txt']);

// A browser with no entries API at all: `files` is all there is, and a folder cannot be
// read. It must still not throw.
const noEntries = drop([], [{name: 'one.txt', size: 4}]);
noEntries.dataTransfer.items = [];
await api.onDrop(noEntries);
check('a browser with no entries API still takes loose files',
	added.map(entry => entry[0]), ['one.txt']);

// --- the timing rule ----------------------------------------------------------------------
//
// This one cannot be observed in a test: the item list is emptied by the browser, not by
// anything here. So it is checked in the source, where breaking it is visible.

const handler = region('async function onDrop', '\n\t// The shell opens a second Explorer');
const entriesAt = handler.indexOf('dropEntries(e)');
const firstAwait = handler.indexOf('await ');
check('the entries are resolved before the handler awaits anything',
	entriesAt > -1 && entriesAt < firstAwait, true);
check('and the walk no longer keys off dataTransfer.files alone',
	/if \(!files \|\| !files\.length\) \{\s*var entries/.test(handler), false);

// --- where a dropped file lands ---------------------------------------------------------------
//
// Dropping a file onto a folder row used to do nothing at all: the row's own handler claimed
// the event before it knew whether there was anything of ours to move, so it never reached
// here. With that fixed, this handler decides where the file goes — and the folder under the
// pointer is the answer whenever there is one, because that is what dropping it there means.

{
	state.dragHoverFolderPath = null;
	await api.onDrop(drop([], [{name: 'shot.png', size: 10}]));
	check('with the pointer over no folder, a file lands in the folder being shown',
		added.map(entry => entry[2]), ['/home']);
}

{
	state.dragHoverFolderPath = '/home/pics';
	await api.onDrop(drop([], [{name: 'shot.png', size: 10}]));
	check('over a folder row, it lands in that folder', added.map(entry => entry[2]), ['/home/pics']);
	state.dragHoverFolderPath = null;
}

{
	// A whole folder dropped onto a folder row: every file under it goes to the same place,
	// keeping the relative path it arrived with.
	state.dragHoverFolderPath = '/home/pics';
	await api.onDrop(drop([tree], [{name: 'pkg', size: 0}]));
	check('a dropped folder goes there too, all of it',
		added.map(entry => entry[2]), ['/home/pics', '/home/pics', '/home/pics', '/home/pics']);
	check('with the paths inside it intact',
		added.map(entry => entry[1]).sort(),
		['pkg/LICENSE', 'pkg/readme.md', 'pkg/src/a.js', 'pkg/src/b.js']);
	state.dragHoverFolderPath = null;
}

// --- a dropped folder whose name is already taken -------------------------------------------
//
// Reported while walking the checklist: dragging a folder in from the desktop onto a folder
// that already had one of that name merged the two silently, file by file, while dragging the
// same folder between two places *inside* PixOS asked first. The question was skipped because
// a dropped folder arrives one call per file, and asking per file across a few hundred would
// have been worse than the merge. It is asked once now, about the folder itself, here.

{
	existing.add('/home/pkg');
	asked = [];
	conflictAnswer = 'keep';
	await api.onDrop(drop([tree], [{name: 'pkg', size: 0}]));
	check('a dropped folder whose name is taken is asked about', asked.length, 1);
	check('and the question names the folder, not one of the files inside it', asked[0],
		'A folder named "pkg" already exists in /home.');
	check('keeping both writes the whole tree under the free name',
		added.map(entry => entry[1]).sort(),
		['pkg-1/LICENSE', 'pkg-1/readme.md', 'pkg-1/src/a.js', 'pkg-1/src/b.js']);
}

{
	// Cancel means nothing at all, rather than the first file in and the rest not: the root
	// answer is applied before a single write, not discovered part way down.
	asked = [];
	conflictAnswer = 'cancel';
	await api.onDrop(drop([tree], [{name: 'pkg', size: 0}]));
	check('cancelling a dropped folder writes none of it', added, []);
	check('and the listing is still refreshed, so the drop ends cleanly', refreshed, 1);
}

{
	// One root cancelled, one free: the drop is not all-or-nothing.
	const other = dirEntry('/other', [fileEntry('/other/x.txt')]);
	asked = [];
	conflictAnswer = 'cancel';
	await api.onDrop(drop([tree, other], [{name: 'pkg', size: 0}, {name: 'other', size: 0}]));
	check('only the taken name is asked about', asked.length, 1);
	check('and the folder nobody objected to still arrives whole',
		added.map(entry => entry[1]), ['other/x.txt']);
}

{
	// The question is asked about the folder the file is going *into*, which is the one under
	// the pointer whenever there is one — the same rule as everything else in this handler.
	existing.add('/home/pics/pkg');
	state.dragHoverFolderPath = '/home/pics';
	asked = [];
	conflictAnswer = 'keep';
	await api.onDrop(drop([tree], [{name: 'pkg', size: 0}]));
	check('dropped onto a folder row, the conflict is looked for in that folder', asked[0],
		'A folder named "pkg" already exists in /home/pics.');
	state.dragHoverFolderPath = null;
	existing.delete('/home/pics/pkg');
	existing.delete('/home/pkg');
}

{
	// Nothing in the way: no dialog, and the name it arrived with.
	asked = [];
	await api.onDrop(drop([tree], [{name: 'pkg', size: 0}]));
	check('a free name asks nothing', asked, []);
	check('and keeps the name it arrived with',
		added.map(entry => entry[1]).sort(),
		['pkg/LICENSE', 'pkg/readme.md', 'pkg/src/a.js', 'pkg/src/b.js']);
}

process.exit(report('explorer-drop') ? 1 : 0);
