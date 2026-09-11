// Dragging rows onto a folder, and the three ways one drop can be reported.
//
// Phase 21 moved this into apps/explorer/js/dnd.js and made the timers parameters, which is
// what these tests are built on: `drop` and `dragend` race to perform the same move, and
// `dragDropHandled` and `dragCommitInProgress` are what make exactly one of them win. The
// rule they enforce was tightened while walking the phase 21 checklist: a move happens where
// the pointer was when the drag ended, or it does not happen. That is not something real timers on a busy machine can
// be trusted to reproduce — the clock here is moved by hand, the way tests/fs-events does it.
//
// A move happening twice is not cosmetic: it is a file moved into a folder and then moved
// again out of it, with nothing on screen to say so.

import fs from 'fs';
import {check, report} from './assert.mjs';
import {createDragAndDrop} from '../apps/explorer/js/dnd.js';

const html = fs.readFileSync(new URL('../apps/explorer/index.html', import.meta.url), 'utf8');

// --- a clock that only moves when told ------------------------------------------------------

const realSetTimeout = setTimeout;

function clock () {
	let now = 0;
	let seq = 0;
	const pending = new Map();
	return {
		setTimeout (fn, ms) { pending.set(++seq, {at: now + (ms || 0), fn}); return seq; },
		clearTimeout (id) { pending.delete(id); },
		// Deliberately async, and it matters. A timer callback is a *macrotask*: everything
		// already queued as a microtask — every `.then` of an await that has already
		// resolved — runs before it does. A clock that fires callbacks synchronously puts
		// them in the wrong order, and the difference is not academic here: it decides
		// whether a commit's `finally` has run by the time dragend's timer fires, and so
		// which of the two guards is the one actually holding the line.
		async tick (ms) {
			now += ms;
			await new Promise(resolve => realSetTimeout(resolve, 0));
			const due = [...pending.entries()]
				.filter(([, t]) => t.at <= now)
				.sort((a, b) => a[1].at - b[1].at);
			for (const [id, t] of due) {
				pending.delete(id);
				t.fn();
				await new Promise(resolve => realSetTimeout(resolve, 0));
			}
		},
		get waiting () { return pending.size; }
	};
}

// --- a listing of rows ------------------------------------------------------------------------

function row (path, type) {
	const classes = new Set();
	const node = {
		dataset: {path: path, type: type},
		classList: {
			add: n => classes.add(n),
			remove: n => classes.delete(n),
			has: n => classes.has(n)
		},
		contains: other => other === node,
		closest: selector => selector.indexOf('dir') > -1
			? (type === 'dir' ? node : null)
			: node
	};
	return node;
}

function transfer (data) {
	const store = Object.assign({}, data);
	return {
		effectAllowed: null,
		dropEffect: null,
		setData: (kind, value) => { store[kind] = value; },
		getData: kind => store[kind] || ''
	};
}

function world () {
	const moves = [];
	const time = clock();
	const dropTargets = [];
	const state = {
		selectedPaths: new Set(),
		dragPaths: [],
		dragHoverFolderPath: null,
		dragDropHandled: false,
		dragCommitInProgress: false,
	};
	const rootElem = {querySelectorAll: () => dropTargets};
	let pointTarget = null;
	const dnd = createDragAndDrop({
		state: state,
		rootElem: rootElem,
		doc: {elementFromPoint: () => pointTarget},
		win: {setTimeout: time.setTimeout, clearTimeout: time.clearTimeout},
		moveItemsToFolder: async (paths, target, meta) => {
			moves.push({paths: paths, target: target, source: meta && meta.source});
		}
	});
	return {
		state, dnd, moves, time, dropTargets,
		at: node => { pointTarget = node; }
	};
}

const folder = row('/home/docs', 'dir');
const file = row('/home/a.txt', 'file');

// --- what gets picked up ------------------------------------------------------------------------

{
	const w = world();
	w.dnd.handleItemDragStart({target: file, dataTransfer: transfer()});
	check('dragging an unselected row drags just that row', w.state.dragPaths, ['/home/a.txt']);
}

