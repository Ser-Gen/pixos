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

const source = fs.readFileSync(new URL('../apps/explorer/index.html', import.meta.url), 'utf8');

function region (from, to) {
	const start = source.indexOf(from);
	const end = source.indexOf(to, start);
	if (start === -1 || end === -1) {
		console.error('explorer-drop.test.mjs: could not find "' + from + '"');
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
		file: cb => cb({name: fullPath.split('/').pop(), body: body || 'BODY', size: 4})
	};
}

function dirEntry (fullPath, children) {
	return {
		isFile: false,
		isDirectory: true,
		fullPath: fullPath,
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

const code = region('async function onDrop', '\n\tasync function moveItemsToFolder');

let added, refreshed;

const state = {dragPaths: [], dragHoverFolderPath: null, cwd: '/home'};

const api = new Function(
	'state', 'updateDragHoverFromPoint', 'getAllFileEntries', 'getFileFromFileEntry',
	'addIncomingFile', 'refreshCurrentDir', 'commitPendingDragMove', 'clearTimeout',
	code + '\n; return {onDrop, dropEntries};'
)(
	state,
	() => {},
	helpers.getAllFileEntries,
	helpers.getFileFromFileEntry,
	async (file, filePath) => { added.push([file.name, filePath]); },
	async () => { refreshed++; },
	async () => {},
	() => {}
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
	['/pkg/LICENSE', '/pkg/readme.md', '/pkg/src/a.js', '/pkg/src/b.js']);
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

const handler = region('async function onDrop', '\n\tasync function moveItemsToFolder');
const entriesAt = handler.indexOf('dropEntries(e)');
const firstAwait = handler.indexOf('await ');
check('the entries are resolved before the handler awaits anything',
	entriesAt > -1 && entriesAt < firstAwait, true);
check('and the walk no longer keys off dataTransfer.files alone',
	/if \(!files \|\| !files\.length\) \{\s*var entries/.test(handler), false);

process.exit(report('explorer-drop') ? 1 : 0);
