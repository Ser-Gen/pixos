// What is *in* a context menu. `js/context-menu.js` is what draws one and where it goes;
// this is the four functions that decide what it holds, which is a different question and
// has always been a different kind of code -- no DOM at all, just an array of
// `{label, action, disabled, separator, submenu}` built from what is selected and what the
// shell can do.
//
// That is why this is worth its own file: the array is inspectable. A test can ask "is
// *Extract...* offered on a .txt" or "does a standalone Explorer still offer bookmarks"
// without a browser, and `tests/explorer-menus.test.mjs` checks that every action every menu
// names is really on the actions table -- an entry naming one that is not is a dead click
// with nothing in the console until somebody presses it.
//
// **`actions` is a parameter, and this module is built after it rather than with the others.**
// The entries that read `actions.copySelected` do it when the menu is built, not when it is
// clicked, so the table has to exist *and have been through the guard loop* by then. It is a
// table of functions this only reads; the context object is still `state` and `ui`.
//
// **Everything the shell owns is asked of the shell, never assumed.** Peers, bookmarks, the
// wallpaper and the screensaver all live out there, so each is offered only when `shell` is not
// `win` and the function is actually present -- a standalone Explorer shows a shorter menu rather
// than a menu of dead entries. A screensaver's first entry is *Preview* only where the shell can
// show one, which `previews` answers for this menu and for *Open* alike.

