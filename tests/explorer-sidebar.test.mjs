// The list down the left: apps/explorer/js/sidebar.js.
//
// It is the only render in Explorer that draws something the app does not own. Quick access
// comes out of `state`, but the mounts come from `mountManager.listMounts()` — the shell's
// answer — and every row it draws is clickable, which is why it is a file rather than another
// function in js/view.js.
//
// Two things in here have a failure mode with no error attached. A window opened with no
// shell has no `mountManager`, and reading `listMounts` off nothing would take the sidebar,
// the refresh that called it and the listing behind it down together. And every button on a
// mount row calls something in `actions` — which is why this module is built at the very
// bottom of `openExplorer`, after that table exists, and why the checks below press the
// buttons rather than counting them.

import {check, report} from './assert.mjs';
import {createSidebar} from '../apps/explorer/js/sidebar.js';

function el (tag) {
	let html = '';
	return {
		tag: tag,
		className: '',
		textContent: '',
		title: '',
		get innerHTML () { return html; },
		set innerHTML (value) { html = value; this.children.length = 0; },
		dataset: {},
		style: {cssText: ''},
		children: [],
		onclick: null,
		append (...nodes) { nodes.forEach(n => this.children.push(n)); }
	};
}

function harness (options) {
	options = options || {};
	const h = {
		state: {cwd: options.cwd || '/home'},
		ui: {sidebar: el('aside')},
		called: [],
		mounts: options.mounts || [],
		navigated: []
	};

	const mountManager = options.noShell ? null : {listMounts: () => h.mounts};

	h.sidebar = createSidebar({
		state: h.state,
		ui: h.ui,
		doc: {createElement: tag => el(tag)},
		win: options.noPicker ? {} : {showDirectoryPicker: () => {}},
		mountManager: mountManager,
		actions: {
			umount: p => { h.called.push(['umount', p]); },
			mountNativeDir: () => { h.called.push(['mountNativeDir']); },
			mountFiles3: () => { h.called.push(['mountFiles3']); }
		},
		navigateTo: p => { h.navigated.push(p); },
		getParentPath: p => (!p || p === '/' ? '/' : p.replace(/\/[^/]*$/, '') || '/')
	});
	return h;
}

function rows (h) {
	return h.ui.sidebar.children.filter(n => n.className.indexOf('Explorer__sidebarItem') === 0);
}

// The Quick access heading is written as markup by the same assignment that empties the
// list; every other heading is an appended node. So there are two places to look, and the
// first of them is also what proves the list was cleared.
function titles (h) {
	return h.ui.sidebar.children
		.filter(n => n.className === 'Explorer__sidebarTitle')
		.map(n => n.textContent);
}

// --- quick access ------------------------------------------------------------------------------

{
	const h = harness({cwd: '/home/docs'});
	h.sidebar.renderSidebar();
	check('the four quick-access rows', rows(h).slice(0, 4).map(n => n.dataset.path),
		['/', '/apps', '/home/docs', '/home']);
	check('under one heading', h.ui.sidebar.innerHTML,
		'<div class="Explorer__sidebarTitle">Quick access</div>');
	check('the folder being shown is marked active',
		rows(h).slice(0, 4).map(n => n.className.indexOf('--active') > -1),
		[false, false, true, false]);
}

{
	// At the root, Current and Parent are both "/" and so is Root: three rows pointing at the
	// same place, all three marked active. That is what it does, and it is worth having
	// written down rather than discovered as a surprise.
	const h = harness({cwd: '/'});
	h.sidebar.renderSidebar();
	check('at the root every quick row points at it',
		rows(h).slice(0, 4).map(n => n.dataset.path), ['/', '/apps', '/', '/']);
	check('and Root reads as a name, not as a path',
		rows(h)[0].textContent, '\u{1F4C1} Root');
	check('while the others carry theirs', rows(h)[1].textContent, '\u{1F4C2} Apps (/apps)');
}

{
	// Redrawn, not appended to. `renderSidebar` runs on every refresh and after every mount,
	// so a render that added to what was there would grow the list all session.
	const h = harness();
	h.sidebar.renderSidebar();
	const first = h.ui.sidebar.children.length;
	h.sidebar.renderSidebar();
	check('a second render replaces the first', h.ui.sidebar.children.length, first);
}

