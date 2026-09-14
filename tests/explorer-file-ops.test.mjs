// Moving and copying things between folders: apps/explorer/js/file-ops.js.
//
// `explorer-files` covers the half that answers "this name is taken, now what" — it has done
// since before any of this was a module. What it never reached is the two loops in front of
// that: `moveItemsToFolder` and `copyItemsToFolder`, which are what a drag onto a folder and
// a paste actually call, and which hold every rule about what must *not* happen.
//
// Four of those rules are one `continue` each, and all four are invisible until the day one
// goes missing: a folder cannot be dropped into itself, a folder cannot be dropped into its
// own descendant (which would move a tree inside itself and lose it), dropping something back
// where it already is does nothing at all, and a failure on one item must not abandon the rest
// of the selection. The last one is why both loops count what they did and only refresh if
// the number is not zero.

import {check, report} from './assert.mjs';
import {createFileOps} from '../apps/explorer/js/file-ops.js';
import {createFormat} from '../apps/explorer/js/format.js';

const pathStub = {
	join: (...parts) => ('/' + parts.join('/')).replace(/\/+/g, '/'),
	basename: p => String(p).split('/').pop(),
	dirname: p => String(p).replace(/\/[^/]*$/, '') || '/',
	extname: p => {
		const base = String(p).split('/').pop();
		const dot = base.lastIndexOf('.');
		return dot > 0 ? base.slice(dot) : '';
	}
};

function harness (options) {
	options = options || {};
	const tree = new Map();
	(options.files || []).forEach(p => tree.set(p, {isDirectory: () => false, body: 'BODY:' + p}));
	(options.dirs || []).forEach(p => tree.set(p, {isDirectory: () => true}));

	const h = {
		tree: tree,
		renamed: [],
		writes: [],
		unlinked: [],
		dirsMade: [],
		prompts: [],
		dialogs: [],
		reported: [],
		refreshes: 0,
		answer: 'cancel',
		renameFails: null,
		state: {cwd: '/home', dialog: null}
	};

	h.ops = createFileOps({
		path: pathStub,
		state: h.state,
		Buffer: {from: x => x},
		shell: {},
		win: {},
		normalizePath: p => String(p).replace(/\/+/g, '/'),
		splitNameAndExtension: createFormat(pathStub).splitNameAndExtension,
		stat: async p => tree.get(p) || null,
		readFile: async p => (tree.get(p) || {}).body || '',
		writeFile: async (p, contents) => {
			h.writes.push(p);
			tree.set(p, {isDirectory: () => false, body: contents});
		},
		readdir: async p => Array.from(tree.keys())
			.filter(k => k.startsWith(p + '/') && k.slice(p.length + 1).indexOf('/') === -1)
			.map(k => k.slice(p.length + 1)),
		ensureDir: async p => { h.dirsMade.push(p); tree.set(p, {isDirectory: () => true}); },
		fsRename: async (from, to) => {
			if (h.renameFails === from) {
				throw Object.assign(new Error('EIO: Input/output error.'), {code: 'EIO'});
			}
			h.renamed.push([from, to]);
			tree.set(to, tree.get(from));
			tree.delete(from);
		},
		unlink: async p => { h.unlinked.push(p); tree.delete(p); },
		unlinkFile: async p => { h.unlinked.push(p); tree.delete(p); },
		fileToAB: async file => file.body,
		report: (title, message) => { h.reported.push([title, message]); },
		reportFailure: (label, err) => { h.reported.push([label, String(err && err.message)]); },
		openDialog: dialog => {
			h.prompts.push(dialog.message);
			h.dialogs.push(dialog);
			dialog.onSubmit(h.answer);
		},
		renderOverlays: () => {},
		refreshCurrentDir: async () => { h.refreshes++; }
	});
	return h;
}

// --- the four rules that are one `continue` each -------------------------------------------

{
	const h = harness({dirs: ['/home', '/home/pics']});
	await h.ops.moveItemsToFolder(['/home/pics'], '/home/pics');
	check('a folder cannot be moved into itself', h.renamed, []);
	check('and nothing is refreshed over it', h.refreshes, 0);
}

