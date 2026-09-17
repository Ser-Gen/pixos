// The mount table, written down, and brought back when PixOS boots.
//
// `js/mount-manager.js` holds the table in memory and nothing else did, so every mount died
// with the tab. This writes it to `/settings/mounts.json` whenever it changes and reads it back
// during boot -- in the shell, before the session reopens any window, because the filesystem
// is not Explorer's: the terminal, treemap and filmoskop browse the same mounts.
//
// **The four types cannot come back the same way, and treating them alike makes three of them
// worse.** A zip or an iso is read again from the file it was mounted from. A Files3 storage
// mounts again from its configuration, *if its token is still in localStorage* -- with no token
// the only way to get one is a popup, and a popup opened during boot has no click behind it and
// is blocked. A local folder is a `FileSystemDirectoryHandle` kept in IndexedDB (it does not fit
// in JSON), and after a reload its permission is `prompt`; `requestPermission()` only answers
// inside a click, so it mounts silently only if the browser still says `granted`. A peer is not
// written down at all: it needs a connection to a machine that may not be there.
//
// **A mount that cannot come back is not dropped.** It stays in the table as *waiting* --
// `needs-permission`, `needs-sign-in`, or `failed` with the reason -- and `list()` hands those to
// Explorer's sidebar, where a click on one is the gesture `reconnect()` needs. The folder never
// silently disappears, which was the complaint. Only `forget()` removes one.
//
// **Nothing is written until the table has been read.** A mount made before `restore()` -- a
// peer connecting early in boot -- would otherwise write a table holding only what exists so
// far, over the one about to be restored. And, as with the session, only the tab that owns the
// settings writes (js/shell/tabs.js); a follower restores what is written and adds nothing.
//
// Everything that touches the platform is a parameter: reading and writing the file, the handle
// store, whether a Files3 token is there, the notification, and the change signal that makes
// Explorer redraw its sidebar when a waiting row changes state.

export var FILE = '/settings/mounts.json';
export var VERSION = 1;

// What one live mount becomes on disk, or null for a mount that cannot be kept: a peer, or an
// archive mounted from bytes with no file behind them.
export function toRecord (mountPoint, info) {
	if (!mountPoint || !info) {
		return null;
	}
	var record = {mountPoint: mountPoint, type: info.type, name: info.name || info.type};
	if (info.type === 'zip' || info.type === 'iso') {
		if (!info.source) {
			return null;
		}
		record.source = info.source;
		return record;
	}
	if (info.type === 'native') {
		return info.handle ? record : null;
	}
	if (info.type === 'files3') {
		// Only the strings: the live config also carries `onUnauthorized`, and the token itself
		// is where Files3 keeps it, under `localStorageId` -- never copied into a settings file.
		var config = info.config || {};
		if (!config.baseUrl || !config.rootFolderId || !config.localStorageId || !config.callbackUrl) {
			return null;
		}
		record.files3 = {
			baseUrl: String(config.baseUrl),
			rootFolderId: Number(config.rootFolderId),
			localStorageId: String(config.localStorageId),
			callbackUrl: String(config.callbackUrl)
		};
		return record;
	}
	return null;
}

// The records in a document read back from disk. It is a file in /settings that anything can
// write, so each one is checked, and a mount point named twice is kept once.
export function readRecords (doc) {
	var list = doc && Array.isArray(doc.mounts) ? doc.mounts : [];
	var seen = {};
	var out = [];
	list.forEach(function (raw) {
		if (!raw || typeof raw.mountPoint !== 'string' || raw.mountPoint.charAt(0) !== '/'
			|| raw.mountPoint === '/' || seen[raw.mountPoint]) {
			return;
		}
		var record = {mountPoint: raw.mountPoint, type: raw.type, name: String(raw.name || raw.type)};
		if (raw.type === 'zip' || raw.type === 'iso') {
			if (typeof raw.source !== 'string' || raw.source.charAt(0) !== '/') {
				return;
			}
			record.source = raw.source;
		}
		else if (raw.type === 'files3') {
			var f = raw.files3 || {};
			if (!f.baseUrl || !(Number(f.rootFolderId) >= 1) || !f.localStorageId || !f.callbackUrl) {
				return;
			}
			record.files3 = {
				baseUrl: String(f.baseUrl),
				rootFolderId: Number(f.rootFolderId),
				localStorageId: String(f.localStorageId),
				callbackUrl: String(f.callbackUrl)
			};
		}
		else if (raw.type !== 'native') {
			return;
		}
		seen[raw.mountPoint] = true;
		out.push(record);
	});
	return out;
}

