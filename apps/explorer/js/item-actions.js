// What *New*, *Rename*, *Delete*, *Download* and *Get SHA1* do: the actions that make, change or
// read one item at a time, as opposed to js/file-ops.js, which is how any of them puts a file
// somewhere.
//
// Almost all of them open a dialog and do their work in its `onSubmit`, which runs long after the
// action itself has returned. That is why none of them catches anything: js/dialogs.js wraps every
// `on*` callback in the same guard the action table gets, and **the errno translation lives
// there, one level up**. The two `catch (err) { throw err; }` blocks below are not dead code by
// accident -- each marks a place where a hand-built dialog used to put a raw "ENOENT: No such file
// or directory." on screen, and says so, so that nobody puts one back.
//
// The rules here are about what an ordinary outcome looks like, because each of these used to
// treat one as nothing happening:
//
//   * **A name that is taken is a question, asked before the write.** Neither `mkdir` nor
//     `fsRename` handles it usefully -- the first throws, the second silently replaces what is
//     there -- so *New Folder* and *Rename* both ask js/file-ops.js's `resolveIncomingDestination`
//     first, the same question a paste asks. `true` for a folder greys out *Replace*.
//   * **Renaming to the same name closes the dialog**, exactly as Cancel would. Left open, the
//     button looked dead.
//   * **A URL that 404s or is refused by CORS is reported**, not closed on. Both are what typing a
//     URL ordinarily produces.
//   * **A delete clears the selection only once the files are gone.** A refused unlink leaves the
//     rows selected, which is what they still are.
//
// The platform is `win` -- `File`, `Blob`, `fetch`, `crypto` -- and each is called *on* it,
// `win.fetch(url)` rather than a copy of `win.fetch`: a detached `fetch` throws "Illegal
// invocation" in a browser and works perfectly in node, which is the worst kind of difference for
// a test to be unable to see. The fake in the test refuses a call whose `this` is not the window.