{
	// The one that loses a tree rather than failing: /home/pics into /home/pics/summer is a
	// folder swallowing itself, and fsRename does it without complaint.
	const h = harness({dirs: ['/home', '/home/pics', '/home/pics/summer']});
	await h.ops.moveItemsToFolder(['/home/pics'], '/home/pics/summer');
	check('a folder cannot be moved into its own descendant', h.renamed, []);
}

{
	// Two of the three guards cover this one between them — a file already in the target
	// folder has `src === dest` as well as `dirname(src) === target` — so removing either
	// alone changes nothing. That is worth knowing rather than discovering: the third is
	// belt-and-braces, and this checks the behaviour rather than which line produces it.
	const h = harness({dirs: ['/home', '/home/docs'], files: ['/home/a.txt']});
	await h.ops.moveItemsToFolder(['/home/a.txt'], '/home');
	check('dropping something back where it already is does nothing', h.renamed, []);
	check('and asks nothing', h.prompts, []);
}

{
	const h = harness({dirs: ['/home', '/home/docs'], files: ['/home/a.txt', '/home/b.txt', '/home/c.txt']});
	h.renameFails = '/home/b.txt';
	// Caught, not awaited bare: the failure mode being tested is a throw that escapes the
	// loop, and one that does would end this file rather than fail a line of it.
	let escaped = null;
	try { await h.ops.moveItemsToFolder(['/home/a.txt', '/home/b.txt', '/home/c.txt'], '/home/docs'); }
	catch (err) { escaped = err.message; }
	check('nothing escapes the loop', escaped, null);
	check('one refusal does not abandon the rest of the selection',
		h.renamed.map(r => r[1]), ['/home/docs/a.txt', '/home/docs/c.txt']);
	check('and the one that failed is named', h.reported.length, 1);
	check('by the file it was', h.reported[0][0], 'Could not move b.txt');
	check('the folder is still refreshed, because two of them moved', h.refreshes, 1);
}

{
	const h = harness({dirs: ['/home', '/home/docs'], files: ['/home/a.txt']});
	h.renameFails = '/home/a.txt';
	let alone = null;
	try { await h.ops.moveItemsToFolder(['/home/a.txt'], '/home/docs'); }
	catch (err) { alone = err.message; }
	check('a single failure does not escape either', alone, null);
	check('nothing moved means nothing to redraw', h.refreshes, 0);
	check('but the failure is still reported', h.reported.length, 1);
}

{
	const h = harness();
	await h.ops.moveItemsToFolder([], '/home/docs');
	await h.ops.moveItemsToFolder(null, '/home/docs');
	check('an empty move is not an error', h.reported, []);
	check('and touches nothing', h.renamed, []);
}

// --- moving onto a name that is taken -------------------------------------------------------

{
	const h = harness({dirs: ['/home', '/home/docs'], files: ['/home/a.txt', '/home/docs/a.txt']});
	h.answer = 'cancel';
	await h.ops.moveItemsToFolder(['/home/a.txt'], '/home/docs');
	check('a taken name asks before moving', h.prompts.length, 1);
	check('and cancel moves nothing', h.renamed, []);
	check('leaving the file that was there', h.tree.has('/home/docs/a.txt'), true);
}

{
	const h = harness({dirs: ['/home', '/home/docs'], files: ['/home/a.txt', '/home/docs/a.txt']});
	h.answer = 'replace';
	await h.ops.moveItemsToFolder(['/home/a.txt'], '/home/docs');
	check('replace removes the old one first', h.unlinked, ['/home/docs/a.txt']);
	check('then renames over it', h.renamed, [['/home/a.txt', '/home/docs/a.txt']]);
}

{
	const h = harness({dirs: ['/home', '/home/docs'], files: ['/home/a.txt', '/home/docs/a.txt']});
	h.answer = 'rename';
	await h.ops.moveItemsToFolder(['/home/a.txt'], '/home/docs');
	check('save as new name moves it beside the other', h.renamed, [['/home/a.txt', '/home/docs/a-1.txt']]);
	check('and removes nothing', h.unlinked, []);
}

// --- copying, which is the same loop with a different verb -----------------------------------

