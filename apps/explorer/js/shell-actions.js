// The actions whose work is the shell's: *Open*, *Open with...*, *Manage Defaults*, *Add to
// bookmarks*, *Share with peers*, *Stop sharing*, and for a screensaver *Preview*, *Show contents*,
// *Set as wallpaper* and *Set as screensaver*. What stays in Explorer is only what Explorer
// knows -- that a folder can be navigated to in place rather than opened, that several files can
// be opened together, which folder you are looking at -- and everything else is a call on `shell`.
//
// **A screensaver is shown, not opened** (phase 26): a folder one would otherwise be gone into, and
// a page opened in a window, neither of which is what it is for. *Show contents* goes in, and
// *Open with...* still opens the page. Only where the shell can show one; elsewhere it opens.
//
// `shell` is the parent window. Explorer does not boot without one (index.html refuses before
// `openExplorer` runs), but not every shell has every entry point, so the two that are optional
// are asked about first: *Open with...* says it needs PixOS rather than throwing, and *Add to
// bookmarks* does nothing where there is no bookmarks document to add to.
//
// **The chooser's *Manage Defaults* button runs after `openWith` has returned**, from a dialog the
// shell draws, so a failure in it would reach nobody. It used to call `actions.manageDefaultApps`
// -- the guarded one, off the table -- and this module cannot read that table without needing the
// thing it is part of. So it builds the same wrapper itself, once, from the same `guarded` and the
// same `readableActionName` the table's loop uses: a failure is reported under the same words.
//
// No `ui`, no DOM. `state` is read for the selection and the folder being shown, and written only
// to close a dialog before the shell's chooser opens over it.

