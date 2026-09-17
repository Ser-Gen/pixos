// The drawer down the left: apps/explorer/js/sidebar.js.
//
// It is the only render in Explorer that draws something the app does not own. The places are
// the bookmarks document, read by js/places.js into `state.places`, and the mounts come from
// `mountManager.listMounts()` -- the shell's answer -- and every row it draws is clickable, which
// is why it is a file rather than another function in js/view.js.
//
// Three things in here have a failure mode with no error attached. A window opened with no shell
// has no `mountManager`, and reading `listMounts` off nothing would take the sidebar, the refresh
// that called it and the listing behind it down together. Every button calls something in
// `actions` -- which is why this module is built at the very bottom of `openExplorer`, after that
// table exists, and why the checks below press the buttons rather than counting them. And the
// drawer's width rule is invisible until a narrow window opens with its listing covered.

import {check, report} from './assert.mjs';
import {createSidebar, NARROW_QUERY, STORAGE_KEY} from '../apps/explorer/js/sidebar.js';

function el (tag) {
	let html = '';
	const attributes = {};
	return {
		tag: tag,
		className: '',
		textContent: '',
		title: '',
		get innerHTML () { return html; },
		set innerHTML (value) { html = value; this.children.length = 0; },
		dataset: {},
		style: {},
		children: [],
		onclick: null,
		oncontextmenu: null,
		append (...nodes) { nodes.forEach(n => this.children.push(n)); },
		setAttribute (name, value) { attributes[name] = String(value); },
		getAttribute (name) { return name in attributes ? attributes[name] : null; }
	};
}

function classList () {
	const names = new Set();
	return {
		toggle (name, force) { if (force) { names.add(name); } else { names.delete(name); } },
		contains (name) { return names.has(name); }
	};
}

function storage (initial, broken) {
	const values = Object.assign({}, initial || {});
	return {
		values: values,
		getItem (key) { if (broken) { throw new Error('denied'); } return key in values ? values[key] : null; },
		setItem (key, value) { if (broken) { throw new Error('denied'); } values[key] = String(value); }
	};
}

const READY = places => ({status: 'ready', group: {id: 'g', name: 'Places'}, places: places});
const place = (title, path, id) => ({id: id || null, title: title, url: path === '/' ? '/' : path + '/', path: path, index: 0});
const STARTERS = () => [place('Root', '/'), place('Apps', '/apps')];

function harness (options) {
	options = options || {};
	const h = {
		state: {cwd: options.cwd || '/home', places: options.places || {status: 'unavailable', group: null, places: STARTERS()}},
		ui: {sidebarList: el('div'), sidebarFooter: el('div'), sidebarToggle: el('button'), body: el('div')},
		called: [],
		menus: [],
		mounts: options.mounts || [],
		navigated: [],
		narrow: !!options.narrow,
		widthListeners: [],
		storage: storage(options.remembered, options.brokenStorage)
	};
	h.ui.body.classList = classList();
	h.waiting = options.waiting || [];

	const win = {localStorage: h.storage};
	if (!options.noPicker) { win.showDirectoryPicker = () => {}; }
	if (!options.noMatchMedia) {
		win.matchMedia = query => ({
			matches: query === NARROW_QUERY && h.narrow,
			addEventListener: (type, fn) => { h.widthListeners.push([type, fn]); }
		});
	}

	h.sidebar = createSidebar({
		state: h.state,
		ui: h.ui,
		doc: {createElement: tag => el(tag)},
		win: win,
		mountManager: options.noShell ? null : {listMounts: () => h.mounts},
		mountTable: options.waiting ? {list: () => h.waiting} : null,
		actions: {
			umount: p => { h.called.push(['umount', p]); },
			mountNativeDir: () => { h.called.push(['mountNativeDir']); },
			mountFiles3: () => { h.called.push(['mountFiles3']); },
			reconnectMount: p => { h.called.push(['reconnectMount', p]); },
			forgetMount: p => { h.called.push(['forgetMount', p]); },
			pinFolder: p => { h.called.push(['pinFolder', p]); },
			unpinPlace: p => { h.called.push(['unpinPlace', p.path]); },
			movePlace: (p, delta) => { h.called.push(['movePlace', p.path, delta]); },
			renamePlace: p => { h.called.push(['renamePlace', p.path]); }
		},
		navigateTo: p => { h.navigated.push(p); },
		openContextMenu: payload => { h.menus.push(payload); }
	});
	return h;
}

