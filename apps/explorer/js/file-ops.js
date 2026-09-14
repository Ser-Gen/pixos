// Everything that puts a file somewhere, lifted out of openExplorer by phase 21: moving and
// copying paths between folders, writing a File that arrived from outside, and the one question
// all of them ask when the name is already taken.
//
// Three rules in here are load-bearing and none of them is obvious from the call sites.
// **The conflict question is asked before the write, never after**, because neither underlying
// call refuses an occupied name -- `writeFile` overwrites and `fsRename` replaces POSIX-style --
// so there is no error to catch and nothing left to undo. **A replacement is staged**: the new
// bytes go to a temporary name in the same folder and only take the destination once they are
// actually stored, because a write that fails halfway used to take the old file with it.
// And **a failure is per item**, so one refusal does not abandon the rest of a selection.
//
// `state` is the context object, by reference; `shell` is the parent window when Explorer runs
// inside PixOS and is the same object as `win` when it does not. Everything else is named,
// including every filesystem call -- which is what lets a test drive a whole paste, conflict
// dialog and all, against a filesystem that is a Map.

export function createFileOps (deps) {
	var state = deps.state;
	var path = deps.path;
	var Buffer = deps.Buffer;
	var shell = deps.shell;
	var win = deps.win;
	var normalizePath = deps.normalizePath;
	var splitNameAndExtension = deps.splitNameAndExtension;
	var stat = deps.stat;
	var readFile = deps.readFile;
	var writeFile = deps.writeFile;
	var readdir = deps.readdir;
	var ensureDir = deps.ensureDir;
	var fsRename = deps.fsRename;
	var unlink = deps.unlink;
	var unlinkFile = deps.unlinkFile;
	var fileToAB = deps.fileToAB;
	var report = deps.report;
	var reportFailure = deps.reportFailure;
	var openDialog = deps.openDialog;
	var renderOverlays = deps.renderOverlays;
	var refreshCurrentDir = deps.refreshCurrentDir;

	async function moveItemsToFolder (srcPaths, targetFolderPath, meta) {
		if (!srcPaths || !srcPaths.length) return;
		var moved = 0;
		for (var i = 0; i < srcPaths.length; i++) {
			var src = normalizePath(srcPaths[i]);
			var base = path.basename(src);
			var dest = path.join(targetFolderPath, base);
			// Three guards, and the third overlaps the first: a file already in the target
			// folder has `src === dest` too, so it is belt-and-braces rather than a case of
			// its own. The middle one is the one that matters most -- a folder dropped into
			// its own descendant is a tree moved inside itself, and fsRename does it without
			// a word of complaint.
			if (src === targetFolderPath || src === dest) continue;
			if (targetFolderPath.indexOf(src + '/') === 0) continue;
			if (path.dirname(src) === targetFolderPath) continue;
			try {
				var resolvedMove = await resolvePasteDestination(src, targetFolderPath, 'move');
				if (!resolvedMove) continue;
				dest = resolvedMove.destPath;
				if (resolvedMove.replaceExisting) {
					await unlink(dest);
				}
				await fsRename(src, dest);
				moved++;
			}
			catch (err) {
				// Per item, so one refusal does not abandon the rest of the selection.
				reportFailure('Could not move ' + base, err);
			}
		}
		if (moved > 0) {
			await refreshCurrentDir(false);
		}
	}

	async function copyItemsToFolder (srcPaths, targetFolderPath) {
		if (!srcPaths || !srcPaths.length) return;
		var copied = 0;
		for (var i = 0; i < srcPaths.length; i++) {
			var src = normalizePath(srcPaths[i]);
			var base = path.basename(src);
			var dest = path.join(targetFolderPath, base);
			if (src === targetFolderPath || src === dest) continue;
			if (targetFolderPath.indexOf(src + '/') === 0) continue;
			try {
				var resolvedCopy = await resolvePasteDestination(src, targetFolderPath, 'copy');
				if (!resolvedCopy) continue;
				dest = resolvedCopy.destPath;
				if (resolvedCopy.replaceExisting) {
					await unlink(dest);
				}
				await copyEntryRecursive(src, dest);
				copied++;
			}
			catch (err) {
				reportFailure('Could not copy ' + base, err);
			}
		}
		if (copied > 0) {
			await refreshCurrentDir(false);
		}
	}

	async function copyEntryRecursive (srcPath, destPath) {
		var srcStat = await stat(srcPath);
		if (!srcStat) {
			throw new Error('Source not found');
		}
		if (srcStat.isDirectory()) {
			await ensureDir(destPath);
			var children = await readdir(srcPath);
			for (var i = 0; i < children.length; i++) {
				await copyEntryRecursive(path.join(srcPath, children[i]), path.join(destPath, children[i]));
			}
			return;
		}
		var content = await readFile(srcPath);
		await writeFile(destPath, Buffer.from(content));
	}

	// Two things arrive in a folder: a path being copied or moved, and a File with no path
	// of its own -- dropped, pasted from the clipboard, or picked with Upload. Both ask the
	// same question when the name is taken, so both go through here. Returns null when the
	// answer is "cancel".
	async function resolveIncomingDestination (name, targetFolderPath, operation, sourceIsDirectory) {
		var destPath = path.join(targetFolderPath, name);
		var existing = await stat(destPath);
		if (!existing) {
			return {
				destPath: destPath,
				replaceExisting: false
			};
		}

		// A directory is never replaced by one command, in either direction.
		var canReplace = !sourceIsDirectory && !existing.isDirectory();
		var decision = await askPasteConflict({
			name: name,
			targetFolderPath: targetFolderPath,
			canReplace: canReplace,
			existingIsDirectory: existing.isDirectory(),
			operation: operation
		});

		if (decision === 'cancel') {
			return null;
		}

		if (decision === 'replace') {
			return {
				destPath: destPath,
				replaceExisting: true
			};
		}

		return {
			destPath: await buildIndexedCopyPath(targetFolderPath, name),
			replaceExisting: false
		};
	}

	// A dropped folder reaches this module one call per file, each carrying a path relative to
	// the drag rather than a name -- so the question `resolveIncomingDestination` asks would be
	// asked once per file, a few hundred times for a folder worth dropping. It belongs to the
	// **root**, and this is where it is asked: once per top-level folder in the drop, before
	// anything is written. Answer "keep both" and the root resolves to a name nothing is using,
	// which is also why no file below it can collide with anything afterwards.
	//
	// Returns a map from the name the drag carries to the name to write under, with null for a
	// root the answer was "cancel" on.
	async function resolveIncomingRoots (rootNames, targetFolderPath) {
		var mapping = {};
		for (var i = 0; i < rootNames.length; i++) {
			var name = rootNames[i];
			if (!name || Object.prototype.hasOwnProperty.call(mapping, name)) {
				continue;
			}
			// `true`: the source is a folder, so the dialog offers keep-both or cancel and never
			// replace -- the same answer set an internal drag of a folder gets, which is the
			// whole point of asking here.
			var resolved = await resolveIncomingDestination(name, targetFolderPath, 'copy', true);
			mapping[name] = resolved ? path.basename(resolved.destPath) : null;
		}
		return mapping;
	}

	// The path a dragged entry carries is rooted at the drag and starts with a slash:
	// "/wii-game/box.iso" for a file inside a dropped folder, "/notes.txt" for one dropped on
	// its own beside it. Two things happen here.
	//
	// **The leading slash goes.** `onFileHandler` tells a loose file from a folder's contents by
	// looking for a slash, and that leading one made every top-level file look like folder
	// contents -- so a file dropped alongside a folder skipped the conflict question and
	// overwrote whatever had its name. Only files dropped *with* a folder, which is why it took
	// this long to notice.
	//
	// **The first segment follows the root's answer**: renamed if the root was kept alongside an
	// existing one, and null -- write nothing -- if the root was cancelled.
	function rerootIncomingPath (fullPath, rootMapping) {
		var relative = String(fullPath || '').replace(/^\/+/, '');
		if (!relative) {
			return null;
		}
		var slash = relative.indexOf('/');
		// Says what it means rather than earning its keep: with no slash the two lines below
		// take `relative.slice(0, -1)` as the root, which is the name minus its last letter and
		// is never a key in the mapping, so the path comes back unchanged either way. Removing
		// it breaks nothing and no test catches that -- which is worth saying out loud, the way
		// the third guard in `moveItemsToFolder` is.
		if (slash === -1) {
			return relative;
		}
		var root = relative.slice(0, slash);
		if (!rootMapping || !Object.prototype.hasOwnProperty.call(rootMapping, root)) {
			return relative;
		}
		if (!rootMapping[root]) {
			return null;
		}
		return rootMapping[root] + relative.slice(slash);
	}

	// Every route that produces a new file in a folder ends here: create, download, extract,
	// convert, drop, paste, upload. Both of the underlying calls replace their destination
	// without complaint -- writeFile overwrites, and fsRename replaces POSIX-style -- so
	// there is no error to catch and the check has to happen before the write.
	//
	// Returns the path actually written, or null if the answer was "cancel".
	async function writeNewFile (folderPath, name, contents, operation) {
		var resolved = await resolveIncomingDestination(name, folderPath, operation || 'copy', false);
		if (!resolved) {
			return null;
		}
		await writeIncomingFile(resolved.destPath, contents, resolved.replaceExisting);
		return resolved.destPath;
	}

	// A file arriving from outside -- dropped, pasted, uploaded, recorded -- and the two
	// things that must not happen when the write fails halfway.
	//
	// **Nothing is left behind.** BrowserFS commits the inode before it stores the data,
	// so a refused write leaves a file of the right name and zero bytes sitting there
	// looking like it worked. That is what a 150 MB drop produced.
	//
	// **Replacing writes somewhere else first.** This used to delete the existing file and
	// then write over the name, so a write that failed took the old file with it and left
	// the empty one in its place. The new bytes go to a temporary name in the same folder
	// and only replace anything once they are actually stored.
	async function writeIncomingFile (destPath, contents, replaceExisting) {
		if (!replaceExisting) {
			try {
				await writeFile(destPath, contents);
			}
			catch (err) {
				await unlinkQuietly(destPath);
				throw err;
			}
			return destPath;
		}
		var staging = destPath + '.pixos-part';
		try {
			await writeFile(staging, contents);
		}
		catch (err) {
			await unlinkQuietly(staging);
			throw err;
		}
		await unlink(destPath);
		await fsRename(staging, destPath);
		return destPath;
	}

	// Used only to clean up after a failure, where a second failure is not news: the error
	// worth reporting is the one that got us here.
	async function unlinkQuietly (p) {
		try {
			await unlinkFile(p);
		}
		catch (err) {
			// It was never created, or it cannot be removed either. Either way the write
			// is what failed.
		}
	}

	async function resolvePasteDestination (srcPath, targetFolderPath, operation) {
		var sourceStat = await stat(srcPath);
		return resolveIncomingDestination(
			path.basename(srcPath),
			targetFolderPath,
			operation,
			!!(sourceStat && sourceStat.isDirectory())
		);
	}

	function askPasteConflict (payload) {
		return new Promise(function (resolve) {
			openDialog({
				type: 'pasteConflict',
				canReplace: payload.canReplace,
				// It used to say "A file named" whatever was in the way. Now that creating a
				// folder comes through here too, the commonest collision is one folder with
				// another, and calling that a file is the kind of small wrongness that makes
				// somebody doubt the rest of the sentence.
				message: (payload.existingIsDirectory ? 'A folder named "' : 'A file named "')
					+ payload.name + '" already exists in ' + payload.targetFolderPath + '.',
				onSubmit: function (decision) {
					state.dialog = null;
					renderOverlays();
					resolve(decision);
				}
			});
		});
	}

	async function buildIndexedCopyPath (folderPath, fileName) {
		var parsed = splitNameAndExtension(fileName);
		var index = 1;
		var candidate = '';
		do {
			candidate = path.join(folderPath, parsed.name + '-' + index + parsed.ext);
			index++;
		} while (await stat(candidate));
		return candidate;
	}
	// Asked before the file is read, not after the write fails. BrowserFS reports every
	// refusal from IndexedDB as a bare `EIO` with the real reason already discarded, so
	// afterwards there is nothing left to explain with -- and a 150 MB file that cannot be
	// stored should not be pulled into memory first to find that out.
	async function refuseOversizedFile (file) {
		var size = file && typeof file.size === 'number' ? file.size : 0;
		if (!size) {
			return false;
		}
		var limit = null;
		try {
			if (shell !== win && typeof shell.describeWriteLimit === 'function') {
				limit = await shell.describeWriteLimit(size);
			}
		}
		catch (crossOrigin) {
			// Running standalone. The write will be attempted and will report whatever it
			// reports, which is the behaviour there was before this check existed.
		}
		if (!limit) {
			return false;
		}
		report(limit.title, (file.name ? file.name + '\n\n' : '') + limit.message);
		return true;
	}

	// Per file, so one that cannot be stored does not abandon the rest of a drop, a paste
	// or a selection -- and so the folder is still refreshed and the file input still
	// cleared afterwards, which is what makes picking the same file twice work.
	//
	// All three callers are event listeners, and nothing awaits an event listener: a
	// rejection escaping one is an unhandled rejection, caught by the window's own net two
	// layers out and reported as *something* going wrong without ever naming the file.
	async function addIncomingFile (file, filePath, folderPath) {
		try {
			await onFileHandler(file, filePath, folderPath);
		}
		catch (err) {
			reportFailure('Could not add ' + ((file && file.name) || 'that file'), err);
		}
	}

	// `folderPath` is where the file is going, and it defaults to the folder being shown --
	// which is every caller but one. A file dropped onto a *folder row* goes into that folder
	// instead, because that is plainly what dropping it there means; the row's own drop
	// handler cannot take it, since only this side knows how to write a file.
	async function onFileHandler (file, filePath, folderPath) {
		var folder = folderPath || state.cwd;
		var target = filePath || file.name;
		var destPath = path.join(folder, target);

		if (await refuseOversizedFile(file)) {
			return;
		}

		// A dropped, pasted or uploaded file used to overwrite whatever already had that
		// name -- silently, with no undo. It now asks the same question a paste does.
		//
		// A slash in `target` means this is one file out of a dropped folder, and its question
		// has already been asked -- once, about the folder, by `resolveIncomingRoots`. Asking
		// again here would ask it per file; not asking it anywhere is what used to merge a
		// dropped folder into an existing one silently.
		var ab = await fileToAB(file);
		if (target.indexOf('/') === -1) {
			await writeNewFile(folder, target, Buffer.from(ab));
			return;
		}
		await writeIncomingFile(destPath, Buffer.from(ab), false);
	}

	return {
		moveItemsToFolder: moveItemsToFolder,
		copyItemsToFolder: copyItemsToFolder,
		copyEntryRecursive: copyEntryRecursive,
		resolveIncomingDestination: resolveIncomingDestination,
		resolveIncomingRoots: resolveIncomingRoots,
		rerootIncomingPath: rerootIncomingPath,
		writeNewFile: writeNewFile,
		writeIncomingFile: writeIncomingFile,
		unlinkQuietly: unlinkQuietly,
		resolvePasteDestination: resolvePasteDestination,
		askPasteConflict: askPasteConflict,
		buildIndexedCopyPath: buildIndexedCopyPath,
		refuseOversizedFile: refuseOversizedFile,
		addIncomingFile: addIncomingFile,
		onFileHandler: onFileHandler
	};
}