{
	// The case that makes a multi-selection drag work at all: the row under the pointer is
	// part of the selection, so the whole selection comes with it.
	const w = world();
	w.state.selectedPaths = new Set(['/home/a.txt', '/home/b.txt']);
	w.dnd.handleItemDragStart({target: file, dataTransfer: transfer()});
	check('dragging a row that is selected drags the whole selection',
		w.state.dragPaths, ['/home/a.txt', '/home/b.txt']);
}

{
	// And the case that would be a nasty surprise: a row outside the selection must not
	// drag the selection along with it.
	const w = world();
	w.state.selectedPaths = new Set(['/home/b.txt', '/home/c.txt']);
	w.dnd.handleItemDragStart({target: file, dataTransfer: transfer()});
	check('dragging a row outside the selection leaves the selection behind',
		w.state.dragPaths, ['/home/a.txt']);
}

{
	const w = world();
	const dt = transfer();
	w.dnd.handleItemDragStart({target: file, dataTransfer: dt});
	check('the paths are put on the drag in Explorer’s own type',
		JSON.parse(dt.getData('application/x-explorer-paths')), ['/home/a.txt']);
	check('and as plain text, so a drag out of Explorer carries something readable',
		JSON.parse(dt.getData('text/plain')), ['/home/a.txt']);
	check('the drag is a move, not a copy', dt.effectAllowed, 'move');
}

{
	const w = world();
	w.dnd.handleItemDragStart({target: {closest: () => null}, dataTransfer: transfer()});
	check('a drag starting on nothing in particular picks nothing up', w.state.dragPaths, []);
}

// --- hovering a folder --------------------------------------------------------------------------

{
	const w = world();
	let prevented = false;
	const dt = transfer();
	w.dnd.handleItemDragOver({target: folder, preventDefault: () => { prevented = true; }, dataTransfer: dt});
	check('hovering a folder accepts the drop', prevented, true);
	check('and says it will be a move', dt.dropEffect, 'move');
	check('the folder is marked as the drop target', folder.classList.has('Explorer__dropTarget'), true);
	check('and it is remembered', w.state.dragHoverFolderPath, '/home/docs');

	// A file is not a drop target: preventDefault is never called, so the browser refuses
	// the drop rather than Explorer accepting one it cannot perform.
	const onFile = world();
	let filePrevented = false;
	onFile.dnd.handleItemDragOver({target: file, preventDefault: () => { filePrevented = true; }});
	check('hovering a file accepts nothing', filePrevented, false);
	check('and makes nothing a target', onFile.state.dragHoverFolderPath, null);
}

{
	// dragleave fires as the pointer crosses into a child of the same folder row. The last
	// known target is kept on purpose: some browsers send dragleave before dragend, and
	// forgetting it there is what left a completed drag with nowhere to commit to.
	const w = world();
	w.dnd.handleItemDragStart({target: file, dataTransfer: transfer()});
	w.dnd.handleItemDragOver({target: folder, preventDefault () {}, dataTransfer: transfer()});
	w.dnd.handleItemDragLeave({target: folder, relatedTarget: null});
	check('leaving a folder unmarks it', folder.classList.has('Explorer__dropTarget'), false);
	check('and the target goes with it, so a release there would move nothing',
		w.state.dragHoverFolderPath, null);
}

// --- the ordinary drop -----------------------------------------------------------------------------

{
	const w = world();
	w.dnd.handleItemDragStart({target: file, dataTransfer: transfer()});
	w.dnd.handleItemDragOver({target: folder, preventDefault () {}, dataTransfer: transfer()});
	await w.dnd.handleItemDrop({
		target: folder,
		preventDefault () {}, stopPropagation () {},
		dataTransfer: transfer({'application/x-explorer-paths': '["/home/a.txt"]'})
	});
	check('a drop moves what was dragged into the folder it landed on',
		w.moves, [{paths: ['/home/a.txt'], target: '/home/docs', source: 'direct-drop'}]);
	check('and the drag state is cleared afterwards',
		[w.state.dragPaths.length, w.state.dragHoverFolderPath], [0, null]);
}

{
	// A drag that arrives from somewhere else in the same page: the dataTransfer is the only
	// thing that knows the paths, since this window never started a drag.
	const w = world();
	await w.dnd.handleItemDrop({
		target: folder,
		preventDefault () {}, stopPropagation () {},
		dataTransfer: transfer({'text/plain': '["/home/x.txt","/home/y.txt"]'})
	});
	check('a drop with no local drag reads the paths off the transfer',
		w.moves[0].paths, ['/home/x.txt', '/home/y.txt']);
}