const list = h => h.ui.sidebarList.children;
const titles = h => list(h).filter(n => n.className === 'Explorer__sidebarTitle').map(n => n.textContent);
// A place row carries its path on the row, which is what the sidebar's one click handler reads.
const placeRows = h => list(h).filter(n => n.dataset.path !== undefined);
// A mount row carries it on its label, whose own click navigates.
const mountRows = h => list(h).filter(n => n.children.length && n.children[0].dataset.path !== undefined);
const actionRows = node => node.children.filter(n => n.className.indexOf('Explorer__sidebarAction') > -1);
const menuLabels = menu => menu.items.map(item => item.separator ? '—' : item.label);
const press = (node, event) => {
	try {
		node.onclick(Object.assign({stopPropagation () {}, clientX: 0, clientY: 0}, event || {}));
		return null;
	}
	catch (err) {
		return err.message;
	}
};

// --- the places ---------------------------------------------------------------------------------------

{
	const h = harness({cwd: '/apps', places: READY([place('Root', '/', 'r'), place('Apps', '/apps', 'a'), place('Work', '/home/work', 'w')])});
	h.sidebar.renderSidebar();
	check('the places come first, under their own heading', titles(h), ['Places']);
	check('one row each, in the order they are in', placeRows(h).map(n => n.dataset.path), ['/', '/apps', '/home/work']);
	check('named by their title, the root with its own icon',
		placeRows(h).map(n => n.children[0].textContent), ['\u{1F4C1} Root', '\u{1F4C2} Apps', '\u{1F4C2} Work']);
	check('and carrying the path where the pointer finds it', placeRows(h).map(n => n.title), ['/', '/apps', '/home/work']);
	check('the folder being shown is marked active',
		placeRows(h).map(n => n.className.indexOf('--active') > -1), [false, true, false]);
	check('Current and Parent are gone for good: both are already on screen', placeRows(h).length, 3);
}

{
	const h = harness({places: READY([place('Root', '/', 'r'), place('Apps', '/apps', 'a'), place('Work', '/home/work', 'w')])});
	h.sidebar.renderSidebar();
	const rows = placeRows(h);
	let stopped = 0;
	const failed = press(rows[0].children[1], {clientX: 12, clientY: 34, stopPropagation: () => { stopped++; }});
	check('each place has a button that opens its menu where it was pressed',
		[failed, h.menus.map(m => [m.x, m.y])], [null, [[12, 34]]]);
	check('without the click also reaching the row, or the document that would close the menu', stopped, 1);
	check('titled for what is in it', rows[0].children[1] && rows[0].children[1].title, 'Rename, move or unpin');
	check('the menu: rename, up, down, and unpin set apart', h.menus[0] && menuLabels(h.menus[0]),
		['Rename…', 'Move up', 'Move down', '—', 'Unpin']);
	check('the first place cannot move up', h.menus[0] && h.menus[0].items.map(i => !!i.disabled), [false, true, false, false, false]);

	press(rows[2].children[1]);
	check('and the last cannot move down', h.menus[1] && h.menus[1].items.map(i => !!i.disabled), [false, false, true, false, false]);

	(h.menus[1] ? h.menus[1].items : []).filter(i => i.action).forEach(i => i.action());
	check('each entry calls its action, with the place it was built for',
		h.called, [['renamePlace', '/home/work'], ['movePlace', '/home/work', -1], ['movePlace', '/home/work', 1], ['unpinPlace', '/home/work']]);

	let prevented = 0;
	rows[1].oncontextmenu && rows[1].oncontextmenu({preventDefault: () => { prevented++; }, clientX: 5, clientY: 6});
	check('a right-click on a place opens the same menu, and not the browser\'s',
		[prevented, h.menus[2] && [h.menus[2].x, h.menus[2].y, menuLabels(h.menus[2])]],
		[1, [5, 6, ['Rename…', 'Move up', 'Move down', '—', 'Unpin']]]);
}

{
	const h = harness({cwd: '/home/docs', places: READY(STARTERS())});
	h.sidebar.renderSidebar();
	const pin = actionRows(h.ui.sidebarList);
	check('a folder that is not pinned is offered a pin, under the places', pin.map(n => n.textContent), ['\u{1F4CC} Pin this folder']);
	check('which comes after the last place', list(h).indexOf(pin[0]) > list(h).indexOf(placeRows(h)[1]), true);
	press(pin[0]);
	check('and pins the folder being shown', h.called, [['pinFolder', '/home/docs']]);

	h.state.cwd = '/apps';
	h.sidebar.renderSidebar();
	check('a folder that is pinned is not offered it again', actionRows(h.ui.sidebarList).length, 0);
}