{
	const h = harness({dirs: ['/home', '/home/docs'], files: ['/home/a.txt']});
	await h.ops.copyItemsToFolder(['/home/a.txt'], '/home/docs');
	check('a copy writes rather than renames', h.writes, ['/home/docs/a.txt']);
	check('and leaves the original where it was', h.tree.has('/home/a.txt'), true);
	check('and redraws once', h.refreshes, 1);
}

{
	const h = harness({dirs: ['/home', '/home/pics'], files: ['/home/pics/one.png']});
	await h.ops.copyItemsToFolder(['/home/pics'], '/home/pics/deeper');
	check('a folder cannot be copied into its own descendant either', h.writes, []);
}

{
	// A folder copy is the recursive one, and the only path here that makes directories.
	const h = harness({
		dirs: ['/home', '/home/src', '/home/src/inner', '/home/dest'],
		files: ['/home/src/a.txt', '/home/src/inner/b.txt']
	});
	await h.ops.copyItemsToFolder(['/home/src'], '/home/dest');
	check('every file under a copied folder arrives',
		h.writes.sort(), ['/home/dest/src/a.txt', '/home/dest/src/inner/b.txt']);
	check('and the folders are made on the way down',
		h.dirsMade.includes('/home/dest/src') && h.dirsMade.includes('/home/dest/src/inner'), true);
}

{
	const h = harness({dirs: ['/home', '/home/dest']});
	let escaped = null;
	try { await h.ops.copyEntryRecursive('/home/gone', '/home/dest/gone'); }
	catch (err) { escaped = err.message; }
	check('copying something that is not there says so', escaped, 'Source not found');
}

{
	const h = harness({dirs: ['/home', '/home/docs'], files: ['/home/a.txt', '/home/b.txt']});
	h.tree.set('/home/a.txt', {isDirectory: () => { throw new Error('EIO: Input/output error.'); }});
	let copyEscaped = null;
	try { await h.ops.copyItemsToFolder(['/home/a.txt', '/home/b.txt'], '/home/docs'); }
	catch (err) { copyEscaped = err.message; }
	check('nothing escapes the copy loop either', copyEscaped, null);
	check('a copy that fails on one item still copies the others', h.writes, ['/home/docs/b.txt']);
	check('and names the one it could not', h.reported[0][0], 'Could not copy a.txt');
}

// --- keep-both counts past what is already there ---------------------------------------------

{
	const h = harness({dirs: ['/home'], files: ['/home/shot.png', '/home/shot-1.png', '/home/shot-2.png']});
	const next = await h.ops.buildIndexedCopyPath('/home', 'shot.png');
	check('the next free indexed name skips the ones taken', next, '/home/shot-3.png');
}

{
	const h = harness({dirs: ['/home'], files: ['/home/notes']});
	check('a name with no extension is indexed too',
		await h.ops.buildIndexedCopyPath('/home', 'notes'), '/home/notes-1');
}

// --- the conflict question names what is actually in the way ----------------------------------

{
	const h = harness({dirs: ['/home', '/home/docs', '/home/docs/report']});
	h.answer = 'cancel';
	await h.ops.resolveIncomingDestination('report', '/home/docs', 'move', false);
	check('a folder in the way is called a folder', h.prompts[0],
		'A folder named "report" already exists in /home/docs.');
}

{
	const h = harness({dirs: ['/home', '/home/docs'], files: ['/home/docs/report.pdf']});
	h.answer = 'cancel';
	await h.ops.resolveIncomingDestination('report.pdf', '/home/docs', 'move', false);
	check('and a file a file', h.prompts[0],
		'A file named "report.pdf" already exists in /home/docs.');
}

{
	// Replacing a folder means deleting whatever is inside it, which is not a thing one
	// click should do — in either direction.
	const h = harness({dirs: ['/home', '/home/docs', '/home/docs/src']});
	let asked = null;
	const ops = createFileOps({
		path: pathStub, state: h.state, Buffer: {from: x => x}, shell: {}, win: {},
		normalizePath: p => p, splitNameAndExtension: createFormat(pathStub).splitNameAndExtension,
		stat: async p => h.tree.get(p) || null,
		readFile: async () => '', writeFile: async () => {}, readdir: async () => [],
		ensureDir: async () => {}, fsRename: async () => {}, unlink: async () => {},
		unlinkFile: async () => {}, fileToAB: async f => f.body,
		report: () => {}, reportFailure: () => {},
		openDialog: d => { asked = d; d.onSubmit('cancel'); },
		renderOverlays: () => {}, refreshCurrentDir: async () => {}
	});
	await ops.resolveIncomingDestination('src', '/home/docs', 'move', true);
	check('a folder onto a folder cannot be replaced', asked.canReplace, false);
	await ops.resolveIncomingDestination('src', '/home/docs', 'move', false);
	check('nor a file onto a folder', asked.canReplace, false);
}

