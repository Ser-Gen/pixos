// Drawing a context menu, and putting it where it fits.
//
// Phase 21 moved this into apps/explorer/js/context-menu.js. What did not move is the three
// item builders — they are saturated with `actions`, which stays in index.html for now, so
// this module knows how to draw a menu and nothing about what is in one. That division is
// what makes it testable: a menu is a list of plain objects in and a tree of nodes out, plus
// two pieces of positioning arithmetic that until now could only be checked by opening a
// menu near the edge of the screen and looking.

import {check, report} from './assert.mjs';
import {createContextMenu} from '../apps/explorer/js/context-menu.js';

// --- just enough DOM ----------------------------------------------------------------------

function element (tag) {
	const el = {
		tagName: tag,
		className: '',
		textContent: '',
		style: {},
		children: [],
		offsetWidth: 120,
		rect: {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0},
		attributes: {},
		setAttribute (name, value) { el.attributes[name] = String(value); },
		getBoundingClientRect () { return el.rect; },
		append (...kids) { el.children.push(...kids); }
	};
	return el;
}

function world (viewport) {
	const frames = [];
	const rendered = [];
	const listeners = {};
	const state = {contextMenu: null};
	const menu = createContextMenu({
		state: state,
		doc: {createElement: element},
		win: {
			innerWidth: (viewport || {}).width || 1000,
			innerHeight: (viewport || {}).height || 800,
			requestAnimationFrame: fn => { frames.push(fn); },
			addEventListener: (name, fn) => { listeners[name] = fn; }
		},
		renderOverlays: () => { rendered.push(state.contextMenu); }
	});
	return {state, menu, frames, rendered, listeners};
}

const items = el => el.children;
const labels = list => items(list).map(li => li.textContent);

// --- opening and closing ---------------------------------------------------------------------

{
	const w = world();
	w.menu.openContextMenu({x: 10, y: 20, items: []});
	check('opening a menu puts it in state', w.state.contextMenu.x, 10);
	check('and asks for a redraw, which is what actually draws it', w.rendered.length, 1);

	w.menu.closeContextMenu();
	check('closing takes it out again', w.state.contextMenu, null);
	check('and redraws', w.rendered.length, 2);

	// Closing an already-closed menu is the common case: every click anywhere calls it.
	// Redrawing the whole overlay layer on each of those would be a waste.
	w.menu.closeContextMenu();
	check('closing a menu that is not open does nothing at all', w.rendered.length, 2);
}

// --- the list ------------------------------------------------------------------------------

{
	const w = world();
	const list = w.menu.buildContextMenuList([
		{label: 'Open', action () {}},
		{separator: true},
		{label: 'Paste', disabled: true, action () {}}
	]);
	check('the list is a ul with the menu class', [list.tagName, list.className],
		['ul', 'ContextMenu__list']);
	check('one node per entry, separators included', items(list).length, 3);
	check('a separator is empty and carries its own class',
		[items(list)[1].className, items(list)[1].textContent],
		['ContextMenu__separator', '']);
	check('an entry shows its label', labels(list)[0], 'Open');
	check('a disabled entry says so in its class',
		items(list)[2].className, 'ContextMenu__item ContextMenu__item--disabled');
	// The important half: disabled has to mean *unclickable*, not merely grey. Paste with
	// an empty clipboard is drawn disabled, and a click that still ran it would paste
	// nothing and report a failure.
	check('and has no click handler at all', items(list)[2].onclick, undefined);
}

{
	// The sort menu (phase 24): one entry per key, the current one ticked.
	const w = world();
	const list = w.menu.buildContextMenuList([
		{label: 'Name', checked: true, action () {}},
		{label: 'Size', checked: false, action () {}},
		{label: 'Refresh', action () {}}
	]);
	check('a checked entry says so in its class', items(list)[0].className, 'ContextMenu__item ContextMenu__item--checked');
	check('and to a screen reader', [items(list)[0].attributes.role, items(list)[0].attributes['aria-checked']],
		['menuitemradio', 'true']);
	check('an unchecked choice is still a choice', [items(list)[1].className, items(list)[1].attributes['aria-checked']],
		['ContextMenu__item', 'false']);
	check('an entry that is not a choice is not announced as one', items(list)[2].attributes.role, undefined);
	check('and the label is left as it was, with no tick typed in', labels(list)[0], 'Name');
}