{
	const h = harness({places: READY([])});
	h.sidebar.renderSidebar();
	check('a Places group with nothing in it is a heading and a pin, not the starters',
		[titles(h), placeRows(h).length, actionRows(h.ui.sidebarList).length], [['Places'], 0, 1]);
}

['loading', 'unavailable', 'unreadable'].forEach(status => {
	const h = harness({places: {status: status, group: null, places: STARTERS(), error: new SyntaxError('Unexpected token')}});
	h.sidebar.renderSidebar();
	check('while ' + status + ': the starters are drawn and nothing offers to change them',
		[placeRows(h).length, placeRows(h).map(n => [n.children.length, n.oncontextmenu === null]), actionRows(h.ui.sidebarList).length],
		[2, [[1, true], [1, true]], 0]);
});

{
	const h = harness({places: {status: 'unreadable', group: null, places: STARTERS(), error: new SyntaxError('Unexpected token }')}});
	h.sidebar.renderSidebar();
	const note = list(h).filter(n => n.className === 'Explorer__sidebarNote');
	check('an unreadable bookmarks file says why the places cannot be changed',
		note.map(n => [n.textContent, n.title]),
		[['Places cannot be changed: /settings/links.json did not read.', 'Unexpected token }']]);
}

{
	// Redrawn, not appended to. `renderSidebar` runs on every refresh, after every mount and after
	// every edit to a place, so a render that added to what was there would grow all session.
	const h = harness({mounts: [{name: 'w', mountPoint: '/mnt/w', type: 'native'}], places: READY(STARTERS())});
	h.sidebar.renderSidebar();
	const first = [list(h).length, h.ui.sidebarFooter.children.length];
	h.sidebar.renderSidebar();
	check('a second render replaces the first, in the list and in the footer',
		[list(h).length, h.ui.sidebarFooter.children.length], first);
}

// --- mounts ---------------------------------------------------------------------------------------------

{
	const h = harness({mounts: [
		{name: 'archive', mountPoint: '/mnt/zip', type: 'zip', readOnly: true},
		{name: 'disc', mountPoint: '/mnt/iso', type: 'iso', readOnly: true},
		{name: 'work', mountPoint: '/mnt/work', type: 'native', readOnly: false},
		{name: 'cloud', mountPoint: '/mnt/s3', type: 'files3', readOnly: false}
	]});
	h.sidebar.renderSidebar();
	check('mounts get a heading of their own, under the places', titles(h), ['Places', 'Mounts']);
	check('each type has its own icon', mountRows(h).map(n => n.children[0].textContent), [
		'\u{1F4E6} archive (/mnt/zip) [ro]',
		'\u{1F4BF} disc (/mnt/iso) [ro]',
		'\u{1F4BB} work (/mnt/work)',
		'☁️ cloud (/mnt/s3)'
	]);
}

{
	const h = harness({mounts: [{name: 'work', mountPoint: '/mnt/work', type: 'native'}]});
	h.sidebar.renderSidebar();
	const row = mountRows(h)[0];
	press(row.children[0]);
	check('clicking a mount navigates into it', h.navigated, ['/mnt/work']);

	let stopped = 0;
	press(row.children[1], {stopPropagation: () => { stopped++; }});
	check('the eject button unmounts it', h.called, [['umount', '/mnt/work']]);
	// Without this the click reaches the label behind it and navigates into the mount it has
	// just been asked to remove.
	check('and does not also navigate into it', [stopped, h.navigated], [1, ['/mnt/work']]);
}

{
	const h = harness({mounts: [], cwd: '/mnt/work'});
	h.sidebar.renderSidebar();
	check('with nothing mounted there is no Mounts heading', titles(h), ['Places']);
}

{
	const h = harness({mounts: [{name: 'work', mountPoint: '/mnt/work', type: 'native'}], cwd: '/mnt/work'});
	h.sidebar.renderSidebar();
	check('the mount you are standing in is marked active', mountRows(h)[0].className.indexOf('--active') > -1, true);
}

// --- mounts the shell could not bring back ----------------------------------------------------------
//
// After a reload `js/shell/mount-table.js` holds every mount it could not mount again without a
// click. They are listed under the live ones, because the complaint was that they vanished.

const waitingRows = h => list(h).filter(n => n.className.indexOf('--waiting') > -1);