export function createMenuItems (deps) {
	var state = deps.state;
	var ui = deps.ui;
	var shell = deps.shell;
	var win = deps.win;
	var mountManager = deps.mountManager;
	var actions = deps.actions;
	var archiveNames = deps.archiveNames;
	var getSelectedItems = deps.getSelectedItems;
	var getItemByPath = deps.getItemByPath;
	var getCurrentFolderItem = deps.getCurrentFolderItem;
	var hasInternalClipboard = deps.hasInternalClipboard;
	var refreshCurrentDir = deps.refreshCurrentDir;
	var report = deps.report;
	var getNameByPath = deps.getNameByPath;
	var getNormalizedExtension = deps.getNormalizedExtension;
	var isImageExtension = deps.isImageExtension;
	var isScreensaver = deps.isScreensaver || function () { return false; };
	var previews = deps.previews || function () { return false; };
	// The chord printed beside a command that has one -- js/keys.js, written for this machine.
	var keyHint = deps.keyHint || function () { return ''; };

	// The shell owns the connection; this only asks who is on it. A submenu rather than a
	// dialog because the answer is a short list of names, and disabled with the reason
	// when it is empty -- an entry that opens an empty picker is the dead end this whole
	// pattern keeps having to undo.
	function sendToPeerMenu (filePath) {
		var connected = (shell !== win && shell.peers && shell.peers.list)
			? shell.peers.list()
			: null;
		if (!connected) {
			return {label: 'Send to peer', disabled: true};
		}
		if (!connected.length) {
			return {
				label: 'Send to peer — nobody connected',
				action: function () { shell.peers.open(); }
			};
		}
		return {
			label: 'Send to peer',
			submenu: connected.map(function (peer) {
				return {
					label: peer.name,
					action: function () {
						Promise.resolve(shell.peers.sendFile(peer.id, filePath)).then(function () {
							report('Offered ' + getNameByPath(filePath) + ' to ' + peer.name,
								'They have to accept it before anything is sent.', 'info');
						}, function (err) {
							report('Could not send ' + getNameByPath(filePath),
								(err && err.message) || String(err));
						});
					}
				};
			})
		};
	}

	// What double-click does, first: *Open*, or for a screensaver *Preview* -- and for a folder one,
	// *Show contents*, since opening it no longer goes in.
	function openEntries (item) {
		var open = {label: previews(item) ? 'Preview' : 'Open', hint: keyHint('open'), action: function () { actions.open(item.path); }};
		if (item.isDirectory && previews(item)) {
			return [open, {label: 'Show contents', action: function () { actions.showContents(item.path); }}];
		}
		return [open];
	}

	// The entries at the end that only the shell can carry out, for a file or a folder. They share
	// one separator, so a standalone Explorer does not end its menu with a rule and nothing after it.
	function shellEntries (item) {
		var entries = [];
		if (typeof shell.addBookmark === 'function') {
			entries.push({label: 'Add to bookmarks', action: function () {
				actions.addToBookmarks(item.path);
			}});
		}
		// The images are already here, so this is the natural place to set one as the wallpaper;
		// and the screensavers, so the place to set one as either.
		var image = !item.isDirectory && isImageExtension(item.path) && typeof shell.setWallpaperImage === 'function';
		var page = isScreensaver(item) && typeof shell.setWallpaperPage === 'function';
		if (image || page) {
			entries.push({label: 'Set as wallpaper', action: function () { actions.setAsWallpaper(item.path); }});
		}
		if (isScreensaver(item) && typeof shell.setScreensaverPage === 'function') {
			entries.push({label: 'Set as screensaver', action: function () { actions.setAsScreensaver(item.path); }});
		}
		return entries.length ? [{separator: true}].concat(entries) : [];
	}

	function getRowMenuItems (path) {
		var selected = getSelectedItems();
		if (selected.length > 1) {
			return getMultiMenuItems();
		}
		var item = getItemByPath(path);
		if (!item) return getEmptyAreaMenuItems();

		if (item.isDirectory) {
			var dirIsMountPoint = mountManager && mountManager.isMountPoint(item.path);
			var dirMenuItems = openEntries(item).concat([
				{label: 'Open in New Explorer', action: function () { actions.open(item.path, 'new explorer'); }},
				{label: 'Open with...', action: function () { actions.openWith(item.path); }},
				{separator: true},
				{label: 'Copy', hint: keyHint('copy'), action: actions.copySelected},
				{label: 'Cut', hint: keyHint('cut'), action: actions.cutSelected},
				{label: 'Copy path', action: function () { actions.copyPath(item.path); }},
				{label: 'Compress…', action: function () { actions.compress(item.path); }},
				{label: 'Paste into Folder', action: function () { actions.pasteClipboard(item.path); }, disabled: !hasInternalClipboard()},
				{separator: true},
				{label: 'Rename', action: function () { actions.rename(item.path); }},
				{label: 'Delete', hint: keyHint('delete'), action: function () { actions.deleteSelected(); }},
				{separator: true},
				{label: 'New', submenu: [
					{label: 'New File', action: actions.createFile},
					{label: 'New Folder', action: actions.createFolder},
					{label: 'Add Online File', action: actions.addOnlineFile}
				]}
			]);
			// The shell holds which folder is shared, because it is the shell that answers
			// when somebody asks to open it. Explorer only offers the folder.
			if (shell !== win && shell.peers && shell.peers.share) {
				var shared = shell.peers.getShare();
				dirMenuItems.push({separator: true});
				dirMenuItems.push(shared === item.path
					? {label: 'Stop sharing with peers', action: function () { actions.stopSharing(); }}
					: {label: 'Share with peers…', action: function () { actions.shareWithPeers(item.path); }});
			}
			dirMenuItems = dirMenuItems.concat(shellEntries(item));
			if (dirIsMountPoint) {
				dirMenuItems.push({separator: true});
				dirMenuItems.push({label: 'Unmount', action: function () { actions.umount(item.path); }});
			}
			return dirMenuItems;
		}

		var ext = getNormalizedExtension(item.path);
		var mountableExts = ['zip', 'iso'];
		var isMountable = mountableExts.indexOf(ext) !== -1;
		var isMountPoint = mountManager && mountManager.isMountPoint(item.path);

		var fileMenuItems = openEntries(item).concat([
			{label: 'Open with...', action: function () { actions.openWith(item.path); }},
			{separator: true},
			{label: 'Copy', hint: keyHint('copy'), action: actions.copySelected},
			{label: 'Cut', hint: keyHint('cut'), action: actions.cutSelected},
			{label: 'Copy path', action: function () { actions.copyPath(item.path); }},
			// Top level rather than in Tools, unlike *Extract…*: compressing applies to
			// anything, extracting only to an archive.
			{label: 'Compress…', action: function () { actions.compress(item.path); }},
			sendToPeerMenu(item.path),
			{label: 'Rename', action: function () { actions.rename(item.path); }},
			{label: 'Download', action: actions.downloadSelected},
			{label: 'Delete', hint: keyHint('delete'), action: actions.deleteSelected},
			{separator: true},
			{label: 'Tools', submenu: [
				{label: 'Get SHA1', action: actions.getHashSHA1},
				// One entry for every format 7-Zip reads, and disabled when the name is
				// not one of them -- an *Extract* that opens a dialog to say "this is not
				// an archive" is a worse answer than an entry you can see is not for this
				// file. The name is a hint, not the truth, so the engine still checks.
				{label: 'Extract…', action: function () { actions.extract(item.path); },
					disabled: !archiveNames.isArchiveName(item.name)},
				{label: 'Mount as filesystem', action: function () { actions.mountArchive(item.path); }, disabled: !isMountable},
				{label: 'FFmpeg', action: actions.ffmpeg},
				{label: state.recording ? 'Stop Screen Recording' : 'Screen Recording', action: state.recording ? actions.stopScreenRecording : actions.startScreenRecording}
			]}
		]);

		return fileMenuItems.concat(shellEntries(item));
	}

	function getMultiMenuItems () {
		var selected = getSelectedItems();
		var allFiles = selected.length > 0 && selected.every(function (item) {
			return !item.isDirectory;
		});
		var items = [];
		if (allFiles) {
			items.push(
				{label: 'Open with...', action: function () { actions.openWith(); }},
				{separator: true}
			);
		}
		items.push(
			{label: 'Copy selected', hint: keyHint('copy'), action: actions.copySelected},
			{label: 'Cut selected', hint: keyHint('cut'), action: actions.cutSelected},
			{label: 'Copy paths', action: function () { actions.copyPath(); }},
			{label: 'Compress…', action: function () { actions.compress(); }},
			{separator: true},
			{label: 'Delete selected', hint: keyHint('delete'), action: actions.deleteSelected},
			{label: 'Download selected', action: actions.downloadSelected},
			{separator: true},
			{label: 'Tools for selected', submenu: [
				{label: 'Get SHA1', action: actions.getHashSHA1},
				{label: 'Extract all', action: actions.extractSelected},
				{label: 'FFmpeg', action: actions.ffmpeg},
				{label: state.recording ? 'Stop Screen Recording' : 'Screen Recording', action: state.recording ? actions.stopScreenRecording : actions.startScreenRecording}
			]}
		);
		return items;
	}

	function getEmptyAreaMenuItems () {
		return [
			// No row under the pointer, so this entry has to name what it acts on. It is
			// also the only way to reach *Open with...* for the folder you are inside --
			// otherwise you have to go up a level to right-click it.
			{label: 'Open this folder with...', action: function () { actions.openWith(getCurrentFolderItem()); }},
			{separator: true},
			{label: 'New File', action: actions.createFile},
			{label: 'New Folder', action: actions.createFolder},
			{label: 'Add Online File', action: actions.addOnlineFile},
			{separator: true},
			{label: 'Upload', action: function () { ui.fileInput.click(); }},
			{label: 'Paste', hint: keyHint('paste'), action: actions.pasteClipboard, disabled: !hasInternalClipboard()},
			{label: 'Refresh', action: function () { refreshCurrentDir(false); }},
			{separator: true},
			// Tools was a submenu while it held Share as well. One entry behind a submenu
			// is a click spent on nothing, so it is a plain entry until there is a second.
			{label: state.recording ? 'Stop Screen Recording' : 'Screen Recording', action: state.recording ? actions.stopScreenRecording : actions.startScreenRecording}
		];
	}

	return {
		sendToPeerMenu: sendToPeerMenu,
		getRowMenuItems: getRowMenuItems,
		getMultiMenuItems: getMultiMenuItems,
		getEmptyAreaMenuItems: getEmptyAreaMenuItems
	};
}
