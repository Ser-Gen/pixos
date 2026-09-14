// Archives, from the outside: what the dialogs do in each of their states, when the engine
// is fetched, and what happens to what comes out of it.
//
// Phase 21 moved all of this into apps/explorer/js/archive-ui.js. The engine itself is 1.4 MB
// of WebAssembly that will not load outside a browser, so `importEngine` is a parameter and
// everything below runs against a fake 7-Zip — which is the point: the rules being checked
// are Explorer's rules about archives, not 7-Zip's about compression.
//
// Three of them have cost real work before. Extracting writes into a folder of its own whose
// name is free, because extracting the same archive twice is ordinary and merging into a
// folder somebody has since put files in cannot be undone. A wrong password is a question,
// not a failure, so the dialog stays open and asks again. And a dialog that has been closed
// while the engine was working must not reopen itself over whatever is on screen now.

import fs from 'fs';
import {check, report} from './assert.mjs';
import {createArchiveUi} from '../apps/explorer/js/archive-ui.js';

// --- enough of a DOM to tell the four states apart -----------------------------------------

function node (tag) {
	return {
		tag: tag, className: '', textContent: '', style: {}, value: '', type: '',
		disabled: false, children: [], classes: new Set(),
		get classList () {
			var self = this;
			return {add: function (c) { self.classes.add(c); },
				remove: function (c) { self.classes.delete(c); },
				contains: function (c) { return self.classes.has(c); }};
		},
		append: function () {
			for (var i = 0; i < arguments.length; i++) { this.children.push(arguments[i]); }
		},
		// Only the one form the module uses: a single class selector, matched against the
		// className it was given.
		querySelector: function (selector) {
			var wanted = selector.replace('.', '');
			return allNodes(this).slice(1).find(function (n) {
				return String(n.className).split(/\s+/).indexOf(wanted) !== -1;
			}) || null;
		},
		querySelectorAll: function (selector) {
			var wanted = selector.replace('.', '');
			return allNodes(this).slice(1).filter(function (n) {
				return String(n.className).split(/\s+/).indexOf(wanted) !== -1;
			});
		},
		focused: false,
		focus: function () { this.focused = true; },
		attrs: {},
		setAttribute: function (name, value) { this.attrs[name] = value; },
		getAttribute: function (name) { return this.attrs[name]; },
		addEventListener: function () {}
	};
}

function text (el) {
	return (el.textContent || '') + el.children.map(text).join(' ');
}

function allNodes (el) {
	return [el].concat(el.children.reduce(function (acc, c) { return acc.concat(allNodes(c)); }, []));
}

// --- a filesystem and a 7-Zip that only do what they are asked ------------------------------

