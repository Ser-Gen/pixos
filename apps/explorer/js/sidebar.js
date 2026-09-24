// The drawer down the left: the pinned places, the mounts under them, and a footer holding the
// two buttons that add a mount. It is a render like the ones in js/view.js and was written beside
// them, but it is the only one that reaches outside Explorer for what it draws -- the places are
// the `Places` group of the bookmarks document, read by js/places.js, and the mounts are
// `mountManager.listMounts()`, both of them the shell's answers -- and the only one whose output
// is clickable, which is what keeps it in a file of its own.
//
// That is also why it is built at the very bottom of the block, after `actions`: every row
// carries a button that calls into the table, so the table has to exist. js/menu-items.js is
// there for the same reason.
//
// **It is a drawer at every width**, opened and closed by the rail's first button. Above 900px it is a
// column beside the listing and starts the way it was last left, open if it never was; at 900px
// and below it lies over the listing, always starts closed, and closes again once something in
// it is chosen. Only the wide choice is remembered -- a drawer remembered open would otherwise
// open every narrow window with its listing covered. Until phase 23 the sidebar was simply
// `display: none` below 900px, and mounting a folder went with it.
//
// A window with no shell has no `mountManager`, and then there are no mounts and no way to
// make one: the places are drawn and the rest of the function does not run.

import { ICONS } from './icons.js';

export var NARROW_QUERY = '(max-width: 900px)';
export var STORAGE_KEY = 'pixos.explorer.sidebar';

