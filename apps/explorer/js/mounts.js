// Explorer's half of `js/mount-manager.js`: the four things a person can do to a mount, the two
// things they can do to one the shell could not bring back after a reload (`reconnectMount`,
// `forgetMount` -- the table itself is `js/shell/mount-table.js`), and the one piece of
// configuration any of them remembers.
//
// The mount manager owns what a mount *is*. This owns what asking for one looks like -- which
// dialog, what a refusal says, and what happens to the window afterwards, which is always the
// same two steps in the same order: redraw the sidebar, then go there. Getting that backwards
// navigates into a mount point the sidebar has not heard of yet.
//
// `state` is the context object and `ui` is not needed at all -- nothing in here draws. The
// platform comes off `win` (localStorage, location, URL, the directory picker) and the
// directory picker is asked of the *shell* first, because Explorer runs in an iframe and the
// File System Access API refuses one that is not the top document in some browsers.
//
// **The two timers are parameters**, on the same rule as js/dnd.js: mounting a native folder
// starts a ten-second watch for a read that never answers, and a test that had to wait ten
// real seconds for it would be a test nobody runs.
//
// `renderSidebar` arrives late-bound, and that is a cycle rather than an oversight: the sidebar
// draws the mounts, and the mount actions redraw the sidebar. It cannot be built before this
// module either, because it reads `actions.umount` -- the *guarded* one, off the table that is
// built from what this module returns.