function harness (options) {
	options = options || {};
	var log = [];
	var written = {};
	var dirs = [];
	var notes = [];
	var failures = [];
	var opened = [];
	var renders = 0;
	var refreshed = 0;
	var navigated = [];

	var engine = {
		inspect: function (bytes, opts) {
			log.push('inspect:' + opts.name + ':' + (opts.password || ''));
			if (options.inspectThrows) { return Promise.reject(options.inspectThrows); }
			return Promise.resolve(options.listing);
		},
		extract: function (bytes, opts) {
			// Several archives in one go need an answer per archive, not one for all of them.
			if (options.extractFor) {
				log.push('extract-one:' + opts.name);
				return options.extractFor(opts.name);
			}
			log.push('extract:' + (opts.paths || []).join(','));
			if (options.extractThrows) { return Promise.reject(options.extractThrows); }
			return Promise.resolve(options.result);
		},
		compress: function (spec) {
			log.push('compress:' + spec.format + ':' + spec.preset + ':' + spec.files.length);
			if (options.compressThrows) { return Promise.reject(options.compressThrows); }
			return Promise.resolve(options.made || {name: spec.name, data: {length: 4096}});
		},
		// The real one appends a number until the name is free; this is the same contract.
		destinationFor: function (name, taken) {
			var base = name.replace(/\.[^.]+$/, '');
			var candidate = base;
			var n = 2;
			while (taken(candidate)) { candidate = base + ' (' + n++ + ')'; }
			return candidate;
		}
	};

	var state = {cwd: '/notes', items: (options.items || []).slice(), dialog: null,
		selectedPaths: new Set(options.selected || [])};

	var ui = createArchiveUi({
		state: state,
		doc: {createElement: node},
		win: {setTimeout: function (fn) { fn(); }},
		path: {join: function () { return Array.prototype.join.call(arguments, '/').replace(/\/+/g, '/'); }},
		report: function (title, message, level, actions) {
			notes.push({title: title, message: message, level: level, actions: actions});
		},
		reportFailure: function (label, err) { failures.push(label + ': ' + err.message); },
		formatSize: function (n) { return n + ' B'; },
		readFile: function (p) {
			log.push('readFile:' + p);
			if (options.readFails) { return Promise.reject(new Error('EIO')); }
			return Promise.resolve({bytes: p});
		},
		writeFile: function (p, data) {
			if (options.writeFails) { return Promise.reject(new Error('ENOSPC: no space left')); }
			written[p] = data; log.push('writeFile:' + p); return Promise.resolve();
		},
		ensureDir: function (p) { dirs.push(p); log.push('ensureDir:' + p); return Promise.resolve(); },
		listDirectory: function (p) { return Promise.resolve(options.tree ? options.tree[p] || [] : []); },
		writeNewFile: function (folder, name, data, operation) {
			log.push('writeNewFile:' + folder + '/' + name + ':' + operation);
			if (options.writeNewFileThrows) { return Promise.reject(options.writeNewFileThrows); }
			return Promise.resolve(options.writeNewFileRefuses ? false : {name: name});
		},
		openDialog: function (dialog) { opened.push(dialog); state.dialog = dialog; },
		renderOverlays: function () { renders++; },
		refreshCurrentDir: function () { refreshed++; return Promise.resolve(); },
		navigateTo: function (p) { navigated.push(p); },
		getItemByPath: function (p) { return state.items.find(i => i.path === p) || null; },
		getSelectedItems: function () { return state.items.filter(i => state.selectedPaths.has(i.path)); },
		Buffer: {from: function (data) { return {buffered: data}; }},
		importEngine: function () {
			log.push('importEngine');
			if (options.engineFailsOnce && log.filter(l => l === 'importEngine').length === 1) {
				return Promise.reject(new Error('network'));
			}
			return Promise.resolve(engine);
		}
	});

	return {ui: ui, state: state, log: log, written: written, dirs: dirs, notes: notes,
		failures: failures, opened: opened, navigated: navigated, engine: engine,
		renders: function () { return renders; }, refreshed: function () { return refreshed; }};
}

const READY = {entries: [{path: 'a.txt', isDirectory: false}, {path: 'sub', isDirectory: true},
	{path: 'sub/b.txt', isDirectory: false}], unwrapped: false};

// --- the engine arrives once, on the first press --------------------------------------------

{
	const h = harness({listing: READY});
	check('nothing is fetched before an archive is opened',
		h.log.indexOf('importEngine'), -1);
	const first = h.ui.loadArchiveEngine();
	const second = h.ui.loadArchiveEngine();
	check('the second caller gets the same promise, not a second download', first === second, true);
	check('and only one fetch happened', h.log.filter(l => l === 'importEngine').length, 1);
}

{
	const h = harness({listing: READY, engineFailsOnce: true});
	let failed = false;
	try { await h.ui.loadArchiveEngine(); } catch (err) { failed = true; }
	check('a failed load is a failed load', failed, true);
	// Caching the rejection would make every press for the rest of the session replay it.
	let engine = null;
	try { engine = await h.ui.loadArchiveEngine(); } catch (err) { engine = 'still rejecting'; }
	check('but the next press tries again rather than replaying it',
		h.log.filter(l => l === 'importEngine').length, 2);
	check('and gets the engine', engine && typeof engine.inspect, 'function');
}

// --- whose sentence a failure is reported in ------------------------------------------------
//
// A wrong password and a truncated file are the same exit code out of 7-Zip; only its text
// tells them apart. So its sentence is used where there is one.

