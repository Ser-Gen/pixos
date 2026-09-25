// Everything Explorer draws of itself: apps/explorer/js/view.js.
//
// Three of the four things in here are invisible until they are wrong in front of somebody.
//
//   * **`renderLayout` writes one template and then looks forty-three nodes up in it by class.**
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
		attributes: {},
		children: [],
		setAttribute (name, value) { this.attributes[name] = String(value); },
		getAttribute (name) { return name in this.attributes ? this.attributes[name] : null; },
		append (...nodes) { nodes.forEach(n => this.children.push(n)); }
	};
}

const doc = {createElement: tag => el(tag), createTextNode: text => ({textContent: text, children: []})};

// What a node reads as, children included -- the fake keeps `textContent` and `children` apart.
const textOf = node => node.textContent + node.children.map(textOf).join('');

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
		kindOf: format.kindOf,
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

// --- renderLayout, and the forty-three lookups after it ----------------------------------------

{
	const h = harness();
	const missing = Object.keys(h.ui).filter(key => !h.ui[key]);
	check('every node renderLayout looks up is really in the markup it wrote', missing, []);
	// Thirty until phase 23 made the sidebar a drawer: its toggle, the body whose class closes
	// it, and the list and footer it is drawn into. Forty-two since phase 24 put the commands on a
	// rail: two view buttons and a sort button where two selects were, *More* where *Default Apps*
	// was, the selection line's box of actions with Compress and Delete in it, and the foot with
	// its text and the three parts of the storage gauge.
	check('and there are the forty-three of them the rest of the app reads',
		Object.keys(h.ui).length, 43);
	check('the two selects and the Default Apps button are gone, not left behind unread',
		['viewMode', 'sortKey', 'defaults'].filter(key => key in h.ui), []);

	// The four the other modules reach for by name, spot-checked so that a rename of one of
	// these has to come here and say so.
	['rows', 'grid', 'overlays', 'selectionBox'].forEach(key => {
		check('ui.' + key + ' exists', !!h.ui[key], true);
	});

	check('the layout is written once, into the window root',
		h.root.innerHTML.indexOf('Explorer__rail') > -1, true);
	check('every rail button names itself twice, for the pointer and for a screen reader',
		(h.root.innerHTML.match(/class="Explorer__railButton [^"]*" type="button" title="([^"]+)" aria-label="\1"/g) || []).length, 12);
	check('and there is no emoji left in the chrome', /[\u{1F300}-\u{1FAFF}]/u.test(h.root.innerHTML), false);
}

{
	// Phase 25: a command with a chord says it in its tooltip, written by the shell for the machine.
	// The name a screen reader hears stays the name alone.
	const h = harness();
	const root = rootElem();
	createView({
		state: h.state, ui: {}, rootElem: root, doc: doc,
		escapeAttr: format.escapeAttr, escapeHtml: format.escapeHtml, formatSize: format.formatSize,
		getExt: format.getExt, getItemTitle: format.getItemTitle, kindOf: format.kindOf,
		hasInternalClipboard: () => false, getSelectedItems: () => [], syncSelectAllUI () {},
		keyHint: name => ({paste: '⌘V', copy: '⌘C', cut: '⌘X', delete: '⌘⌫'})[name] || ''
	}).renderLayout();
	const html = root.innerHTML;
	check('the rail\'s Paste gives its chord in the tooltip', /class="Explorer__railButton Explorer__paste" type="button" title="Paste \(⌘V\)" aria-label="Paste"/.test(html), true);
	check('the selection line\'s four do too',
		['Copy (⌘C)', 'Cut (⌘X)', 'Delete (⌘⌫)', 'Paste (⌘V)'].every(t => html.indexOf('title="' + t + '"') > -1), true);
	check('a button with no chord keeps its plain name', /title="Upload" aria-label="Upload"/.test(html), true);
	check('with no shell to write chords, no tooltip carries one', /\(⌘/.test(h.root.innerHTML), false);
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
	// Phase 26: a screensaver is typed as one, page or folder, and sorts under that name rather
	// than under html or among the plain folders.
	const h = harness({
		items: [item('b.zip'), item('Rain.xscr.html'), item('a.txt'), item('page.html'),
			item('Slideshow.xscr', {isDirectory: true}), item('zfolder', {isDirectory: true}), item('old.zip', {isDirectory: true})],
		sort: {key: 'type', dir: 'asc'}
	});
	h.view.sortItems();
	// A folder's type is Folder whatever it is called -- old.zip sorts as one, not as a zip.
	check('sorting by type puts a screensaver where its Type says, not with the pages or the folders',
		h.state.items.map(i => i.name), ['old.zip', 'zfolder', 'Slideshow.xscr', 'page.html', 'Rain.xscr.html', 'a.txt', 'b.zip']);
	h.view.renderRows();
	const cells = h.ui.rows.children.map(n => n.children[2].textContent);
	check('and the Type column says Screensaver for the folder and the page',
		cells, ['Folder', 'Folder', 'Screensaver', 'html', 'Screensaver', 'txt', 'zip']);
	const marks = html => (html.match(/Explorer__kind--(\w+)/) || [])[1];
	check('both drawn with the screensaver mark, in the row and the card',
		[marks(h.ui.rows.children[2].children[1].innerHTML), marks(h.ui.rows.children[4].children[1].innerHTML),
			marks(h.ui.grid.children[2].innerHTML), marks(h.ui.grid.children[4].innerHTML)], ['scr', 'scr', 'scr', 'scr']);
	check('while the folder stays a folder to everything else', h.ui.rows.children[2].dataset.type, 'dir');
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
	check('with nothing selected and nothing copied, the selection line has no actions on it', h.ui.acts.hidden, true);
	check('with an empty clipboard, Paste is dead', h.ui.paste.disabled, true);
	check('details is the view that is on', [h.ui.viewDetails.getAttribute('aria-pressed'), h.ui.viewGrid.getAttribute('aria-pressed')],
		['true', 'false']);
	check('the sort button says what the sort is', [h.ui.sort.title, h.ui.sort.getAttribute('aria-label')],
		['Sort: Name, ascending', 'Sort: Name, ascending']);
	check('and so does the foot', h.ui.footText.textContent, 'sorted by name, ascending  ·  details view');
	check('the table carries the key and direction the stylesheet draws the arrow from',
		[h.ui.table.dataset.sortKey, h.ui.table.dataset.sortDir], ['name', 'asc']);
	check('and the selection checkbox is redrawn with the rest', h.syncs, 1);
}

{
	const h = harness({
		cwd: '/home/docs', back: ['/home'], forward: ['/tmp'],
		items: [item('a.txt')], selected: ['/home/a.txt'], clipboard: true,
		sort: {key: 'size', dir: 'desc'}, viewMode: 'grid'
	});
	h.view.renderToolbarState();
	check('history enables the two arrows',
		[h.ui.back.disabled, h.ui.forward.disabled], [false, false]);
	check('below the root, Up is live', h.ui.up.disabled, false);
	check('a selection puts its actions on the line under the path', h.ui.acts.hidden, false);
	check('all four of them', [h.ui.copy, h.ui.cut, h.ui.compress, h.ui.delete].map(b => b.hidden), [false, false, false, false]);
	check('a full clipboard enables Paste', h.ui.paste.disabled, false);
	check('and puts Paste on the line beside them', h.ui.pasteHere.hidden, false);
	check('grid is the view that is on', [h.ui.viewDetails.getAttribute('aria-pressed'), h.ui.viewGrid.getAttribute('aria-pressed')],
		['false', 'true']);
	check('a reversed sort by size is named as one', h.ui.sort.title, 'Sort: Size, descending');
	check('in the foot too', h.ui.footText.textContent, 'sorted by size, descending  ·  grid view');
	check('and on the table', [h.ui.table.dataset.sortKey, h.ui.table.dataset.sortDir], ['size', 'desc']);
}

{
	// Mockup B disabled Paste whenever nothing was selected. Pasting needs something copied and
	// nothing selected, so that was wrong, and the check is here because the mockup is what the
	// chrome was built from.
	const h = harness({items: [item('a.txt')], selected: [], clipboard: true});
	h.ui.acts.hidden = true;
	h.view.renderToolbarState();
	check('Paste follows the clipboard, not the selection', h.ui.paste.disabled, false);
	// After the first walk: something copied, nothing selected, and the line under the path showed
	// only a count -- Paste was a rail icon away.
	check('something copied opens the line under the path with nothing selected', h.ui.acts.hidden, false);
	check('with Paste on it', h.ui.pasteHere.hidden, false);
	check('and not the four that need a selection', [h.ui.copy, h.ui.cut, h.ui.compress, h.ui.delete].map(b => b.hidden),
		[true, true, true, true]);
}

{
	const h = harness({items: [item('a.txt')], selected: ['/home/a.txt'], clipboard: false});
	h.ui.pasteHere.hidden = false;
	h.view.renderToolbarState();
	check('a selection with nothing copied has no Paste on its line', [h.ui.acts.hidden, h.ui.pasteHere.hidden], [false, true]);
}

// --- renderBreadcrumbs ------------------------------------------------------------------------

const crumbsOf = h => h.ui.breadcrumbs.children.filter(n => n.className.split(' ')[0] === 'Explorer__crumb');
const separatorsOf = h => h.ui.breadcrumbs.children.filter(n => n.className === 'Explorer__crumbSep');

{
	const h = harness({cwd: '/home/docs/2026'});
	h.view.renderBreadcrumbs();
	const crumbs = crumbsOf(h);
	check('one crumb per segment, plus the root, which is drawn as the root is written',
		crumbs.map(n => n.textContent), ['/', 'home', 'docs', '2026']);
	check('each carries the path it walks to',
		crumbs.map(n => n.dataset.path), ['/', '/home', '/home/docs', '/home/docs/2026']);
	check('only the last one is marked current',
		crumbs.map(n => n.className.indexOf('--current') > -1), [false, false, false, true]);
	check('every other crumb is a button, so the keyboard can reach it, and the current one is text',
		crumbs.map(n => [n.tag, n.type || null]), [['button', 'button'], ['button', 'button'], ['button', 'button'], ['span', null]]);
	check('the whole title reads as the path', h.ui.breadcrumbs.children.map(n => n.textContent).join(''), '/home/docs/2026');
	check('which means no separator after the root, one between each other pair', separatorsOf(h).length, 2);
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
	check('the status line is redrawn with the rows', textOf(h.ui.status), '3 items');
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
	const date = h.ui.rows.children[0].children[3];
	check('the modified column reads as the whole stamp', textOf(date), '2026-01-01 00:00:00');
	check('with the time in a part of its own, which a narrow window drops',
		[date.textContent, date.children.map(c => [c.className, c.textContent])], ['2026-01-01', [['Explorer__time', ' 00:00:00']]]);
	check('each cell says which column it is, which is what a narrow window hides by',
		h.ui.rows.children[0].children.map(c => c.className),
		['Explorer__selectCol', 'Explorer__colName', 'Explorer__colType', 'Explorer__colModified', 'Explorer__colSize']);
}

{
	// Phase 24 draws a kind instead of 📁 and 📄.
	const h = harness({items: [
		item('folder', {isDirectory: true}), item('photo.png'), item('site.zip'), item('notes.txt')
	]});
	h.view.renderRows();
	const marks = html => (html.match(/Explorer__kind--(\w+)/) || [])[1];
	check('each row is drawn with the mark of its kind', h.ui.rows.children.map(n => marks(n.children[1].innerHTML)),
		['dir', 'img', 'bin', 'doc']);
	check('and so is each card', h.ui.grid.children.map(n => marks(n.innerHTML)), ['dir', 'img', 'bin', 'doc']);
	check('the mark is hidden from a screen reader, which has the Type column',
		/class="Explorer__kind [^"]*" aria-hidden="true"/.test(h.ui.rows.children[0].children[1].innerHTML), true);
	check('and no emoji is left in a row or a card',
		/[\u{1F300}-\u{1FAFF}]/u.test(h.ui.rows.children.concat(h.ui.grid.children).map(n => n.innerHTML + n.children.map(c => c.innerHTML).join('')).join('')), false);
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
		textOf(h.ui.status), '3 items  —  2 selected (300 B)');
	check('with the selection set apart, which is what the stylesheet colours',
		h.ui.status.children.filter(n => n.tag === 'b').map(n => n.textContent), ['2 selected']);
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
	check('a selected folder contributes nothing to the size, and a size of nothing is not shown',
		textOf(h.ui.status), '1 item  —  1 selected');
}

{
	const h = harness({items: [item('a.txt')]});
	h.view.renderStatus();
	h.view.renderStatus();
	check('the status is replaced, not added to', textOf(h.ui.status), '1 item');
}

// --- renderStorage ------------------------------------------------------------------------------
//
// The shell's figure, drawn in the foot. Hidden until there is one to draw.

{
	const h = harness();
	// Hidden in the markup, as the template writes it; the fake starts every node visible.
	h.ui.gauge.hidden = true;
	h.view.renderStorage({supported: true, usage: 512, quota: 2048});
	check('a figure is drawn as used of available', [h.ui.gauge.hidden, h.ui.gaugeText.textContent], [false, '512 B / 2.0 KB']);
	check('with the bar filled by the share used', h.ui.gaugeFill.style.width, '25.0%');
	check('and a tooltip that says what it is a figure of', h.ui.gauge.title, '512 B of 2.0 KB used by PixOS in this browser');

	h.view.renderStorage({supported: true, usage: 9000, quota: 2048});
	check('a usage past the quota fills the bar and no further', h.ui.gaugeFill.style.width, '100.0%');

	[null, {supported: false}, {supported: true, usage: 5, quota: 0}].forEach((storage, i) => {
		h.view.renderStorage(storage);
		check('no figure, a browser that will not estimate, or no quota hides the gauge (' + i + ')', h.ui.gauge.hidden, true);
	});
}

report('explorer-view');
