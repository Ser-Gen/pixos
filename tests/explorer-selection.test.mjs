// What is selected, and the rubber band that selects it.
//
// Phase 21 moved this into apps/explorer/js/selection.js — the first module in the split
// that needed the context object, so `state` and `ui` go in by reference and everything else
// is a named parameter. None of the arithmetic below could be reached before: the box
// normalisation, the three-pixel threshold that separates a click from a drag, and the
// tri-state of the select-all checkbox were all only ever checked by dragging a mouse.

import {check, report} from './assert.mjs';
import {createSelection} from '../apps/explorer/js/selection.js';

// --- a window with rows in it ------------------------------------------------------------

// `main` is the scrolling pane every coordinate in this module is relative to. Giving it a
// non-zero origin *and* a scroll offset is the point: the two are added, and a version that
// forgets either looks right only when the window is at the top left of the screen.
function pane (scrollLeft, scrollTop) {
	const classes = new Set();
	return {
		scrollLeft: scrollLeft || 0,
		scrollTop: scrollTop || 0,
		getBoundingClientRect: () => ({left: 100, top: 50}),
		classList: {
			add: name => classes.add(name),
			remove: name => classes.delete(name),
			has: name => classes.has(name)
		}
	};
}

function node (path, rect) {
	const classes = new Set();
	return {
		dataset: {path: path},
		checked: false,
		getBoundingClientRect: () => rect,
		classList: {
			toggle: (name, on) => { if (on) { classes.add(name); } else { classes.delete(name); } },
			has: name => classes.has(name)
		}
	};
}

function world (items, rows) {
	const state = {
		items: (items || []).map(p => ({path: p, name: p.split('/').pop(), isDirectory: false})),
		selectedPaths: new Set(),
		lastSelectedPath: null,
		selectionBox: null,
		viewMode: 'details',
		cwd: '/home'
	};
	const ui = {
		main: pane(0, 0),
		selectionBox: {style: {}},
		selectAll: {checked: false, indeterminate: false},
		selectAllToolbar: {checked: false, indeterminate: false}
	};
	const rendered = {status: 0, toolbar: 0};
	const listeners = [];
	const rootElem = {
		querySelectorAll: selector => selector.indexOf('.Explorer__row') === 0 ? (rows || []) : []
	};
	const selection = createSelection({
		state: state,
		ui: ui,
		rootElem: rootElem,
		doc: {
			addEventListener: (name, fn) => { listeners.push(['+', name, fn]); },
			removeEventListener: (name, fn) => { listeners.push(['-', name, fn]); }
		},
		closeContextMenu: () => { rendered.menuClosed = true; },
		renderStatus: () => { rendered.status++; },
		renderToolbarState: () => { rendered.toolbar++; }
	});
	return {state, ui, selection, rendered, listeners};
}

const paths = ['/home/a.txt', '/home/b.txt', '/home/c.txt', '/home/d.txt'];
const selected = w => Array.from(w.state.selectedPaths);

// --- clicking rows --------------------------------------------------------------------------

{
	const w = world(paths);
	w.selection.applySelectionFromEvent('/home/b.txt', {});
	check('a plain click selects one row', selected(w), ['/home/b.txt']);
	w.selection.applySelectionFromEvent('/home/d.txt', {});
	check('and a second plain click replaces it rather than adding',
		selected(w), ['/home/d.txt']);
	check('the status bar is redrawn, because the count changed', w.rendered.status, 2);
	check('and so is the toolbar, because what is enabled changed', w.rendered.toolbar, 2);
}

{
	const w = world(paths);
	w.selection.applySelectionFromEvent('/home/a.txt', {});
	w.selection.applySelectionFromEvent('/home/c.txt', {ctrlKey: true});
	check('ctrl adds to the selection', selected(w), ['/home/a.txt', '/home/c.txt']);
	w.selection.applySelectionFromEvent('/home/a.txt', {ctrlKey: true});
	check('and ctrl on something already selected takes it out again',
		selected(w), ['/home/c.txt']);
	// A Mac sends metaKey, not ctrlKey, and a version that checks only one of them is
	// broken on exactly one platform.
	w.selection.applySelectionFromEvent('/home/d.txt', {metaKey: true});
	check('cmd does the same thing as ctrl', selected(w), ['/home/c.txt', '/home/d.txt']);
}

