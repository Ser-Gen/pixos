// Who changed the filesystem, and who needed to know.
//
// Two Explorer windows on one folder each read their listing once, when the folder was
// opened. Delete a file in one and the other still shows it; click it and you are told it
// no longer exists, which is a true sentence and the wrong answer to a reasonable action.
// The same staleness belongs to every reader: an editor holding a file somebody else
// rewrote, the Bookmarks window that missed a bookmark added from the desktop, a sidebar
// that has not noticed a mount.
//
// BrowserFS has no watch API, so the signal has to be raised by the writers. The obvious
// way to do that -- have each writer announce what it wrote -- has one hole in it, and it
// is the hole that matters: the writer that forgets. Every app, every shell module and
// every future call site would have to remember, and the first one that does not is a bug
// nobody sees until a window is stale.
//
// So the writers are not asked. There is exactly one `fs` in this system -- the shell
// creates it and Explorer, terminal, treemap, filmoskop and every shell module all reach
// the same object through `parent.fs` -- and this module wraps its mutating methods at
// that single point. A write is announced because it happened, not because whoever made it
// remembered to say so. `mount-manager` is the one writer this cannot see, because a mount
// changes what a directory contains without going through `fs` at all, and it reports
// itself.
//
// Three things stop that from being a flood. Changes are **coalesced**: a batch is emitted
// once the writes go quiet, and at least every `maxWait` regardless, so a copy of five
// hundred files refreshes a listing twice a second while it runs rather than five hundred
// times, and once more when it finishes. A batch is **capped**, and past the cap sets
// `truncated` instead of growing -- an archive extraction is not worth an array of ten
// thousand paths, and every question a listener can ask a truncated batch is answered
// `true`, so the failure is a needless refresh rather than a missed one. And the questions
// are asked of the batch rather than answered by it: `affects(dir)` and `touches(path)`
// are what a listener wants, and neither can be got wrong in the listener because neither
// is written there.

var QUIET = 80;
var MAX_WAIT = 500;
var ENTRY_CAP = 200;
var DIR_CAP = 50;

// name, kind, how many leading arguments are paths.
var MUTATORS = [
	['writeFile', 'write', 1],
	['appendFile', 'write', 1],
	['truncate', 'write', 1],
	['mkdir', 'create', 1],
	['unlink', 'remove', 1],
	['rmdir', 'remove', 1],
	['rename', 'rename', 2]
];

var config = null;
var pending = null;
var timer = null;
var watchers = [];

function defaults () {
	return {
		schedule: function (fn, ms) { return setTimeout(fn, ms); },
		cancel: function (handle) { clearTimeout(handle); },
		now: function () { return Date.now(); },
		quiet: QUIET,
		maxWait: MAX_WAIT,
		entryCap: ENTRY_CAP,
		dirCap: DIR_CAP,
		broadcast: null,
		onError: null
	};
}

function ensure () {
	if (!config) { config = defaults(); }
	return config;
}

export function init (options) {
	var cfg = options || {};
	var base = defaults();
	config = {
		schedule: cfg.schedule || base.schedule,
		cancel: cfg.cancel || base.cancel,
		now: cfg.now || base.now,
		quiet: typeof cfg.quiet === 'number' ? cfg.quiet : base.quiet,
		maxWait: typeof cfg.maxWait === 'number' ? cfg.maxWait : base.maxWait,
		entryCap: typeof cfg.entryCap === 'number' ? cfg.entryCap : base.entryCap,
		dirCap: typeof cfg.dirCap === 'number' ? cfg.dirCap : base.dirCap,
		broadcast: typeof cfg.broadcast === 'function' ? cfg.broadcast : null,
		onError: typeof cfg.onError === 'function' ? cfg.onError : null
	};
	return config;
}

// Tests only: forget every watcher, every pending change and the configuration.
export function reset () {
	if (config && timer !== null) { config.cancel(timer); }
	config = null;
	pending = null;
	timer = null;
	watchers = [];
}

// `/__browserfs__/home/a.txt` and `home/a.txt//` are the same file as `/home/a.txt`. The
// prefix is stripped only when it is a whole segment, so a folder actually called
// `__browserfs__notes` survives.
export function normalizePath (input) {
	var text = String(input === null || input === undefined ? '' : input);
	text = text.replace(/^\/?__browserfs__(?=\/|$)/, '');
	if (text.charAt(0) !== '/') { text = '/' + text; }
	text = text.replace(/\/{2,}/g, '/');
	if (text.length > 1) { text = text.replace(/\/+$/, ''); }
	return text || '/';
}