export function createSidebar (deps) {

	var state = deps.state;
	var ui = deps.ui;
	var document = deps.doc;
	var window = deps.win;
	var mountManager = deps.mountManager;
	// The shell's `js/shell/mount-table.js`, or null in a window with no shell.
	var mountTable = deps.mountTable || null;
	var actions = deps.actions;
	var navigateTo = deps.navigateTo;
	var openContextMenu = deps.openContextMenu;

	function renderSidebar () {
		ui.sidebarList.innerHTML = '';
		ui.sidebarFooter.innerHTML = '';
		renderPlaces();
		if (mountManager) {
			renderMounts();
			renderMountButtons();
		}
	}

	function renderPlaces () {
		var places = state.places || {status: 'loading', places: []};
		var editable = places.status === 'ready';
		var pinned = places.places.some(function (place) {
			return place.path === state.cwd;
		});
		// Pinning lives in the heading, as mockup B has it: a row of its own under the places moved
		// down every time one was added. Offered only for a folder that is not a place already, and
		// only when places can be changed at all.
		ui.sidebarList.append(heading('Places', editable && !pinned
			? rowButton(ICONS.add, 'Pin this folder', function () { actions.pinFolder(state.cwd); }, 'Explorer__sidebarAdd')
			: null));

		places.places.forEach(function (place, at) {
			var row = document.createElement('div');
			row.className = 'Explorer__sidebarItem' + (place.path === state.cwd ? ' Explorer__sidebarItem--active' : '');
			// Gone to by the one click handler on the whole sidebar, in index.html.
			row.dataset.path = place.path;
			row.title = place.path;
			row.append(mark(place.path === '/' ? 'root' : 'place'), label(place.title));
			if (editable) {
				var openMenu = function (e) {
					openContextMenu({x: e.clientX, y: e.clientY, items: placeMenu(place, at, places.places.length)});
				};
				// A button as well as the right-click, because a menu nobody can see is a menu
				// nobody finds -- and "the sidebar is not editable" was the complaint.
				row.append(rowButton(ICONS.moreRow, 'Rename, move or unpin', openMenu));
				row.oncontextmenu = function (e) {
					e.preventDefault();
					openMenu(e);
				};
			}
			ui.sidebarList.append(row);
		});

		// The starters are drawn, and nothing offers to change them: the shell would refuse the
		// write and say so, and a menu leading only to that note is worse than none.
		if (places.status === 'unreadable') {
			var note = document.createElement('div');
			note.className = 'Explorer__sidebarNote';
			note.textContent = 'Places cannot be changed: /settings/links.json did not read.';
			note.title = places.error && places.error.message ? places.error.message : '';
			ui.sidebarList.append(note);
		}
	}

	function placeMenu (place, at, count) {
		return [
			{label: 'Rename…', action: function () { actions.renamePlace(place); }},
			{label: 'Move up', action: function () { actions.movePlace(place, -1); }, disabled: at === 0},
			{label: 'Move down', action: function () { actions.movePlace(place, 1); }, disabled: at === count - 1},
			{separator: true},
			{label: 'Unpin', action: function () { actions.unpinPlace(place); }}
		];
	}

	function renderMounts () {
		var mounts = mountManager.listMounts();
		// What the shell could not bring back after a reload, and is waiting for a click (or
		// has given up on, with the reason). Drawn under the live ones, never instead of
		// them: a folder that silently disappeared from this list is the complaint phase 22
		// exists for.
		var waiting = mountTable ? mountTable.list() : [];
		if (!mounts.length && !waiting.length) {
			return;
		}
		ui.sidebarList.append(heading('Mounts', null));

		mounts.forEach(function (m) {
			var row = mountRow(m, 'mount', function () {
				navigateTo(m.mountPoint);
			});
			row.title = m.mountPoint;
			row.append(detail(TYPE_WORDS[m.type] ? TYPE_WORDS[m.type] + (m.readOnly ? ' · ro' : '') : (m.readOnly ? 'ro' : '')));
			row.append(rowButton(ICONS.eject, 'Unmount', function () { actions.umount(m.mountPoint); }));
			ui.sidebarList.append(row);
		});

		waiting.forEach(function (w) {
			var restoring = w.status === 'restoring';
			var row = mountRow(w, 'waiting', restoring ? null : function () { actions.reconnectMount(w.mountPoint); });
			row.className += ' Explorer__sidebarItem--waiting';
			// Amber is kept for the two states a click can end: the browser wants a gesture, or
			// the storage wants a sign-in. A mount that did not come back, or is being tried, is
			// only quiet.
			row.dataset.status = w.status;
			row.title = w.mountPoint + (w.reason ? '\n' + w.reason : '');
			row.append(detail(WAITING_WORDS[w.status]));
			// Not while it is being tried: forgetting a mount that is about to succeed
			// would only have it written back the moment it did.
			if (!restoring) {
				row.append(rowButton(ICONS.close, 'Forget this mount', function () { actions.forgetMount(w.mountPoint); }));
			}
			ui.sidebarList.append(row);
		});
	}

	// In the footer rather than under the list, so they stay where they are however many places
	// and mounts are above them.
	function renderMountButtons () {
		if (typeof window.showDirectoryPicker === 'function') {
			ui.sidebarFooter.append(actionRow('Mount local folder...', ICONS.folder, function () { actions.mountNativeDir(); }));
		}
		ui.sidebarFooter.append(actionRow('Mount Files3 storage...', ICONS.cloud, function () { actions.mountFiles3(); }));
	}

	var WAITING_WORDS = {
		'restoring': 'reconnecting…',
		'needs-permission': 'click to reconnect',
		'needs-sign-in': 'click to sign in',
		'failed': 'did not come back'
	};

	// What a mount is, in a word, at the end of its row. The mount point is the row's tooltip.
	var TYPE_WORDS = {native: 'local', iso: 'iso', zip: 'zip', files3: 'files3'};

	function heading (text, button) {
		var node = document.createElement('div');
		node.className = 'Explorer__sidebarTitle';
		var name = document.createElement('span');
		name.textContent = text;
		node.append(name);
		if (button) {
			node.append(button);
		}
		return node;
	}

	// The small square every row starts with: filled for the root, a ring for any other place,
	// dashed for a mount that is waiting. Drawn by the stylesheet from its class.
	function mark (kind) {
		var node = document.createElement('span');
		node.className = 'Explorer__sidebarMark Explorer__sidebarMark--' + kind;
		node.setAttribute('aria-hidden', 'true');
		return node;
	}

	function label (text) {
		var node = document.createElement('span');
		node.className = 'Explorer__sidebarLabel';
		node.textContent = text;
		return node;
	}

	function detail (text) {
		var node = document.createElement('span');
		node.className = 'Explorer__sidebarDetail';
		node.textContent = text;
		return node;
	}

	function actionRow (text, icon, run) {
		var node = document.createElement('button');
		node.type = 'button';
		node.className = 'Explorer__sidebarItem Explorer__sidebarAction';
		node.innerHTML = icon;
		node.append(label(text));
		node.onclick = run;
		return node;
	}

	// A mount's label is what navigates, not the row: the row also holds a button that must not.
	function mountRow (m, kind, onLabelClick) {
		var row = document.createElement('div');
		row.className = 'Explorer__sidebarItem' + (m.mountPoint === state.cwd ? ' Explorer__sidebarItem--active' : '');
		var node = label(m.name);
		node.dataset.path = m.mountPoint;
		node.onclick = onLabelClick;
		row.append(mark(kind), node);
		return row;
	}

	function rowButton (icon, title, run, extraClass) {
		var button = document.createElement('button');
		button.type = 'button';
		button.className = 'Explorer__sidebarButton' + (extraClass ? ' ' + extraClass : '');
		button.innerHTML = icon;
		button.title = title;
		button.setAttribute('aria-label', title);
		button.onclick = function (e) {
			// Without this the click reaches the row behind it too -- and the document, whose
			// click handler closes the context menu this button may just have opened.
			e.stopPropagation();
			run(e);
		};
		return button;
	}

	// --- the drawer ---------------------------------------------------------------------------

	function isNarrow () {
		try {
			return !!(typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches);
		}
		catch (err) {
			return false;
		}
	}

	function rememberedOpen () {
		try {
			var value = window.localStorage.getItem(STORAGE_KEY);
			return value === 'open' ? true : (value === 'closed' ? false : null);
		}
		catch (err) {
			// A private window, or storage refused: the default is a fine answer.
			return null;
		}
	}

	function setSidebarOpen (open, remember) {
		state.sidebarOpen = !!open;
		if (remember && !isNarrow()) {
			try {
				window.localStorage.setItem(STORAGE_KEY, state.sidebarOpen ? 'open' : 'closed');
			}
			catch (err) {
				// Not remembered, and still toggled.
			}
		}
		ui.body.classList.toggle('Explorer__body--sidebarClosed', !state.sidebarOpen);
		ui.sidebarToggle.setAttribute('aria-pressed', state.sidebarOpen ? 'true' : 'false');
		ui.sidebarToggle.title = state.sidebarOpen ? 'Hide the sidebar' : 'Show the sidebar';
	}

	function toggleSidebar () {
		setSidebarOpen(!state.sidebarOpen, true);
	}

	// Once at boot, and again whenever the window crosses the breakpoint.
	function fitSidebar () {
		if (isNarrow()) {
			setSidebarOpen(false, false);
			return;
		}
		var remembered = rememberedOpen();
		setSidebarOpen(remembered === null ? true : remembered, false);
	}

	// The window is going somewhere -- called by `navigateTo` and by Back and Forward in
	// index.html, never by a row. Over the listing the drawer has done its job; as a column it
	// stays where it is.
	function sidebarChosen () {
		if (state.sidebarOpen && isNarrow()) {
			setSidebarOpen(false, false);
		}
	}

	function watchSidebarWidth () {
		try {
			var query = window.matchMedia(NARROW_QUERY);
			if (typeof query.addEventListener === 'function') {
				query.addEventListener('change', fitSidebar);
			}
			else if (typeof query.addListener === 'function') {
				query.addListener(fitSidebar);
			}
		}
		catch (err) {
			// No matchMedia: the drawer keeps whatever state it was fitted to at boot.
		}
	}

	return {
		renderSidebar: renderSidebar,
		toggleSidebar: toggleSidebar,
		fitSidebar: fitSidebar,
		sidebarChosen: sidebarChosen,
		watchSidebarWidth: watchSidebarWidth
	};
}
