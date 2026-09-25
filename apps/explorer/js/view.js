// Everything Explorer draws of itself: the whole chrome in one template, the order the rows
// go in, and the six redraws that follow a change in `state` or in the shell's storage figure.
// It is the last of the big blocks to come out of `openExplorer` that is not `actions`.
//
// **Phase 24 drew it again from mockup B** (docs/explorer-chrome-mockup-b.html): the commands on a
// rail, the path as the title, a selection line and a foot. What every control was before, and
// where it went, is docs/explorer-controls.md -- read it before taking one out.
//
// **`renderLayout` is why `ui` can be passed to a module before it holds anything.** Every
// other file takes `ui` by reference and reads nodes off it; this is the one that puts them
// there, and it does it by mutating the same object, never by reassigning it. Build order
// therefore does not matter to any of them -- but `renderLayout()` must have *run* before
// anything reads `ui`, which is why index.html calls it immediately after the module block
// and before it binds a single event.
//
// **`renderOverlays` is not here**, though it is a render and it was written beside these.
// It is the junction where three modules meet -- context-menu builds a node, dialogs builds
// a node, and it hangs whichever exists in `ui.overlays` -- and five modules call it to ask
// for that redraw. Moving it here would mean handing those five a late-bound thunk each,
// which is five cycles broken to tidy seventeen lines. It stays in index.html, where the
// wiring lives.
//
// The one cycle this file does have is with js/selection.js, and it is real rather than
// accidental: changing what is selected asks for a redraw, and the redraw reads what is
// selected. index.html breaks it the same way it breaks the dialogs/archive one -- selection
// is built first and takes `renderStatus` and `renderToolbarState` late-bound, which is
// exactly what that file's own header said would happen.

import { ICONS } from './icons.js';

// What each sort key is called wherever it is named: the sort button's title, its menu, the foot.
export var SORT_LABELS = {name: 'Name', type: 'Type', mtime: 'Modified', size: 'Size'};

