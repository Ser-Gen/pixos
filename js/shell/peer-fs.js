// Somebody else's folder, as a filesystem.
//
// This is the whole reason a shared folder is a *mount* rather than a window with a file
// list in it: once the folder is a filesystem, everything downstream comes free. The guest
// browses it in their own Explorer, opens files with their own apps and their own
// associations, searches it with the palette, and the service worker serves it under
// `/__browserfs__` like anything else. None of that had to be written twice, and none of
// it had to be transmitted.
//
// **It is a plain object, not a subclass.** BrowserFS's own backends are inside the
// vendored bundle and it exports no base class, so this implements the interface the
// bundle actually calls — established by experiment, not by reading the types: `readdir`,
// `stat(path, isLstat, cb)`, `readFile(path, encoding, flag, cb)`, `exists`, `realpath`,
// and the metadata answers. Paths arrive already stripped of the mount point, so what this
// sees is exactly what the host resolves against the share root.
//
// **Every call is asynchronous and can fail.** `supportsSynch()` is false, which is what
// stops anything in the shell from calling the sync half of the API and getting nothing.
// A call that never comes back rejects on a deadline in `peers.js` — the files3 mount
// taught that lesson, and it is why `file-search.js` races reads against a clock.
//
// **Read-only, and it says so.** `isReadOnly()` is true, so BrowserFS itself refuses
// writes before a message is ever sent, with the error the rest of the system already
// knows how to report.

var FILE = 32768;
var DIRECTORY = 16384;

// Listings are the one thing worth holding on to: Explorer stats every row it draws, so a
// folder of forty files is forty round trips over a link with real latency. Short enough
// that the far side changing is noticed within seconds of asking again.
var CACHE_MS = 4000;

export function create (cfg) {
	var call = cfg.call;
	var Stats = cfg.Stats;
	var name = cfg.name || 'Peer';
	var cache = {};

	function cached (key, run) {
		var hit = cache[key];
		var now = Date.now();
		if (hit && now - hit.at < CACHE_MS) {
			return hit.value;
		}
		var value = run();
		cache[key] = {at: now, value: value};
		// A failure is not worth remembering: the next click should try again rather than
		// repeat an error for four seconds.
		value.catch(function () {
			if (cache[key] && cache[key].value === value) {
				delete cache[key];
			}
		});
		return value;
	}

	function fail (cb, err) {
		cb(err instanceof Error ? err : new Error(String(err)));
	}

	return {
		getName: function () {
			return 'Peer: ' + name;
		},
		isReadOnly: function () {
			return true;
		},
		supportsLinks: function () {
			return false;
		},
		supportsProps: function () {
			return false;
		},
		// False on purpose: there is no synchronous way to ask another machine anything,
		// and a backend that claimed otherwise would be asked and would have to lie.
		supportsSynch: function () {
			return false;
		},
		diskSpace: function (path, cb) {
			// Nothing here knows the far side's disk, and a made-up number would be worse
			// than a zero the storage widget already knows how to read as "no answer".
			cb(0, 0);
		},

		readdir: function (path, cb) {
			cached('d:' + path, function () {
				return call('readdir', path);
			}).then(function (list) {
				cb(null, (list || []).slice());
			}, function (err) {
				fail(cb, err);
			});
		},

		stat: function (path, isLstat, cb) {
			cached('s:' + path, function () {
				return call('stat', path);
			}).then(function (info) {
				cb(null, new Stats(info.dir ? DIRECTORY : FILE, info.size,
					undefined, undefined, info.mtime || undefined));
			}, function (err) {
				fail(cb, err);
			});
		},

		exists: function (path, cb) {
			cached('s:' + path, function () {
				return call('stat', path);
			}).then(function () {
				cb(true);
			}, function () {
				cb(false);
			});
		},

		realpath: function (path, cache_, cb) {
			cb(null, path);
		},

		// Not cached: a file is the thing you actually came for, and holding one in memory
		// per path is how a mount ends up costing more than the machine it is on.
		readFile: function (path, encoding, flag, cb) {
			call('read', path).then(function (data) {
				var buffer = toBuffer(data);
				cb(null, encoding ? buffer.toString(encoding) : buffer);
			}, function (err) {
				fail(cb, err);
			});
		},

		// Everything that writes. BrowserFS refuses these itself because isReadOnly() is
		// true, and they are here so that a route which reaches one anyway says what is
		// wrong rather than failing as "not a function".
		writeFile: readOnly,
		unlink: readOnly,
		rmdir: readOnly,
		mkdir: readOnly,
		rename: readOnly,
		truncate: readOnly,
		open: readOnly,

		// Emptied when the far side says something changed, and when the folder is
		// remounted. There is no change signal from another machine yet -- that is the
		// same missing signal Explorer's own stale listings need.
		invalidate: function () {
			cache = {};
		}
	};

	function readOnly () {
		var cb = arguments[arguments.length - 1];
		if (typeof cb === 'function') {
			cb(new Error('This folder belongs to another machine and is shared read-only.'));
		}
	}
}

function toBuffer (data) {
	if (!data) {
		return globalThis.Buffer.alloc(0);
	}
	if (globalThis.Buffer.isBuffer(data)) {
		return data;
	}
	return globalThis.Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
}
