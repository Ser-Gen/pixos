// Every call Explorer makes to the filesystem, and the browser-side plumbing beside it:
// BrowserFS speaks callbacks, everything above this file speaks promises, and this is
// where that translation happens. It also holds the four functions that turn a drag from
// the desktop into files -- `webkitGetAsEntry` and its reader are the same shape of
// callback API, one directory deep.
//
// Nothing here reads `state` or `ui`. It was already true before the split; it is worth
// keeping true, because it is what lets this file be read on its own.

export function createFsHelpers (deps) {

	var fs = deps.fs;
	var path = deps.path;
	var mountManager = deps.mountManager;
	var normalizePath = deps.normalizePath;

	async function listDirectory (dirPath) {
		if (mountManager && typeof mountManager.refreshFiles3Directory === 'function') {
			mountManager.refreshFiles3Directory(dirPath);
		}
		var contents = await readdir(dirPath);
		var stats = await Promise.all(contents.map(async function (item) {
			var itemPath = path.join(dirPath, item);
			var st = await stat(itemPath);
			return {
				name: item,
				path: itemPath,
				isDirectory: st && st.isDirectory ? st.isDirectory() : false,
				size: st && st.size ? st.size : 0,
				mtime: st && st.mtime ? st.mtime.toISOString().slice(0, 19).replace('T', ' ') : '-',
				mtimeTs: st && st.mtime ? st.mtime.getTime() : 0
			};
		}));
		return stats;
	}

	function readFile (p) {
		return new Promise(function (resolve, reject) {
			fs.readFile(p, function (e, content) {
				if (e) {
					reject(e);
					return;
				}
				resolve(content);
			});
		});
	}

	async function writeFile (p, content) {
		await ensureDir(path.dirname(p));
		return new Promise(function (resolve, reject) {
			fs.writeFile(p, content, function (e) {
				if (e) {
					reject(e);
					return;
				}
				resolve();
			});
		});
	}

	async function ensureDir (dirPath) {
		var normalized = normalizePath(dirPath);
		var segments = normalized.split('/').filter(Boolean);
		var current = '/';
		for (var i = 0; i < segments.length; i++) {
			current = path.join(current, segments[i]);
			var st = await stat(current);
			if (!st) {
				await mkdir(current);
			}
		}
	}

	function mkdir (p) {
		return new Promise(function (resolve) {
			fs.mkdir(p, function () {
				resolve();
			});
		});
	}

	function stat (p) {
		return new Promise(function (resolve) {
			fs.stat(p, function (e, stats) {
				if (stats) {
					resolve(stats);
				}
				else {
					resolve(false);
				}
			});
		});
	}

	function readdir (p) {
		return new Promise(function (resolve) {
			fs.readdir(p, function (e, contents) {
				resolve(contents || []);
			});
		});
	}

	function fsRename (oldPath, newPath) {
		return new Promise(function (resolve, reject) {
			fs.rename(oldPath, newPath, function (e) {
				if (e) {
					reject(e);
					return;
				}
				resolve();
			});
		});
	}

	async function unlink (p) {
		var stats = await stat(p);
		if (stats && stats.isDirectory()) {
			await deleteFolderRecursive(p);
		}
		else {
			await unlinkFile(p);
		}
	}

	function unlinkFile (p) {
		return new Promise(function (resolve, reject) {
			fs.unlink(p, function (err) {
				if (err) {
					reject(err);
					return;
				}
				resolve();
			});
		});
	}

	function rmdir (p) {
		return new Promise(function (resolve, reject) {
			fs.rmdir(p, function (err) {
				if (err) {
					reject(err);
					return;
				}
				resolve();
			});
		});
	}

	async function deleteFolderRecursive (p) {
		var stats = await stat(p);
		if (!stats) return;

		var dirContent = await readdir(p);
		await Promise.all(dirContent.map(async function (file) {
			var curPath = path.join(p, file);
			var st = await stat(curPath);
			if (st && st.isDirectory()) {
				await deleteFolderRecursive(curPath);
			}
			else {
				await unlinkFile(curPath);
			}
		}));
		await rmdir(p);
	}

	function downloadBlob (blob, filename) {
		var url = URL.createObjectURL(blob);
		var a = document.createElement('a');
		a.href = url;
		a.download = filename || 'download';
		a.addEventListener('click', function clickHandler () {
			setTimeout(function () {
				URL.revokeObjectURL(url);
				a.removeEventListener('click', clickHandler);
				a.remove();
			}, 150);
		}, false);
		a.click();
	}

	function blobToFile (theBlob, fileName) {
		return new File([theBlob], fileName, {
			lastModified: new Date().getTime(),
			type: theBlob.type
		});
	}

	function fileToAB (file) {
		return new Promise(function (resolve, reject) {
			var reader = new FileReader();
			reader.onload = function () {
				resolve(this.result);
			};
			// Without these two a file the browser cannot read -- one removed from the
			// disk since it was dropped, or one too large to hold in memory -- leaves this
			// promise pending for ever, and the drop that is waiting on it never finishes
			// and never reports.
			reader.onerror = function () {
				reject(reader.error || new Error('That file could not be read.'));
			};
			reader.onabort = function () {
				reject(new Error('Reading that file was cancelled.'));
			};
			reader.readAsArrayBuffer(file);
		});
	}

	function getFileFromFileEntry (entry) {
		return new Promise(function (resolve) {
			entry.file(function (file) {
				resolve(file);
			});
		});
	}

	// Takes entries, not the DataTransferItemList it used to take. `webkitGetAsEntry()`
	// has to be called synchronously inside the drop handler -- the item list is emptied
	// the moment that handler yields -- and this function is `async`, so doing it here was
	// only ever safe by accident of the loop happening before the first `await`. The
	// caller does it now, where the requirement is visible.
	//
	// It also skips entries that are null, which the old loop pushed and then dereferenced.
	async function getAllFileEntries (entries) {
		var fileEntries = [];
		var queue = entries.slice();
		while (queue.length > 0) {
			var entry = queue.shift();
			if (!entry) {
				continue;
			}
			if (entry.isFile) {
				fileEntries.push(entry);
			}
			else if (entry.isDirectory) {
				var reader = entry.createReader();
				queue.push.apply(queue, await readAllDirectoryEntries(reader));
			}
		}
		return fileEntries;
	}

	async function readAllDirectoryEntries (directoryReader) {
		var entries = [];
		var readEntries = await readEntriesPromise(directoryReader);
		while (readEntries.length > 0) {
			entries.push.apply(entries, readEntries);
			readEntries = await readEntriesPromise(directoryReader);
		}
		return entries;
	}

	async function readEntriesPromise (directoryReader) {
		try {
			return await new Promise(function (resolve, reject) {
				directoryReader.readEntries(resolve, reject);
			});
		}
		catch (err) {
			console.log(err);
			return [];
		}
	}

	return {
		listDirectory: listDirectory,
		readFile: readFile,
		writeFile: writeFile,
		ensureDir: ensureDir,
		mkdir: mkdir,
		stat: stat,
		readdir: readdir,
		fsRename: fsRename,
		unlink: unlink,
		unlinkFile: unlinkFile,
		rmdir: rmdir,
		deleteFolderRecursive: deleteFolderRecursive,
		downloadBlob: downloadBlob,
		blobToFile: blobToFile,
		fileToAB: fileToAB,
		getFileFromFileEntry: getFileFromFileEntry,
		getAllFileEntries: getAllFileEntries,
		readAllDirectoryEntries: readAllDirectoryEntries,
		readEntriesPromise: readEntriesPromise
	};
}
