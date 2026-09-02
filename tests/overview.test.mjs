// The window overview: what order the tiles go in, and what a keystroke means.
//
// Both halves are pure and both are load-bearing. The order decides what the numbers 1–9
// point at, and if the keys and the hint line at the top of the overlay ever disagree the
// overlay is lying about itself — so the mapping lives in one function and is checked
// here rather than trusted to a chain of if-statements in a DOM handler.

import {check, report} from './assert.mjs';
import * as overview from '../js/shell/overview.js';

const WORKSPACES = [
	{id: 'w1', name: 'Desktop 1'},
	{id: 'w2', name: 'Desktop 2'},
	{id: 'w3', name: 'Notes'}
];

const WINDOWS = [
	{id: 1, title: 'notes.txt', path: '/home/notes.txt', appId: 'ace', workspace: 'w2'},
	{id: 2, title: 'Explorer', path: '/home', appId: 'explorer', workspace: 'w1'},
	{id: 3, title: 'report.md', path: '/home/report.md', appId: 'monaco-cdn', workspace: 'w3', dirty: true},
	{id: 4, title: 'App Manager', path: '', appId: 'app-manager', workspace: 'w1'}
];

// --- order ---------------------------------------------------------------------------------

let tiles = overview.plan(WINDOWS, WORKSPACES, 'w1');
check('the desktop you are on comes first', tiles.map(t => t.id), [2, 4, 1, 3]);
check('and the rest follow in desktop order', tiles.slice(2).map(t => t.desktop),
	['Desktop 2', 'Notes']);
check('which desktop is the current one is marked', tiles.map(t => t.current),
	[true, true, false, false]);

check('switching desktop re-orders it', overview.plan(WINDOWS, WORKSPACES, 'w3').map(t => t.id),
	[3, 2, 4, 1]);

// --- numbering -------------------------------------------------------------------------------

check('the first nine are numbered', tiles.map(t => t.number), [1, 2, 3, 4]);

const many = Array.from({length: 12}, (_, i) => ({id: i, title: 'w' + i, workspace: 'w1'}));
const numbered = overview.plan(many, WORKSPACES, 'w1');
check('a tenth window gets no number rather than a key that does not exist',
	numbered.map(t => t.number).slice(8), [9, null, null, null]);
check('but it is still listed — the arrows reach it', numbered.length, 12);

// --- what a tile carries -----------------------------------------------------------------------

check('a tile names its desktop', tiles[3].desktop, 'Notes');
check('and carries the dirty flag, so unsaved work is visible here too', tiles[3].dirty, true);
check('a window with no title falls back to its filename',
	overview.plan([{id: 9, path: '/home/a/b.txt', workspace: 'w1'}], WORKSPACES, 'w1')[0].title,
	'b.txt');
check('and with neither, to something rather than nothing',
	overview.plan([{id: 9, workspace: 'w1'}], WORKSPACES, 'w1')[0].title, 'Window');

// A window on a desktop that has since been closed must still be reachable: it is exactly
// the window you would be trying to find.
const orphan = overview.plan([{id: 7, title: 'lost', workspace: 'gone'}], WORKSPACES, 'w1');
check('a window on an unknown desktop is still listed', orphan.length, 1);
check('with an empty desktop name rather than a crash', orphan[0].desktop, '');

check('no windows is not an error', overview.plan([], WORKSPACES, 'w1'), []);
check('and neither is no desktops', overview.plan(WINDOWS, [], 'w1').length, 4);

// --- keys ------------------------------------------------------------------------------------

function key (init) {
	return Object.assign({key: '', code: '', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false}, init);
}

check('Esc cancels', overview.resolveKey(key({key: 'Escape'}), 4), {action: 'cancel'});
check('Enter opens the highlighted one', overview.resolveKey(key({key: 'Enter'}), 4), {action: 'activate'});
check('so does Space', overview.resolveKey(key({key: ' '}), 4), {action: 'activate'});
check('Delete closes it', overview.resolveKey(key({key: 'Delete'}), 4), {action: 'close'});
check('and Backspace, which is Delete on a Mac keyboard',
	overview.resolveKey(key({key: 'Backspace'}), 4), {action: 'close'});

check('arrows move one', overview.resolveKey(key({key: 'ArrowRight'}), 4), {action: 'move', delta: 1});
check('in both directions', overview.resolveKey(key({key: 'ArrowUp'}), 4), {action: 'move', delta: -1});
check('down is forwards, up is back', [
	overview.resolveKey(key({key: 'ArrowDown'}), 4).delta,
	overview.resolveKey(key({key: 'ArrowLeft'}), 4).delta
], [1, -1]);
check('Tab moves too', overview.resolveKey(key({key: 'Tab'}), 4), {action: 'move', delta: 1});
check('and Shift+Tab goes back', overview.resolveKey(key({key: 'Tab', shiftKey: true}), 4),
	{action: 'move', delta: -1});

check('a digit picks that tile', overview.resolveKey(key({key: '3', code: 'Digit3'}), 4),
	{action: 'pick', index: 2});
check('a digit past the end does nothing rather than something arbitrary',
	overview.resolveKey(key({key: '9', code: 'Digit9'}), 4), {action: 'ignore'});
check('there is no zero — the numbers shown start at 1',
	overview.resolveKey(key({key: '0', code: 'Digit0'}), 4), null);

// Ctrl+Shift+1..9 switches desktops and must keep doing so while the overlay is open: the
// two bindings are for different things and swallowing one here would break the other.
check('Ctrl+digit is not ours', overview.resolveKey(key({key: '2', code: 'Digit2', ctrlKey: true}), 4), null);
check('nor is Cmd+digit', overview.resolveKey(key({key: '2', code: 'Digit2', metaKey: true}), 4), null);

// Anything unclaimed returns null so the handler leaves it alone rather than preventing a
// default it knows nothing about.
check('an ordinary letter is not claimed', overview.resolveKey(key({key: 'a', code: 'KeyA'}), 4), null);
check('and neither is a chord that belongs to the shell',
	overview.resolveKey(key({key: 'k', code: 'KeyK', metaKey: true}), 4), null);

process.exit(report('overview') ? 1 : 0);
