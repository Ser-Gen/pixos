// Dialogs: what opening one does to its callbacks, what closing one answers, and where the
// focus lands.
//
// Phase 21 moved this into apps/explorer/js/dialogs.js. Three rules in here have each cost a
// real bug, and none of them is visible from a call site:
//
//   * Every `on*`-shaped callback is wrapped when the dialog opens, because a submit handler
//     runs long after the action that opened it has returned — the wrapper around `actions`
//     is off the stack by then. A rename onto a file another window had just deleted reported
//     itself as "Uncaught (in promise)" in a console nobody had open, and as nothing on screen.
//   * The submit latch has to *release* when a handler declines, or an empty filename leaves
//     the dialog alive but deaf: every later click and Enter swallowed, Cancel the only way out.
//   * The focus never lands on a checkbox, and on a filename field it selects the stem only —
//     typing over "report" has to keep ".final.pdf" or the autofocus is something to undo.
//
// The markup for each dialog type goes through `innerHTML`, which is not worth reimplementing
// here; `tests/explorer-files.test.mjs` and `tests/explorer-keys.test.mjs` read that source
// directly. What is below is everything that is logic rather than markup.

import fs from 'fs';
import {check, report} from './assert.mjs';
import {createDialogs} from '../apps/explorer/js/dialogs.js';
import {createFailure} from '../apps/explorer/js/failure.js';
import {createFormat} from '../apps/explorer/js/format.js';

// The real one, not a stand-in: where the selection ends is the whole point of the check below.
const {basenameEnd} = createFormat({join: function () { return ''; }});

// --- as much DOM as the logic touches --------------------------------------------------------

function el (tag, className) {
	return {
		tag: tag, className: className || '', innerHTML: '', value: '', type: '',
		tagName: (tag || 'div').toUpperCase(), dataset: {}, children: [],
		focused: false, selection: null, onclick: null, onkeydown: null,
		append: function () {
			for (var i = 0; i < arguments.length; i++) { this.children.push(arguments[i]); }
		},
		focus: function () { this.focused = true; },
		select: function () { this.selection = 'all'; },
		setSelectionRange: function (from, to) {
			if (this.refuseSelection) { throw new Error('this input type does not support selection'); }
			this.selection = [from, to];
		},
		// Only the forms the module uses: one class, or the comma-separated list in
		// focusDialogInput.
		querySelector: function (selector) { return this.querySelectorAll(selector)[0] || null; },
		querySelectorAll: function (selector) {
			var self = this;
			var wants = selector.split(',').map(function (s) { return s.trim(); });
			var all = [];
			(function walk (node) {
				node.children.forEach(function (c) { all.push(c); walk(c); });
			})(self);
			return all.filter(function (node) {
				return wants.some(function (want) {
					if (want.charAt(0) === '.') {
						return String(node.className).split(/\s+/).indexOf(want.slice(1)) !== -1;
					}
					if (want.indexOf(':not([type="checkbox"])') !== -1) {
						return node.tag === want.split(':')[0] && node.type !== 'checkbox';
					}
					return node.tag === want;
				});
			});
		}
	};
}

