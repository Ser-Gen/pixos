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
import {check, report} from './assert.mjs';

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

// --- renaming selects the name, not the extension ---------------------------------------

const fnStart = source.indexOf('function basenameEnd (name) {');
const fnEnd = source.indexOf('\n\t}', fnStart) + 3;
const basenameEnd = new Function(source.slice(fnStart, fnEnd) + '\n; return basenameEnd;')();

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

const wiring = source.slice(source.indexOf('function wireSimpleDialog'));
const enterBranch = wiring.slice(wiring.indexOf("if (e.key === 'Enter'"), wiring.indexOf('submitOnce();'));
check("the dialog's Enter stops propagating", enterBranch.includes('stopPropagation()'), true);
check('and still prevents the default', enterBranch.includes('preventDefault()'), true);

check('the rename field is marked as a filename',
	source.includes('class="Dialog__input" data-select-basename'), true);

process.exit(report('explorer-keys') ? 1 : 0);
