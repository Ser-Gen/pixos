// Everything Explorer draws of itself: apps/explorer/js/view.js.
//
// Three of the four things in here are invisible until they are wrong in front of somebody.
//
//   * **`renderLayout` writes one template and then looks thirty nodes up in it by class.**
//     Rename a class in the markup and the matching `ui.x` is quietly `null` — no error at
//     render time, an "is not a function" the first time a button is pressed, and nothing at
//     all for the ones that are only read. So the whole of `ui` is checked against the
//     template it was filled from.
//   * **Folders come first whichever way the sort points.** The grouping is decided before
//     the direction multiplier is applied, which is easy to lose when the comparator is
//     rearranged, and reversing the list is exactly the moment somebody would notice.
//   * **A name goes into `innerHTML` twice per row** — once in the table cell, once in the
//     card — so a file called `<img onerror=...>` is a stored XSS in a file manager if either
//     one forgets to escape.
//
// The fourth is the cycle with js/selection.js: `renderRows` and `renderToolbarState` both end
// by asking the selection to redraw its checkboxes, and that is the edge index.html breaks
// with a late-bound pair.

import {check, report} from './assert.mjs';
import {createView} from '../apps/explorer/js/view.js';
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
const format = createFormat(pathStub);

// --- as much DOM as the module touches ------------------------------------------------------

function el (tag) {
	let html = '';
	return {
		tag: tag,
		className: '',
		// Assigning innerHTML drops whatever was in the node, which is the only DOM semantic
		// these renders depend on: each of them starts by emptying what it is about to fill,
		// and a fake that kept its children would let a doubled listing pass.
		get innerHTML () { return html; },
		set innerHTML (value) { html = value; this.children.length = 0; },
		textContent: '',
		title: '',
		value: '',
		hidden: false,
		disabled: false,
		checked: false,
		indeterminate: false,
		draggable: false,
		dataset: {},
		style: {},
		children: [],
		append (...nodes) { nodes.forEach(n => this.children.push(n)); }
	};
}

const doc = {createElement: tag => el(tag)};

// `rootElem` answers a selector only if the class is really in the markup `renderLayout` just
// wrote. That is the whole point: a selector nobody updated returns null here exactly as it
// would in a browser.
function rootElem () {
	let markup = '';
	return {
		get innerHTML () { return markup; },
		set innerHTML (value) { markup = value; },
		querySelector (selector) {
			const cls = selector.replace(/^\./, '');
			return new RegExp('class="[^"]*\\b' + cls + '\\b[^"]*"').test(markup)
				? el('div')
				: null;
		}
	};
}

function harness (options) {
	options = options || {};
	const h = {
		state: {
			cwd: options.cwd || '/home',
			items: options.items || [],
			selectedPaths: new Set(options.selected || []),
			historyBack: options.back || [],
			historyForward: options.forward || [],
			sort: options.sort || {key: 'name', dir: 'asc'},
			viewMode: options.viewMode || 'details'
		},
		ui: {},
		root: rootElem(),
		syncs: 0,
		clipboard: !!options.clipboard
	};

	h.view = createView({
		state: h.state,
		ui: h.ui,
		rootElem: h.root,
		doc: doc,
		escapeAttr: format.escapeAttr,
		escapeHtml: format.escapeHtml,
		formatSize: format.formatSize,
		getExt: format.getExt,
		getItemTitle: format.getItemTitle,
		hasInternalClipboard: () => h.clipboard,
		getSelectedItems: () => h.state.items.filter(i => h.state.selectedPaths.has(i.path)),
		syncSelectAllUI: () => { h.syncs++; }
	});
	h.view.renderLayout();
	return h;
}

function item (name, extra) {
	return Object.assign({
		name: name,
		path: '/home/' + name,
		isDirectory: false,
		size: 10,
		mtime: '2026-01-01 00:00:00',
		mtimeTs: 1
	}, extra || {});
}