function harness (options) {
	options = options || {};
	var renders = 0;
	var notes = [];
	var shellCalls = [];

	var state = {dialog: null};
	var win = {addEventListener: function () {}, MediaRecorder: {isTypeSupported: function () { return true; }}};
	var shell = {
		notify: function (note) { notes.push(note); },
		setDefaultAppForExtension: options.noShellStorage ? undefined : function (ext, appId) {
			shellCalls.push('set:' + ext + ':' + appId); return Promise.resolve();
		},
		clearDefaultAppForExtension: options.noShellStorage ? undefined : function (ext) {
			shellCalls.push('clear:' + ext); return Promise.resolve();
		}
	};

	var failure = createFailure({
		shell: shell, win: win, doc: {addEventListener: function () {}}, nav: {},
		openInfoDialog: function () {}
	});

	var built = [];
	var dialogs = createDialogs({
		state: state,
		doc: {createElement: el},
		win: win,
		shell: shell,
		guarded: failure.guarded,
		readableActionName: failure.readableActionName,
		renderOverlays: function () { renders++; },
		escapeHtml: function (s) { return String(s); },
		escapeAttr: function (s) { return String(s); },
		basenameEnd: basenameEnd,
		getDefaultAppRows: function () { return Promise.resolve(options.rows || []); },
		getInstalledAppsForPicker: function () { return options.picker || []; },
		isAppCompatibleWithExtension: function (appId, ext) {
			return Promise.resolve(!options.incompatible);
		},
		normalizeExtensionInput: function (value) {
			return String(value || '').trim().replace(/^\./, '').toLowerCase();
		},
		buildArchiveDialog: function (d) { built.push('archive:' + d.name); return el('div', 'FakeArchive'); },
		buildCompressDialog: function (d) { built.push('compress:' + d.name); return el('div', 'FakeCompress'); }
	});

	return {dialogs: dialogs, state: state, notes: notes, shellCalls: shellCalls, built: built,
		renders: function () { return renders; }};
}

// --- opening one wraps everything on it ------------------------------------------------------

{
	const h = harness();
	let ran = 0;
	const dialog = {type: 'rename', onSubmit: function () { ran++; }, oldName: 'a.txt'};
	const original = dialog.onSubmit;
	h.dialogs.openDialog(dialog);

	check('the dialog is on screen', h.state.dialog, dialog);
	check('and the overlays were drawn', h.renders(), 1);
	check('its callback was replaced with a wrapped one', dialog.onSubmit === original, false);
	dialog.onSubmit();
	check('and the wrapper still calls through', ran, 1);
}

{
	const h = harness();
	// Whatever is on*-shaped, rather than a list of the callbacks that exist today: a list is
	// a thing to forget to add to, and forgetting is the failure this is here to prevent.
	const dialog = {type: 'rename', onSubmit: function () {}, onPick: function () {},
		onSomethingAddedNextYear: function () {}, oldName: 'a', notACallback: function () {}};
	const before = Object.assign({}, dialog);
	h.dialogs.openDialog(dialog);
	check('every on*-shaped callback is wrapped',
		['onSubmit', 'onPick', 'onSomethingAddedNextYear'].map(n => dialog[n] === before[n]),
		[false, false, false]);
	check('and nothing else is', dialog.notACallback === before.notACallback, true);
}

{
	const h = harness();
	const dialog = {type: 'rename', onSubmit: function () { throw new Error('the file is gone'); }};
	h.dialogs.openDialog(dialog);
	dialog.onSubmit();
	check('a throw inside a submit handler is reported rather than lost', h.notes.length, 1);
	check('under a readable name for the dialog it came from',
		h.notes[0].title, 'Rename failed');
}

{
	const h = harness();
	const dialog = {type: 'pasteConflict',
		onSubmit: function () { return Promise.reject(new Error('EBUSY')); }};
	h.dialogs.openDialog(dialog);
	await dialog.onSubmit();
	check('a rejected promise is caught too — this is the one that escaped into nothing',
		h.notes.map(n => n.title), ['Paste conflict failed']);
}

{
	const h = harness();
	const dialog = {type: 'rename', onSubmit: 'not a function', oldName: 'a'};
	h.dialogs.openDialog(dialog);
	check('an on*-shaped thing that is not a function is left alone', dialog.onSubmit, 'not a function');
}

{
	const h = harness();
	h.dialogs.openDialog(null);
	check('opening nothing closes what was there', h.state.dialog, null);
	check('and still redraws', h.renders(), 1);
}

// --- closing one -------------------------------------------------------------------------------

{
	const h = harness();
	const answers = [];
	h.dialogs.openDialog({type: 'pasteConflict', onSubmit: function (a) { answers.push(a); }});
	h.dialogs.closeDialog();
	check('a conflict closed without a choice answers cancel', answers, ['cancel']);
	check('and the dialog is gone', h.state.dialog, null);
}