{
	const w = world(paths);
	w.selection.applySelectionFromEvent('/home/b.txt', {});
	w.selection.applySelectionFromEvent('/home/d.txt', {shiftKey: true});
	check('shift takes the range between the two',
		selected(w), ['/home/b.txt', '/home/c.txt', '/home/d.txt']);

	// Backwards, which is the case an implementation using slice(from, to) gets wrong.
	const back = world(paths);
	back.selection.applySelectionFromEvent('/home/d.txt', {});
	back.selection.applySelectionFromEvent('/home/b.txt', {shiftKey: true});
	check('and the same range when dragged upwards',
		selected(back), ['/home/b.txt', '/home/c.txt', '/home/d.txt']);
}

{
	// The anchor can disappear: another window deletes the row you last clicked, the
	// listing refreshes, and then you shift-click. Falling through to a plain click is the
	// right answer; indexing on -1 is not.
	const w = world(paths);
	w.selection.applySelectionFromEvent('/home/b.txt', {});
	w.state.items = w.state.items.filter(item => item.path !== '/home/b.txt');
	w.selection.applySelectionFromEvent('/home/d.txt', {shiftKey: true});
	check('shift with an anchor that has since been deleted selects just the row clicked',
		selected(w), ['/home/d.txt']);
}

// --- the checkbox column and select-all -------------------------------------------------------

{
	const w = world(paths);
	w.selection.toggleSelection('/home/a.txt', true);
	check('a checkbox ticks its row', selected(w), ['/home/a.txt']);
	check('and nothing is indeterminate yet — one of four is a partial selection',
		[w.ui.selectAll.checked, w.ui.selectAll.indeterminate], [false, true]);

	w.selection.setAllSelection(true);
	check('select-all takes every row in the folder', selected(w), paths);
	check('and the box goes solid rather than indeterminate',
		[w.ui.selectAll.checked, w.ui.selectAll.indeterminate], [true, false]);
	check('both copies of the box agree, the header one and the toolbar one',
		[w.ui.selectAllToolbar.checked, w.ui.selectAllToolbar.indeterminate], [true, false]);

	w.selection.setAllSelection(false);
	check('and clearing it empties the selection', selected(w), []);
	check('with the box empty and not indeterminate',
		[w.ui.selectAll.checked, w.ui.selectAll.indeterminate], [false, false]);
}

{
	// An empty folder must not report "all selected" — nothing of nothing is not everything,
	// and a solid tick over an empty listing is a lie.
	const w = world([]);
	w.selection.syncSelectAllUI();
	check('an empty folder never shows select-all as ticked',
		[w.ui.selectAll.checked, w.ui.selectAll.indeterminate], [false, false]);
}

{
	const w = world(paths);
	w.selection.toggleSelection('/home/c.txt', true);
	w.selection.toggleSelection('/home/c.txt', false);
	check('unticking the last box clears the anchor with it', w.state.lastSelectedPath, null);
}

// --- the rubber band ------------------------------------------------------------------------

{
	const w = world(paths);
	w.selection.startSelectionBox({clientX: 120, clientY: 70});
	check('starting a band closes any open context menu', w.rendered.menuClosed, true);
	check('the band starts where the mouse is, in pane coordinates, not screen ones',
		[w.state.selectionBox.startX, w.state.selectionBox.startY], [20, 20]);
	check('and it is not a drag yet', w.state.selectionBox.didDrag, false);
	check('the pane is marked as selecting, so the cursor and text selection can change',
		w.ui.main.classList.has('Explorer__main--selecting'), true);
	check('and the listeners go on the document, not the pane — a drag leaves the pane',
		w.listeners.map(l => l[0] + l[1]), ['+mousemove', '+mouseup']);

	// Under the threshold: this is a click that wobbled, not a drag.
	w.selection.handleSelectionBoxMove({clientX: 122, clientY: 72});
	check('a two-pixel wobble is still a click', w.state.selectionBox.didDrag, false);
	check('and the band stays invisible', w.ui.selectionBox.style.display, 'none');

	// Each axis on its own: a version testing only one of them turns a sideways drag into a
	// click, and nothing on screen says why.
	w.selection.handleSelectionBoxMove({clientX: 126, clientY: 70});
	check('four pixels sideways is a drag', w.state.selectionBox.didDrag, true);

	const vertical = world(paths);
	vertical.selection.startSelectionBox({clientX: 120, clientY: 70});
	vertical.selection.handleSelectionBoxMove({clientX: 120, clientY: 76});
	check('and four pixels downwards is a drag too', vertical.state.selectionBox.didDrag, true);

	w.selection.handleSelectionBoxMove({clientX: 130, clientY: 90});
	check('and now the band is drawn', w.ui.selectionBox.style.display, 'block');
	check('at the right place and size',
		[w.ui.selectionBox.style.left, w.ui.selectionBox.style.top,
			w.ui.selectionBox.style.width, w.ui.selectionBox.style.height],
		['20px', '20px', '10px', '20px']);
}