{
	// A chord beside a command (phase 25), already written for the machine by the time it is here.
	const w = world();
	const list = w.menu.buildContextMenuList([
		{label: 'Copy', hint: '⌘C', action () {}},
		{label: 'New', hint: '⌘N', submenu: [{label: 'New File', action () {}}]},
		{label: 'Rename', hint: '', action () {}}
	]);
	check('an entry with a chord draws it after the label', [labels(list)[0], items(list)[0].children.map(c => [c.className, c.textContent])],
		['Copy', [['ContextMenu__hint', '⌘C']]]);
	check('a submenu keeps its arrow in that place, and no chord', items(list)[1].children.map(c => c.className || c.textContent),
		['›', 'ContextMenu__submenu']);
	check('an empty chord draws nothing', items(list)[2].children.length, 0);
}

{
	// Order matters. The action is what opens a dialog, and closing the menu afterwards
	// would tear down the dialog it had just opened.
	const w = world();
	// Observed from inside the action, which is the only place the order is visible: if the
	// menu is still in state when the action runs, the close came second.
	let menuWhenActionRan = 'not run';
	const list = w.menu.buildContextMenuList([
		{label: 'Rename', action () { menuWhenActionRan = w.state.contextMenu; }}
	]);
	w.state.contextMenu = {items: []};
	const stopped = [];
	items(list)[0].onclick({stopPropagation: () => { stopped.push(true); }});
	check('clicking an entry closes the menu before running the action',
		menuWhenActionRan, null);
	check('and the menu stays gone afterwards', w.state.contextMenu, null);
	check('and the click does not carry on to whatever is underneath', stopped, [true]);
}

{
	const w = world();
	const list = w.menu.buildContextMenuList([
		{label: 'New', submenu: [{label: 'New File', action () {}}, {label: 'New Folder'}]}
	]);
	const parent = items(list)[0];
	check('an entry with a submenu gets a marker',
		parent.children[0].textContent, '›');
	const sub = parent.children[1];
	check('and the submenu itself, as a nested list', sub.className, 'ContextMenu__submenu');
	check('with its own entries', labels(sub.children[0]), ['New File', 'New Folder']);
	check('positioned on hover rather than up front, because it has no size until then',
		typeof parent.onmouseenter, 'function');

	const empty = w.menu.buildContextMenuList([{label: 'New', submenu: []}]);
	check('an empty submenu is not a submenu', items(empty)[0].children.length, 0);
}

// --- where it goes ---------------------------------------------------------------------------

{
	const w = world({width: 1000, height: 800});
	const node = w.menu.buildContextMenuNode([{label: 'Open', action () {}}], 40, 60);
	check('the menu is placed where the click was', [node.style.left, node.style.top],
		['40px', '60px']);
	check('and swallows its own clicks and right-clicks',
		[typeof node.onclick, typeof node.oncontextmenu], ['function', 'function']);

	// Measuring has to wait a frame: the node has no size until it is in the document.
	node.rect = {width: 200, height: 300};
	w.menu.positionContextMenuNode(node, 40, 60);
	check('positioning waits for a frame rather than measuring an unattached node',
		w.frames.length, 1);
	w.frames[0]();
	check('a menu with room stays exactly where it was asked to go',
		[node.style.left, node.style.top], ['40px', '60px']);
}

{
	const w = world({width: 1000, height: 800});
	const node = w.menu.buildContextMenuNode([], 950, 700);
	node.rect = {width: 200, height: 300};
	w.menu.positionContextMenuNode(node, 950, 700);
	w.frames[0]();
	// 1000 - 200 - 6 and 800 - 300 - 6: pulled back inside, with the margin kept.
	check('a menu opened near the corner is pulled back on screen',
		[node.style.left, node.style.top], ['794px', '494px']);
}