{
	const h = harness();
	const answers = [];
	h.dialogs.openDialog({type: 'pasteConflict', onSubmit: function (a) { answers.push(a); }});
	h.dialogs.closeDialog('replace');
	check('a choice is passed through as it was made', answers, ['replace']);
}

{
	const h = harness();
	let called = 0;
	h.dialogs.openDialog({type: 'rename', onSubmit: function () { called++; }});
	h.dialogs.closeDialog();
	// Only pasteConflict has a caller waiting on an answer; submitting every other dialog on
	// its way out would perform the operation the user just dismissed.
	check('closing any other dialog does not submit it', called, 0);
	check('and it is still closed', h.state.dialog, null);
}

{
	const h = harness();
	const renders = h.renders();
	let threw = null;
	try { h.dialogs.closeDialog(); } catch (err) { threw = err.message; }
	check('closing when nothing is open does not reach for the dialog that is not there', threw, null);
	check('and does nothing at all', h.renders(), renders);
}

{
	const h = harness();
	h.dialogs.openInfoDialog('Default apps', 'Extension is required');
	check('an info dialog is a dialog like any other',
		[h.state.dialog.type, h.state.dialog.title, h.state.dialog.message],
		['info', 'Default apps', 'Extension is required']);
}

// --- the submit latch ----------------------------------------------------------------------------

function panelWith (options) {
	const panel = el('div', 'Modal__panel');
    if (options.cancel !== false) { panel.append(el('button', 'Dialog__cancel')); }
    if (options.submit !== false) { panel.append(el('button', 'Dialog__submit')); }
	return panel;
}

{
	const h = harness();
	const panel = panelWith({});
	let submits = 0;
	h.dialogs.wireSimpleDialog(panel, function () { submits++; });

	panel.querySelector('.Dialog__submit').onclick();
	panel.onkeydown({key: 'Enter', target: {tagName: 'INPUT'},
		preventDefault: function () {}, stopPropagation: function () {}});
	// A click and an Enter can both arrive for one press. Two submits is two files created,
	// or a rename performed twice.
	check('a click and an Enter together submit once', submits, 1);
}

{
	const h = harness();
	const panel = panelWith({});
	let submits = 0;
	// `false` means the handler declined — an empty filename, say — and left the dialog open.
	// The latch has to release, or every later click is swallowed and the dialog is dead.
	h.dialogs.wireSimpleDialog(panel, function () { submits++; return submits === 1 ? false : undefined; });

	panel.querySelector('.Dialog__submit').onclick();
	check('the declined submit ran', submits, 1);
	panel.querySelector('.Dialog__submit').onclick();
	check('and the dialog is still listening afterwards', submits, 2);
	panel.querySelector('.Dialog__submit').onclick();
	check('but once it goes through, it latches for good', submits, 2);
}

{
	const h = harness();
	const panel = panelWith({});
	let submits = 0;
	let prevented = 0;
	let stopped = 0;
	h.dialogs.wireSimpleDialog(panel, function () { submits++; });
	panel.onkeydown({key: 'Enter', target: {tagName: 'TEXTAREA'},
		preventDefault: function () { prevented++; }, stopPropagation: function () { stopped++; }});
	check('Enter inside a textarea is a newline, not a submit', submits, 0);
	check('and is left entirely alone', [prevented, stopped], [0, 0]);

	panel.onkeydown({key: 'Escape', target: {tagName: 'INPUT'},
		preventDefault: function () { prevented++; }, stopPropagation: function () { stopped++; }});
	check('and so is every other key', [submits, prevented, stopped], [0, 0, 0]);
}

{
	const h = harness();
	const panel = panelWith({});
	let stopped = 0;
	h.dialogs.wireSimpleDialog(panel, function () {});
	panel.onkeydown({key: 'Enter', target: {tagName: 'INPUT'},
		preventDefault: function () {}, stopPropagation: function () { stopped++; }});
	// preventDefault stops the default action, not the bubble. Without the stop the event
	// still reached the document handler, which opened the path the dialog had just renamed
	// away from.
	check('Enter does not reach the window behind the dialog', stopped, 1);
}

