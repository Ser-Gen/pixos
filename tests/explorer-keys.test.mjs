// Explorer's global keyboard handler.
//
// Every branch in it acts on the current *selection*, which makes it dangerous in exactly
// one way: a keystroke meant for a text field must never reach it. That guard used to be
// repeated on each branch and was missing from the two destructive ones, so pressing
// Delete while renaming a file deleted the file.
//
// The handler is extracted from index.html rather than duplicated here, so these tests
// fail loudly if it is reorganised — the failure mode being watched for is "someone added
// a branch and forgot the guard", and a copy of the code could not see that happen.

import fs from 'fs';
import path from 'path';
import {check, report} from './assert.mjs';
import {createFormat} from '../apps/explorer/js/format.js';

const source = fs.readFileSync(new URL('../apps/explorer/index.html', import.meta.url), 'utf8');

const START = "document.addEventListener('keydown', function (e) {";
const END = "document.addEventListener('paste'";
const start = source.indexOf(START);
const end = source.indexOf(END, start);
if (start === -1 || end === -1) {
	console.error('explorer-keys.test.mjs: could not find the keydown handler in apps/explorer/index.html');
	process.exit(1);
}
const region = source.slice(start, end);

// --- a document that hands the handler back ------------------------------------------

const calls = [];
const record = name => () => calls.push(name);

const state = {dialog: null, selectedPaths: new Set()};
const actions = {
	deleteSelected: record('delete'),
	open: path => calls.push('open:' + path),
	copySelected: record('copy'),
	cutSelected: record('cut'),
	pasteClipboard: record('paste')
};

const captured = {};
const documentStub = {
	addEventListener (type, fn) {
		captured[type] = fn;
	}
};

new Function(
	'document', 'state', 'actions', 'isEditableTarget', 'closeDialog', 'closeContextMenu',
	'renderOverlays', 'setAllSelection', 'hasInternalClipboard',
	region
)(
	documentStub, state, actions,
	node => !!(node && node.editable),
	record('closeDialog'), record('closeContextMenu'), record('renderOverlays'),
	record('selectAll'), () => true
);

const onKeyDown = captured.keydown;
check('the handler was registered on the document', typeof onKeyDown, 'function');

const GRID = {editable: false};
const FIELD = {editable: true};

function press (key, target, extra) {
	calls.length = 0;
	onKeyDown(Object.assign({
		key: key,
		target: target || GRID,
		ctrlKey: false,
		metaKey: false,
		preventDefault: function () {}
	}, extra || {}));
	return calls.slice();
}

// --- the bug that lost files -----------------------------------------------------------

state.selectedPaths = new Set(['/home/report.pdf']);

check('Delete on the file grid deletes', press('Delete'), ['delete']);
// The one that mattered: the file being renamed is still the selected file, so an
// unguarded Delete deletes it while you are editing its name.
check('Delete inside a text field does NOT delete', press('Delete', FIELD), []);

check('Enter on the file grid opens the selection', press('Enter'), ['open:/home/report.pdf']);
check('Enter inside a text field does NOT open anything', press('Enter', FIELD), []);

// --- a dialog owns the keyboard --------------------------------------------------------

state.dialog = {type: 'rename'};

check('Delete does nothing while a dialog is open', press('Delete'), []);
check('Enter does nothing while a dialog is open', press('Enter'), []);
check('nor does Ctrl+A', press('a', GRID, {ctrlKey: true}), []);
check('nor Ctrl+C', press('c', GRID, {ctrlKey: true}), []);
check('nor Ctrl+X', press('x', GRID, {ctrlKey: true}), []);
check('nor Ctrl+V', press('v', GRID, {ctrlKey: true}), []);

// Escape is the deliberate exception: closing what is open is what it is for.
check('Escape still closes the dialog', press('Escape'),
	['closeDialog', 'closeContextMenu', 'renderOverlays']);

state.dialog = null;