// --- renderLayout, and the thirty lookups after it -------------------------------------------

{
	const h = harness();
	const missing = Object.keys(h.ui).filter(key => !h.ui[key]);
	check('every node renderLayout looks up is really in the markup it wrote', missing, []);
	check('and there are the thirty of them the rest of the app reads',
		Object.keys(h.ui).length, 30);

	// The four the other modules reach for by name, spot-checked so that a rename of one of
	// these has to come here and say so.
	['rows', 'grid', 'overlays', 'selectionBox'].forEach(key => {
		check('ui.' + key + ' exists', !!h.ui[key], true);
	});

	check('the layout is written once, into the window root',
		h.root.innerHTML.indexOf('Explorer__toolbar') > -1, true);
}

{
	// Two Explorer windows are two iframes, and every lookup here is scoped to the window's
	// own root rather than to the document -- a selector that escaped one would find the
	// other's rows.
	const h = harness();
	check('nothing is looked up on the document', typeof doc.querySelector, 'undefined');
	check('and the root is what answered', h.root.innerHTML.length > 500, true);
}

// --- sortItems ---------------------------------------------------------------------------------

{
	const h = harness({items: [
		item('b.txt'), item('folder', {isDirectory: true}), item('a.txt')
	]});
	h.view.sortItems();
	check('folders come first, then files by name',
		h.state.items.map(i => i.name), ['folder', 'a.txt', 'b.txt']);
}

{
	// The grouping happens before the direction multiplier, so reversing the sort reverses
	// the files and leaves the folders on top. Fold the two together and a descending sort
	// buries every folder at the bottom.
	const h = harness({
		items: [item('b.txt'), item('folder', {isDirectory: true}), item('a.txt')],
		sort: {key: 'name', dir: 'desc'}
	});
	h.view.sortItems();
	check('and they still come first when the sort is reversed',
		h.state.items.map(i => i.name), ['folder', 'b.txt', 'a.txt']);
}

{
	const h = harness({
		items: [item('big', {size: 900}), item('small', {size: 3}), item('mid', {size: 40})],
		sort: {key: 'size', dir: 'asc'}
	});
	h.view.sortItems();
	check('sorting by size', h.state.items.map(i => i.name), ['small', 'mid', 'big']);
	h.state.sort.dir = 'desc';
	h.view.sortItems();
	check('and by size the other way', h.state.items.map(i => i.name), ['big', 'mid', 'small']);
}

{
	const h = harness({
		items: [item('c', {mtimeTs: 30}), item('a', {mtimeTs: 10}), item('b', {mtimeTs: 20})],
		sort: {key: 'mtime', dir: 'asc'}
	});
	h.view.sortItems();
	check('sorting by date', h.state.items.map(i => i.name), ['a', 'b', 'c']);
}

{
	const h = harness({
		items: [item('b.zip'), item('a.txt'), item('c.txt')],
		sort: {key: 'type', dir: 'asc'}
	});
	h.view.sortItems();
	check('sorting by type groups the extensions', h.state.items.map(i => i.name),
		['a.txt', 'c.txt', 'b.zip']);
}

{
	// Every key falls through to the name when the key itself ties, which is what stops the
	// list reshuffling itself on a refresh that changed nothing.
	const h = harness({
		items: [item('c', {size: 5}), item('a', {size: 5}), item('b', {size: 5})],
		sort: {key: 'size', dir: 'asc'}
	});
	h.view.sortItems();
	check('a tie is broken by name', h.state.items.map(i => i.name), ['a', 'b', 'c']);
}

// --- renderToolbarState -------------------------------------------------------------------------

{
	const h = harness({cwd: '/'});
	h.view.renderToolbarState();
	check('with no history, back and forward are dead',
		[h.ui.back.disabled, h.ui.forward.disabled], [true, true]);
	check('at the root, Up is dead too', h.ui.up.disabled, true);
	check('with nothing selected, Copy and Cut are dead',
		[h.ui.copy.disabled, h.ui.cut.disabled], [true, true]);
	check('with an empty clipboard, Paste is dead', h.ui.paste.disabled, true);
	check('and the selection checkbox is redrawn with the rest', h.syncs, 1);
}