export function createView (deps) {

	var state = deps.state;
	var ui = deps.ui;
	var rootElem = deps.rootElem;
	var document = deps.doc;
	var escapeAttr = deps.escapeAttr;
	var escapeHtml = deps.escapeHtml;
	var formatSize = deps.formatSize;
	var getExt = deps.getExt;
	var getItemTitle = deps.getItemTitle;
	var kindOf = deps.kindOf;
	var hasInternalClipboard = deps.hasInternalClipboard;
	var getSelectedItems = deps.getSelectedItems;
	var syncSelectAllUI = deps.syncSelectAllUI;
	// The chord for a command, already written for this machine by the shell, or ''.
	var keyHint = deps.keyHint || function () { return ''; };


	// The template and its lookups. Built from mockup B: a rail of commands down the left edge,
	// which cannot crop because it does not compete for width; the drawer beside it; and the
	// document -- the path as its title, a line under that which is a count until something is
	// selected and then also what can be done with it, the listing, and a foot holding what is
	// true whatever is selected. Each rail button names itself with `title` and `aria-label`: a
	// tooltip drawn by CSS would be clipped by the rail's own scrolling.
	function renderLayout () {
		rootElem.innerHTML = `
		<div class="Explorer">
			<nav class="Explorer__rail" aria-label="Commands">
				${railButton('Explorer__sidebarToggle', 'Show the sidebar', ICONS.drawer, ' aria-pressed="false"')}
				<div class="Explorer__railRule"></div>
				${railButton('Explorer__back', 'Back', ICONS.back)}
				${railButton('Explorer__forward', 'Forward', ICONS.forward)}
				${railButton('Explorer__up', 'Up one folder', ICONS.up)}
				<div class="Explorer__railRule"></div>
				${railButton('Explorer__new Explorer__railButton--accent', 'New', ICONS.add, ' aria-haspopup="menu"')}
				${railButton('Explorer__upload', 'Upload', ICONS.upload)}
				${railButton('Explorer__paste', 'Paste', ICONS.paste, '', 'paste')}
				<div class="Explorer__railRule"></div>
				${railButton('Explorer__viewDetails', 'Details', ICONS.details, ' aria-pressed="true"')}
				${railButton('Explorer__viewGrid', 'Grid', ICONS.grid, ' aria-pressed="false"')}
				${railButton('Explorer__sort', 'Sort', ICONS.sort, ' aria-haspopup="menu"')}
				${railButton('Explorer__refresh', 'Refresh', ICONS.refresh)}
				<div class="Explorer__railGap"></div>
				${railButton('Explorer__more', 'More', ICONS.more, ' aria-haspopup="menu"')}
			</nav>
			<div class="Explorer__body">
				<aside class="Explorer__sidebar">
					<div class="Explorer__sidebarList"></div>
					<div class="Explorer__sidebarFooter"></div>
				</aside>
				<section class="Explorer__doc">
					<header class="Explorer__head">
						<h1 class="Explorer__breadcrumbs"></h1>
						<div class="Explorer__sub">
							<label class="Explorer__selectAllLabel" title="Select every item in this folder">
								<input class="Explorer__selectAllToolbar Explorer__check" type="checkbox">
								<span>All</span>
							</label>
							<span class="Explorer__status"></span>
							<div class="Explorer__acts" hidden>
								<button class="Explorer__act Explorer__copy" type="button"${keyTitle('Copy', 'copy')}>Copy</button>
								<button class="Explorer__act Explorer__act--destructive Explorer__cut" type="button"${keyTitle('Cut', 'cut')}>Cut</button>
								<button class="Explorer__act Explorer__compress" type="button">Compress…</button>
								<button class="Explorer__act Explorer__act--destructive Explorer__delete" type="button"${keyTitle('Delete', 'delete')}>Delete</button>
								<button class="Explorer__act Explorer__pasteHere" type="button"${keyTitle('Paste', 'paste')}>Paste</button>
							</div>
						</div>
					</header>
					<main class="Explorer__main">
						<table class="Explorer__table">
							<thead>
								<tr>
									<th class="Explorer__selectCol"><input class="Explorer__selectAll Explorer__check" type="checkbox" aria-label="Select all"></th>
									<th class="Explorer__colName" data-sort-key="name">Name</th>
									<th class="Explorer__colType" data-sort-key="type">Type</th>
									<th class="Explorer__colModified" data-sort-key="mtime">Modified</th>
									<th class="Explorer__colSize" data-sort-key="size">Size</th>
								</tr>
							</thead>
							<tbody class="Explorer__rows"></tbody>
						</table>
						<div class="Explorer__grid" hidden></div>
						<div class="Explorer__empty" hidden>No items in this folder</div>
						<div class="Explorer__selectionBox"></div>
					</main>
					<footer class="Explorer__foot">
						<span class="Explorer__recordingIndicator" hidden>
							<span class="Explorer__recordingDot"></span>
							<span class="Explorer__recordingTime">00:00:00</span>
							<button class="Explorer__recordingBtn Explorer__recordingMicBtn" type="button" title="Mute microphone">${ICONS.mic}</button>
							<button class="Explorer__recordingBtn Explorer__recordingSysBtn" type="button" title="Mute system audio">${ICONS.speaker}</button>
							<button class="Explorer__recordingBtn Explorer__recordingStop" type="button" title="Stop recording">${ICONS.stop}</button>
						</span>
						<span class="Explorer__footText"></span>
						<span class="Explorer__gauge" hidden>
							<span class="Explorer__gaugeText"></span>
							<span class="Explorer__gaugeBar"><span class="Explorer__gaugeFill"></span></span>
						</span>
					</footer>
				</section>
			</div>
			<input class="Explorer__fileInput" type="file" multiple hidden>
		</div>
		<div class="Explorer__overlays"></div>
		`;

		ui.sidebarToggle = rootElem.querySelector('.Explorer__sidebarToggle');
		ui.back = rootElem.querySelector('.Explorer__back');
		ui.forward = rootElem.querySelector('.Explorer__forward');
		ui.up = rootElem.querySelector('.Explorer__up');
		ui.newBtn = rootElem.querySelector('.Explorer__new');
		ui.upload = rootElem.querySelector('.Explorer__upload');
		ui.paste = rootElem.querySelector('.Explorer__paste');
		ui.viewDetails = rootElem.querySelector('.Explorer__viewDetails');
		ui.viewGrid = rootElem.querySelector('.Explorer__viewGrid');
		ui.sort = rootElem.querySelector('.Explorer__sort');
		ui.refresh = rootElem.querySelector('.Explorer__refresh');
		ui.more = rootElem.querySelector('.Explorer__more');
		ui.breadcrumbs = rootElem.querySelector('.Explorer__breadcrumbs');
		ui.selectAllToolbar = rootElem.querySelector('.Explorer__selectAllToolbar');
		ui.status = rootElem.querySelector('.Explorer__status');
		ui.acts = rootElem.querySelector('.Explorer__acts');
		ui.copy = rootElem.querySelector('.Explorer__copy');
		ui.cut = rootElem.querySelector('.Explorer__cut');
		ui.compress = rootElem.querySelector('.Explorer__compress');
		ui.delete = rootElem.querySelector('.Explorer__delete');
		ui.pasteHere = rootElem.querySelector('.Explorer__pasteHere');
		ui.body = rootElem.querySelector('.Explorer__body');
		ui.sidebar = rootElem.querySelector('.Explorer__sidebar');
		ui.sidebarList = rootElem.querySelector('.Explorer__sidebarList');
		ui.sidebarFooter = rootElem.querySelector('.Explorer__sidebarFooter');
		ui.main = rootElem.querySelector('.Explorer__main');
		ui.table = rootElem.querySelector('.Explorer__table');
		ui.selectAll = rootElem.querySelector('.Explorer__selectAll');
		ui.rows = rootElem.querySelector('.Explorer__rows');
		ui.grid = rootElem.querySelector('.Explorer__grid');
		ui.empty = rootElem.querySelector('.Explorer__empty');
		ui.selectionBox = rootElem.querySelector('.Explorer__selectionBox');
		ui.recordingIndicator = rootElem.querySelector('.Explorer__recordingIndicator');
		ui.recordingTime = rootElem.querySelector('.Explorer__recordingTime');
		ui.recordingMicBtn = rootElem.querySelector('.Explorer__recordingMicBtn');
		ui.recordingSysBtn = rootElem.querySelector('.Explorer__recordingSysBtn');
		ui.recordingStop = rootElem.querySelector('.Explorer__recordingStop');
		ui.footText = rootElem.querySelector('.Explorer__footText');
		ui.gauge = rootElem.querySelector('.Explorer__gauge');
		ui.gaugeText = rootElem.querySelector('.Explorer__gaugeText');
		ui.gaugeFill = rootElem.querySelector('.Explorer__gaugeFill');
		ui.fileInput = rootElem.querySelector('.Explorer__fileInput');
		ui.overlays = rootElem.querySelector('.Explorer__overlays');
	}

	// `keys` names the command in js/keys.js whose chord goes in the tooltip, after the name. The
	// label a screen reader hears stays the name alone.
	function railButton (classes, name, icon, extra, keys) {
		var hint = keys ? keyHint(keys) : '';
		return '<button class="Explorer__railButton ' + classes + '" type="button" title="'
			+ escapeAttr(hint ? name + ' (' + hint + ')' : name)
			+ '" aria-label="' + name + '"' + (extra || '') + '>' + icon + '</button>';
	}

	// A tooltip for a worded button: its chord and nothing else, since the word is on it already.
	function keyTitle (name, keys) {
		var hint = keyHint(keys);
		return hint ? ' title="' + escapeAttr(name + ' (' + hint + ')') + '"' : '';
	}

	function sortItems () {
		var dirMul = state.sort.dir === 'asc' ? 1 : -1;
		state.items.sort(function (a, b) {
			if (a.isDirectory !== b.isDirectory) {
				return a.isDirectory ? -1 : 1;
			}

			if (state.sort.key === 'type') {
				var tcmp = typeKey(a).localeCompare(typeKey(b));
				if (tcmp) return tcmp * dirMul;
			}
			if (state.sort.key === 'mtime') {
				var mcmp = (a.mtimeTs - b.mtimeTs);
				if (mcmp) return mcmp * dirMul;
			}
			if (state.sort.key === 'size') {
				var scmp = (a.size - b.size);
				if (scmp) return scmp * dirMul;
			}

			return a.name.localeCompare(b.name) * dirMul;
		});
	}

	// What the Type column says, and what sorting by it compares: a screensaver is one whether it is
	// a page or a folder, so it is neither an `html` nor a Folder there.
	function typeName (item) {
		if (kindOf(item) === 'scr') {
			return 'Screensaver';
		}
		return item.isDirectory ? 'Folder' : (getExt(item.name) || 'File');
	}

	function typeKey (item) {
		if (kindOf(item) === 'scr') {
			return 'screensaver';
		}
		return item.isDirectory ? 'dir' : getExt(item.name);
	}

	function renderToolbarState () {
		ui.back.disabled = !state.historyBack.length;
		ui.forward.disabled = !state.historyForward.length;
		ui.up.disabled = state.cwd === '/';
		// The line under the path carries what can be done right now: the selection's own actions
		// while there is a selection, and Paste while something is copied. With neither it is a
		// count, and nothing shifts.
		var selected = !!state.selectedPaths.size;
		var copied = hasInternalClipboard();
		[ui.copy, ui.cut, ui.compress, ui.delete].forEach(function (button) { button.hidden = !selected; });
		ui.pasteHere.hidden = !copied;
		ui.acts.hidden = !selected && !copied;
		// Follows the clipboard, not the selection: pasting needs something copied, and nothing
		// selected. Mockup B had this the wrong way round.
		ui.paste.disabled = !copied;
		ui.viewDetails.setAttribute('aria-pressed', state.viewMode === 'grid' ? 'false' : 'true');
		ui.viewGrid.setAttribute('aria-pressed', state.viewMode === 'grid' ? 'true' : 'false');
		var sorted = describeSort();
		ui.sort.title = 'Sort: ' + sorted;
		ui.sort.setAttribute('aria-label', 'Sort: ' + sorted);
		// Read by the stylesheet, which draws the direction on the header being sorted by. There
		// is one attribute pair here instead of one per header so that nothing has to look the
		// headers up.
		ui.table.dataset.sortKey = state.sort.key;
		ui.table.dataset.sortDir = state.sort.dir;
		ui.footText.textContent = 'sorted by ' + sorted.toLowerCase() + '  ·  '
			+ (state.viewMode === 'grid' ? 'grid' : 'details') + ' view';
		syncSelectAllUI();
	}

	function describeSort () {
		return (SORT_LABELS[state.sort.key] || SORT_LABELS.name) + ', '
			+ (state.sort.dir === 'desc' ? 'descending' : 'ascending');
	}

	// The path is the document's title. The root is `/` rather than a name, and nothing separates
	// it from the first folder, so the title reads as the path it is: `/home/docs`, each part of
	// it a way back there. The folder being shown is text, not a button -- there is nowhere for
	// it to go.
	function renderBreadcrumbs () {
		var segments = state.cwd.split('/').filter(Boolean);
		var crumbs = [{label: '/', path: '/'}];
		segments.forEach(function (segment, index) {
			crumbs.push({
				label: segment,
				path: '/' + segments.slice(0, index + 1).join('/')
			});
		});

		ui.breadcrumbs.innerHTML = '';
		crumbs.forEach(function (crumb, index) {
			var current = index === crumbs.length - 1;
			var node = document.createElement(current ? 'span' : 'button');
			node.className = 'Explorer__crumb' + (current ? ' Explorer__crumb--current' : '');
			if (!current) {
				node.type = 'button';
			}
			node.dataset.path = crumb.path;
			node.textContent = crumb.label;
			ui.breadcrumbs.append(node);
			if (index > 0 && !current) {
				var sep = document.createElement('span');
				sep.className = 'Explorer__crumbSep';
				sep.textContent = '/';
				ui.breadcrumbs.append(sep);
			}
		});
	}

	function renderRows () {
		ui.rows.innerHTML = '';
		ui.grid.innerHTML = '';
		ui.empty.hidden = !!state.items.length;

		ui.table.hidden = state.viewMode === 'grid';
		ui.grid.hidden = state.viewMode !== 'grid';

		state.items.forEach(function (item) {
			var tr = document.createElement('tr');
			tr.className = 'Explorer__row' + (state.selectedPaths.has(item.path) ? ' Explorer__row--selected' : '');
			tr.dataset.path = item.path;
			tr.dataset.type = item.isDirectory ? 'dir' : 'file';
			tr.draggable = true;
			tr.title = getItemTitle(item);

			var selectTd = document.createElement('td');
			selectTd.className = 'Explorer__selectCol';
			selectTd.innerHTML = '<input class="Explorer__itemCheckbox Explorer__check" type="checkbox" data-path="' + escapeAttr(item.path) + '"' + (state.selectedPaths.has(item.path) ? ' checked' : '') + ' aria-label="Select ' + escapeAttr(item.name) + '">';
			tr.append(selectTd);

			var kind = kindOf(item);
			var nameTd = document.createElement('td');
			nameTd.className = 'Explorer__colName';
			nameTd.innerHTML = `<div class="Explorer__nameCell">${kindMark(kind)}<span class="Explorer__nameText">${escapeHtml(item.name)}</span></div>`;
			tr.append(nameTd);

			var typeTd = document.createElement('td');
			typeTd.className = 'Explorer__colType';
			typeTd.textContent = typeName(item);
			tr.append(typeTd);

			var dateTd = document.createElement('td');
			dateTd.className = 'Explorer__colModified';
			// The day and the time apart, so that a narrow window can drop the time and keep the
			// column; the row's title still has the whole stamp.
			var stamp = String(item.mtime);
			dateTd.textContent = stamp.slice(0, 10);
			if (stamp.length > 10) {
				var time = document.createElement('span');
				time.className = 'Explorer__time';
				time.textContent = stamp.slice(10);
				dateTd.append(time);
			}
			tr.append(dateTd);

			var sizeTd = document.createElement('td');
			sizeTd.className = 'Explorer__colSize';
			sizeTd.textContent = item.isDirectory ? '' : formatSize(item.size);
			tr.append(sizeTd);

			ui.rows.append(tr);

			var card = document.createElement('div');
			card.className = 'Explorer__card' + (state.selectedPaths.has(item.path) ? ' Explorer__card--selected' : '');
			card.dataset.path = item.path;
			card.dataset.type = item.isDirectory ? 'dir' : 'file';
			card.draggable = true;
			card.title = getItemTitle(item);
			card.innerHTML = `
				<input class="Explorer__itemCheckbox Explorer__check Explorer__cardCheck" type="checkbox" data-path="${escapeAttr(item.path)}"${state.selectedPaths.has(item.path) ? ' checked' : ''} aria-label="Select ${escapeAttr(item.name)}">
				<div class="Explorer__cardIcon">${kindMark(kind)}</div>
				<div class="Explorer__cardName">${escapeHtml(item.name)}</div>
			`;
			ui.grid.append(card);
		});

		renderStatus();
		syncSelectAllUI();
	}

	// One hairline square, varied by kind -- see `kindOf` in js/format.js. Empty, and hidden from a
	// screen reader: the Type column and the tooltip already say what the file is.
	function kindMark (kind) {
		return '<span class="Explorer__kind Explorer__kind--' + kind + '" aria-hidden="true"></span>';
	}

	// "12 items", and while something is selected "12 items — 3 selected (1.2 MB)". The size counts
	// files only: a folder's size would mean walking it.
	function renderStatus () {
		var selectedItems = getSelectedItems();
		var totalSize = selectedItems.reduce(function (acc, item) {
			return acc + (item.isDirectory ? 0 : item.size);
		}, 0);

		ui.status.innerHTML = '';
		ui.status.append(document.createTextNode(state.items.length + (state.items.length === 1 ? ' item' : ' items')));
		if (selectedItems.length) {
			var selected = document.createElement('b');
			selected.textContent = selectedItems.length + ' selected';
			ui.status.append(document.createTextNode('  —  '), selected);
			if (totalSize) {
				ui.status.append(document.createTextNode(' (' + formatSize(totalSize) + ')'));
			}
		}
	}

	// What the shell says about storage: `{supported, usage, quota}` from js/shell/system-stats.js,
	// or nothing. The gauge is hidden until there is a figure to draw -- a window with no shell, or
	// a browser that will not estimate, has no gauge rather than an empty one.
	function renderStorage (storage) {
		if (!storage || !storage.supported || !storage.quota) {
			ui.gauge.hidden = true;
			return;
		}
		var share = Math.max(0, Math.min(1, storage.usage / storage.quota));
		var text = formatSize(storage.usage) + ' / ' + formatSize(storage.quota);
		ui.gaugeText.textContent = text;
		ui.gaugeFill.style.width = (share * 100).toFixed(1) + '%';
		ui.gauge.title = formatSize(storage.usage) + ' of ' + formatSize(storage.quota) + ' used by PixOS in this browser';
		ui.gauge.hidden = false;
	}

	return {
		renderLayout: renderLayout,
		sortItems: sortItems,
		renderToolbarState: renderToolbarState,
		renderBreadcrumbs: renderBreadcrumbs,
		renderRows: renderRows,
		renderStatus: renderStatus,
		renderStorage: renderStorage
	};
}