// One note for everything that did not come back, raised once the restore has finished rather
// than once per mount. Null when nothing failed. A folder waiting for a click is not a failure
// -- after a reload that is every local folder, every time -- so it is not in here.
export function describeRestoreFailures (failed) {
	var list = (Array.isArray(failed) ? failed : []).filter(function (item) { return item && item.mountPoint; });
	if (!list.length) {
		return null;
	}
	var one = list.length === 1;
	return {
		title: one ? 'A mount did not come back' : list.length + ' mounts did not come back',
		message: list.map(function (item) {
			return item.name + ' (' + item.mountPoint + ')' + (item.reason ? ' — ' + item.reason : '');
		}).join('\n') + '\n\n'
			+ (one ? 'It is' : 'Each is') + ' still in Explorer\'s sidebar: click '
			+ (one ? 'it' : 'one') + ' to try again, or forget it there.'
	};
}

function reasonOf (err) {
	return err && err.message ? String(err.message) : String(err || 'unknown error');
}

export function createMountTable (deps) {
	var mountManager = deps.mountManager;
	var handles = deps.handles;
	var log = deps.log || function (message, err) { console.error(message, err); };

	// mountPoint -> {record, status, error, handle}. `status` is 'restoring', 'needs-permission',
	// 'needs-sign-in' or 'failed'.
	var waiting = {};
	var loaded = false;
	var queue = Promise.resolve();
	var settling = Promise.resolve();

	function announce (mountPoint) {
		try {
			deps.announce(mountPoint);
		}
		catch (err) {
			log('Announcing a waiting mount failed', err);
		}
	}

	function snapshot () {
		var records = [];
		var points = [];
		mountManager.listMounts().forEach(function (m) {
			var record = toRecord(m.mountPoint, mountManager.getMountInfo(m.mountPoint));
			if (record) {
				records.push(record);
				points.push(record.mountPoint);
			}
		});
		Object.keys(waiting).forEach(function (mountPoint) {
			if (points.indexOf(mountPoint) === -1) {
				records.push(waiting[mountPoint].record);
			}
		});
		return records;
	}

	async function writeNow () {
		if (!loaded || (deps.canWrite && !deps.canWrite())) {
			return;
		}
		var records = snapshot();
		// Three separate steps, each allowed to fail on its own: a handle store that will not
		// open costs the local folders, and must not cost the zips and the Files3 storages their
		// place in the document too.
		try {
			// Handles before the document: a document naming a folder whose handle was never
			// stored is a row that can only ever fail.
			for (var i = 0; i < records.length; i++) {
				var info = mountManager.getMountInfo(records[i].mountPoint);
				if (records[i].type === 'native' && info && info.handle) {
					await handles.put(records[i].mountPoint, info.handle);
				}
			}
		}
		catch (err) {
			log('Could not keep a local folder handle', err);
		}
		try {
			await deps.write({version: VERSION, mounts: records});
		}
		catch (err) {
			log('Could not write the mount table', err);
			return;
		}
		try {
			var kept = records.filter(function (r) { return r.type === 'native'; })
				.map(function (r) { return r.mountPoint; });
			var stored = await handles.keys();
			for (var j = 0; j < stored.length; j++) {
				if (kept.indexOf(stored[j]) === -1) {
					await handles.remove(stored[j]);
				}
			}
		}
		catch (err) {
			log('Could not drop a local folder handle nothing uses', err);
		}
	}

	// Queued, so two changes in quick succession never interleave their writes; each write
	// takes the table as it is when its turn comes.
	function save () {
		queue = queue.then(writeNow, writeNow);
		return queue;
	}

	// Called from `mountManager.onChange`, which fires on every mount and unmount.
	function changed () {
		Object.keys(waiting).forEach(function (mountPoint) {
			// Something else was mounted where a waiting one would go. What is there wins.
			if (mountManager.isMountPoint(mountPoint) && waiting[mountPoint].status !== 'restoring') {
				delete waiting[mountPoint];
			}
		});
		return save();
	}

	function settle (mountPoint, status, error) {
		var entry = waiting[mountPoint];
		if (entry) {
			entry.status = status;
			entry.error = error || null;
			announce(mountPoint);
		}
		return {mounted: false, status: status, error: error || null};
	}

	// Runs one mount call and settles its entry by the answer.
	function mountWith (mountPoint, start) {
		return new Promise(function (resolve) {
			var answered = false;
			function done (err) {
				if (answered) { return; }
				answered = true;
				if (err) {
					var entry = waiting[mountPoint];
					// A Files3 mount refused for its token has had the token cleared by then, and
					// what it needs is a sign-in, not a retry.
					var signIn = entry && entry.record.type === 'files3' && !deps.hasToken(entry.record.files3);
					resolve(settle(mountPoint, signIn ? 'needs-sign-in' : 'failed', err));
					return;
				}
				delete waiting[mountPoint];
				announce(mountPoint);
				resolve({mounted: true, status: null, error: null});
			}
			try {
				start(done);
			}
			catch (err) {
				done(err);
			}
		});
	}

	function startFiles3 (record) {
		return function (cb) {
			mountManager.mountFiles3(Object.assign({}, record.files3, {
				onUnauthorized: function (mountPoint) {
					deps.notify({
						level: 'warn',
						title: 'Files3 session expired',
						message: 'The session for ' + mountPoint + ' has expired. Mount it again.'
					});
				}
			}), record.mountPoint, record.name, cb);
		};
	}

	function startNative (record, handle) {
		return function (cb) {
			mountManager.mountNativeDir(handle, record.mountPoint, record.name, cb);
		};
	}

	function bringBack (record) {
		var mountPoint = record.mountPoint;
		waiting[mountPoint].status = 'restoring';
		waiting[mountPoint].error = null;

		if (record.type === 'zip' || record.type === 'iso') {
			var method = record.type === 'zip' ? 'mountZipFile' : 'mountIsoFile';
			return mountWith(mountPoint, function (cb) {
				mountManager[method](record.source, mountPoint, record.name, cb);
			});
		}
		if (record.type === 'files3') {
			if (!deps.hasToken(record.files3)) {
				return Promise.resolve(settle(mountPoint, 'needs-sign-in'));
			}
			return mountWith(mountPoint, startFiles3(record));
		}
		// native
		return Promise.resolve()
			.then(function () { return handles.get(mountPoint); })
			.then(function (handle) {
				if (!handle) {
					return settle(mountPoint, 'failed', new Error('the browser did not keep this folder'));
				}
				waiting[mountPoint].handle = handle;
				var permission = typeof handle.queryPermission === 'function'
					? handle.queryPermission({mode: 'readwrite'})
					: 'granted';
				return Promise.resolve(permission).then(function (state) {
					if (state !== 'granted') {
						return settle(mountPoint, 'needs-permission');
					}
					return mountWith(mountPoint, startNative(record, handle));
				});
			})
			.catch(function (err) {
				return settle(mountPoint, 'failed', err);
			});
	}

	// During boot. Resolves once every local mount -- zip, iso, a folder on this machine -- has
	// come back or been marked waiting, so the session that opens next finds them there. Files3
	// is started but not waited for: it goes over the network, and a slow server must not hold
	// the whole desktop back. An Explorer standing in it when it arrives hears the mount.
	async function restore () {
		var doc = null;
		try {
			doc = await deps.read();
		}
		catch (err) {
			log('Could not read the mount table', err);
		}
		var records = readRecords(doc).filter(function (record) {
			return !mountManager.isMountPoint(record.mountPoint);
		});
		records.forEach(function (record) {
			waiting[record.mountPoint] = {record: record, status: 'restoring', error: null, handle: null};
			announce(record.mountPoint);
		});
		loaded = true;

		var local = [];
		var all = [];
		records.forEach(function (record) {
			var running = bringBack(record);
			all.push(running);
			if (record.type !== 'files3') {
				local.push(running);
			}
		});

		settling = Promise.all(all).then(function () {
			var note = describeRestoreFailures(records.filter(function (record) {
				return waiting[record.mountPoint] && waiting[record.mountPoint].status === 'failed';
			}).map(function (record) {
				return {
					mountPoint: record.mountPoint,
					name: record.name,
					reason: reasonOf(waiting[record.mountPoint].error)
				};
			}));
			if (note) {
				deps.notify({level: 'warn', title: note.title, message: note.message});
			}
		});

		await Promise.all(local);
		// Once, whether or not anything changed: a mount made before the table was read wrote
		// nothing, and would otherwise stay unwritten until the next change came along.
		save();
		return list();
	}

	// From a click in Explorer's sidebar. **The permission is asked for before anything is
	// awaited**: `requestPermission()` only answers inside the gesture that asked for it, and
	// every `await` in front of it is a chance for that gesture to be spent.
	function reconnect (mountPoint) {
		var entry = waiting[mountPoint];
		if (!entry || entry.status === 'restoring') {
			return Promise.resolve({mounted: false, status: entry ? entry.status : null, error: null});
		}
		var record = entry.record;

		if (record.type === 'native' && entry.handle && typeof entry.handle.requestPermission === 'function') {
			var asked;
			try {
				asked = entry.handle.requestPermission({mode: 'readwrite'});
			}
			catch (err) {
				return Promise.resolve(settle(mountPoint, 'failed', err));
			}
			entry.status = 'restoring';
			announce(mountPoint);
			return Promise.resolve(asked).then(function (state) {
				if (state !== 'granted') {
					return settle(mountPoint, 'needs-permission');
				}
				return mountWith(mountPoint, startNative(record, entry.handle));
			}, function (err) {
				return settle(mountPoint, 'failed', err);
			});
		}

		if (record.type === 'files3' && entry.status === 'needs-sign-in') {
			// No token, so this opens the sign-in popup -- inside the click, which is the only
			// place a browser lets one open.
			entry.status = 'restoring';
			announce(mountPoint);
			return mountWith(mountPoint, startFiles3(record));
		}

		announce(mountPoint);
		return bringBack(record);
	}

	function forget (mountPoint) {
		var entry = waiting[mountPoint];
		if (!entry || entry.status === 'restoring') {
			return false;
		}
		delete waiting[mountPoint];
		announce(mountPoint);
		save();
		return true;
	}

	// What Explorer's sidebar draws under the live mounts.
	function list () {
		return Object.keys(waiting).filter(function (mountPoint) {
			return !mountManager.isMountPoint(mountPoint);
		}).map(function (mountPoint) {
			var entry = waiting[mountPoint];
			return {
				mountPoint: mountPoint,
				type: entry.record.type,
				name: entry.record.name,
				status: entry.status,
				reason: entry.error ? reasonOf(entry.error) : null
			};
		});
	}

	return {
		restore: restore,
		changed: changed,
		reconnect: reconnect,
		forget: forget,
		list: list,
		// For tests and for boot: the note about failures is raised when this resolves, and
		// every queued write has finished when `written()` does.
		settled: function () { return settling; },
		written: function () { return queue; }
	};
}