// --- the clipboard branches keep the guard they always had ------------------------------

check('Ctrl+A selects all on the grid', press('a', GRID, {ctrlKey: true}), ['selectAll']);
check('Ctrl+A inside a field selects the text, not the files', press('a', FIELD, {ctrlKey: true}), []);
check('Cmd+C copies on the grid', press('c', GRID, {metaKey: true}), ['copy']);
check('Ctrl+C inside a field does not', press('c', FIELD, {ctrlKey: true}), []);
check('Ctrl+X cuts on the grid', press('x', GRID, {ctrlKey: true}), ['cut']);
check('Ctrl+X inside a field does not', press('x', FIELD, {ctrlKey: true}), []);
check('Ctrl+V pastes on the grid', press('v', GRID, {ctrlKey: true}), ['paste']);
check('Ctrl+V inside a field does not', press('v', FIELD, {ctrlKey: true}), []);

// --- nothing fires with no selection ------------------------------------------------------

state.selectedPaths = new Set();
check('Delete with nothing selected does nothing', press('Delete'), []);
check('Enter with nothing selected does nothing', press('Enter'), []);

state.selectedPaths = new Set(['/a', '/b']);
check('Enter on a multiple selection does nothing', press('Enter'), []);
check('Delete on a multiple selection still deletes', press('Delete'), ['delete']);

// --- the guard is structural, not a list of special cases -----------------------------
//
// The regression this whole file exists for is "a branch was added and the guard was
// forgotten". Assert the guard cannot be bypassed by construction: it returns early, and
// it does so before any action branch in the source.

const GUARD = 'if (state.dialog || isEditableTarget(e.target))';
const guard = region.indexOf(GUARD);
check('the two guards are one early return, not repeated per branch', guard !== -1, true);
check('and no branch repeats isEditableTarget after it',
	region.indexOf('isEditableTarget', guard + GUARD.length), -1);

['actions.deleteSelected', 'actions.open', 'setAllSelection', 'actions.copySelected',
	'actions.cutSelected', 'actions.pasteClipboard'].forEach(function (action) {
	const at = region.indexOf(action);
	check(action + ' is behind the guard', at > guard, true);
});

// --- Cmd/Ctrl+Backspace, the delete key a Mac laptop has (phase 25) ---------------------------

state.selectedPaths = new Set(['/home/report.pdf']);
check('Cmd+Backspace deletes, as in Finder', press('Backspace', GRID, {metaKey: true}), ['delete']);
check('so does Ctrl+Backspace', press('Backspace', GRID, {ctrlKey: true}), ['delete']);
check('Backspace alone does not -- it is how you go back a letter', press('Backspace'), []);
check('Cmd+Backspace in a field deletes the word, not the file', press('Backspace', FIELD, {metaKey: true}), []);

// --- what the shortcuts sheet lists is what the handler answers to (phase 25) ----------------
//
// js/keys.js is the list the shell's sheet shows for Explorer and the menus print beside their
// commands. Every keyboard chord on it is pressed here against the handler above; a chord the
// handler lost, or one added to the list and never to the handler, fails here.

const {KEYS, SHORTCUTS, chordFor} = await import('../apps/explorer/js/keys.js');

// A keydown for a chord in the shell's spelling, pressed with Cmd (a Mac) or Ctrl.
function eventFor (spec, withMeta) {
	const parts = spec.split('+');
	const key = parts.pop();
	const extra = {};
	parts.forEach(mod => {
		if (mod === 'Mod') { extra[withMeta ? 'metaKey' : 'ctrlKey'] = true; }
		if (mod === 'Ctrl') { extra.ctrlKey = true; }
		if (mod === 'Shift') { extra.shiftKey = true; }
		if (mod === 'Alt') { extra.altKey = true; }
	});
	return [/^[A-Z]$/.test(key) ? key.toLowerCase() : key, extra];
}