{
	const h = harness({listing: READY});
	const err = new Error('exit 2');
	err.failure = {title: 'That password is not right', message: 'Nothing was written.'};
	h.ui.reportArchiveFailure('Could not read x.7z', err);
	check('the engine is quoted when it has something to say',
		h.notes.map(n => [n.title, n.level]), [['That password is not right', 'warn']]);
	check('and it is not also reported generically', h.failures, []);

	h.ui.reportArchiveFailure('Could not read x.7z', new Error('undefined is not a function'));
	check('an unexpected exception falls back to the generic reporter',
		h.failures, ['Could not read x.7z: undefined is not a function']);
	check('and raises no second card', h.notes.length, 1);
}

// --- reading an archive ----------------------------------------------------------------------

{
	const h = harness({listing: READY, items: [{name: 'photos.zip'}]});
	await h.ui.openArchiveDialog({name: 'photos.zip', path: '/notes/photos.zip'});
	const dialog = h.state.dialog;
	check('the dialog opens before anything is read', h.opened[0].type, 'archive');
	// Reading an archive to see inside it writes nothing anywhere, which is what makes it
	// safe to do before asking anything at all.
	check('reading writes nothing', Object.keys(h.written), []);
	check('it ends ready', dialog.phase, 'ready');
	check('holding what is inside', dialog.entries.length, 3);
	check('every file is selected and no folder is', [...dialog.selected].sort(), ['a.txt', 'sub/b.txt']);
	// photos.zip would extract into "photos", and "photos" is not taken here.
	check('the destination is a folder beside the archive', dialog.destination, 'photos');
}

{
	const h = harness({listing: READY, items: [{name: 'photos.zip'}, {name: 'photos'}]});
	await h.ui.openArchiveDialog({name: 'photos.zip', path: '/notes/photos.zip'});
	check('and it is never a name that is already taken', h.state.dialog.destination, 'photos (2)');
}

{
	const h = harness({listing: {needsPassword: true, failure: {title: 'This archive is locked'}}});
	await h.ui.openArchiveDialog({name: 'secret.7z', path: '/notes/secret.7z'});
	check('the dialog is still open', h.state.dialog !== null, true);
	check('a locked archive asks instead of failing', h.state.dialog && h.state.dialog.phase, 'password');
	check('with what the engine said above the field',
		h.state.dialog && h.state.dialog.error, 'This archive is locked');
	check('and nothing was reported as a failure', [h.notes.length, h.failures.length], [0, 0]);
}

{
	const h = harness({listing: {failure: {title: 'Damaged archive', message: 'Not readable.'}}});
	await h.ui.openArchiveDialog({name: 'broken.zip', path: '/notes/broken.zip'});
	check('an archive that cannot be read closes the dialog', h.state.dialog, null);
	check('and says why, as a warning rather than an error',
		[h.notes[0].title, h.notes[0].level], ['Damaged archive', 'warn']);
}

{
	const h = harness({inspectThrows: new Error('out of memory')});
	await h.ui.openArchiveDialog({name: 'huge.7z', path: '/notes/huge.7z'});
	check('an engine that throws closes the dialog', h.state.dialog, null);
	check('and is reported', h.failures, ['Could not read huge.7z: out of memory']);
}

// The dialog was closed while the engine was working. Reopening it over whatever is on
// screen now would be worse than useless.
{
	const h = harness({listing: READY});
	const opening = h.ui.openArchiveDialog({name: 'photos.zip', path: '/notes/photos.zip'});
	h.state.dialog = {type: 'rename'};
	await opening;
	check('an answer nobody is waiting for does not reopen the dialog',
		h.state.dialog && h.state.dialog.type, 'rename');
	check('and does not push a second one', h.opened.length, 1);
}

// --- extracting --------------------------------------------------------------------------------