{
	// A menu taller than the window. There is no position that fits, so the clamp gives up
	// on the bottom and pins the *top* to the margin — the top of a menu is the half worth
	// showing. Note that it moves the menu up to 6px even though the click at 10px would
	// have fit: `Math.min(y, ...)` takes the margin once the window is the smaller of the
	// two, which is the correct end to sacrifice.
	const w = world({width: 400, height: 200});
	const node = w.menu.buildContextMenuNode([], 10, 10);
	node.rect = {width: 300, height: 400};
	w.menu.positionContextMenuNode(node, 10, 10);
	w.frames[0]();
	check('a menu bigger than the window is pinned to the margin, not pushed off the top',
		[node.style.left, node.style.top], ['10px', '6px']);
}

// --- submenus flip ------------------------------------------------------------------------------

{
	const w = world({width: 1000, height: 800});
	const sub = element('div');
	sub.rect = {width: 180, height: 120};
	sub.style.display = 'none';
	sub.style.visibility = 'visible';
	const parentItem = element('li');
	parentItem.rect = {right: 300, top: 100};
	parentItem.offsetWidth = 150;

	w.menu.positionSubmenuNode(sub, parentItem);
	check('a submenu with room opens to the right of its parent', sub.style.left, '144px');
	check('and just above the parent row', sub.style.top, '-6px');
	// It is measured by being shown invisibly and then put back exactly as it was, or the
	// second hover finds it already open.
	check('the submenu is left displayed as it was found', sub.style.display, 'none');
	check('and as visible as it was found', sub.style.visibility, 'visible');
	check('with no stale right offset fighting the left one', sub.style.right, 'auto');
}

{
	const w = world({width: 1000, height: 800});
	const sub = element('div');
	sub.rect = {width: 180, height: 120};
	const parentItem = element('li');
	parentItem.rect = {right: 900, top: 100};
	parentItem.offsetWidth = 150;
	w.menu.positionSubmenuNode(sub, parentItem);
	check('a submenu with no room on the right opens to the left instead',
		sub.style.left, '-174px');
}

{
	// Hovering the last row of a tall menu: the submenu would hang off the bottom, so it
	// slides up until it fits.
	const w = world({width: 1000, height: 300});
	const sub = element('div');
	sub.rect = {width: 180, height: 200};
	const parentItem = element('li');
	parentItem.rect = {right: 300, top: 250};
	parentItem.offsetWidth = 150;
	w.menu.positionSubmenuNode(sub, parentItem);
	// 300 - 6 - 250 - 200
	check('a submenu near the bottom slides up to stay on screen', sub.style.top, '-156px');
}

{
	// And near the top it slides down rather than off.
	const w = world({width: 1000, height: 800});
	const sub = element('div');
	sub.rect = {width: 180, height: 120};
	const parentItem = element('li');
	parentItem.rect = {right: 300, top: 2};
	parentItem.offsetWidth = 150;
	w.menu.positionSubmenuNode(sub, parentItem);
	check('and one at the very top slides down instead of off it', sub.style.top, '4px');
}

// --- a click that lands somewhere else entirely ---------------------------------------------
//
// Reported while walking the phase 21 checklist: the menu stayed open when the click was
// outside Explorer. index.html closes it on a click in Explorer's own document, and the
// desktop, the taskbar and every other window are a different document, so that listener
// never hears about them. Losing the focus is the only signal an iframe gets.

{
	const w = world();
	check('the module listens for the window losing focus',
		typeof w.listeners.blur, 'function');

	w.menu.openContextMenu({x: 10, y: 20, items: []});
	w.listeners.blur();
	check('a menu open when Explorer loses the focus is closed', w.state.contextMenu, null);

	// It shares closeContextMenu, so it inherits the do-nothing-when-shut behaviour: the
	// focus moves in and out of an iframe constantly and must not redraw the overlay layer
	// every time.
	const quiet = w.rendered.length;
	w.listeners.blur();
	w.listeners.blur();
	check('and losing the focus with no menu open redraws nothing',
		w.rendered.length, quiet);
}

process.exit(report('explorer-context-menu') ? 1 : 0);
