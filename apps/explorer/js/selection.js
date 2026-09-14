// What is selected, and the rubber band that selects it. Lifted out of openExplorer by
// phase 21, on the same rule as js/context-menu.js: `state` and `ui` are passed by
// reference because they are shared mutable objects, and everything else is a named
// parameter.
//
// `ui` is empty when this is built -- renderLayout fills it in afterwards -- which is fine
// because it is only ever mutated, never reassigned, so the reference taken here is the
// reference that later holds the nodes. `rootElem` is the window's own root: every query in
// here is scoped to it rather than to the document, because two Explorer windows are two
// iframes and a selector that escaped one of them would find the other's rows.
//
// `renderStatus` and `renderToolbarState` now live in js/view.js, and they are still passed in
// rather than imported -- which is what made that move cost this file nothing. They are also
// the one real cycle here: changing what is selected asks for a redraw, and the redraw reads
// what is selected (`renderRows` and `renderToolbarState` both call back into `getSelectedItems`
// and `syncSelectAllUI`). One of the two modules has to be built first; this is the one, and
// index.html hands these two in late-bound.

export function createSelection (deps) {
	var state = deps.state;
	var ui = deps.ui;
	var rootElem = deps.rootElem;
	var doc = deps.doc;
	var closeContextMenu = deps.closeContextMenu;
	var renderStatus = deps.renderStatus;
	var renderToolbarState = deps.renderToolbarState;

	function getItemByPath (itemPath) {
		return state.items.find(function (item) {
			return item.path === itemPath;
		}) || null;
	}

	// The folder you are looking *at* is not one of the rows in it, so nothing in the
	// empty-area menu can look it up. This is where it is described instead.
	function getCurrentFolderItem () {
		return {
			path: state.cwd,
			name: state.cwd.split('/').filter(Boolean).pop() || '/',
			isDirectory: true
		};
	}

	function getSelectedItems () {
		return state.items.filter(function (item) {
			return state.selectedPaths.has(item.path);
		});
	}

	function applySelectionFromEvent (itemPath, e) {
		var visiblePaths = state.items.map(function (item) { return item.path; });
		if (e.shiftKey && state.lastSelectedPath && visiblePaths.indexOf(state.lastSelectedPath) > -1) {
			var from = visiblePaths.indexOf(state.lastSelectedPath);
			var to = visiblePaths.indexOf(itemPath);
			var start = Math.min(from, to);
			var end = Math.max(from, to);
			state.selectedPaths = new Set(visiblePaths.slice(start, end + 1));
		}
		else if (e.metaKey || e.ctrlKey) {
			if (state.selectedPaths.has(itemPath)) {
				state.selectedPaths.delete(itemPath);
			}
			else {
				state.selectedPaths.add(itemPath);
			}
			state.lastSelectedPath = itemPath;
		}
		else {
			state.selectedPaths = new Set([itemPath]);
			state.lastSelectedPath = itemPath;
		}
		syncSelectionUI();
	}

	function toggleSelection (itemPath, isSelected) {
		if (isSelected) {
			state.selectedPaths.add(itemPath);
			state.lastSelectedPath = itemPath;
		}
		else {
			state.selectedPaths.delete(itemPath);
			if (state.lastSelectedPath === itemPath) {
				state.lastSelectedPath = Array.from(state.selectedPaths).pop() || null;
			}
		}
		syncSelectionUI();
	}

	function setAllSelection (checked) {
		if (checked) {
			state.selectedPaths = new Set(state.items.map(function (item) { return item.path; }));
			state.lastSelectedPath = state.items.length ? state.items[state.items.length - 1].path : null;
		}
		else {
			state.selectedPaths = new Set();
			state.lastSelectedPath = null;
		}
		syncSelectionUI();
	}

	function syncSelectionUI () {
		rootElem.querySelectorAll('.Explorer__row[data-path]').forEach(function (node) {
			node.classList.toggle('Explorer__row--selected', state.selectedPaths.has(node.dataset.path));
		});
		rootElem.querySelectorAll('.Explorer__card[data-path]').forEach(function (node) {
			node.classList.toggle('Explorer__card--selected', state.selectedPaths.has(node.dataset.path));
		});
		rootElem.querySelectorAll('.Explorer__itemCheckbox[data-path]').forEach(function (node) {
			node.checked = state.selectedPaths.has(node.dataset.path);
		});
		syncSelectAllUI();
		renderStatus();
		renderToolbarState();
	}

	function syncSelectAllUI () {
		var allSelected = !!state.items.length && state.selectedPaths.size === state.items.length;
		var partiallySelected = state.selectedPaths.size > 0 && state.selectedPaths.size < state.items.length;
		[ui.selectAll, ui.selectAllToolbar].forEach(function (node) {
			if (!node) return;
			node.checked = allSelected;
			node.indeterminate = partiallySelected;
		});
	}

	function startSelectionBox (e) {
		closeContextMenu();
		var point = getSelectionPoint(e);
		state.selectionBox = {
			startX: point.x,
			startY: point.y,
			currentX: point.x,
			currentY: point.y,
			baseSelection: (e.ctrlKey || e.metaKey) ? new Set(state.selectedPaths) : new Set(),
			toggledPaths: new Set(),
			didDrag: false
		};
		ui.main.classList.add('Explorer__main--selecting');
		updateSelectionBoxVisual();
		doc.addEventListener('mousemove', handleSelectionBoxMove);
		doc.addEventListener('mouseup', handleSelectionBoxEnd);
	}

	function handleSelectionBoxMove (e) {
		if (!state.selectionBox) return;
		var point = getSelectionPoint(e);
		state.selectionBox.currentX = point.x;
		state.selectionBox.currentY = point.y;
		state.selectionBox.didDrag = state.selectionBox.didDrag || Math.abs(point.x - state.selectionBox.startX) > 3 || Math.abs(point.y - state.selectionBox.startY) > 3;
		updateSelectionBoxVisual();
		updateSelectionBoxSelection();
	}

	function handleSelectionBoxEnd () {
		if (!state.selectionBox) return;
		var didDrag = state.selectionBox.didDrag;
		if (!didDrag) {
			state.selectedPaths = new Set();
			state.lastSelectedPath = null;
			syncSelectionUI();
		}
		state.selectionBox = null;
		ui.main.classList.remove('Explorer__main--selecting');
		ui.selectionBox.style.display = 'none';
		doc.removeEventListener('mousemove', handleSelectionBoxMove);
		doc.removeEventListener('mouseup', handleSelectionBoxEnd);
	}

	function updateSelectionBoxVisual () {
		if (!state.selectionBox) return;
		var box = getSelectionBoxRect();
		ui.selectionBox.style.display = state.selectionBox.didDrag ? 'block' : 'none';
		ui.selectionBox.style.left = box.left + 'px';
		ui.selectionBox.style.top = box.top + 'px';
		ui.selectionBox.style.width = box.width + 'px';
		ui.selectionBox.style.height = box.height + 'px';
	}

	function updateSelectionBoxSelection () {
		if (!state.selectionBox || !state.selectionBox.didDrag) return;
		var box = getSelectionBoxRect();
		var nextSelection = new Set(state.selectionBox.baseSelection);
		var intersected = getSelectionIntersectedPaths(box);
		intersected.forEach(function (itemPath) {
			nextSelection.add(itemPath);
		});
		state.selectedPaths = nextSelection;
		state.lastSelectedPath = intersected.length ? intersected[intersected.length - 1] : (Array.from(nextSelection).pop() || null);
		syncSelectionUI();
	}

	function getSelectionBoxRect () {
		var selection = state.selectionBox;
		var left = Math.min(selection.startX, selection.currentX);
		var top = Math.min(selection.startY, selection.currentY);
		var right = Math.max(selection.startX, selection.currentX);
		var bottom = Math.max(selection.startY, selection.currentY);
		return {
			left: left,
			top: top,
			right: right,
			bottom: bottom,
			width: right - left,
			height: bottom - top
		};
	}

	function getSelectionPoint (e) {
		var mainRect = ui.main.getBoundingClientRect();
		return {
			x: e.clientX - mainRect.left + ui.main.scrollLeft,
			y: e.clientY - mainRect.top + ui.main.scrollTop
		};
	}

	function getSelectionIntersectedPaths (box) {
		var selector = state.viewMode === 'grid' ? '.Explorer__card[data-path]' : '.Explorer__row[data-path]';
		return Array.from(rootElem.querySelectorAll(selector)).map(function (node) {
			var rect = getNodeRectInMain(node);
			return intersectsSelectionBox(box, rect) ? node.dataset.path : null;
		}).filter(Boolean);
	}

	function getNodeRectInMain (node) {
		var rect = node.getBoundingClientRect();
		var mainRect = ui.main.getBoundingClientRect();
		return {
			left: rect.left - mainRect.left + ui.main.scrollLeft,
			top: rect.top - mainRect.top + ui.main.scrollTop,
			right: rect.right - mainRect.left + ui.main.scrollLeft,
			bottom: rect.bottom - mainRect.top + ui.main.scrollTop
		};
	}

	function intersectsSelectionBox (a, b) {
		return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
	}

	return {
		getItemByPath: getItemByPath,
		getCurrentFolderItem: getCurrentFolderItem,
		getSelectedItems: getSelectedItems,
		applySelectionFromEvent: applySelectionFromEvent,
		toggleSelection: toggleSelection,
		setAllSelection: setAllSelection,
		syncSelectionUI: syncSelectionUI,
		syncSelectAllUI: syncSelectAllUI,
		startSelectionBox: startSelectionBox,
		handleSelectionBoxMove: handleSelectionBoxMove,
		handleSelectionBoxEnd: handleSelectionBoxEnd,
		updateSelectionBoxVisual: updateSelectionBoxVisual,
		updateSelectionBoxSelection: updateSelectionBoxSelection,
		getSelectionBoxRect: getSelectionBoxRect,
		getSelectionPoint: getSelectionPoint,
		getSelectionIntersectedPaths: getSelectionIntersectedPaths,
		getNodeRectInMain: getNodeRectInMain,
		intersectsSelectionBox: intersectsSelectionBox
	};
}