export function createItemActions (deps) {

	var state = deps.state;
	var path = deps.path;
	var Buffer = deps.Buffer;
	var win = deps.win;
	var getItemByPath = deps.getItemByPath;
	var getSelectedItems = deps.getSelectedItems;
	var getNameByPath = deps.getNameByPath;
	var openDialog = deps.openDialog;
	var openInfoDialog = deps.openInfoDialog;
	var renderOverlays = deps.renderOverlays;
	var resolveIncomingDestination = deps.resolveIncomingDestination;
	var writeNewFile = deps.writeNewFile;
	var mkdir = deps.mkdir;
	var unlink = deps.unlink;
	var fsRename = deps.fsRename;
	var readFile = deps.readFile;
	var downloadBlob = deps.downloadBlob;
	var reportFetchFailure = deps.reportFetchFailure;
	var refreshCurrentDir = deps.refreshCurrentDir;

	function createFile () {
		openDialog({
			type: 'newFile',
			onSubmit: async function (payload) {
				state.dialog = null;
				renderOverlays();
				var ab = await new win.File([payload.content || ''], payload.name).arrayBuffer();
				await writeNewFile(state.cwd, payload.name, Buffer.from(ab));
				await refreshCurrentDir(false);
			}
		});
	}

	function createFolder () {
		openDialog({
			type: 'newFolder',
			onSubmit: async function (name) {
				state.dialog = null;
				renderOverlays();
				// mkdir on an existing name is an error rather than a silent no-op, and an
				// unhandled one looked like the button doing nothing. It used to report a card
				// saying the name was taken -- which told you what was wrong and then left you to
				// do something about it. Renaming onto a taken name asks instead, and so does
				// pasting onto one, so this asks too, through the same dialog. `true` for
				// sourceIsDirectory is what greys out *Replace*: replacing a folder would mean
				// deleting whatever is inside it, which is not a thing one click should do.
				var resolvedNew = await resolveIncomingDestination(name, state.cwd, 'create folder', true);
				if (!resolvedNew) {
					return;
				}
				await mkdir(resolvedNew.destPath);
				await refreshCurrentDir(false);
			}
		});
	}

	function addOnlineFile () {
		openDialog({
			type: 'onlineFile',
			onSubmit: async function (payload) {
				state.dialog = null;
				renderOverlays();

				// The original had no catch and never checked response.ok, so a 404 or a
				// CORS block closed the dialog and did nothing whatsoever. Both are the
				// ordinary outcomes of typing a URL, not exceptional ones.
				var response;
				try {
					response = await win.fetch(payload.url);
				}
				catch (err) {
					reportFetchFailure(payload.url, {error: err});
					return;
				}
				if (!response.ok) {
					reportFetchFailure(payload.url, {response: response});
					return;
				}

				var ab = await response.arrayBuffer();
				var name = payload.name || getNameByPath(decodeURIComponent(payload.url));
				await writeNewFile(state.cwd, name, Buffer.from(ab));
				await refreshCurrentDir(false);
			}
		});
	}

	function rename (itemPath) {
		var item = getItemByPath(itemPath || Array.from(state.selectedPaths)[0]);
		if (!item) return;
		openDialog({
			type: 'rename',
			oldName: item.name,
			onSubmit: async function (newName) {
				// The same name is a no-op, not an error -- close, exactly as Cancel
				// would. Leaving the dialog up made it look like the button was dead.
				if (!newName || newName === item.name) {
					state.dialog = null;
					renderOverlays();
					return;
				}
				state.dialog = null;
				renderOverlays();
				try {
					// fsRename does not fail on an occupied name, it replaces what is
					// there -- so renaming onto an existing file used to destroy it
					// silently. There is no error to catch; the question has to be
					// asked first, the same one a paste asks.
					var resolved = await resolveIncomingDestination(
						newName, path.dirname(item.path), 'rename', item.isDirectory);
					if (!resolved) {
						return;
					}
					if (resolved.replaceExisting) {
						await unlink(resolved.destPath);
					}
					await fsRename(item.path, resolved.destPath);
				}
				catch (err) {
					// Thrown straight to the action wrapper, which translates the errno
					// and raises a notification. Catching it here to build a dialog by
					// hand is what put a raw "ENOENT: No such file or directory." on
					// screen -- the errno translation lives one level up.
					throw err;
				}
				await refreshCurrentDir(false);
			}
		});
	}

	function deleteSelected () {
		var targets = getSelectedItems();
		if (!targets.length) return;
		openDialog({
			type: 'confirmDelete',
			items: targets,
			onSubmit: async function () {
				state.dialog = null;
				renderOverlays();
				try {
					await Promise.all(targets.map(function (item) {
						return unlink(item.path);
					}));
				}
				catch (err) {
					// Same reasoning as rename: the wrapper translates and reports.
					throw err;
				}
				state.selectedPaths = new Set();
				await refreshCurrentDir(false);
			}
		});
	}

	async function downloadSelected () {
		var targets = getSelectedItems().filter(function (item) { return !item.isDirectory; });
		await Promise.all(targets.map(async function (item) {
			var contents = await readFile(item.path);
			downloadBlob(new win.Blob([contents]), item.name);
		}));
	}

	async function getHashSHA1 () {
		var targets = getSelectedItems().filter(function (item) { return !item.isDirectory; });
		if (!targets.length) return;
		var lines = [];
		for (var i = 0; i < targets.length; i++) {
			var contents = await readFile(targets[i].path);
			var hashBuffer = await win.crypto.subtle.digest('SHA-1', contents);
			var hashArray = Array.from(new Uint8Array(hashBuffer));
			var hashHex = hashArray.map(function (b) {
				return b.toString(16).padStart(2, '0');
			}).join('');
			lines.push(targets[i].name + ': ' + hashHex);
		}
		openInfoDialog('SHA1', lines.join('\n'));
	}

	return {
		createFile: createFile,
		createFolder: createFolder,
		addOnlineFile: addOnlineFile,
		rename: rename,
		deleteSelected: deleteSelected,
		downloadSelected: downloadSelected,
		getHashSHA1: getHashSHA1
	};
}