// The store for local-folder handles. A handle is structured-cloneable, so IndexedDB keeps it
// whole, but it is not bytes, so it cannot go in a BrowserFS file beside the rest of the table.
// A database of its own, keyed by mount point. Not covered by a test: there is no IndexedDB in
// node, and a fake one would only test the fake.
export function createHandleStore (idb) {
	var DB = 'pixos-mount-handles';
	var STORE = 'handles';
	var opening = null;

	function open () {
		if (!idb) {
			return Promise.reject(new Error('IndexedDB is not available'));
		}
		if (!opening) {
			opening = new Promise(function (resolve, reject) {
				var request = idb.open(DB, 1);
				request.onupgradeneeded = function () {
					request.result.createObjectStore(STORE);
				};
				request.onsuccess = function () { resolve(request.result); };
				request.onerror = function () {
					opening = null;
					reject(request.error);
				};
			});
		}
		return opening;
	}

	function run (mode, work) {
		return open().then(function (db) {
			return new Promise(function (resolve, reject) {
				var tx = db.transaction(STORE, mode);
				var request = work(tx.objectStore(STORE));
				tx.oncomplete = function () { resolve(request.result); };
				tx.onerror = function () { reject(tx.error); };
				tx.onabort = function () { reject(tx.error); };
			});
		});
	}

	return {
		get: function (key) { return run('readonly', function (s) { return s.get(key); }); },
		put: function (key, handle) { return run('readwrite', function (s) { return s.put(handle, key); }); },
		remove: function (key) { return run('readwrite', function (s) { return s.delete(key); }); },
		keys: function () { return run('readonly', function (s) { return s.getAllKeys(); }); }
	};
}