{
	// `getParentPath` is a parameter, and a quick item with no path is a row that looks like
	// every other one and navigates nowhere. Explorer's own answers this with '/' and never
	// with nothing, so the guard is defence at the boundary rather than a case anyone has
	// seen -- which is why it is stated here instead of only in the source.
	const h = harness();
	h.sidebar = createSidebar({
		state: h.state,
		ui: h.ui,
		doc: {createElement: tag => el(tag)},
		win: {},
		mountManager: null,
		actions: {},
		navigateTo: () => {},
		getParentPath: () => ''
	});
	h.sidebar.renderSidebar();
	check('a quick item with no path is not drawn at all',
		rows(h).map(n => n.dataset.path), ['/', '/apps', '/home']);
}

// --- mounts --------------------------------------------------------------------------------------

{
	const h = harness({mounts: [
		{name: 'archive', mountPoint: '/mnt/zip', type: 'zip', readOnly: true},
		{name: 'disc', mountPoint: '/mnt/iso', type: 'iso', readOnly: true},
		{name: 'work', mountPoint: '/mnt/work', type: 'native', readOnly: false},
		{name: 'cloud', mountPoint: '/mnt/s3', type: 'files3', readOnly: false}
	]});
	h.sidebar.renderSidebar();
	check('mounts get a heading of their own', titles(h), ['Mounts']);

	const labels = h.ui.sidebar.children
		.filter(n => n.children.length === 2)
		.map(n => n.children[0].textContent);
	check('each type has its own icon', labels, [
		'\u{1F4E6} archive (/mnt/zip) [ro]',
		'\u{1F4BF} disc (/mnt/iso) [ro]',
		'\u{1F4BB} work (/mnt/work)',
		'☁️ cloud (/mnt/s3)'
	]);
}

{
	const h = harness({mounts: [{name: 'work', mountPoint: '/mnt/work', type: 'native'}]});
	h.sidebar.renderSidebar();
	const row = h.ui.sidebar.children.filter(n => n.children.length === 2)[0];
	row.children[0].onclick();
	check('clicking a mount navigates into it', h.navigated, ['/mnt/work']);

	let stopped = 0;
	row.children[1].onclick({stopPropagation: () => { stopped++; }});
	check('the eject button unmounts it', h.called, [['umount', '/mnt/work']]);
	// Without this the click reaches the label behind it and navigates into the mount it has
	// just been asked to remove.
	check('and does not also navigate into it', stopped, 1);
	check('so nothing was navigated to', h.navigated, ['/mnt/work']);
}

{
	const h = harness({mounts: [], cwd: '/mnt/work'});
	h.sidebar.renderSidebar();
	check('with nothing mounted there is no Mounts heading', titles(h), []);
}

{
	const h = harness({
		mounts: [{name: 'work', mountPoint: '/mnt/work', type: 'native'}],
		cwd: '/mnt/work'
	});
	h.sidebar.renderSidebar();
	const row = h.ui.sidebar.children.filter(n => n.children.length === 2)[0];
	check('the mount you are standing in is marked active',
		row.className.indexOf('--active') > -1, true);
}

// --- the two buttons under the list ------------------------------------------------------------

{
	const h = harness();
	h.sidebar.renderSidebar();
	const buttons = rows(h).filter(n => n.onclick);
	check('both ways of adding a mount are offered',
		buttons.map(n => n.textContent),
		['\u{1F4C2} Mount local folder...', '☁️ Mount Files3 storage...']);
	buttons[0].onclick();
	buttons[1].onclick();
	check('and each calls its action', h.called, [['mountNativeDir'], ['mountFiles3']]);
}

{
	// Firefox and Safari have no File System Access API, so there is no local folder to pick
	// and the button would open a dialog that could only say so.
	const h = harness({noPicker: true});
	h.sidebar.renderSidebar();
	const buttons = rows(h).filter(n => n.onclick);
	check('a browser with no directory picker is not offered one',
		buttons.map(n => n.textContent), ['☁️ Mount Files3 storage...']);
}

// --- no shell ------------------------------------------------------------------------------------

{
	// Explorer opened in a bare tab has no shell and therefore no mount manager. It still
	// draws -- the refresh that calls this is the same one that draws the listing, and taking
	// it down takes the window with it.
	const h = harness({noShell: true});
	h.sidebar.renderSidebar();
	check('quick access is still drawn', rows(h).map(n => n.dataset.path),
		['/', '/apps', '/home', '/']);
	check('and nothing offers a mount', titles(h), []);
	check('nor a way to make one', rows(h).filter(n => n.onclick).length, 0);
}

report('explorer-sidebar');