{
	const h = harness({listing: READY, items: [{name: 'photos.zip'}],
		result: {files: [{path: 'a.txt', data: 'A'}, {path: 'sub/b.txt', data: 'B'}], dirs: ['empty']}});
	await h.ui.openArchiveDialog({name: 'photos.zip', path: '/notes/photos.zip'});
	const dialog = h.state.dialog;
	await h.ui.runExtract(dialog, ['a.txt', 'sub/b.txt']);

	check('the selection is passed through, not left to 7-Zip to guess',
		h.log.indexOf('extract:a.txt,sub/b.txt') !== -1, true);
	check('the dialog closes before the files land', h.state.dialog, null);
	check('everything is written under the destination folder',
		Object.keys(h.written).sort(), ['/notes/photos/a.txt', '/notes/photos/sub/b.txt']);
	// An empty folder is part of the archive's shape, and writeFile only makes the ones
	// with something in them.
	check('and an empty folder in the archive is still made', h.dirs.indexOf('/notes/photos/empty') !== -1, true);
	check('the listing is refreshed afterwards', h.refreshed(), 1);
	check('it says what it did', h.notes[0].title, 'Extracted photos.zip');
	check('counting the files', h.notes[0].message.startsWith('2 files into photos/'), true);
	check('and offers to go there', h.notes[0].actions[0].label, 'Open photos');
	h.notes[0].actions[0].run();
	check('which navigates into the folder it made', h.navigated, ['/notes/photos']);
}

{
	const h = harness({listing: READY, result: {files: [{path: 'a.txt', data: 'A'}], dirs: []}});
	await h.ui.openArchiveDialog({name: 'one.zip', path: '/notes/one.zip'});
	await h.ui.runExtract(h.state.dialog, ['a.txt']);
	check('one file is a file, not 1 files', h.notes[0].message.startsWith('1 file into'), true);
}

{
	const h = harness({listing: READY, result: {files: [{path: 'a.txt', data: 'A'}], dirs: [],
		unwrapped: true}});
	await h.ui.openArchiveDialog({name: 'x.tar.gz', path: '/notes/x.tar.gz'});
	await h.ui.runExtract(h.state.dialog, ['a.txt']);
	check('a double-wrapped archive says both layers came off',
		h.notes[0].message.includes('no .tar left over'), true);
}

{
	const h = harness({listing: READY, result: {files: [{path: 'a.txt', data: 'A'}], dirs: [],
		failure: {kind: 'partial', message: 'Two entries were skipped.'}}});
	await h.ui.openArchiveDialog({name: 'x.zip', path: '/notes/x.zip'});
	await h.ui.runExtract(h.state.dialog, ['a.txt']);
	check('a partial extraction says so', h.notes[0].title, 'Extracted part of x.zip');
	check('as a warning, because some of it is missing', h.notes[0].level, 'warn');
	check('and names what went wrong', h.notes[0].message.includes('Two entries were skipped.'), true);
}

// A password is a question, not a failure: the dialog stays open and asks again with what
// went wrong above the field.
{
	const err = new Error('exit 2');
	err.failure = {kind: 'password', title: 'That password is not right'};
	const h = harness({listing: READY, extractThrows: err});
	await h.ui.openArchiveDialog({name: 'secret.7z', path: '/notes/secret.7z'});
	await h.ui.runExtract(h.state.dialog, ['a.txt']);
	check('a wrong password leaves the dialog open', h.state.dialog !== null, true);
	check('back on the password step', h.state.dialog.phase, 'password');
	check('saying what was wrong', h.state.dialog.error, 'That password is not right');
	check('and raises no card over it', [h.notes.length, h.failures.length], [0, 0]);
}

{
	const err = new Error('exit 2');
	err.failure = {kind: 'corrupt', title: 'Damaged archive', message: 'Not readable.'};
	const h = harness({listing: READY, extractThrows: err});
	await h.ui.openArchiveDialog({name: 'broken.zip', path: '/notes/broken.zip'});
	await h.ui.runExtract(h.state.dialog, ['a.txt']);
	check('anything that is not a password closes the dialog', h.state.dialog, null);
	check('and is reported in the engine’s own words', h.notes[0].title, 'Damaged archive');
}

{
	const h = harness({listing: READY, writeFails: true,
		result: {files: [{path: 'a.txt', data: 'A'}], dirs: []}});
	await h.ui.openArchiveDialog({name: 'x.zip', path: '/notes/x.zip'});
	await h.ui.runExtract(h.state.dialog, ['a.txt']);
	check('a disk that refuses the write is reported',
		h.failures, ['Writing the contents of x.zip: ENOSPC: no space left']);
	check('and nothing claims the archive was extracted', h.notes.length, 0);
}