const EXPECTED = {
	open: ['open:/home/report.pdf'],
	delete: ['delete'],
	selectAll: ['selectAll'],
	copy: ['copy'],
	cut: ['cut'],
	paste: ['paste'],
	close: ['closeDialog', 'closeContextMenu', 'renderOverlays']
};
check('every command in the key list has an expected action here', Object.keys(KEYS).sort(), Object.keys(EXPECTED).sort());

[true, false].forEach(withMeta => {
	const missed = [];
	Object.keys(KEYS).forEach(name => {
		KEYS[name].keys.forEach(spec => {
			state.selectedPaths = new Set(['/home/report.pdf']);
			const [key, extra] = eventFor(spec, withMeta);
			const got = press(key, GRID, extra);
			if (JSON.stringify(got) !== JSON.stringify(EXPECTED[name])) {
				missed.push(spec + ' -> ' + JSON.stringify(got));
			}
		});
	});
	check('every listed chord does what it is listed for, pressed with ' + (withMeta ? 'Cmd' : 'Ctrl'), missed, []);
});

check('the sheet lists every command in the key list, with its every chord',
	Object.keys(KEYS).every(name => SHORTCUTS.some(entry => entry.keys === KEYS[name].keys)), true);
check('and nothing else but the two pointer gestures',
	SHORTCUTS.filter(entry => !Object.keys(KEYS).some(name => entry.keys === KEYS[name].keys)).map(entry => entry.keys),
	[['Shift+Click'], ['Mod+Click']]);

check('a menu prints Delete on a PC', chordFor('delete', false), 'Delete');
check('and Cmd+Backspace on a Mac, which has no Delete key to press', chordFor('delete', true), 'Mod+Backspace');
check('a command with one chord prints it everywhere', [chordFor('copy', false), chordFor('copy', true)], ['Mod+C', 'Mod+C']);
check('a name the list does not know prints nothing', chordFor('rename', true), null);

state.selectedPaths = new Set();

// --- renaming selects the name, not the extension ---------------------------------------

// Imported rather than scraped out of the HTML: phase 21 moved it into a module, which
// is the difference between `new Function` on a slice of a 4,700-line file and a plain
// import of the thing being tested.
const {basenameEnd} = createFormat(path.posix);

check('a plain name selects whole', basenameEnd('README'), 6);
check('an extension is left out of the selection', basenameEnd('report.pdf'), 6);
check('only the last extension is left out', basenameEnd('report.final.pdf'), 12);
// A dotfile's leading dot is its name, not an extension: selecting nothing would be worse.
check('a dotfile selects whole', basenameEnd('.gitignore'), 10);
check('a dotfile with an extension keeps the extension out', basenameEnd('.eslintrc.json'), 9);
check('an empty name does not throw', basenameEnd(''), 0);
check('a trailing dot selects up to it', basenameEnd('name.'), 4);

// --- the dialog stops its own Enter --------------------------------------------------
//
// The document guard above already covers this, but the two are independent: one keeps the
// keystroke out of the window behind, the other keeps the dialog from acting twice.

// The dialog machinery is apps/explorer/js/dialogs.js since phase 21.
const dialogSource = fs.readFileSync(
	new URL('../apps/explorer/js/dialogs.js', import.meta.url), 'utf8');
const wiringAt = dialogSource.indexOf('function wireSimpleDialog');
check('wireSimpleDialog is still somewhere to be found', wiringAt !== -1, true);
const wiring = dialogSource.slice(wiringAt);
const enterBranch = wiring.slice(wiring.indexOf("if (e.key === 'Enter'"), wiring.indexOf('submitOnce();'));
check("the dialog's Enter stops propagating", enterBranch.includes('stopPropagation()'), true);
check('and still prevents the default', enterBranch.includes('preventDefault()'), true);

check('the rename field is marked as a filename',
	dialogSource.includes('class="Dialog__input" data-select-basename'), true);

process.exit(report('explorer-keys') ? 1 : 0);