{
	const h = harness({
		cwd: '/home/docs', back: ['/home'], forward: ['/tmp'],
		items: [item('a.txt')], selected: ['/home/a.txt'], clipboard: true,
		sort: {key: 'size', dir: 'asc'}, viewMode: 'grid'
	});
	h.view.renderToolbarState();
	check('history enables the two arrows',
		[h.ui.back.disabled, h.ui.forward.disabled], [false, false]);
	check('below the root, Up is live', h.ui.up.disabled, false);
	check('a selection enables Copy and Cut',
		[h.ui.copy.disabled, h.ui.cut.disabled], [false, false]);
	check('a full clipboard enables Paste', h.ui.paste.disabled, false);
	check('and the two selects show what state says they show',
		[h.ui.sortKey.value, h.ui.viewMode.value], ['size', 'grid']);
}

// --- renderBreadcrumbs ------------------------------------------------------------------------

{
	const h = harness({cwd: '/home/docs/2026'});
	h.view.renderBreadcrumbs();
	const crumbs = h.ui.breadcrumbs.children.filter(n => n.className.indexOf('Explorer__crumb') === 0);
	check('one crumb per segment, plus the root',
		crumbs.map(n => n.textContent), ['rootfs', 'home', 'docs', '2026']);
	check('each carries the path it walks to',
		crumbs.map(n => n.dataset.path), ['/', '/home', '/home/docs', '/home/docs/2026']);
	check('only the last one is marked current',
		crumbs.map(n => n.className.indexOf('--current') > -1), [false, false, false, true]);
	check('with a separator between each pair',
		h.ui.breadcrumbs.children.filter(n => n.textContent === '/').length, 3);
}

{
	const h = harness({cwd: '/'});
	h.view.renderBreadcrumbs();
	check('the root on its own is one crumb and no separator',
		h.ui.breadcrumbs.children.length, 1);
	check('and it is marked current',
		h.ui.breadcrumbs.children[0].className.indexOf('--current') > -1, true);
}

{
	// Redrawn, not appended to: navigating four folders deep and back used to leave every
	// crumb of every folder visited in the bar.
	const h = harness({cwd: '/home'});
	h.view.renderBreadcrumbs();
	const first = h.ui.breadcrumbs.children.length;
	h.view.renderBreadcrumbs();
	check('a second render replaces the first', h.ui.breadcrumbs.children.length, first);
}

// --- renderRows -----------------------------------------------------------------------------

{
	const h = harness({items: [
		item('folder', {isDirectory: true}), item('notes.txt'), item('big.iso', {size: 2048})
	]});
	h.view.renderRows();
	check('one row per item', h.ui.rows.children.length, 3);
	check('and one card per item, so switching view mode draws nothing new',
		h.ui.grid.children.length, 3);
	check('each row knows its path',
		h.ui.rows.children.map(n => n.dataset.path),
		['/home/folder', '/home/notes.txt', '/home/big.iso']);
	check('and whether it is a folder',
		h.ui.rows.children.map(n => n.dataset.type), ['dir', 'file', 'file']);
	check('every row can be dragged', h.ui.rows.children.every(n => n.draggable), true);
	check('and so can every card', h.ui.grid.children.every(n => n.draggable), true);
	check('the empty note is hidden while there are items', h.ui.empty.hidden, true);
	check('the status line is redrawn with the rows',
		h.ui.status.textContent, '3 items | selected: 0 | selected size: 0 B');
	check('and the select-all checkbox with it', h.syncs, 1);
}

{
	const h = harness({items: []});
	h.view.renderRows();
	check('an empty folder says so', h.ui.empty.hidden, false);
	check('and draws no rows', h.ui.rows.children.length, 0);
}