// --- compressing ---------------------------------------------------------------------------------

{
	const h = harness({items: [{name: 'a.txt'}, {name: 'b.txt'}]});
	h.ui.openCompressDialog([{name: 'a.txt', path: '/notes/a.txt', isDirectory: false}]);
	const dialog = h.state.dialog;
	check('the compress dialog opens without fetching the engine',
		h.log.indexOf('importEngine'), -1);
	check('it defaults to 7z', dialog.format, '7z');
	check('and suggests a name ending in that extension', dialog.name.endsWith('.7z'), true);

	const was = dialog.name.replace(/\.7z$/, '');
	dialog.onFormat('zip');
	check('changing the format changes the extension', dialog.name, was + '.zip');
}

{
	// Compressing one a.txt suggests a.7z — so a folder that already holds an a.7z is the
	// case that matters. 7-Zip does not replace an archive it is given the name of, it tries
	// to *add* to it, so a free name here is a requirement rather than a courtesy.
	const h = harness({items: [{name: 'a.7z'}]});
	h.ui.openCompressDialog([{name: 'a.txt', path: '/notes/a.txt', isDirectory: false}]);
	check('a suggested name that is taken is stepped past', h.state.dialog.name, 'a-2.7z');
}

{
	// And the stem the user typed survives a change of format, rather than the field
	// reverting to the default name with a new extension on it.
	const h = harness({items: []});
	h.ui.openCompressDialog([{name: 'a.txt', path: '/notes/a.txt', isDirectory: false}]);
	const dialog = h.state.dialog;
	check('the default name follows the one item being compressed', dialog.name, 'a.7z');
	dialog.onName('my-backup.7z');
	dialog.onFormat('zip');
	check('a name the user typed keeps its stem across a format change', dialog.name, 'my-backup.zip');
}

{
	const h = harness({
		tree: {'/notes/sub': [{name: 'b.txt', path: '/notes/sub/b.txt', isDirectory: false},
			{name: 'deeper', path: '/notes/sub/deeper', isDirectory: true}],
			'/notes/sub/deeper': []},
		made: {name: 'notes.7z', data: {length: 2048}}});
	h.ui.openCompressDialog([
		{name: 'a.txt', path: '/notes/a.txt', isDirectory: false},
		{name: 'sub', path: '/notes/sub', isDirectory: true}]);
	const dialog = h.state.dialog;
	await h.ui.runCompress(dialog);

	check('a folder is walked to the bottom',
		h.log.filter(l => l.startsWith('readFile:')), ['readFile:/notes/a.txt', 'readFile:/notes/sub/b.txt']);
	check('and its empty folders are carried too, because they are part of the shape',
		h.log.indexOf('compress:7z:normal:2') !== -1, true);
	// Through the same funnel every other route that produces a file uses, so a name that
	// has appeared since the dialog opened is asked about rather than written over.
	check('the archive is written through writeNewFile, not straight to disk',
		h.log.filter(l => l.startsWith('writeNewFile:')), ['writeNewFile:/notes/notes.7z:compress']);
	check('nothing was written past it', Object.keys(h.written), []);
	check('the dialog closed', h.state.dialog, null);
	check('the listing was refreshed', h.refreshed(), 1);
	check('and it says what it made', h.notes[0].title, 'Made notes.7z');
	check('with the size and the count', h.notes[0].message, '2048 B from 2 items.');
}

{
	const h = harness({writeNewFileRefuses: true, made: {name: 'notes.7z', data: {length: 10}}});
	h.ui.openCompressDialog([{name: 'a.txt', path: '/notes/a.txt', isDirectory: false}]);
	await h.ui.runCompress(h.state.dialog);
	check('a conflict the user cancelled says nothing happened', h.notes.length, 0);
	check('and does not refresh over their answer', h.refreshed(), 0);
}