{
	// Something dragged in from outside carrying text that is not JSON. Parsing throws, and
	// the drop has to fall back rather than take the exception up into the handler.
	const w = world();
	console.error = () => {};
	w.state.dragPaths = ['/home/a.txt'];
	await w.dnd.handleItemDrop({
		target: folder,
		preventDefault () {}, stopPropagation () {},
		dataTransfer: transfer({'text/plain': 'not json at all'})
	});
	check('a transfer that will not parse falls back to what is being dragged locally',
		w.moves[0].paths, ['/home/a.txt']);
}

{
	const w = world();
	await w.dnd.handleItemDrop({
		target: folder,
		preventDefault () {}, stopPropagation () {},
		dataTransfer: transfer({})
	});
	check('a drop carrying nothing at all moves nothing', w.moves, []);
}

// --- the three racers -------------------------------------------------------------------------------
//
// This is what the module is for.

{
	// drop wins; dragend arrives afterwards and must not move the same files a second time.
	const w = world();
	w.dnd.handleItemDragStart({target: file, dataTransfer: transfer()});
	w.dnd.handleItemDragOver({target: folder, preventDefault () {}, dataTransfer: transfer()});
	await w.dnd.handleItemDrop({
		target: folder, preventDefault () {}, stopPropagation () {},
		dataTransfer: transfer({'application/x-explorer-paths': '["/home/a.txt"]'})
	});
	w.dnd.handleItemDragEnd();
	await w.time.tick(0);
	check('a drop followed by dragend moves the files once, not twice', w.moves.length, 1);
}

{
	// No drop at all -- released over something the browser did not treat as a drop zone.
	// dragend is the only thing that fires, and the move has to happen there.
	const w = world();
	w.dnd.handleItemDragStart({target: file, dataTransfer: transfer()});
	w.dnd.handleItemDragOver({target: folder, preventDefault () {}, dataTransfer: transfer()});
	w.dnd.handleItemDragEnd();
	check('dragend does not commit synchronously — the drop may still be bubbling',
		w.moves.length, 0);
	await w.time.tick(0);
	check('a drag that ended without a drop still commits, from the last folder hovered',
		w.moves, [{paths: ['/home/a.txt'], target: '/home/docs', source: 'dragend-fallback'}]);
}

{
	// The rule, reported while walking the phase 21 checklist: a file moves only if the
	// pointer was over the folder when the drag ended. Crossing a folder on the way to
	// somewhere else used to be enough, because the last folder seen was kept as a target
	// and a release anywhere at all committed to it.
	const w = world();
	w.dnd.handleItemDragStart({target: file, dataTransfer: transfer()});
	w.dnd.handleItemDragOver({target: folder, preventDefault () {}, dataTransfer: transfer()});
	check('crossing a folder makes it the target', w.state.dragHoverFolderPath, '/home/docs');

	w.at(null);
	w.dnd.updateDragHoverFromPoint(10, 10);
	check('and moving off it takes the target away again', w.state.dragHoverFolderPath, null);

	w.dnd.handleItemDragEnd();
	await w.time.tick(0);
	check('so releasing over the toolbar moves nothing at all', w.moves, []);
	check('and the drag is over rather than left hanging', w.state.dragPaths, []);
}

{
	// The same rule the other way round: cross one folder, end over another, and the move
	// goes where the pointer actually was.
	const other = row('/home/pics', 'dir');
	const w = world();
	w.dnd.handleItemDragStart({target: file, dataTransfer: transfer()});
	w.dnd.handleItemDragOver({target: folder, preventDefault () {}, dataTransfer: transfer()});
	w.dnd.handleItemDragOver({target: other, preventDefault () {}, dataTransfer: transfer()});
	w.dnd.handleItemDragEnd();
	await w.time.tick(0);
	check('a move lands in the folder the pointer ended on, not one it passed over',
		w.moves.map(m => m.target), ['/home/pics']);
}

