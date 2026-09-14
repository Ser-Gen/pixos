// Explorer's two clipboards, which are not the same thing and are easy to mistake for one.
//
// **The internal one** is `state.clipboard`: a list of paths and whether they were copied or cut,
// held by this window and never by the browser. *Copy*, *Cut* and *Paste* use it, and it is the
// only way a folder can be copied at all -- the system clipboard holds text, not a tree.
// `hasInternalClipboard` is the one question anybody else asks of it: the toolbar greys *Paste*
// out with it, the menus disable their *Paste* entries with it, and the keyboard handler lets
// `Ctrl+V` through with it.
//
// **The system one** is only ever written, by *Copy path*, and it is the trap: from inside an
// iframe it needs a secure context and a gesture and can simply be refused. A copy that silently
// did nothing is worse than no menu entry at all, so a refusal falls back to a dialog with the
// text already in it -- a copy you can finish by hand. The two attempts before that live in
// js/failure.js (`copyTextToClipboard`); this only decides what happens when both fail.
//
// Two rules about the internal one that are not visible in the three lines each action takes:
//
//   * **A selection holding a folder and something inside it copies the folder once.**
//     `getEffectiveSelectedPaths` drops every path that sits under another selected path, because
//     copying `/a` and `/a/b` into the same place is `/a` and then a conflict about `b` inside the
//     copy that was just made.
//   * **A paste works on a snapshot**, and a cut is forgotten only once the move has succeeded.
//     The move asks conflict questions and so can take as long as a person does; a Copy pressed
//     in the meantime must not change what is being pasted, and a failed move must leave the cut
//     paths on the clipboard to try again. The toolbar is redrawn either way.
//
// `renderToolbarState` comes straight from js/view.js, which is built above this -- and the view
// takes `hasInternalClipboard` from here late-bound, because the toolbar reads the clipboard and
// every clipboard action redraws the toolbar. The same shape as selection and view, and the same
// fix.

export function createClipboard (deps) {

	var state = deps.state;
	var normalizePath = deps.normalizePath;
	var getSelectedItems = deps.getSelectedItems;
	var copyItemsToFolder = deps.copyItemsToFolder;
	var moveItemsToFolder = deps.moveItemsToFolder;
	var renderToolbarState = deps.renderToolbarState;
	var copyTextToClipboard = deps.copyTextToClipboard;
	var openDialog = deps.openDialog;

	function hasInternalClipboard () {
		return !!(state.clipboard && state.clipboard.paths && state.clipboard.paths.length);
	}

	function getEffectiveSelectedPaths () {
		return Array.from(state.selectedPaths)
			.map(normalizePath)
			.sort()
			.filter(function (candidate, index, list) {
				for (var i = 0; i < list.length; i++) {
					// Says what is meant rather than changing the answer: no path starts with
					// itself plus a slash, so without this line the result is the same.
					if (i === index) continue;
					if (candidate.indexOf(list[i] + '/') === 0) {
						return false;
					}
				}
				return true;
			});
	}

	function copySelected () {
		var targets = getEffectiveSelectedPaths();
		if (!targets.length) return;
		state.clipboard = {
			mode: 'copy',
			paths: targets
		};
		renderToolbarState();
	}

	function cutSelected () {
		var targets = getEffectiveSelectedPaths();
		if (!targets.length) return;
		state.clipboard = {
			mode: 'cut',
			paths: targets
		};
		renderToolbarState();
	}

	async function pasteClipboard (targetFolderPath) {
		if (!hasInternalClipboard()) return;
		var destination = normalizePath(targetFolderPath || state.cwd);
		var clipboard = {
			mode: state.clipboard.mode,
			paths: state.clipboard.paths.slice()
		};
		try {
			if (clipboard.mode === 'copy') {
				await copyItemsToFolder(clipboard.paths, destination);
			}
			else {
				await moveItemsToFolder(clipboard.paths, destination, {source: 'clipboard-cut'});
				state.clipboard = null;
			}
		}
		finally {
			renderToolbarState();
		}
	}

	async function copyPath (itemPath) {
		var paths = itemPath
			? [itemPath]
			: getSelectedItems().map(function (entry) { return entry.path; });
		if (!paths.length) {
			return;
		}
		var text = paths.join('\n');
		if (await copyTextToClipboard(text)) {
			return;
		}
		openDialog({
			type: 'copyText',
			title: paths.length > 1 ? 'Copy paths' : 'Copy path',
			text: text
		});
	}

	return {
		hasInternalClipboard: hasInternalClipboard,
		getEffectiveSelectedPaths: getEffectiveSelectedPaths,
		copySelected: copySelected,
		cutSelected: cutSelected,
		pasteClipboard: pasteClipboard,
		copyPath: copyPath
	};
}