export function createShellActions (deps) {

	var state = deps.state;
	var shell = deps.shell;
	var getItemByPath = deps.getItemByPath;
	var isScreensaver = deps.isScreensaver || function () { return false; };
	var getSelectedItems = deps.getSelectedItems;
	var getNameByPath = deps.getNameByPath;
	var getOpenWithAppsForItems = deps.getOpenWithAppsForItems;
	var getSpecificExtension = deps.getSpecificExtension;
	var buildDefaultAppsManagerDialog = deps.buildDefaultAppsManagerDialog;
	var openDialog = deps.openDialog;
	var renderOverlays = deps.renderOverlays;
	var navigateTo = deps.navigateTo;
	var refreshCurrentDir = deps.refreshCurrentDir;
	var report = deps.report;
	var guarded = deps.guarded;
	var readableActionName = deps.readableActionName;

	var manageDefaultAppsFromChooser = guarded(manageDefaultApps, readableActionName('manageDefaultApps'));

	function open (itemPath, forcedApp) {
		var item = getItemByPath(itemPath);
		if (!item) return;

		if (!forcedApp && previews(item)) {
			shell.previewScreensaver(item.path);
			return;
		}
		if (item.isDirectory) {
			if (forcedApp && forcedApp !== 'explorer') {
				shell.openPath(item.path, forcedApp);
				return;
			}
			navigateTo(item.path);
			return;
		}
		shell.openFile(item.path, forcedApp);
	}

	// Whether *Open* shows this one rather than opening it. The menu asks too, to call it *Preview*.
	function previews (item) {
		return isScreensaver(item) && typeof shell.previewScreensaver === 'function';
	}

	// Into a screensaver folder, which *Open* no longer does.
	function showContents (itemPath) {
		var item = getItemByPath(itemPath);
		if (item && item.isDirectory) {
			navigateTo(item.path);
		}
	}

	// An image or a screensaver, each through the shell's own entry for it.
	function setAsWallpaper (itemPath) {
		var item = getItemByPath(itemPath);
		if (!item) {
			return;
		}
		if (isScreensaver(item)) {
			return shell.setWallpaperPage(item.path);
		}
		return shell.setWallpaperImage(item.path);
	}

	// The shell says what it set, and when it will start: nothing on screen changes.
	function setAsScreensaver (itemPath) {
		var item = getItemByPath(itemPath);
		if (item && isScreensaver(item)) {
			return shell.setScreensaverPage(item.path);
		}
	}

	async function addToBookmarks (itemPath) {
		var item = getItemByPath(itemPath || Array.from(state.selectedPaths)[0]);
		if (!item || typeof shell.addBookmark !== 'function') {
			return;
		}
		// The shell reports what happened, including "already bookmarked", so there
		// is one surface for it rather than two that can disagree.
		await shell.addBookmark({
			title: item.name,
			url: item.path,
			// A trailing slash is what tells Bookmarks to open it with Explorer
			// rather than as a file. Explorer is the one that knows which it is.
			directory: item.isDirectory
		});
	}

	// The dialog itself is the shell's (js/shell/open-with.js), the same one a file
	// with no default app raises. Explorer used to draw its own, and the two came up
	// in nearly the same situation looking nothing alike -- only one of them knew
	// about the browser tab, and only one of them had keyboard picking. What stays
	// here is what only Explorer knows: that a folder can be navigated to in place,
	// and that several files can be opened at once.
	// `target` is a path when a row menu opened this, and the selection may still
	// override it -- several files at once are opened together. It is an *item* when
	// the caller already knows what it means and the selection is not it: the
	// empty-area menu acts on the folder you are looking at, and a file left
	// highlighted inside that folder must not quietly take its place.
	async function openWith (target) {
		var subject = (target && typeof target === 'object') ? target : null;
		var selectedFiles = subject ? [] : getSelectedItems().filter(function (entry) {
			return !entry.isDirectory;
		});
		var items;
		if (selectedFiles.length > 1) {
			items = selectedFiles;
		}
		else {
			var item = subject || getItemByPath(target || Array.from(state.selectedPaths)[0]);
			if (!item) {
				return;
			}
			items = [item];
		}

		if (typeof shell.openWithChooser !== 'function') {
			report('Open with needs PixOS', 'This window is not running inside the '
				+ 'PixOS shell, so there is nothing to list the apps.', 'warn');
			return;
		}

		var apps = await getOpenWithAppsForItems(items);
		var fileItems = items.filter(function (entry) { return !entry.isDirectory; });
		var extensions = fileItems.map(function (entry) {
			return getSpecificExtension(entry.path);
		}).filter(Boolean);
		var uniqueExtensions = extensions.filter(function (ext, index) {
			return extensions.indexOf(ext) === index;
		});
		// Only ever offered for one file: an association is one extension to one app,
		// and "remember this for all five of these" is not a thing it can express.
		// (Which also means the uniqueness filter above cannot change the answer today --
		// one file has at most one extension. It is what the rule would need if it widened.)
		var extension = (fileItems.length === 1 && uniqueExtensions.length === 1)
			? uniqueExtensions[0]
			: '';

		// The chooser promises never to be empty, and for one file it keeps that
		// promise itself — the browser tab and the plain window are always there.
		// For a folder, or for several files with nothing in common, there is
		// nothing universal to fall back on, so the empty case is answered here
		// instead of being shown as a dialog with no rows in it.
		var universal = items.length === 1 && !items[0].isDirectory;
		if (!apps.length && !universal) {
			report('Nothing can open all of these',
				items.length > 1
					? 'No installed app takes every one of the ' + items.length + ' files selected. '
						+ 'Try them one at a time.'
					: 'No installed app can open a folder.',
				'warn');
			return;
		}

		state.dialog = null;
		renderOverlays();

		var picked = await shell.openWithChooser({
			paths: items.map(function (entry) { return entry.path; }),
			apps: apps,
			extension: extension,
			title: items.length > 1
				? 'Open ' + items.length + ' files with...'
				: 'Open with...',
			subtitle: items.length === 1 ? items[0].path : items.length + ' files',
			// Neither route means anything for a folder, and for several files at
			// once they would each need a tab or a window of their own.
			universal: universal,
			extras: [
				{
					label: 'App Manager',
					run: function () {
						// An installed app, opened as one.
						if (typeof shell.openApp === 'function') {
							shell.openApp('app-manager');
						}
						else {
							shell.openFile('/apps/app-manager/index.html');
						}
					}
				},
				{
					label: 'Manage Defaults',
					run: function () {
						manageDefaultAppsFromChooser(extension);
					}
				}
			]
		});
		if (!picked) {
			return;
		}
		// Installing the app and remembering the choice already happened in the
		// shell; what is left is the opening, which is the part Explorer knows how
		// to do differently.
		if (picked.kind === shell.OPEN_WITH_BROWSER_TAB) {
			shell.openInBrowserTab(items[0].path);
			return;
		}
		if (picked.kind === shell.OPEN_WITH_RAW_WINDOW) {
			shell.openRawFile(items[0].path);
			return;
		}
		if (items[0].isDirectory && items.length === 1) {
			if (picked.appId === 'explorer') {
				// Navigating to the folder this window is already showing does
				// nothing, and a chooser entry that does nothing reads as broken.
				// Asked from inside it, *Explorer* means another one.
				if (items[0].path === state.cwd) {
					shell.openPath(items[0].path, 'new explorer');
				}
				else {
					navigateTo(items[0].path);
				}
			}
			else {
				shell.openPath(items[0].path, picked.appId);
			}
			return;
		}
		if (fileItems.length > 1 && typeof shell.openFiles === 'function') {
			shell.openFiles(fileItems.map(function (entry) {
				return entry.path;
			}), picked.appId);
			return;
		}
		if (fileItems.length === 1) {
			shell.openFile(fileItems[0].path, picked.appId);
		}
	}

	async function manageDefaultApps (prefillExtension) {
		openDialog(await buildDefaultAppsManagerDialog(prefillExtension));
	}

	// One folder at a time, on purpose: every extra root is another boundary to get
	// right, and the panel can only honestly report a list it can show.
	function shareWithPeers (dirPath) {
		try {
			shell.peers.share(dirPath);
			report('Sharing ' + getNameByPath(dirPath),
				'A connected peer can ask to open it, and you answer. They can read '
				+ 'everything in it and nothing outside it, and they cannot write.',
				'info', [{label: 'Show the Peers panel', run: function () { shell.peers.open(); }}]);
			refreshCurrentDir(false);
		}
		catch (err) {
			report('Could not share that folder', (err && err.message) || String(err));
		}
	}

	function stopSharing () {
		shell.peers.share(null);
		report('Stopped sharing', 'Anyone who had it open has been told, and their '
			+ 'copy of the folder is gone.', 'info');
		refreshCurrentDir(false);
	}

	return {
		open: open,
		previews: previews,
		showContents: showContents,
		setAsWallpaper: setAsWallpaper,
		setAsScreensaver: setAsScreensaver,
		openWith: openWith,
		manageDefaultApps: manageDefaultApps,
		addToBookmarks: addToBookmarks,
		shareWithPeers: shareWithPeers,
		stopSharing: stopSharing
	};
}