{
	// And nothing commits while the button is still down. There used to be a 220ms idle
	// timer that did exactly that: hover a folder, hold still, and the file moved before
	// you had decided to drop it anywhere.
	const w = world();
	w.dnd.handleItemDragStart({target: file, dataTransfer: transfer()});
	w.dnd.handleItemDragOver({target: folder, preventDefault () {}, dataTransfer: transfer()});
	await w.time.tick(5000);
	check('holding over a folder without releasing moves nothing', w.moves, []);
	check('and leaves no timer running to do it later', w.time.waiting, 0);
}

{
	// The idle timer fires, and then a real drop arrives before the move has finished. The
	// in-progress guard is the only thing standing between that and two moves.
	const w = world();
	let release;
	const slow = new Promise(resolve => { release = resolve; });
	const moves = [];
	const time = clock();
	const state = {
		selectedPaths: new Set(), dragPaths: ['/home/a.txt'],
		dragHoverFolderPath: '/home/docs',
		dragDropHandled: false, dragCommitInProgress: false
	};
	const dnd = createDragAndDrop({
		state: state,
		rootElem: {querySelectorAll: () => []},
		doc: {elementFromPoint: () => null},
		win: {setTimeout: time.setTimeout, clearTimeout: time.clearTimeout},
		moveItemsToFolder: async (paths, target, meta) => {
			moves.push(meta.source);
			await slow;
		}
	});
	const first = dnd.commitPendingDragMove('mouseup-fallback');
	dnd.commitPendingDragMove('dragend-fallback');
	check('a second commit while the first is still running does nothing', moves, ['mouseup-fallback']);
	release();
	await first;
	check('and after it finishes the flag is down again', state.dragCommitInProgress, false);
}

{
	const w = world();
	w.dnd.handleItemDragStart({target: file, dataTransfer: transfer()});
	w.dnd.commitPendingDragMove('test');
	check('a commit with nowhere to commit to does nothing', w.moves, []);
}

// The two guards overlap, and which one is doing the work depends on the timing. Removing
// either one alone leaves every test above passing, because the other covers it — so both
// cases below were written by breaking each guard in turn and finding nothing complained.

{
	// `dragDropHandled` is set before the drop awaits the move, not after, and this is why:
	// dragend fires while the move is still in flight, with dragPaths and the hover target
	// both still set. Nothing else would stop it moving the same files a second time.
	const moves = [];
	const time = clock();
	let release;
	const slow = new Promise(resolve => { release = resolve; });
	const state = {
		selectedPaths: new Set(), dragPaths: [],
		dragHoverFolderPath: null,
		dragDropHandled: false, dragCommitInProgress: false
	};
	const dnd = createDragAndDrop({
		state: state,
		rootElem: {querySelectorAll: () => []},
		doc: {elementFromPoint: () => null},
		win: {setTimeout: time.setTimeout, clearTimeout: time.clearTimeout},
		moveItemsToFolder: async (paths, target, meta) => { moves.push(meta.source); await slow; }
	});
	dnd.handleItemDragStart({target: file, dataTransfer: transfer()});
	dnd.handleItemDragOver({target: folder, preventDefault () {}, dataTransfer: transfer()});
	const dropping = dnd.handleItemDrop({
		target: folder, preventDefault () {}, stopPropagation () {},
		dataTransfer: transfer({'application/x-explorer-paths': '["/home/a.txt"]'})
	});
	check('the drop is still moving, and has not cleared anything yet',
		[moves.length, state.dragPaths.length], [1, 1]);
	dnd.handleItemDragEnd();
	await time.tick(0);
	check('dragend arriving mid-move does not start a second one', moves.length, 1);
	release();
	await dropping;
}

{
	// And `dragCommitInProgress` is not redundant beside it, because handleItemDragEnd puts
	// `dragDropHandled` back to false immediately after asking for a commit — without
	// waiting for it. While that commit is still running the other guard is down, and this
	// is the only one left. The two lines below are exactly what handleItemDragEnd does.
	const moves = [];
	const time = clock();
	let release;
	const slow = new Promise(resolve => { release = resolve; });
	const state = {
		selectedPaths: new Set(), dragPaths: ['/home/a.txt'],
		dragHoverFolderPath: '/home/docs',
		dragDropHandled: false, dragCommitInProgress: false
	};
	const dnd = createDragAndDrop({
		state: state,
		rootElem: {querySelectorAll: () => []},
		doc: {elementFromPoint: () => null},
		win: {setTimeout: time.setTimeout, clearTimeout: time.clearTimeout},
		moveItemsToFolder: async (paths, target, meta) => { moves.push(meta.source); await slow; }
	});
	const first = dnd.commitPendingDragMove('mouseup-fallback');
	state.dragDropHandled = false;
	dnd.commitPendingDragMove('dragend-fallback');
	check('a commit while another is running is refused even with the other guard down',
		moves, ['mouseup-fallback']);
	release();
	await first;
	check('and the in-progress flag comes down when it finishes', state.dragCommitInProgress, false);
}