{
	const h = harness({compressThrows: new Error('out of memory')});
	h.ui.openCompressDialog([{name: 'a.txt', path: '/notes/a.txt', isDirectory: false}]);
	const name = h.state.dialog.name;
	await h.ui.runCompress(h.state.dialog);
	check('an engine that gives up closes the dialog', h.state.dialog, null);
	check('and says which archive it was', h.failures, ['Could not make ' + name + ': out of memory']);
}

// --- redrawing a dialog that is already open ---------------------------------------------------
//
// openDialog wraps a dialog's callbacks so a throw inside one is reported rather than lost.
// It wraps again every time it is called, so a dialog with four states that re-opened itself
// on each redraw would end up several layers deep in its own error handling.

{
	const h = harness({listing: READY});
	await h.ui.openArchiveDialog({name: 'x.zip', path: '/notes/x.zip'});
	const before = h.opened.length;
	const renders = h.renders();
	h.ui.refreshArchiveDialog(h.state.dialog);
	check('redrawing the live dialog does not re-open it', h.opened.length, before);
	check('it only redraws the overlays', h.renders(), renders + 1);
}

{
	const h = harness({listing: READY});
	const orphan = {type: 'archive', phase: 'ready'};
	h.ui.refreshArchiveDialog(orphan);
	check('but a dialog that is not on screen is opened rather than silently dropped',
		h.state.dialog, orphan);
}

{
	const h = harness({listing: READY});
	await h.ui.openArchiveDialog({name: 'x.zip', path: '/notes/x.zip'});
	const mine = h.state.dialog;
	h.state.dialog = {type: 'rename'};
	h.ui.closeArchiveDialog(mine);
	check('closing a dialog that has been replaced does not close the new one',
		h.state.dialog && h.state.dialog.type, 'rename');
}

// --- the four states look different ----------------------------------------------------------

{
	const h = harness({listing: READY});
	await h.ui.openArchiveDialog({name: 'photos.zip', path: '/notes/photos.zip'});
	const ready = h.ui.buildArchiveDialog(h.state.dialog);
	check('the ready state offers to extract', text(ready).includes('Extract photos.zip'), true);

	const working = h.ui.buildArchiveDialog(Object.assign({}, h.state.dialog, {phase: 'working'}));
	// This build of 7-Zip runs on this thread: the window will not redraw again until it is
	// done, so saying so beats looking frozen.
	check('the working state says the window will hold still',
		text(working).includes('holds everything up'), true);
	check('and its only button is disabled',
		allNodes(working).filter(n => n.tag === 'button').every(b => b.disabled), true);

	const reading = h.ui.buildArchiveDialog(Object.assign({}, h.state.dialog, {phase: 'reading'}));
	check('the reading state says it is reading', text(reading).includes('Reading the archive'), true);

	const locked = h.ui.buildArchiveDialog(Object.assign({}, h.state.dialog,
		{phase: 'password', error: 'That password is not right'}));
	check('the password state repeats what was wrong',
		text(locked).includes('That password is not right'), true);
	check('and offers the distinction the classifier exists for',
		text(locked).includes('damaged rather than locked'), true);
	const field = allNodes(locked).find(n => n.type === 'password');
	check('with a password field to type into', field !== undefined, true);
	// The field is the only thing there worth typing into, and the win.setTimeout it is
	// deferred through is a parameter for exactly this reason.
	check('and the cursor is already in it', field.focused, true);
}

{
	const h = harness({items: []});
	h.ui.openCompressDialog([{name: 'a.txt', path: '/notes/a.txt', isDirectory: false}]);
	const box = h.ui.buildCompressDialog(h.state.dialog);
	check('the compress dialog names every format the rules module knows',
		h.ui.archiveNames.FORMATS.every(f => text(box).includes(f.label)), true);
	check('and every compression preset', h.ui.archiveNames.PRESETS.every(p => text(box).includes(p.label)), true);
}

// --- the three entries in Explorer's action table -------------------------------------------------
//
// Moved here from index.html in phase 21's thirteenth pass. Each is a sentence about which items
// the dialogs get, and the last is the one place several archives are extracted with no dialog.

const zipItem = name => ({name: name, path: '/notes/' + name, isDirectory: false});
const folderItem = name => ({name: name, path: '/notes/' + name, isDirectory: true});