// --- the size check asks the shell, and only when there is one --------------------------------

{
	let askedFor = null;
	const ops = createFileOps({
		path: pathStub, state: {cwd: '/home', dialog: null}, Buffer: {from: x => x},
		shell: {describeWriteLimit: async bytes => { askedFor = bytes; return null; }},
		win: {},
		normalizePath: p => p, splitNameAndExtension: createFormat(pathStub).splitNameAndExtension,
		stat: async () => null, readFile: async () => '', writeFile: async () => {},
		readdir: async () => [], ensureDir: async () => {}, fsRename: async () => {},
		unlink: async () => {}, unlinkFile: async () => {}, fileToAB: async f => f.body,
		report: () => {}, reportFailure: () => {}, openDialog: () => {},
		renderOverlays: () => {}, refreshCurrentDir: async () => {}
	});
	check('a file of a known size is measured', await ops.refuseOversizedFile({name: 'big', size: 999}), false);
	check('by the shell, which owns the limit', askedFor, 999);
	askedFor = null;
	check('a file with no size is not measured at all',
		await ops.refuseOversizedFile({name: 'x', size: 0}), false);
	// The answer alone cannot tell the two apart — a limit that says nothing and a limit
	// never consulted both come back false. Whether the shell was asked can.
	check('and the shell is not asked about it', askedFor, null);
}

{
	// Standalone: `shell` and `win` are the same object, so there is nobody to ask. The
	// write is attempted and reports whatever it reports.
	const same = {};
	const ops = createFileOps({
		path: pathStub, state: {cwd: '/home', dialog: null}, Buffer: {from: x => x},
		shell: same, win: same,
		normalizePath: p => p, splitNameAndExtension: createFormat(pathStub).splitNameAndExtension,
		stat: async () => null, readFile: async () => '', writeFile: async () => {},
		readdir: async () => [], ensureDir: async () => {}, fsRename: async () => {},
		unlink: async () => {}, unlinkFile: async () => {}, fileToAB: async f => f.body,
		report: () => {}, reportFailure: () => {}, openDialog: () => {},
		renderOverlays: () => {}, refreshCurrentDir: async () => {}
	});
	check('with no shell to ask, nothing is refused in advance',
		await ops.refuseOversizedFile({name: 'big', size: 999999999}), false);
}

// --- a file arriving from outside, and where it is told to land --------------------------------
//
// `folderPath` defaults to the folder being shown, which is every caller but one: a file
// dropped onto a *folder row* goes into that folder. Before this, the row's own drop handler
// claimed the event and the file went nowhere at all.

{
	const h = harness({dirs: ['/home', '/home/pics']});
	await h.ops.onFileHandler({name: 'shot.png', body: 'PNG', size: 3});
	check('with nowhere named, a file lands in the folder being shown', h.writes, ['/home/shot.png']);
}

{
	const h = harness({dirs: ['/home', '/home/pics']});
	await h.ops.onFileHandler({name: 'shot.png', body: 'PNG', size: 3}, null, '/home/pics');
	check('named a folder, it lands in that one', h.writes, ['/home/pics/shot.png']);
	check('and the folder being shown is not touched', h.tree.has('/home/shot.png'), false);
}

{
	// The nested-path route, which a dropped folder takes: the relative path is kept and
	// hung off the destination rather than off the current folder.
	const h = harness({dirs: ['/home', '/home/pics']});
	await h.ops.onFileHandler({name: 'a.js', body: 'JS', size: 2}, 'pkg/src/a.js', '/home/pics');
	check('a path from inside a dropped folder keeps its shape under the destination',
		h.writes, ['/home/pics/pkg/src/a.js']);
}