{
	const h = harness();
	const panel = panelWith({});
	h.dialogs.openDialog({type: 'rename'});
	h.dialogs.wireSimpleDialog(panel, function () {});
	panel.querySelector('.Dialog__cancel').onclick();
	check('Cancel closes the dialog', h.state.dialog, null);
}

{
	const h = harness();
	const panel = panelWith({cancel: false, submit: false});
	let threw = null;
	try { h.dialogs.wireSimpleDialog(panel, function () {}); }
	catch (err) { threw = err.message; }
	check('a panel with neither button is wired without complaint', threw, null);
}

// --- where the focus lands -------------------------------------------------------------------------

{
	const h = harness();
	const root = el('div');
	const input = el('input', 'Dialog__input');
	input.value = 'report.final.pdf';
	input.dataset.selectBasename = '';
	root.append(input);
	h.dialogs.focusDialogInput(root);
	check('the field takes the focus', input.focused, true);
	// Everything up to the last dot. Typing straight over it keeps ".pdf", which is what
	// makes the autofocus useful rather than something to undo before you can use it.
	check('and a filename field leaves the extension out of the selection',
		[input.selection, input.value.slice(0, input.selection[1])], [[0, 12], 'report.final']);
}

{
	const h = harness();
	const root = el('div');
	const input = el('input', 'Dialog__input');
	input.value = 'https://example.com/a.zip';
	root.append(input);
	h.dialogs.focusDialogInput(root);
	check('a field that is not a filename selects all of itself', input.selection, 'all');
}

{
	const h = harness();
	const root = el('div');
	const box = el('input', 'Explorer__entry');
	box.type = 'checkbox';
	const text = el('input', 'Dialog__input');
	root.append(box, text);
	h.dialogs.focusDialogInput(root);
	// The archive dialog is a list of checkboxes and made this visible: focusing the first
	// one buries the field the dialog is actually asking you to use.
	check('a checkbox is never what gets focused', [box.focused, text.focused], [false, true]);
}

{
	const h = harness();
	const root = el('div');
	const submit = el('button', 'Dialog__submit');
	root.append(el('div', 'Modal__title'), submit);
	h.dialogs.focusDialogInput(root);
	// So Enter confirms the dialog rather than falling through to the window behind it.
	check('a dialog with no field focuses its default button instead', submit.focused, true);
}

{
	const h = harness();
	const root = el('div');
	root.append(el('div', 'Modal__title'));
	let threw = null;
	try { h.dialogs.focusDialogInput(root); } catch (err) { threw = err.message; }
	check('and a dialog with neither is not an error', threw, null);
}

{
	const h = harness();
	const root = el('div');
	const input = el('input', 'Dialog__input');
	input.refuseSelection = true;
	input.dataset.selectBasename = '';
	root.append(input);
	let threw = null;
	try { h.dialogs.focusDialogInput(root); } catch (err) { threw = err.message; }
	check('an input type that refuses a selection is still focused', input.focused, true);
	check('and does not take the dialog down with it', threw, null);
}

{
	const h = harness();
	const root = el('div');
	const area = el('textarea', 'Dialog__content');
	root.append(area);
	h.dialogs.focusDialogInput(root);
	check('a textarea is focused but not selected', [area.focused, area.selection], [true, null]);
}

// --- the archive dialogs are drawn by the module that owns them -------------------------------------

{
	const h = harness();
	h.dialogs.buildDialogNode({type: 'archive', name: 'photos.zip', phase: 'ready'});
	h.dialogs.buildDialogNode({type: 'compress', name: 'notes.7z', phase: 'ready'});
	// The one place the dependency runs the other way: js/archive-ui.js opens its dialogs
	// through openDialog, and this draws them.
	check('buildDialogNode hands archive dialogs to the archive module',
		h.built, ['archive:photos.zip', 'compress:notes.7z']);
}

// --- setting a default app -------------------------------------------------------------------------