{
	const h = harness({listing: READY, items: [zipItem('photos.zip'), folderItem('sub')]});
	await h.ui.extract('/notes/sub');
	await h.ui.extract('/notes/missing.zip');
	check('Extract does nothing for a folder, or for a path not in the listing', h.opened, []);
	await h.ui.extract('/notes/photos.zip');
	check('and opens the archive dialog for an archive row', h.opened.map(d => [d.type, d.path]),
		[['archive', '/notes/photos.zip']]);
}

{
	const h = harness({listing: READY, items: [zipItem('photos.zip')], selected: ['/notes/photos.zip']});
	await h.ui.extract();
	check('with no row, the selected item', h.opened.map(d => d.path), ['/notes/photos.zip']);
}

{
	const items = [zipItem('a.txt'), zipItem('b.txt'), zipItem('c.txt')];
	const paths = h => h.opened.map(d => d.items.map(i => i.name));

	const inSelection = harness({items: items, selected: ['/notes/a.txt', '/notes/b.txt']});
	inSelection.ui.compress('/notes/a.txt');
	check('Compress on a selected row takes the whole selection', paths(inSelection), [['a.txt', 'b.txt']]);

	const outside = harness({items: items, selected: ['/notes/a.txt', '/notes/b.txt']});
	outside.ui.compress('/notes/c.txt');
	check('on a row outside the selection, only that row', paths(outside), [['c.txt']]);

	const unselected = harness({items: items});
	unselected.ui.compress('/notes/c.txt');
	check('and with nothing selected, that row', paths(unselected), [['c.txt']]);

	const fromMenu = harness({items: items, selected: ['/notes/b.txt']});
	fromMenu.ui.compress();
	check('with no row, the selection', paths(fromMenu), [['b.txt']]);

	const nothing = harness({items: items});
	let threw = null;
	try {
		nothing.ui.compress();
		nothing.ui.compress('/notes/gone.txt');
	}
	catch (err) {
		threw = err.message;
	}
	check('with neither, or a row that is not there, no dialog and no exception', [nothing.opened, threw], [[], null]);
}

{
	const h = harness({items: [folderItem('sub')], selected: ['/notes/sub']});
	let threw = null;
	try {
		await h.ui.extractSelected();
	}
	catch (err) {
		threw = err.message;
	}
	check('Extract all with no files selected does nothing -- not even fetch the engine',
		[h.opened, h.notes, h.log, threw], [[], [], [], null]);
}

{
	const h = harness({listing: READY, items: [zipItem('one.zip'), folderItem('sub')],
		selected: ['/notes/one.zip', '/notes/sub']});
	let threw = null;
	try {
		await h.ui.extractSelected();
	}
	catch (err) {
		threw = err.message;
	}
	check('one file among the selection is the ordinary dialog, with its listing and choices',
		[h.opened.map(d => d.type), h.notes, threw], [['archive'], [], null]);
}

{
	const locked = kind => { const err = new Error('exit 2'); err.failure = {kind: kind, title: 'Locked'}; return err; };
	const broken = new Error('exit 2');
	broken.failure = {kind: 'corrupt', title: 'Not an archive'};
	const outcomes = {
		'ok.zip': Promise.resolve({files: [{path: 'x.txt', data: 'X'}], dirs: []}),
		'locked.7z': Promise.reject(locked('password-needed')),
		'wrong.zip': Promise.reject(locked('password')),
		'bad.rar': Promise.reject(broken),
		'odd.zip': Promise.reject(new Error('boom')),
		'blank.zip': Promise.reject({})
	};
	Object.values(outcomes).forEach(p => p.catch(() => {}));
	const names = Object.keys(outcomes);
	const h = harness({items: names.map(zipItem), selected: names.map(n => '/notes/' + n),
		extractFor: name => outcomes[name]});
	await h.ui.extractSelected();

	check('several are extracted with no dialog, every one attempted however the others went',
		[h.opened, h.log.filter(l => l.startsWith('extract-one:')).map(l => l.slice(12))], [[], names]);
	check('what came out is written into a folder of its own', h.written['/notes/ok/x.txt'], {buffered: 'X'});
	check('the listing is refreshed once, after all of them', h.refreshed(), 1);
	const summary = h.notes[h.notes.length - 1];
	check('and one summary says what happened to each', [summary.title, summary.level],
		['Extracted 1 of 6', 'warn']);
	check('locked ones by name, with what to do about them -- both kinds of password answer',
		summary.message.includes('2 need a password: locked.7z, wrong.zip. Extract those one at a time'), true);
	check('failures in 7-Zip\'s own words, then the error\'s, then just "failed"',
		summary.message.endsWith('bad.rar — Not an archive; odd.zip — boom; blank.zip — failed.'), true);
	check('and it starts with the count that worked', summary.message.startsWith('1 extracted. '), true);
}

