// Everything Explorer draws of itself: the whole chrome in one template, the order the rows
// go in, and the five redraws that follow a change in `state`. It is the last of the big
// blocks to come out of `openExplorer` that is not `actions`.
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
	var hasInternalClipboard = deps.hasInternalClipboard;
	var getSelectedItems = deps.getSelectedItems;
	var syncSelectAllUI = deps.syncSelectAllUI;


	function renderLayout () {
		rootElem.innerHTML = `
		<div class="Explorer">
			<div class="Explorer__toolbar">
				<div class="Explorer__toolbarGroup">
					<button class="Explorer__back" title="Back">←</button>
					<button class="Explorer__forward" title="Forward">→</button>
					<button class="Explorer__up" title="Up">↑ Up</button>
				</div>
				<div class="Explorer__toolbarGroup">
					<button class="Explorer__new">New</button>
					<button class="Explorer__upload">Upload</button>
					<button class="Explorer__copy">Copy</button>
					<button class="Explorer__cut">Cut</button>
					<button class="Explorer__paste">Paste</button>
					<button class="Explorer__defaults">Default Apps</button>
					<label class="Explorer__toolbarLabel" title="Select all items in current folder">
						<input class="Explorer__selectAllToolbar Explorer__check" type="checkbox">
						<span>All</span>
					</label>
				</div>
				<div class="Explorer__toolbarGroup Explorer__toolbarGroup--grow">
					<select class="Explorer__viewMode">
						<option value="details">Details</option>
						<option value="grid">Grid</option>
					</select>
					<select class="Explorer__sortKey">
						<option value="name">Sort: Name</option>
						<option value="type">Sort: Type</option>
						<option value="mtime">Sort: Date</option>
						<option value="size">Sort: Size</option>
					</select>
					<button class="Explorer__refresh">Refresh</button>
					<span class="Explorer__recordingIndicator" hidden>
						<span class="Explorer__recordingDot"></span>
						<span class="Explorer__recordingTime">00:00:00</span>
						<button class="Explorer__recordingBtn Explorer__recordingMicBtn" title="Mute microphone"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V20H9v2h6v-2h-2v-2.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg></button>
						<button class="Explorer__recordingBtn Explorer__recordingSysBtn" title="Mute system audio"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg></button>
						<button class="Explorer__recordingBtn Explorer__recordingStop" title="Stop recording"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg></button>
					</span>
				</div>
				<input class="Explorer__fileInput" type="file" multiple hidden>
			</div>
			<div class="Explorer__breadcrumbs"></div>
			<div class="Explorer__body">
				<aside class="Explorer__sidebar"></aside>
				<main class="Explorer__main">
					<table class="Explorer__table">
						<thead>
							<tr>
								<th class="Explorer__selectCol"><input class="Explorer__selectAll Explorer__check" type="checkbox" aria-label="Select all"></th>
								<th data-sort-key="name">Name</th>
								<th data-sort-key="type">Type</th>
								<th data-sort-key="mtime">Modified</th>
								<th data-sort-key="size">Size</th>
							</tr>
						</thead>
						<tbody class="Explorer__rows"></tbody>
					</table>
					<div class="Explorer__grid" hidden></div>
					<div class="Explorer__empty" hidden>No items in this folder</div>
					<div class="Explorer__selectionBox"></div>
				</main>
			</div>
			<div class="Explorer__status"></div>
		</div>
		<div class="Explorer__overlays"></div>
		`;

		ui.back = rootElem.querySelector('.Explorer__back');
		ui.forward = rootElem.querySelector('.Explorer__forward');
		ui.up = rootElem.querySelector('.Explorer__up');
		ui.newBtn = rootElem.querySelector('.Explorer__new');
		ui.upload = rootElem.querySelector('.Explorer__upload');
		ui.copy = rootElem.querySelector('.Explorer__copy');
		ui.cut = rootElem.querySelector('.Explorer__cut');
		ui.paste = rootElem.querySelector('.Explorer__paste');
		ui.defaults = rootElem.querySelector('.Explorer__defaults');
		ui.selectAll = rootElem.querySelector('.Explorer__selectAll');
		ui.selectAllToolbar = rootElem.querySelector('.Explorer__selectAllToolbar');
		ui.fileInput = rootElem.querySelector('.Explorer__fileInput');
		ui.viewMode = rootElem.querySelector('.Explorer__viewMode');
		ui.sortKey = rootElem.querySelector('.Explorer__sortKey');
		ui.refresh = rootElem.querySelector('.Explorer__refresh');
		ui.recordingIndicator = rootElem.querySelector('.Explorer__recordingIndicator');
		ui.recordingTime = rootElem.querySelector('.Explorer__recordingTime');
		ui.recordingMicBtn = rootElem.querySelector('.Explorer__recordingMicBtn');
		ui.recordingSysBtn = rootElem.querySelector('.Explorer__recordingSysBtn');
		ui.recordingStop = rootElem.querySelector('.Explorer__recordingStop');
		ui.breadcrumbs = rootElem.querySelector('.Explorer__breadcrumbs');
		ui.sidebar = rootElem.querySelector('.Explorer__sidebar');
		ui.main = rootElem.querySelector('.Explorer__main');
		ui.rows = rootElem.querySelector('.Explorer__rows');
		ui.grid = rootElem.querySelector('.Explorer__grid');
		ui.table = rootElem.querySelector('.Explorer__table');
		ui.empty = rootElem.querySelector('.Explorer__empty');
		ui.selectionBox = rootElem.querySelector('.Explorer__selectionBox');
		ui.status = rootElem.querySelector('.Explorer__status');
		ui.overlays = rootElem.querySelector('.Explorer__overlays');
	}


	function sortItems () {
		var dirMul = state.sort.dir === 'asc' ? 1 : -1;
		state.items.sort(function (a, b) {
			if (a.isDirectory !== b.isDirectory) {
				return a.isDirectory ? -1 : 1;
			}

			if (state.sort.key === 'type') {
				var at = a.isDirectory ? 'dir' : getExt(a.name);
				var bt = b.isDirectory ? 'dir' : getExt(b.name);
				var tcmp = at.localeCompare(bt);
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

	function renderToolbarState () {
		ui.back.disabled = !state.historyBack.length;
		ui.forward.disabled = !state.historyForward.length;
		ui.up.disabled = state.cwd === '/';
		ui.copy.disabled = !state.selectedPaths.size;
		ui.cut.disabled = !state.selectedPaths.size;
		ui.paste.disabled = !hasInternalClipboard();
		ui.sortKey.value = state.sort.key;
		ui.viewMode.value = state.viewMode;
		syncSelectAllUI();
	}

	function renderBreadcrumbs () {
		var segments = state.cwd.split('/').filter(Boolean);
		var crumbs = [{label: 'rootfs', path: '/'}];
		segments.forEach(function (segment, index) {
			crumbs.push({
				label: segment,
				path: '/' + segments.slice(0, index + 1).join('/')
			});
		});

		ui.breadcrumbs.innerHTML = '';
		crumbs.forEach(function (crumb, index) {
			var span = document.createElement('span');
			span.className = 'Explorer__crumb' + (index === crumbs.length - 1 ? ' Explorer__crumb--current' : '');
			span.dataset.path = crumb.path;
			span.textContent = crumb.label;
			ui.breadcrumbs.append(span);
			if (index < crumbs.length - 1) {
				var sep = document.createElement('span');
				sep.className = 'Explorer__muted';
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

			var nameTd = document.createElement('td');
			nameTd.innerHTML = `<div class="Explorer__nameCell"><span>${item.isDirectory ? '📁' : '📄'}</span><span class="Explorer__nameText">${escapeHtml(item.name)}</span></div>`;
			tr.append(nameTd);

			var typeTd = document.createElement('td');
			typeTd.textContent = item.isDirectory ? 'Folder' : (getExt(item.name) || 'File');
			tr.append(typeTd);

			var dateTd = document.createElement('td');
			dateTd.textContent = item.mtime;
			tr.append(dateTd);

			var sizeTd = document.createElement('td');
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
				<div class="Explorer__cardIcon">${item.isDirectory ? '📁' : '📄'}</div>
				<div class="Explorer__cardName">${escapeHtml(item.name)}</div>
			`;
			ui.grid.append(card);
		});

		renderStatus();
		syncSelectAllUI();
	}

	function renderStatus () {
		var selectedItems = getSelectedItems();
		var totalSize = selectedItems.reduce(function (acc, item) {
			return acc + (item.isDirectory ? 0 : item.size);
		}, 0);

		ui.status.textContent = state.items.length + ' items' +
			' | selected: ' + selectedItems.length +
			' | selected size: ' + formatSize(totalSize);
	}

	return {
		renderLayout: renderLayout,
		sortItems: sortItems,
		renderToolbarState: renderToolbarState,
		renderBreadcrumbs: renderBreadcrumbs,
		renderRows: renderRows,
		renderStatus: renderStatus
	};
}