{
	const h = harness({items: [item('a.txt')], viewMode: 'grid'});
	h.view.renderRows();
	check('in grid mode the table is hidden', h.ui.table.hidden, true);
	check('and the grid is not', h.ui.grid.hidden, false);
}

{
	const h = harness({items: [item('a.txt')], viewMode: 'details'});
	h.view.renderRows();
	check('in details mode it is the other way round',
		[h.ui.table.hidden, h.ui.grid.hidden], [false, true]);
}

{
	const h = harness({items: [item('a.txt'), item('b.txt')], selected: ['/home/b.txt']});
	h.view.renderRows();
	check('a selected row is drawn selected',
		h.ui.rows.children.map(n => n.className.indexOf('--selected') > -1), [false, true]);
	check('and so is its card',
		h.ui.grid.children.map(n => n.className.indexOf('--selected') > -1), [false, true]);
	check('the checkbox in it is checked',
		h.ui.rows.children[1].children[0].innerHTML.indexOf(' checked') > -1, true);
	check('and the one beside it is not',
		h.ui.rows.children[0].children[0].innerHTML.indexOf(' checked') > -1, false);
}

{
	// A file manager renders names it did not choose. Both places one goes into innerHTML
	// are checked, because the card was added a year after the row and copied the wrong half.
	const h = harness({items: [item('<img src=x onerror=alert(1)>')]});
	h.view.renderRows();
	const row = h.ui.rows.children[0];
	const card = h.ui.grid.children[0];
	check('the name in the row is escaped',
		row.children[1].innerHTML.indexOf('<img') === -1, true);
	check('and it is still readable', row.children[1].innerHTML.indexOf('&lt;img') > -1, true);
	check('the name in the card is escaped too', card.innerHTML.indexOf('<img src=x') === -1, true);
	check('and so is the one in the checkbox attribute',
		card.innerHTML.indexOf('onerror=alert(1)"') === -1, true);
}

{
	const h = harness({items: [
		item('folder', {isDirectory: true}), item('notes.txt'), item('big.iso', {size: 2048})
	]});
	h.view.renderRows();
	const cells = h.ui.rows.children.map(n => n.children.map(c => c.textContent));
	check('a folder has no size', cells[0][4], '');
	check('and is typed as one', cells[0][2], 'Folder');
	check('a file shows its extension', cells[1][2], 'txt');
	check('and its size, spelled the one way sizes are spelled', cells[2][4], '2.0 KB');
	check('every row carries the hover title', h.ui.rows.children.every(n => !!n.title), true);
}

{
	// Cleared before it is filled: a refresh used to append a second copy of the folder to
	// the one already on screen.
	const h = harness({items: [item('a.txt')]});
	h.view.renderRows();
	h.view.renderRows();
	check('a second render replaces the first', h.ui.rows.children.length, 1);
	check('in the grid as well', h.ui.grid.children.length, 1);
}

// --- renderStatus -------------------------------------------------------------------------------

{
	const h = harness({
		items: [item('a.txt', {size: 100}), item('b.txt', {size: 200}),
			item('folder', {isDirectory: true, size: 4096})],
		selected: ['/home/a.txt', '/home/b.txt']
	});
	h.view.renderStatus();
	check('the status line counts the folder and the selection',
		h.ui.status.textContent, '3 items | selected: 2 | selected size: 300 B');
}

{
	// A folder's own size is whatever the filesystem says the directory entry weighs, which
	// is not the size of anything in it. Adding it to the total says "selected size: 4 KB"
	// about a selection of nothing.
	const h = harness({
		items: [item('folder', {isDirectory: true, size: 4096})],
		selected: ['/home/folder']
	});
	h.view.renderStatus();
	check('a selected folder contributes nothing to the size',
		h.ui.status.textContent, '1 items | selected: 1 | selected size: 0 B');
}

report('explorer-view');