{
	const h = harness();
	check('an empty extension is refused', await h.dialogs.saveDefaultAppAssociation('', 'ace'), false);
	check('and says which field is missing', h.state.dialog.message, 'Extension is required');

	check('so is a missing app', await h.dialogs.saveDefaultAppAssociation('txt', ''), false);
	check('with its own reason', h.state.dialog.message, 'Application is required');
	check('and the shell was never asked', h.shellCalls, []);
}

{
	const h = harness();
	check('a good pair is written', await h.dialogs.saveDefaultAppAssociation('.TXT', 'ace'), true);
	// Normalised on the way in, so `.TXT`, `TXT` and `txt` are one association rather than three.
	check('with the extension normalised first', h.shellCalls, ['set:txt:ace']);
}

{
	const h = harness({incompatible: true});
	check('an app that cannot open the extension is refused',
		await h.dialogs.saveDefaultAppAssociation('txt', 'media-player'), false);
	check('and named in the reason', h.state.dialog.message, 'Selected app does not support .txt');
	check('nothing was written', h.shellCalls, []);
}

{
	const h = harness({noShellStorage: true});
	let refused = null;
	let blew = null;
	try { refused = await h.dialogs.saveDefaultAppAssociation('txt', 'ace'); }
	catch (err) { blew = err.message; }
	check('a shell with nowhere to store it is not called into', blew, null);
	check('it says so rather than failing quietly', refused, false);
	check('in as many words', h.state.dialog && h.state.dialog.message,
		'Default app storage is unavailable');
}

{
	const h = harness();
	check('clearing normalises the same way', await h.dialogs.clearDefaultAppAssociation('.TXT'), true);
	check('and reaches the shell', h.shellCalls, ['clear:txt']);
	check('clearing nothing is not an error', await h.dialogs.clearDefaultAppAssociation(''), false);
	check('and is silent, because there was nothing to tell anyone about',
		[h.notes.length, h.state.dialog], [0, null]);
}

{
	const h = harness({rows: [{extension: 'txt', appId: 'ace'}], picker: [{id: 'ace', name: 'Ace'}]});
	const dialog = await h.dialogs.buildDefaultAppsManagerDialog('md');
	check('the manager carries the rows it was given', dialog.rows, [{extension: 'txt', appId: 'ace'}]);
	check('and the apps that could be added', dialog.addableApps, [{id: 'ace', name: 'Ace'}]);
	check('with the extension it was opened for prefilled', dialog.prefillExtension, 'md');

	await dialog.onSave('json', 'ace');
	check('saving writes through the same checked path', h.shellCalls, ['set:json:ace']);
	// Rebuilt rather than patched, because the rows are what the shell says they are.
	check('and the dialog is rebuilt around the new row', h.state.dialog.prefillExtension, 'json');
}

{
	const h = harness({incompatible: true});
	const dialog = await h.dialogs.buildDefaultAppsManagerDialog('');
	await dialog.onSave('txt', 'media-player');
	check('a refused save does not reopen the manager over the reason it gave',
		h.state.dialog.type, 'info');
}

// --- the wiring in index.html --------------------------------------------------------------------------

const html = fs.readFileSync(new URL('../apps/explorer/index.html', import.meta.url), 'utf8');

check('index.html builds the dialog module', /createDialogs\(\{/.test(html), true);
check('and none of it is left behind',
	/function buildDialogNode|function wireSimpleDialog|function openDialog /.test(html), false);
// createFailure is the first statement in openExplorer and openInfoDialog is assigned well
// after it. Passing the name directly would hand it `undefined` for the life of the window.
check('failure.js gets openInfoDialog late-bound, because it is built before this module',
	/openInfoDialog: function \(title, message\) \{ return openInfoDialog\(title, message\); \}/.test(html), true);
check('and the archive builders go in late-bound too, which is where the cycle is broken',
	/buildArchiveDialog: function \(dialog\) \{ return buildArchiveDialog\(dialog\); \}/.test(html), true);

process.exit(report('explorer-dialogs'));
