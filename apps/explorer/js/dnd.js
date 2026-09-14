// Dragging rows onto a folder. Lifted out of openExplorer by phase 21, on the same rule as
// js/selection.js: `state` by reference, everything else a named parameter.
//
// The reason this one is worth reading rather than skimming is that a single drop can be
// reported by the browser three different ways, and only one move may happen. `drop` fires
// on the folder; `dragend` fires on the source and in some browsers *before* the drop has
// finished bubbling; and neither fires at all if the pointer is released over a target the
// browser does not consider a drop zone, which is what the 220ms idle commit exists for.
// `dragDropHandled` and `dragCommitInProgress` are what make those three paths idempotent,
// and a move happening twice is not a cosmetic bug -- it is a file moved to one folder and
// then moved again out of it.
//
// `setTimeout` and `clearTimeout` come from `win` rather than the global, so a test can move
// that clock by hand: the race above is exactly the kind of thing real timers on a busy
// machine cannot be trusted to reproduce.

export function createDragAndDrop (deps) {
	var state = deps.state;
	var rootElem = deps.rootElem;
	var doc = deps.doc;
	var win = deps.win;
	// Still in index.html; it moves with js/file-ops.js.
	var moveItemsToFolder = deps.moveItemsToFolder;

	// The type a drag started inside Explorer carries. `getData` is refused during dragover --
	// the browser lets a handler see the *types* on the transfer but not the data until the
	// drop actually happens -- so this is the only way to tell one of our own rows from a file
	// being dragged in off the desktop while the pointer is still moving.
	var EXPLORER_DRAG_TYPE = 'application/x-explorer-paths';

	// `types` is an array in current browsers and a DOMStringList in older ones; neither is
	// reliably `.includes`-able, so this goes through Array.prototype.
	function isInternalDrag (dataTransfer) {
		if (!dataTransfer || !dataTransfer.types) { return false; }
		return Array.prototype.indexOf.call(dataTransfer.types, EXPLORER_DRAG_TYPE) !== -1;
	}

	function handleItemDragStart (e) {
		var itemNode = e.target.closest('[data-path][data-type]');
		if (!itemNode) return;
		var dragPath = itemNode.dataset.path;
		var dragPaths = state.selectedPaths.has(dragPath) ? Array.from(state.selectedPaths) : [dragPath];
		state.dragPaths = dragPaths;
		state.dragDropHandled = false;
		if (e.dataTransfer) {
			var payload = JSON.stringify(dragPaths);
			e.dataTransfer.setData(EXPLORER_DRAG_TYPE, payload);
			e.dataTransfer.setData('text/plain', payload);
			e.dataTransfer.effectAllowed = 'move';
		}
	}

	function handleItemDragOver (e) {
		var folderNode = e.target.closest('[data-path][data-type=\"dir\"]');
		if (!folderNode) return;
		e.preventDefault();
		clearDropTargets();
		folderNode.classList.add('Explorer__dropTarget');
		state.dragHoverFolderPath = folderNode.dataset.path;
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
	}

	function handleItemDragLeave (e) {
		var folderNode = e.target.closest('[data-path][data-type=\"dir\"]');
		if (!folderNode) return;
		if (folderNode.contains(e.relatedTarget)) return;
		folderNode.classList.remove('Explorer__dropTarget');
		// Keep last known folder target during drag; some browsers emit dragleave before dragend/drop.
		if (state.dragHoverFolderPath === folderNode.dataset.path) {
			state.dragHoverFolderPath = null;
		}
	}

	async function handleItemDrop (e) {
		var folderNode = e.target.closest('[data-path][data-type=\"dir\"]');
		if (!folderNode) return;
		var dragRaw = e.dataTransfer ? (
			e.dataTransfer.getData(EXPLORER_DRAG_TYPE)
			|| e.dataTransfer.getData('text/plain')
		) : '';
		var dragPaths = state.dragPaths && state.dragPaths.length ? state.dragPaths.slice() : [];
		try {
			if (dragRaw) {
				dragPaths = JSON.parse(dragRaw);
			}
		}
		catch (err) {
			console.error(err);
		}
		// Nothing of ours is being dragged, so this is a file arriving from outside the
		// browser. It is not this handler's to deal with, and it must not be claimed here:
		// `preventDefault` and `stopPropagation` below are what stop the event reaching the
		// listener on `body` that knows how to write a file, and claiming it before knowing
		// whether there was anything to move is why dropping a file from the desktop onto a
		// folder row did nothing at all -- no file, no error, no console line. Reported while
		// walking the phase 21 checklist.
		if (!dragPaths.length) return;
		e.preventDefault();
		e.stopPropagation();
		clearDropTargets();
		state.dragDropHandled = true;
		await moveItemsToFolder(dragPaths, folderNode.dataset.path, {source: 'direct-drop'});
		state.dragPaths = [];
		state.dragHoverFolderPath = null;
	}

	function handleItemDragEnd () {
		// Some browsers fire dragend before drop bubbling completes.
		win.setTimeout(function () {
			commitPendingDragMove('dragend-fallback');
			state.dragPaths = [];
			state.dragHoverFolderPath = null;
			state.dragDropHandled = false;
			clearDropTargets();
		}, 0);
	}

	async function commitPendingDragMove (source) {
		if (state.dragCommitInProgress) return;
		if (state.dragDropHandled) return;
		// The live target only, never the last one seen: a move happens where the pointer was
		// when the drag ended, or it does not happen.
		var targetFolder = state.dragHoverFolderPath;
		if (!targetFolder) return;
		if (!state.dragPaths || !state.dragPaths.length) return;

		state.dragCommitInProgress = true;
		try {
			state.dragDropHandled = true;
			await moveItemsToFolder(state.dragPaths.slice(), targetFolder, {source: source});
		}
		finally {
			state.dragCommitInProgress = false;
		}
	}

	function clearDropTargets () {
		rootElem.querySelectorAll('.Explorer__dropTarget').forEach(function (node) {
			node.classList.remove('Explorer__dropTarget');
		});
	}

	function updateDragHoverFromPoint (x, y) {
		var node = doc.elementFromPoint(x, y);
		var folderNode = node && node.closest ? node.closest('[data-path][data-type=\"dir\"]') : null;
		clearDropTargets();
		if (folderNode) {
			state.dragHoverFolderPath = folderNode.dataset.path;
			folderNode.classList.add('Explorer__dropTarget');
		}
		else {
			// The pointer is not over a folder, so there is no target -- and that stays true
			// for the rest of the drag unless it comes back over one. Keeping the last folder
			// here is what used to move a file into a folder the pointer had merely crossed on
			// its way to the toolbar: a release that landed nowhere still committed, which is
			// not something anyone asked for. Reported while walking the phase 21 checklist.
			state.dragHoverFolderPath = null;
		}
	}

	return {
		isInternalDrag: isInternalDrag,
		handleItemDragStart: handleItemDragStart,
		handleItemDragOver: handleItemDragOver,
		handleItemDragLeave: handleItemDragLeave,
		handleItemDrop: handleItemDrop,
		handleItemDragEnd: handleItemDragEnd,
		commitPendingDragMove: commitPendingDragMove,
		clearDropTargets: clearDropTargets,
		updateDragHoverFromPoint: updateDragHoverFromPoint
	};
}