{
	const ok = () => Promise.resolve({files: [], dirs: []});
	const h = harness({items: [zipItem('a.zip'), zipItem('b.zip')], selected: ['/notes/a.zip', '/notes/b.zip'],
		extractFor: ok});
	await h.ui.extractSelected();
	const summary = h.notes[h.notes.length - 1];
	check('when every one worked it is information, not a warning',
		[summary.title, summary.message, summary.level], ['Extracted 2 of 2', '2 extracted.', 'info']);
}

{
	const h = harness({items: [zipItem('a.zip'), zipItem('b.zip')], selected: ['/notes/a.zip', '/notes/b.zip'],
		extractFor: () => Promise.reject(new Error('boom'))});
	await h.ui.extractSelected();
	check('when none did, it says nothing was extracted', h.notes[h.notes.length - 1].title, 'Nothing was extracted');
	check('and lists only what failed, with no "0 extracted" in front', h.notes[h.notes.length - 1].message,
		'a.zip — boom; b.zip — boom.');
	check('having still refreshed, since some may have written before failing', h.refreshed(), 1);
}

{
	const locked = () => { const err = new Error('exit 2'); err.failure = {kind: 'password-needed'}; return Promise.reject(err); };
	const h = harness({items: [zipItem('a.7z'), zipItem('b.7z')], selected: ['/notes/a.7z', '/notes/b.7z'],
		extractFor: locked});
	await h.ui.extractSelected();
	const summary = h.notes[h.notes.length - 1];
	check('locked archives alone are a warning too -- nothing failed, but nothing was done',
		[summary.title, summary.level], ['Nothing was extracted', 'warn']);
}

{
	const h = harness({items: [zipItem('a.zip'), zipItem('b.zip')], selected: ['/notes/a.zip', '/notes/b.zip'],
		engineFailsOnce: true, extractFor: () => Promise.resolve({files: [], dirs: []})});
	await h.ui.extractSelected();
	check('an engine that will not load is reported once, as that',
		h.failures, ['The archive engine could not be loaded: network']);
	check('and nothing is read, extracted or refreshed after it',
		[h.log.filter(l => !l.startsWith('importEngine')), h.refreshed(), h.notes], [[], 0, []]);
}

// --- the wiring in index.html -------------------------------------------------------------------

const html = fs.readFileSync(new URL('../apps/explorer/index.html', import.meta.url), 'utf8');

check('index.html builds the archive module', /createArchiveUi\(\{/.test(html), true);
check('and none of it is left behind',
	/function buildArchiveDialog|async function runCompress|async function writeExtracted/.test(html), false);
// The rules module is pure and cheap, and deciding whether a file is an archive must not
// cost a 1.4 MB download — so it comes back out of this module rather than being re-imported.
// The row menu moved into js/menu-items.js in phase 21's ninth pass; it is still handed
// `archiveNames` from here, which is what this now checks on both ends.
const menuItems = fs.readFileSync(new URL('../apps/explorer/js/menu-items.js', import.meta.url), 'utf8');
check('the row menu still knows what an archive is',
	menuItems.includes('archiveNames.isArchiveName(item.name)'), true);
check('and is handed the rules rather than importing them',
	menuItems.includes("from '../../7z/") || menuItems.includes('from "../../7z/'), false);
check('index.html passes them across',
	/archiveNames: archiveNames/.test(html), true);
check('and does not import the rules itself',
	html.includes('from "../7z/js/parse.js"'), false);

process.exit(report('explorer-archive-ui'));