export function parentOf (input) {
	var norm = normalizePath(input);
	if (norm === '/') { return '/'; }
	var cut = norm.lastIndexOf('/');
	return cut <= 0 ? '/' : norm.slice(0, cut);
}

function isUnder (child, ancestor) {
	if (ancestor === '/') { return child !== '/'; }
	return child.indexOf(ancestor + '/') === 0;
}

// A rename is one entry with two ends, and both of them changed.
function sidesOf (entry) {
	if (!entry || !entry.path) { return []; }
	return entry.from && entry.from !== entry.path ? [entry.from, entry.path] : [entry.path];
}

function isGone (kind) {
	return kind === 'remove' || kind === 'rename' || kind === 'unmount';
}

// Did the listing of this folder change? A write counts: Explorer shows size and modified
// time, so a file rewritten in place is a row that is now wrong.
export function affects (detail, dirPath) {
	if (!detail) { return false; }
	if (detail.truncated) { return true; }
	var dir = normalizePath(dirPath);
	return (detail.entries || []).some(function (entry) {
		return sidesOf(entry).some(function (target) {
			if (parentOf(target) === dir) { return true; }
			// The folder you are standing in was removed, renamed or unmounted -- as was
			// anything above it.
			if (isGone(entry.kind) && (target === dir || isUnder(dir, target))) { return true; }
			// Something was mounted exactly here, so what it contains is new.
			if (entry.kind === 'mount' && target === dir) { return true; }
			return false;
		});
	});
}

// Did this exact path change? True for the file itself, for anything inside it when it is
// a folder, and for a folder above it going away -- all three mean what somebody is
// holding is no longer what is on disk.
export function touches (detail, filePath) {
	if (!detail) { return false; }
	if (detail.truncated) { return true; }
	var target = normalizePath(filePath);
	return (detail.entries || []).some(function (entry) {
		return sidesOf(entry).some(function (changed) {
			return changed === target || isUnder(changed, target) || isUnder(target, changed);
		});
	});
}

function buildDetail (entries, dirs, truncated, remote, at) {
	var detail = {
		entries: entries,
		dirs: dirs,
		truncated: !!truncated,
		remote: !!remote,
		at: at
	};
	// The questions live on the batch so that no listener has to work out what a rename or
	// a removed parent means -- which is where this would otherwise be got wrong, once per
	// listener.
	detail.affects = function (dirPath) { return affects(detail, dirPath); };
	detail.touches = function (filePath) { return touches(detail, filePath); };
	return detail;
}

export function record (kind, paths, extra) {
	var cfg = ensure();
	var list = (Array.isArray(paths) ? paths : [paths])
		.filter(function (item) { return item !== null && item !== undefined && item !== ''; })
		.map(normalizePath);
	if (!list.length) { return null; }

	var entry = {kind: kind || 'write', path: list[list.length - 1]};
	if (list.length > 1) { entry.from = list[0]; }
	if (extra && extra.from) { entry.from = normalizePath(extra.from); }
	if (entry.from === entry.path) { delete entry.from; }

	if (!pending) {
		pending = {entries: [], dirs: [], truncated: false, firstAt: cfg.now()};
	}
	if (pending.entries.length >= cfg.entryCap) {
		pending.truncated = true;
	}
	else {
		pending.entries.push(entry);
	}
	sidesOf(entry).forEach(function (target) {
		var dir = parentOf(target);
		if (pending.dirs.indexOf(dir) !== -1) { return; }
		if (pending.dirs.length >= cfg.dirCap) { pending.truncated = true; return; }
		pending.dirs.push(dir);
	});

	schedule();
	return entry;
}

// Quiet for `quiet` ms, or `maxWait` since the first unflushed change, whichever comes
// first. Debounce alone would say nothing at all for the whole of a long copy; throttle
// alone would keep firing after it ended.
function schedule () {
	var cfg = ensure();
	var now = cfg.now();
	var at = Math.min(now + cfg.quiet, pending.firstAt + cfg.maxWait);
	if (timer !== null) { cfg.cancel(timer); }
	timer = cfg.schedule(function () {
		timer = null;
		flush();
	}, Math.max(0, at - now));
}

