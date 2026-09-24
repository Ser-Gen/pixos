// The rail and the lines around the listing: what phase 24 wired in apps/explorer/index.html.
//
// Mockup B moved every command onto a rail down the left edge, where nothing crops. The drawing is
// js/view.js and tests/explorer-view.test.mjs; this is what the buttons do, which lives in
// `bindEvents` and four small functions beside it. Three things here have no error attached when
// they are wrong:
//
//   * **A rail menu opens beside its button.** A keyboard press has no pointer, so a menu placed at
//     the event's clientX/clientY opened in the window's top-left corner.
//   * **The sort menu is two questions.** Choosing a key must keep the direction, and choosing a
//     direction must keep the key, or the header arrow and the menu disagree.
//   * **A view or sort change redraws the rail as well as the rows.** Otherwise the pressed button,
//     the sort button's name and the foot all describe the view before.

import fs from 'node:fs';
import {check, report} from './assert.mjs';
import {SORT_LABELS} from '../apps/explorer/js/view.js';

const entry = fs.readFileSync(new URL('../apps/explorer/index.html', import.meta.url), 'utf8');

function slice (from, to) {
	const start = entry.indexOf(from);
	const end = entry.indexOf(to, start);
	if (start === -1 || end === -1) {
		console.error('explorer-rail.test.mjs: could not find "' + (start === -1 ? from : to) + '" in apps/explorer/index.html');
		process.exit(1);
	}
	return entry.slice(start, end);
}

const helpers = slice('\tfunction openMenuBeside (', '\tfunction navigateTo (');

function world (sort, viewMode) {
	const w = {
		state: {sort: sort || {key: 'name', dir: 'asc'}, viewMode: viewMode || 'details'},
		trace: [],
		menus: []
	};
	w.api = new Function('state', 'SORT_LABELS', 'openContextMenu', 'sortItems', 'renderRows', 'renderToolbarState',
		helpers + '\n; return {openMenuBeside, getSortMenuItems, applySort, setViewMode};')(
		w.state, SORT_LABELS,
		payload => { w.menus.push(payload); },
		() => { w.trace.push('sort:' + w.state.sort.key + ':' + w.state.sort.dir); },
		() => { w.trace.push('rows'); },
		() => { w.trace.push('rail'); }
	);
	return w;
}

const labelsOf = items => items.map(i => i.separator ? '—' : i.label);
const ticked = items => items.filter(i => i.checked).map(i => i.label);

// --- where a rail menu opens -----------------------------------------------------------------------

{
	const w = world();
	const button = {getBoundingClientRect: () => ({left: 7, right: 39, top: 180, bottom: 212})};
	w.api.openMenuBeside(button, [{label: 'x'}]);
	check('a rail menu opens just right of its button, level with its top', [w.menus[0].x, w.menus[0].y], [43, 180]);
	check('with the items it was given', labelsOf(w.menus[0].items), ['x']);
}

// --- the sort menu ---------------------------------------------------------------------------------

{
	const w = world({key: 'mtime', dir: 'desc'});
	const items = w.api.getSortMenuItems();
	check('four keys, a line, two directions', labelsOf(items),
		['Name', 'Type', 'Modified', 'Size', '—', 'Ascending', 'Descending']);
	check('the current key and the current direction are ticked, and nothing else', ticked(items), ['Modified', 'Descending']);
	check('every choice says whether it is ticked, so each is drawn as a choice',
		items.filter(i => !i.separator).every(i => typeof i.checked === 'boolean'), true);

	items[3].action();
	check('choosing a key keeps the direction', w.state.sort, {key: 'size', dir: 'desc'});
	check('and sorts, draws the rows, then the rail', w.trace, ['sort:size:desc', 'rows', 'rail']);

	w.trace.length = 0;
	w.api.getSortMenuItems()[5].action();
	check('choosing a direction keeps the key', w.state.sort, {key: 'size', dir: 'asc'});
	check('and redraws the same three', w.trace, ['sort:size:asc', 'rows', 'rail']);
	check('the next menu is ticked for what was chosen', ticked(w.api.getSortMenuItems()), ['Size', 'Ascending']);
}