{
	const h = harness({waiting: [
		{mountPoint: '/mnt/work', type: 'native', name: 'work', status: 'needs-permission', reason: null},
		{mountPoint: '/mnt/s3', type: 'files3', name: 'cloud', status: 'needs-sign-in', reason: null},
		{mountPoint: '/mnt/a', type: 'zip', name: 'a.zip', status: 'failed', reason: 'ENOENT: /home/a.zip'},
		{mountPoint: '/mnt/disc', type: 'iso', name: 'disc', status: 'restoring', reason: null}
	]});
	h.sidebar.renderSidebar();
	check('with nothing mounted, waiting mounts still get the heading', titles(h), ['Places', 'Mounts']);
	check('each says what it is waiting for', waitingRows(h).map(n => n.children[0].textContent), [
		'\u{1F4BB} work (/mnt/work) — click to reconnect',
		'☁️ cloud (/mnt/s3) — click to sign in',
		'\u{1F4E6} a.zip (/mnt/a) — did not come back',
		'\u{1F4BF} disc (/mnt/disc) — reconnecting…'
	]);
	check('and one that failed carries the reason where the pointer finds it',
		waitingRows(h).map(n => n.title), ['', '', 'ENOENT: /home/a.zip', '']);

	// Pressed inside a guard: with the rows missing, the checks below have to fail, not throw.
	let stopped = 0;
	let pressed = null;
	try {
		waitingRows(h)[0].children[0].onclick();
		waitingRows(h)[2].children[1].onclick({stopPropagation: () => { stopped++; }});
	}
	catch (err) {
		pressed = err.message;
	}
	check('the rows were there to press', pressed, null);
	check('clicking one is a reconnect -- the click is the gesture the browser wants',
		h.called.slice(0, 1), [['reconnectMount', '/mnt/work']]);
	check('its other button forgets it, and does not reconnect it on the way',
		[h.called.slice(1), stopped], [[['forgetMount', '/mnt/a']], 1]);

	const failed = waitingRows(h)[2];
	check('titled for what it does', failed ? failed.children[1].title : null, 'Forget this mount');

	// `=== null` and `.length`, not the node itself: JSON.stringify writes a function as null,
	// so comparing `onclick` by value could never tell a handler from none.
	const trying = waitingRows(h)[3];
	check('one being tried offers nothing to click: no reconnect, no forget',
		trying ? [trying.children[0].onclick === null, trying.children.length] : null, [true, 1]);
}

{
	const h = harness({
		mounts: [{name: 'archive', mountPoint: '/mnt/zip', type: 'zip', readOnly: true}],
		waiting: [{mountPoint: '/mnt/work', type: 'native', name: 'work', status: 'needs-permission', reason: null}]
	});
	h.sidebar.renderSidebar();
	check('under the live mounts, not instead of them, and under the one heading',
		[mountRows(h).map(n => n.children[0].dataset.path), titles(h)], [['/mnt/zip', '/mnt/work'], ['Places', 'Mounts']]);
	check('and only the waiting one is marked as waiting',
		mountRows(h).map(n => n.className.indexOf('--waiting') > -1), [false, true]);
}

// --- the footer ---------------------------------------------------------------------------------------

{
	const h = harness();
	h.sidebar.renderSidebar();
	const buttons = actionRows(h.ui.sidebarFooter);
	check('both ways of adding a mount are in the footer', buttons.map(n => n.textContent),
		['\u{1F4C2} Mount local folder...', '☁️ Mount Files3 storage...']);
	check('and not in the list above it', actionRows(h.ui.sidebarList).filter(n => /Mount/.test(n.textContent)).length, 0);
	buttons.forEach(n => press(n));
	check('and each calls its action', h.called, [['mountNativeDir'], ['mountFiles3']]);
}

{
	// Firefox and Safari have no File System Access API, so there is no local folder to pick
	// and the button would open a dialog that could only say so.
	const h = harness({noPicker: true});
	h.sidebar.renderSidebar();
	check('a browser with no directory picker is not offered one',
		actionRows(h.ui.sidebarFooter).map(n => n.textContent), ['☁️ Mount Files3 storage...']);
}

{
	// Explorer opened with a shell that has no mount manager. It still draws -- the refresh that
	// calls this is the same one that draws the listing, and taking it down takes the window with it.
	const h = harness({noShell: true});
	h.sidebar.renderSidebar();
	check('the places are still drawn', placeRows(h).map(n => n.dataset.path), ['/', '/apps']);
	check('and nothing offers a mount', [titles(h), h.ui.sidebarFooter.children.length], [['Places'], 0]);
}

// --- the drawer ---------------------------------------------------------------------------------------

const closed = h => h.ui.body.classList.contains('Explorer__body--sidebarClosed');