export function flush () {
	var cfg = ensure();
	if (timer !== null) { cfg.cancel(timer); timer = null; }
	if (!pending) { return null; }

	var batch = pending;
	pending = null;
	var detail = buildDetail(batch.entries, batch.dirs, batch.truncated, false, cfg.now());

	if (cfg.broadcast) {
		try {
			cfg.broadcast({entries: batch.entries, dirs: batch.dirs, truncated: batch.truncated});
		}
		catch (err) {
			// A channel that has closed is not a reason for this tab to lose its own event.
			report(err);
		}
	}
	deliver(detail);
	return detail;
}

// A batch from another tab. Never re-broadcast, or two tabs would keep handing one write
// back to each other for ever.
export function receive (payload) {
	var cfg = ensure();
	if (!payload) { return null; }
	var detail = buildDetail(
		Array.isArray(payload.entries) ? payload.entries : [],
		Array.isArray(payload.dirs) ? payload.dirs : [],
		!!payload.truncated,
		true,
		cfg.now()
	);
	deliver(detail);
	return detail;
}

function report (err) {
	var cfg = ensure();
	if (cfg.onError) { cfg.onError(err); }
	else { console.error('A filesystem change signal failed', err); }
}

function deliver (detail) {
	// A copy, because a listener is allowed to unsubscribe itself while being called.
	watchers.slice().forEach(function (watcher) {
		if (watcher.dead) { return; }
		try {
			watcher.fn(detail);
		}
		catch (err) {
			// One app's listener throwing must not stop the rest of the system hearing
			// about the change.
			report(err);
		}
	});
}

// `owner` is whatever the caller wants to drop a whole group by later -- the shell passes
// a window id, so closing a window takes its watchers with it.
export function subscribe (fn, options) {
	if (typeof fn !== 'function') { return function () {}; }
	var watcher = {
		fn: fn,
		owner: options && options.owner !== undefined ? options.owner : null,
		dead: false
	};
	watchers.push(watcher);
	return function () {
		watcher.dead = true;
		var at = watchers.indexOf(watcher);
		if (at !== -1) { watchers.splice(at, 1); }
	};
}

export function dropOwner (owner) {
	var dropped = 0;
	watchers = watchers.filter(function (watcher) {
		if (watcher.owner !== owner) { return true; }
		watcher.dead = true;
		dropped++;
		return false;
	});
	return dropped;
}

export function watcherCount () {
	return watchers.length;
}

function noteChange (kind, paths) {
	try {
		record(kind, paths);
	}
	catch (err) {
		// Nothing in here is worth failing somebody's write over.
		report(err);
	}
}

function wrapOne (target, name, kind, arity, sync) {
	var original = target[name];
	if (typeof original !== 'function' || original.__pixosWatched) { return false; }

	var replacement;
	if (sync) {
		replacement = function () {
			var out = original.apply(this, arguments);
			// Only after it returned without throwing: a refused write did not happen.
			noteChange(kind, Array.prototype.slice.call(arguments, 0, arity));
			return out;
		};
	}
	else {
		replacement = function () {
			var args = Array.prototype.slice.call(arguments);
			var paths = args.slice(0, arity);
			var last = args.length ? args[args.length - 1] : null;
			function seen (err) {
				if (!err) { noteChange(kind, paths); }
			}
			if (typeof last === 'function') {
				args[args.length - 1] = function (err) {
					seen(err);
					return last.apply(this, arguments);
				};
			}
			else {
				// No callback given. Node and BrowserFS both read a trailing function as
				// the callback, so this is the shape a caller with options would produce.
				args.push(seen);
			}
			return original.apply(this, args);
		};
	}

	replacement.__pixosWatched = original;
	target[name] = replacement;
	return true;
}

// Wrap the one `fs` everything shares. Idempotent, because a second call would otherwise
// double every event.
export function watchFs (target) {
	if (!target) { return 0; }
	var wrapped = 0;
	MUTATORS.forEach(function (spec) {
		if (wrapOne(target, spec[0], spec[1], spec[2], false)) { wrapped++; }
		if (wrapOne(target, spec[0] + 'Sync', spec[1], spec[2], true)) { wrapped++; }
	});
	return wrapped;
}

export function unwatchFs (target) {
	if (!target) { return 0; }
	var restored = 0;
	MUTATORS.forEach(function (spec) {
		[spec[0], spec[0] + 'Sync'].forEach(function (name) {
			var current = target[name];
			if (current && current.__pixosWatched) {
				target[name] = current.__pixosWatched;
				restored++;
			}
		});
	});
	return restored;
}