// --- following the pointer by hand ---------------------------------------------------------------------

{
	// Used by the drop handler when the browser will not say what is under the pointer.
	const w = world();
	w.at(folder);
	w.dnd.updateDragHoverFromPoint(10, 10);
	check('a point over a folder makes it the target', w.state.dragHoverFolderPath, '/home/docs');
	check('and marks it', folder.classList.has('Explorer__dropTarget'), true);

	w.at(null);
	w.state.dragPaths = [];
	w.dnd.updateDragHoverFromPoint(10, 10);
	check('a point over nothing clears the target when nothing is being dragged',
		w.state.dragHoverFolderPath, null);

	// And it clears it mid-drag just the same, which is the whole rule: no folder under the
	// pointer means no target, however recently there was one. This used to be the opposite
	// -- the comment on the branch said "keep last valid hover folder for fallback commit",
	// and that kept folder is what committed a move the user had not asked for.
	w.at(folder);
	w.dnd.updateDragHoverFromPoint(10, 10);
	w.state.dragPaths = ['/home/a.txt'];
	w.at(null);
	w.dnd.updateDragHoverFromPoint(10, 10);
	check('and clears it mid-drag too, which is what the rest of this file is about',
		w.state.dragHoverFolderPath, null);
}

// --- telling our own drag from a file off the desktop -------------------------------------
//
// This is where the drop actually died, and it died silently for a long time. A drag started
// in Explorer declares `effectAllowed = 'move'`. `document.body` is an ancestor of every row,
// so its dragover handler runs *after* the row's and has the last word on `dropEffect` — and
// it used to answer `'copy'` unconditionally. `move` + `copy` is not a preference the browser
// splits the difference on: the pair is invalid, so it cancels the drop. No `drop` event
// fires at all, the drag image animates back to where it started, and the move only ever
// happened because a dragend fallback picked it up afterwards. Removing those fallbacks is
// what made it visible.

{
	const w = world();
	check('a transfer carrying Explorer\u2019s own type is one of ours',
		w.dnd.isInternalDrag({types: ['application/x-explorer-paths', 'text/plain']}), true);
	check('a file dragged in off the desktop is not',
		w.dnd.isInternalDrag({types: ['Files']}), false);
	check('and neither is a plain text selection',
		w.dnd.isInternalDrag({types: ['text/plain']}), false);
	check('nothing at all is not ours either',
		[w.dnd.isInternalDrag(null), w.dnd.isInternalDrag({})], [false, false]);

	// `types` is an array in current browsers and a DOMStringList in older ones. Neither is
	// reliably `.includes`-able, which is why this goes through Array.prototype.
	const listLike = {length: 1, 0: 'application/x-explorer-paths'};
	check('a DOMStringList-shaped types answers the same', w.dnd.isInternalDrag({types: listLike}), true);
}

{
	// The handler itself lives in bindEvents, so this checks the source rather than running
	// it: the point is that the decision exists at all, and that nobody puts the constant
	// back. Both halves failed before the fix.
	const bodyDragover = html.slice(html.indexOf("document.body.addEventListener('dragover'"));
	const handler = bodyDragover.slice(0, bodyDragover.indexOf('});'));
	check('the page-level dragover asks whether the drag is ours',
		/isInternalDrag\(e\.dataTransfer\)/.test(handler), true);
	check('and answers move for our own drags rather than always copy',
		/dropEffect = internal \? 'move' : 'copy'/.test(handler), true);
	check('the whole-page drop wash is only for a file arriving from outside',
		/if \(!internal\) \{[\s\S]{0,120}Page--onDragOver/.test(handler), true);
	check('and no copy is hardcoded onto every drag any more',
		/dropEffect = 'copy'/.test(handler), false);
}

process.exit(report('explorer-dnd') ? 1 : 0);