{
	// Dragged up and to the left: the rect has to be normalised or the width goes negative
	// and the band vanishes.
	const w = world(paths);
	w.selection.startSelectionBox({clientX: 200, clientY: 200});
	w.selection.handleSelectionBoxMove({clientX: 120, clientY: 70});
	const box = w.selection.getSelectionBoxRect();
	check('a band dragged backwards still has a positive size',
		[box.left, box.top, box.width, box.height], [20, 20, 80, 130]);
}

{
	// Scroll is added to the pointer, so a band drawn over a scrolled listing lines up with
	// the rows rather than with where they would be at the top.
	const w = world(paths);
	w.ui.main.scrollTop = 400;
	w.ui.main.scrollLeft = 15;
	const point = w.selection.getSelectionPoint({clientX: 120, clientY: 70});
	check('a point is measured from the pane and through its scroll', [point.x, point.y], [35, 420]);
}

{
	const w = world(paths);
	w.selection.startSelectionBox({clientX: 120, clientY: 70});
	w.selection.handleSelectionBoxEnd();
	check('a band that never became a drag clears the selection — it was a click on empty space',
		selected(w), []);
	check('and the band is put away', w.state.selectionBox, null);
	check('the pane stops being marked as selecting',
		w.ui.main.classList.has('Explorer__main--selecting'), false);
	check('and both listeners come off again, or every click leaks another pair',
		w.listeners.filter(l => l[0] === '-').map(l => l[1]), ['mousemove', 'mouseup']);
}

{
	// Ctrl held when the band starts means "add to what I already have", so a band drawn in
	// one corner and another in the other corner accumulate.
	const w = world(paths);
	w.selection.applySelectionFromEvent('/home/a.txt', {});
	w.selection.startSelectionBox({clientX: 120, clientY: 70, ctrlKey: true});
	check('ctrl keeps what was already selected as the base',
		Array.from(w.state.selectionBox.baseSelection), ['/home/a.txt']);

	const plain = world(paths);
	plain.selection.applySelectionFromEvent('/home/a.txt', {});
	plain.selection.startSelectionBox({clientX: 120, clientY: 70});
	check('and without ctrl the band starts from nothing',
		Array.from(plain.state.selectionBox.baseSelection), []);
}

// --- what the band touches ---------------------------------------------------------------------

{
	const hit = (a, b) => world([]).selection.intersectsSelectionBox(a, b);
	const band = {left: 10, top: 10, right: 50, bottom: 50};
	check('a row inside the band is caught',
		hit(band, {left: 20, top: 20, right: 30, bottom: 30}), true);
	check('a row the band only overlaps is caught too',
		hit(band, {left: 40, top: 40, right: 90, bottom: 90}), true);
	check('a row entirely to the right is not',
		hit(band, {left: 60, top: 20, right: 80, bottom: 30}), false);
	check('nor one entirely below',
		hit(band, {left: 20, top: 60, right: 30, bottom: 80}), false);
	// Edges touching counts, which is what makes a band dragged exactly to a row's top edge
	// select it rather than almost selecting it.
	check('a row touching the band edge-on counts as caught',
		hit(band, {left: 50, top: 50, right: 70, bottom: 70}), true);
}

{
	const rows = [
		node('/home/a.txt', {left: 100, top: 50, right: 400, bottom: 70}),
		node('/home/b.txt', {left: 100, top: 70, right: 400, bottom: 90}),
		node('/home/c.txt', {left: 100, top: 90, right: 400, bottom: 110})
	];
	const w = world(paths, rows);
	w.selection.startSelectionBox({clientX: 110, clientY: 55});
	w.selection.handleSelectionBoxMove({clientX: 300, clientY: 85});
	check('the band selects the rows it crosses',
		selected(w), ['/home/a.txt', '/home/b.txt']);
	check('and the anchor is the last row it reached, so shift-click continues from there',
		w.state.lastSelectedPath, '/home/b.txt');

	// Shrinking the band back has to *deselect*: the selection is recomputed from the base
	// each time, not accumulated.
	w.selection.handleSelectionBoxMove({clientX: 300, clientY: 65});
	check('pulling the band back up releases the row it left',
		selected(w), ['/home/a.txt']);
}

{
	const rows = [node('/home/a.txt', {left: 100, top: 50, right: 400, bottom: 70})];
	const w = world(paths, rows);
	w.ui.main.scrollTop = 200;
	const rect = w.selection.getNodeRectInMain(rows[0]);
	check('a row is measured in the same coordinates the band is', [rect.left, rect.top], [0, 200]);
}

process.exit(report('explorer-selection') ? 1 : 0);