{
	const h = harness({dirs: ['/home', '/home/pics'], files: ['/home/pics/shot.png']});
	h.answer = 'cancel';
	await h.ops.onFileHandler({name: 'shot.png', body: 'PNG', size: 3}, null, '/home/pics');
	check('a taken name in the destination folder is still asked about', h.prompts.length, 1);
	check('and names that folder, not the one being shown', h.prompts[0],
		'A file named "shot.png" already exists in /home/pics.');
	check('cancel writes nothing', h.writes, []);
}

{
	const h = harness({dirs: ['/home', '/home/pics']});
	await h.ops.addIncomingFile({name: 'shot.png', body: 'PNG', size: 3}, null, '/home/pics');
	check('addIncomingFile passes the destination through', h.writes, ['/home/pics/shot.png']);
}

// --- the root of a dropped folder ----------------------------------------------------------
//
// A dropped folder arrives one call per file, so the conflict question cannot be asked where
// every other one is asked — it would be asked a few hundred times. `resolveIncomingRoots`
// asks it once per top-level folder in the drop, and `rerootIncomingPath` is what carries that
// one answer down to every file below it.

{
	const h = harness({dirs: ['/home', '/home/pkg']});
	h.answer = 'keep';
	const mapping = await h.ops.resolveIncomingRoots(['pkg'], '/home');
	check('a taken root is asked about once', h.prompts.length, 1);
	check('and the question is about the folder', h.prompts[0],
		'A folder named "pkg" already exists in /home.');
	check('keep both resolves it to a free name', mapping, {pkg: 'pkg-1'});
}

{
	const h = harness({dirs: ['/home']});
	const mapping = await h.ops.resolveIncomingRoots(['pkg'], '/home');
	check('a free root asks nothing', h.prompts, []);
	check('and keeps its own name', mapping, {pkg: 'pkg'});
}

{
	const h = harness({dirs: ['/home', '/home/pkg']});
	h.answer = 'cancel';
	const mapping = await h.ops.resolveIncomingRoots(['pkg'], '/home');
	check('cancel resolves the root to nothing', mapping, {pkg: null});
}

{
	// A file in the way of a folder, which is still a conflict. Neither can replace the other
	// -- one command never replaces a directory, in either direction -- so the dialog must not
	// offer Replace here, however ordinary the thing in the way looks.
	const h = harness({dirs: ['/home'], files: ['/home/pkg']});
	h.answer = 'keep';
	await h.ops.resolveIncomingRoots(['pkg'], '/home');
	check('a file in the way of a dropped folder is a conflict too', h.prompts.length, 1);
	check('and it is named as a file, because that is what is there', h.prompts[0],
		'A file named "pkg" already exists in /home.');
	check('with no Replace offered, since the thing arriving is a folder',
		h.dialogs[0].canReplace, false);
}

{
	const h = harness({dirs: ['/home', '/home/pkg']});
	h.answer = 'keep';
	await h.ops.resolveIncomingRoots(['pkg', 'pkg'], '/home');
	check('the same root twice in one drop is asked about once', h.prompts.length, 1);
}

{
	const h = harness({dirs: ['/home']});
	const reroot = h.ops.rerootIncomingPath;
	check('the leading slash the drag adds is dropped', reroot('/notes.txt', {}), 'notes.txt');
	check('so a top-level file reads as a loose name and takes the question with it',
		reroot('/notes.txt', {}).indexOf('/'), -1);
	check('a file below a renamed root follows the rename',
		reroot('/pkg/src/a.js', {pkg: 'pkg-1'}), 'pkg-1/src/a.js');
	check('a file below a cancelled root is not written at all',
		reroot('/pkg/src/a.js', {pkg: null}), null);
	check('a root nobody resolved is left as it is',
		reroot('/other/x.txt', {pkg: 'pkg-1'}), 'other/x.txt');
	check('and so is one with no mapping at all',
		reroot('/other/x.txt', null), 'other/x.txt');
	check('a path of nothing but slashes is nothing', reroot('///', {}), null);
	check('and neither an empty path nor a missing one throws',
		[reroot('', {}), reroot(undefined, {})], [null, null]);
	check('a root whose replacement is its own name changes nothing',
		reroot('/pkg/a.js', {pkg: 'pkg'}), 'pkg/a.js');
}

report('explorer-file-ops');