export function createMounts (deps) {

	var state = deps.state;
	var fs = deps.fs;
	var path = deps.path;
	var shell = deps.shell;
	var win = deps.win;
	var mountManager = deps.mountManager;
	var normalizePath = deps.normalizePath;
	var getItemByPath = deps.getItemByPath;
	var getNormalizedExtension = deps.getNormalizedExtension;
	var openDialog = deps.openDialog;
	var openInfoDialog = deps.openInfoDialog;
	var report = deps.report;
	var reportFailure = deps.reportFailure;
	var renderOverlays = deps.renderOverlays;
	var renderSidebar = deps.renderSidebar;
	var navigateTo = deps.navigateTo;
	var refreshCurrentDir = deps.refreshCurrentDir;
	var setTimer = deps.setTimer;
	var clearTimer = deps.clearTimer;

	async function mountArchive (itemPath) {
		if (!mountManager) {
			openInfoDialog('Mount', 'Mount manager is not available');
			return;
		}
		var item = getItemByPath(itemPath || Array.from(state.selectedPaths)[0]);
		if (!item || item.isDirectory) return;
		var ext = getNormalizedExtension(item.path);
		var defaultMp = mountManager.suggestMountPoint(path.basename(item.path));
		openDialog({
			type: 'prompt',
			title: 'Mount ' + ext.toUpperCase(),
			message: 'Mount point path:',
			defaultValue: defaultMp,
			onSubmit: async function (mountPoint) {
				state.dialog = null;
				renderOverlays();
				if (!mountPoint) return;
				try {
					var cb = function (err) {
						if (err) {
							reportFailure('Could not mount ' + item.name, err);
						} else {
							renderSidebar();
							navigateTo(mountPoint);
						}
					};
					// By path, not by bytes: the mount manager reads the file itself and keeps the
					// path, which is what lets the shell mount it again after a reload.
					if (ext === 'zip') {
						mountManager.mountZipFile(item.path, mountPoint, path.basename(item.path), cb);
					} else if (ext === 'iso') {
						mountManager.mountIsoFile(item.path, mountPoint, path.basename(item.path), cb);
					} else {
						openInfoDialog('Mount', 'Unsupported format: ' + ext);
					}
				} catch (e) {
					reportFailure('Could not mount ' + item.name, e);
				}
			}
		});
	}

	async function mountNativeDir () {
		if (!mountManager) {
			openInfoDialog('Mount', 'Mount manager is not available');
			return;
		}
		var pickDir = (shell && typeof shell.pickNativeDirectory === 'function')
			? shell.pickNativeDirectory.bind(shell)
			: (typeof win.showDirectoryPicker === 'function' ? function () { return win.showDirectoryPicker(); } : null);
		if (!pickDir) {
			openInfoDialog('Mount', 'File System Access API is not supported in this browser');
			return;
		}
		try {
			var handle = await pickDir();
			var name = handle.name || 'local';
			var defaultMp = mountManager.suggestMountPoint(name);
			openDialog({
				type: 'prompt',
				title: 'Mount Local Folder',
				message: 'Mount point path:',
				defaultValue: defaultMp,
				onSubmit: function (mountPoint) {
					state.dialog = null;
					renderOverlays();
					if (!mountPoint) return;
					mountPoint = normalizePath(mountPoint);
					mountManager.mountNativeDir(handle, mountPoint, name, function (err) {
						if (err) {
							reportFailure('Could not mount ' + name, err);
							return;
						}
						renderSidebar();
						var readDone = false;
						var readTimer = setTimer(function () {
							if (readDone) return;
							readDone = true;
							report('Mounted, but slow to read',
								mountPoint + ' is mounted, but reading it timed out. Open it from the '
								+ 'Mounts sidebar when it responds.', 'warn');
						}, 10000);
						fs.readdir(mountPoint, function (readErr) {
							if (readDone) return;
							readDone = true;
							clearTimer(readTimer);
							if (readErr) {
								reportFailure('Mounted ' + mountPoint + ', but cannot read it', readErr);
								return;
							}
							navigateTo(mountPoint);
						});
					});
				}
			});
		} catch (e) {
			// Picking no folder is not a failure; the browser reports it as one.
			if (e.name !== 'AbortError') {
				reportFailure('Could not mount that folder', e);
			}
		}
	}

	function mountFiles3 () {
		if (!mountManager) {
			openInfoDialog('Mount Files3', 'Mount manager is not available');
			return;
		}
		var saved = loadFiles3Config();
		var defaultBaseUrl = saved ? saved.baseUrl : '';
		var defaultRootFolderId = saved ? saved.rootFolderId : '';
		var defaultLocalStorageId = saved ? saved.localStorageId : defaultFiles3LocalStorageId(defaultBaseUrl);
		var defaultMountPoint = mountManager.suggestMountPoint('files3_' + (defaultRootFolderId || 'storage'));
		openDialog({
			type: 'files3Mount',
			baseUrl: defaultBaseUrl,
			rootFolderId: defaultRootFolderId,
			localStorageId: defaultLocalStorageId,
			mountPoint: defaultMountPoint,
			onSubmit: function (fields) {
				state.dialog = null;
				renderOverlays();

				var baseUrl = fields.baseUrl;
				var rootFolderId = parseInt(fields.rootFolderId, 10);
				var localStorageId = fields.localStorageId;
				var mountPoint = fields.mountPoint;

				if (!baseUrl) {
					openInfoDialog('Mount Files3', 'Base URL API is required');
					return;
				}
				if (!rootFolderId || rootFolderId < 1) {
					openInfoDialog('Mount Files3', 'Root Folder ID must be a positive number');
					return;
				}
				if (!localStorageId) {
					openInfoDialog('Mount Files3', 'localStorage ID is required');
					return;
				}
				if (!mountPoint || mountPoint.charAt(0) !== '/') {
					openInfoDialog('Mount Files3', 'Mount point must start with /');
					return;
				}

				saveFiles3Config({
					baseUrl: baseUrl,
					rootFolderId: rootFolderId,
					localStorageId: localStorageId
				});

				var callbackUrl = win.location.origin + win.location.pathname;
				var displayName = 'Files3';
				try {
					displayName = new win.URL(baseUrl).hostname || displayName;
				} catch (e) { /* ignore */ }

				mountManager.mountFiles3({
					baseUrl: baseUrl,
					rootFolderId: rootFolderId,
					localStorageId: localStorageId,
					callbackUrl: callbackUrl,
					onUnauthorized: function (mp) {
						report('Files3 session expired', 'The session for ' + mp + ' has expired. Mount it again.', 'warn');
					}
				}, mountPoint, displayName, function (err) {
					if (err) {
						var msg = err.message || String(err);
						if (msg === 'Auth window closed without token.') {
							openInfoDialog('Mount Files3', 'Authorization window was closed without completing login.');
						} else if (msg.indexOf('Popup blocked') === 0) {
							openInfoDialog('Mount Files3', msg + ' Allow popups for this site and try again.');
						} else {
							report('Could not mount Files3', msg);
						}
					} else {
						renderSidebar();
						navigateTo(mountPoint);
					}
				});
			}
		});
	}

	function umount (mountPoint) {
		if (!mountManager) return;
		try {
			mountManager.umount(mountPoint);
			renderSidebar();
			if (state.cwd.indexOf(mountPoint) === 0) {
				navigateTo('/');
			} else {
				refreshCurrentDir(false);
			}
		} catch (e) {
			reportFailure('Could not unmount that', e);
		}
	}

	// A mount the shell could not bring back after a reload, clicked in the sidebar. The shell's
	// `mountTable.reconnect` asks the browser for permission *first*, before anything is awaited,
	// and this click is the gesture that lets it -- which is why nothing here may come before the
	// call. What it answers with is where the window goes.
	function reconnectMount (mountPoint) {
		var table = shell && shell.mountTable;
		if (!table) return;
		return Promise.resolve(table.reconnect(mountPoint)).then(function (result) {
			renderSidebar();
			if (result && result.mounted) {
				navigateTo(mountPoint);
			} else if (result && result.error) {
				reportFailure('Could not reconnect ' + mountPoint, result.error);
			}
		});
	}

	function forgetMount (mountPoint) {
		var table = shell && shell.mountTable;
		if (!table) return;
		table.forget(mountPoint);
		renderSidebar();
	}

	// **Written twice on purpose, and the other copy is not in a module.** Files3 authorises in
	// a popup that redirects back to this page with `?token=`, and the script that catches it has
	// to run at parse time, before any module has loaded -- so the first `<script>` in
	// index.html carries its own copy of this key and of the rule below for deriving a storage id
	// from a host. Change either here and that copy has to change with it;
	// `tests/explorer-mounts.test.mjs` is what says so out loud.
	var FILES3_CONFIG_KEY = 'pixos_files3_config';

	function loadFiles3Config () {
		try {
			var raw = win.localStorage.getItem(FILES3_CONFIG_KEY);
			if (raw) {
				return JSON.parse(raw);
			}
		} catch (e) { /* ignore */ }
		return null;
	}

	function saveFiles3Config (cfg) {
		win.localStorage.setItem(FILES3_CONFIG_KEY, JSON.stringify(cfg));
	}

	function defaultFiles3LocalStorageId (baseUrl) {
		try {
			var host = new win.URL(baseUrl).hostname.replace(/[^a-zA-Z0-9_\-]/g, '_');
			return 'files3_token_' + (host || 'storage');
		} catch (e) {
			return 'files3_token_storage';
		}
	}

	return {
		mountArchive: mountArchive,
		mountNativeDir: mountNativeDir,
		mountFiles3: mountFiles3,
		umount: umount,
		reconnectMount: reconnectMount,
		forgetMount: forgetMount,
		loadFiles3Config: loadFiles3Config,
		saveFiles3Config: saveFiles3Config,
		defaultFiles3LocalStorageId: defaultFiles3LocalStorageId
	};
}