// --- the two view buttons --------------------------------------------------------------------------

{
	const w = world(null, 'details');
	w.api.setViewMode('grid');
	check('a view button sets the view', w.state.viewMode, 'grid');
	check('and draws the rows in it, then the rail that says which is on', w.trace, ['rows', 'rail']);
}

// --- what bindEvents connects -----------------------------------------------------------------------

const events = slice('\tfunction bindEvents () {', '\tfunction openMenuBeside (');
const handler = name => {
	const at = events.indexOf('ui.' + name + '.onclick = function');
	return at === -1 ? '' : events.slice(at, events.indexOf('\n\t\t};', at));
};

check('the two view buttons choose the view they are named for',
	[/setViewMode\('details'\)/.test(handler('viewDetails')), /setViewMode\('grid'\)/.test(handler('viewGrid'))], [true, true]);
check('the sort button opens the sort menu beside itself',
	/openMenuBeside\(ui\.sort, getSortMenuItems\(\)\)/.test(handler('sort')), true);
check('New opens the empty-area menu beside itself, not at the pointer',
	/openMenuBeside\(ui\.newBtn, getEmptyAreaMenuItems\(\)\)/.test(handler('newBtn')), true);
// A menu button whose click reaches the document closes the menu it has just opened.
check('each of the three menu buttons keeps its click from the document that closes menus',
	['sort', 'newBtn', 'more'].filter(name => !/e\.stopPropagation\(\);/.test(handler(name))), []);
check('the selection line\'s Compress compresses the selection', /actions\.compress\(\);/.test(handler('compress')), true);
check('and its Delete deletes it, through the same action the Delete key uses',
	/actions\.deleteSelected\(\);/.test(handler('delete')), true);
check('Copy and Cut are still wired, now from the selection line',
	[/actions\.copySelected\(\);/.test(handler('copy')), /actions\.cutSelected\(\);/.test(handler('cut'))], [true, true]);

{
	// *Select all* was here, and went after the first walk: the *All* box, the header box and
	// Ctrl/Cmd+A already do it.
	const more = handler('more');
	check('More holds Default apps, and nothing that selects',
		(more.match(/label: '([^']+)'/g) || []).map(m => m.slice(8, -1)), ['Default apps…']);
	check('Default apps is the action the toolbar button called', /action: actions\.manageDefaultApps/.test(more), true);
}

check('the Paste on the selection line pastes, as the rail\'s does',
	[/actions\.pasteClipboard\(\);/.test(handler('pasteHere')), /actions\.pasteClipboard\(\);/.test(handler('paste'))], [true, true]);

check('a column header sorts through the same path the menu does',
	/state\.sort\.dir = 'asc';\s*\}\s*applySort\(\);/.test(events), true);
check('nothing is left reading the two selects the rail replaced', /ui\.(viewMode|sortKey|defaults)\b/.test(entry), false);

// --- the storage gauge -----------------------------------------------------------------------------

{
	const watch = slice('\tfunction watchStorage () {', '\n\t}\n');
	const calls = [];
	const run = parent => new Function('parent', 'window', 'renderStorage', watch + '\n\t}\n; return watchStorage;')(
		parent, 'this window', 'the render')();
	run({watchStorage: (win, fn) => { calls.push([win, fn]); }});
	check('the foot asks the shell for storage, for this window, drawn by renderStorage', calls, [['this window', 'the render']]);
	calls.length = 0;
	run('this window');
	check('a window with no shell asks nothing, and throws nothing', calls, []);
	run({});
	check('nor does a shell too old to answer', calls, []);

	const boot = slice('\tfitSidebar();\n\twatchSidebarWidth();', 'await refreshCurrentDir(false);');
	check('and it is asked at boot, before the first refresh', /watchStorage\(\);/.test(boot), true);
}

report('explorer-rail');