{
	const h = harness();
	h.sidebar.fitSidebar();
	check('a wide window that never chose starts with the drawer open',
		[h.state.sidebarOpen, closed(h), h.ui.sidebarToggle.getAttribute('aria-pressed'), h.ui.sidebarToggle.title],
		[true, false, 'true', 'Hide the sidebar']);

	h.sidebar.toggleSidebar();
	check('the toggle closes it', [h.state.sidebarOpen, closed(h), h.ui.sidebarToggle.getAttribute('aria-pressed'), h.ui.sidebarToggle.title],
		[false, true, 'false', 'Show the sidebar']);
	check('and a wide choice is remembered', h.storage.values[STORAGE_KEY], 'closed');

	const next = harness({remembered: {[STORAGE_KEY]: 'closed'}});
	next.sidebar.fitSidebar();
	check('so the next wide window starts closed', [next.state.sidebarOpen, closed(next)], [false, true]);
}

{
	const h = harness({narrow: true, remembered: {[STORAGE_KEY]: 'open'}});
	h.sidebar.fitSidebar();
	check('a narrow window starts closed, whatever was remembered -- open, it would cover the listing',
		[h.state.sidebarOpen, closed(h)], [false, true]);
	h.sidebar.toggleSidebar();
	check('the toggle still opens it over the listing', [h.state.sidebarOpen, closed(h)], [true, false]);

	h.sidebar.sidebarChosen();
	check('and once something in it is chosen, it closes again', [h.state.sidebarOpen, closed(h)], [false, true]);
	check('without remembering that', h.storage.values[STORAGE_KEY], 'open');
}

{
	// Opened and then closed by hand while narrow: the second press is the one that would write
	// "closed" if a narrow choice were remembered. Opening alone could not show it -- "open" is
	// what was already there.
	const h = harness({narrow: true, remembered: {[STORAGE_KEY]: 'open'}});
	h.sidebar.fitSidebar();
	h.sidebar.toggleSidebar();
	h.sidebar.toggleSidebar();
	check('a narrow choice is not remembered -- the wide windows keep the answer they had',
		[h.state.sidebarOpen, h.storage.values[STORAGE_KEY]], [false, 'open']);
}

{
	// Closing is navigateTo's, so every route into a folder does it -- reconnecting a mount and
	// the footer's buttons included, which no row click ever reached. A row that also closed
	// the drawer would hide a navigateTo that had stopped doing it; tests/explorer-places.test.mjs
	// drives that one.
	const h = harness({mounts: [{name: 'work', mountPoint: '/mnt/work', type: 'native'}], narrow: true});
	h.sidebar.fitSidebar();
	h.sidebar.toggleSidebar();
	h.sidebar.renderSidebar();
	press(mountRows(h)[0].children[0]);
	check('a mount row only navigates, and leaves the drawer to navigateTo', [h.navigated, h.state.sidebarOpen], [['/mnt/work'], true]);
}

{
	const h = harness();
	h.sidebar.fitSidebar();
	h.sidebar.sidebarChosen();
	check('a wide drawer stays open when something in it is chosen -- it is a column, not in the way',
		h.state.sidebarOpen, true);
}

{
	const h = harness({remembered: {[STORAGE_KEY]: 'open'}});
	h.sidebar.fitSidebar();
	h.sidebar.watchSidebarWidth();
	const listeners = h.widthListeners.filter(entry => entry[0] === 'change');
	check('the window\'s width is watched', listeners.length, 1);
	h.narrow = true;
	listeners.forEach(entry => entry[1]());
	check('narrowed past the breakpoint, the drawer closes', h.state.sidebarOpen, false);
	h.narrow = false;
	listeners.forEach(entry => entry[1]());
	check('widened again, it comes back as it was remembered', h.state.sidebarOpen, true);
}

{
	const h = harness({brokenStorage: true});
	let failed = null;
	try {
		h.sidebar.fitSidebar();
		h.sidebar.toggleSidebar();
	}
	catch (err) {
		failed = err.message;
	}
	check('storage that refuses costs the memory, never the toggle', [failed, h.state.sidebarOpen], [null, false]);
}

{
	const h = harness({noMatchMedia: true});
	let failed = null;
	try {
		h.sidebar.fitSidebar();
		h.sidebar.watchSidebarWidth();
		h.sidebar.sidebarChosen();
	}
	catch (err) {
		failed = err.message;
	}
	check('with no matchMedia the window counts as wide', [failed, h.state.sidebarOpen], [null, true]);
}

report('explorer-sidebar');
