// The filesystem change signal.
//
// The claim this module makes is that a writer cannot forget to announce a write, because
// no writer is asked: the one shared `fs` is wrapped and the announcement is a consequence
// of the call. So the tests drive a fake `fs` the way a real caller would -- including the
// call shapes a real caller uses and this wrapper must not disturb -- and check what came
// out the other end.
//
// The other half is arithmetic that is easy to get subtly wrong and impossible to see in a
// browser: when a batch is emitted during a long copy, what a truncated batch is allowed to
// answer, and which folder a rename changed (both of them).

import {check, report} from './assert.mjs';
import * as fsEvents from '../js/shell/fs-events.js';
import {readFileSync} from 'fs';

var root = new URL('../', import.meta.url);
function readFile (name) {
	return readFileSync(new URL(name, root), 'utf8');
}

// A clock and a timer queue driven by hand. Everything about coalescing is timing, and
// timing tested with real timers is a test that fails on a busy machine.
function harness (options) {
	var clock = 0;
	var timers = [];
	var next = 1;
	var seen = [];
	var sent = [];

	fsEvents.reset();
	fsEvents.init(Object.assign({
		now: function () { return clock; },
		schedule: function (fn, ms) {
			var handle = next++;
			timers.push({handle: handle, at: clock + ms, fn: fn});
			return handle;
		},
		cancel: function (handle) {
			timers = timers.filter(function (item) { return item.handle !== handle; });
		},
		broadcast: function (payload) { sent.push(payload); }
	}, options || {}));

	fsEvents.subscribe(function (detail) { seen.push(detail); });

	return {
		seen: seen,
		sent: sent,
		// Move time forward, firing whatever falls due on the way.
		tick: function (ms) {
			clock += ms;
			var due = timers.filter(function (item) { return item.at <= clock; });
			timers = timers.filter(function (item) { return item.at > clock; });
			due.forEach(function (item) { item.fn(); });
		},
		pendingTimers: function () { return timers.length; },
		at: function () { return clock; }
	};
}

// A fake fs with the call shapes BrowserFS actually offers. `fail` makes the next call
// report an error, which is the case that must NOT produce an event.
function fakeFs (log) {
	var fs = {
		fail: null,
		writeFile: function (p, data, arg3, arg4) {
			var cb = typeof arg4 === 'function' ? arg4 : (typeof arg3 === 'function' ? arg3 : null);
			log.push('writeFile ' + p);
			var err = fs.fail; fs.fail = null;
			if (cb) { cb(err || null); }
		},
		unlink: function (p, cb) {
			log.push('unlink ' + p);
			var err = fs.fail; fs.fail = null;
			cb(err || null);
		},
		mkdir: function (p, cb) {
			log.push('mkdir ' + p);
			cb(null);
		},
		rmdir: function (p, cb) { log.push('rmdir ' + p); cb(null); },
		rename: function (from, to, cb) { log.push('rename ' + from + ' ' + to); cb(null); },
		appendFile: function (p, data, cb) { log.push('append ' + p); cb(null); },
		truncate: function (p, len, cb) { log.push('truncate ' + p); cb(null); },
		writeFileSync: function (p, data) {
			log.push('writeFileSync ' + p);
			var err = fs.fail; fs.fail = null;
			if (err) { throw err; }
			return 'written';
		},
		readFile: function (p, cb) { log.push('readFile ' + p); cb(null, 'x'); }
	};
	return fs;
}

console.log('\nPaths');

check('a browserfs url is the same file as its path',
	fsEvents.normalizePath('/__browserfs__/home/a.txt'), '/home/a.txt');
check('a relative path is absolute, doubled slashes collapse, a trailing slash goes',
	[fsEvents.normalizePath('home/a.txt'), fsEvents.normalizePath('/home//a.txt'), fsEvents.normalizePath('/home/sub/')],
	['/home/a.txt', '/home/a.txt', '/home/sub']);
check('a folder whose name merely starts with the prefix is left alone',
	fsEvents.normalizePath('/__browserfs__notes/a.txt'), '/__browserfs__notes/a.txt');
check('the root survives every spelling of it',
	[fsEvents.normalizePath('/'), fsEvents.normalizePath(''), fsEvents.normalizePath('//')], ['/', '/', '/']);
check('the parent of a file in the root is the root',
	[fsEvents.parentOf('/a.txt'), fsEvents.parentOf('/home/sub/a.txt'), fsEvents.parentOf('/')],
	['/', '/home/sub', '/']);

console.log('\nEvery writer is seen, because none of them is asked');

(function () {
	var log = [];
	var fs = fakeFs(log);
	var h = harness();
	var wrapped = fsEvents.watchFs(fs);

	check('every mutating method is wrapped, and reading is left alone', wrapped > 0 && !fs.readFile.__pixosWatched, true);

	fs.writeFile('/home/a.txt', 'x', function () {});
	h.tick(100);
	check('a write nobody announced is announced anyway',
		h.seen.length === 1 && h.seen[0].entries[0].path, '/home/a.txt');
	check('and it is a write', h.seen[0].entries[0].kind, 'write');
	check('the caller still got its own callback', log, ['writeFile /home/a.txt']);
})();

(function () {
	var log = [];
	var fs = fakeFs(log);
	var h = harness();
	fsEvents.watchFs(fs);

	var got = [];
	fs.writeFile('/home/a.txt', 'x', {encoding: 'utf8'}, function (err) { got.push(['cb', err]); });
	h.tick(100);
	check('the options-plus-callback shape still reaches the callback and still reports',
		[got.length, h.seen.length], [1, 1]);

	h.seen.length = 0;
	fs.writeFile('/home/b.txt', 'x');
	h.tick(100);
	check('a call with no callback at all is still seen',
		h.seen.length === 1 && h.seen[0].entries[0].path, '/home/b.txt');
})();

(function () {
	var log = [];
	var fs = fakeFs(log);
	var h = harness();
	fsEvents.watchFs(fs);

	fs.fail = new Error('EACCES');
	fs.unlink('/home/a.txt', function () {});
	h.tick(100);
	check('a write that failed is not a change', h.seen.length, 0);

	fs.fail = new Error('EACCES');
	var threw = false;
	try { fs.writeFileSync('/home/a.txt', 'x'); } catch (err) { threw = true; }
	h.tick(100);
	check('nor is a sync write that threw', [threw, h.seen.length], [true, 0]);

	check('a sync write that returned is a change, and its return value survives',
		[fs.writeFileSync('/home/c.txt', 'x'), (h.tick(100), h.seen.length)], ['written', 1]);
})();

(function () {
	var fs = fakeFs([]);
	var before = fs.writeFile;
	fsEvents.watchFs(fs);
	var once = fs.writeFile;
	fsEvents.watchFs(fs);
	check('wrapping twice does not wrap twice', fs.writeFile === once, true);
	fsEvents.unwatchFs(fs);
	check('and it can be put back exactly as it was', fs.writeFile === before, true);
})();

console.log('\nA rename changed two folders');

(function () {
	var fs = fakeFs([]);
	var h = harness();
	fsEvents.watchFs(fs);

	fs.rename('/home/old.txt', '/work/new.txt', function () {});
	h.tick(100);
	var detail = h.seen[0];
	check('one entry, carrying both ends', [detail.entries.length, detail.entries[0].from, detail.entries[0].path],
		[1, '/home/old.txt', '/work/new.txt']);
	check('the folder it left has changed', detail.affects('/home'), true);
	check('the folder it arrived in has changed', detail.affects('/work'), true);
	check('a folder it never touched has not', detail.affects('/settings'), false);
})();

console.log('\nWhat a listener is allowed to ask');

(function () {
	var fs = fakeFs([]);
	var h = harness();
	fsEvents.watchFs(fs);

	fs.writeFile('/home/notes/a.txt', 'x', function () {});
	h.tick(100);
	var detail = h.seen[0];
	check('the folder holding it changed', detail.affects('/home/notes'), true);
	check('its grandparent did not -- a listing is one level deep', detail.affects('/home'), false);
	check('the file itself was touched', detail.touches('/home/notes/a.txt'), true);
	check('a folder above it was touched, because what it holds is different',
		detail.touches('/home/notes'), true);
	check('an unrelated file was not', detail.touches('/home/notes/b.txt'), false);
})();

(function () {
	var fs = fakeFs([]);
	var h = harness();
	fsEvents.watchFs(fs);

	fs.rmdir('/home/notes', function () {});
	h.tick(100);
	var detail = h.seen[0];
	check('standing in a folder that was removed counts as your listing changing',
		detail.affects('/home/notes'), true);
	check('and so does standing anywhere below it', detail.affects('/home/notes/deep/deeper'), true);
	check('a sibling is unaffected', detail.affects('/home/other'), false);
})();

(function () {
	var h = harness();
	fsEvents.record('mount', '/mnt/disk');
	h.tick(100);
	var detail = h.seen[0];
	check('a mount changes the folder it landed in', detail.affects('/mnt'), true);
	check('and the folder it landed on, whose contents are new', detail.affects('/mnt/disk'), true);
})();

console.log('\nA long copy is not five hundred refreshes');

(function () {
	var fs = fakeFs([]);
	var h = harness({quiet: 80, maxWait: 500});
	fsEvents.watchFs(fs);

	// A write every 20ms for a second: quiet never arrives, so only maxWait can fire.
	for (var i = 0; i < 50; i++) {
		fs.writeFile('/home/copy/' + i + '.txt', 'x', function () {});
		h.tick(20);
	}
	check('a batch was emitted while it was still running, twice a second',
		h.seen.length, 2);

	// The copy finishes with one last file, and the quiet window -- not maxWait -- is what
	// has to deliver it. Without that, a listener would be left showing the state of the
	// folder as it was a moment before the operation ended.
	fs.writeFile('/home/copy/last.txt', 'x', function () {});
	h.tick(100);
	check('and a final batch lands once the writes stop', h.seen.length, 3);

	var total = h.seen.reduce(function (sum, detail) { return sum + detail.entries.length; }, 0);
	check('every write is accounted for across the batches, none twice', total, 51);
})();

(function () {
	var fs = fakeFs([]);
	var h = harness({quiet: 80, maxWait: 500});
	fsEvents.watchFs(fs);

	fs.writeFile('/home/a.txt', 'x', function () {});
	h.tick(50);
	check('nothing is emitted while writes are still arriving', h.seen.length, 0);
	fs.writeFile('/home/b.txt', 'x', function () {});
	h.tick(50);
	check('the quiet window restarts on each write', h.seen.length, 0);
	h.tick(40);
	check('and both land in one batch once it goes quiet',
		[h.seen.length, h.seen[0].entries.length], [1, 2]);
})();

console.log('\nA batch that got too big answers yes to everything');

(function () {
	var fs = fakeFs([]);
	var h = harness({entryCap: 5, quiet: 80, maxWait: 100000});
	fsEvents.watchFs(fs);

	for (var i = 0; i < 40; i++) {
		fs.writeFile('/home/many/' + i + '.txt', 'x', function () {});
	}
	h.tick(100);
	var detail = h.seen[0];
	check('the array stops at the cap rather than growing', detail.entries.length, 5);
	check('and says so', detail.truncated, true);
	check('a truncated batch cannot say a folder is unaffected',
		[detail.affects('/somewhere/else'), detail.touches('/nowhere/at/all')], [true, true]);
})();

(function () {
	var h = harness({dirCap: 2, quiet: 80, maxWait: 100000});
	fsEvents.record('write', '/a/1.txt');
	fsEvents.record('write', '/b/1.txt');
	fsEvents.record('write', '/c/1.txt');
	h.tick(100);
	check('too many folders truncates as well, on far fewer entries',
		[h.seen[0].entries.length, h.seen[0].dirs.length, h.seen[0].truncated], [3, 2, true]);
})();

console.log('\nOther tabs');

(function () {
	var fs = fakeFs([]);
	var h = harness();
	fsEvents.watchFs(fs);

	fs.writeFile('/home/a.txt', 'x', function () {});
	h.tick(100);
	check('a local change is offered to the other tabs', h.sent.length, 1);
	check('and carries no functions, so it can cross a channel',
		JSON.parse(JSON.stringify(h.sent[0])).entries[0].path, '/home/a.txt');

	h.seen.length = 0;
	h.sent.length = 0;
	fsEvents.receive({entries: [{kind: 'remove', path: '/home/b.txt'}], dirs: ['/home']});
	check('a change from another tab reaches this one', h.seen.length, 1);
	check('with the questions answerable, the same as a local one',
		h.seen[0].affects('/home'), true);
	check('it is marked as coming from elsewhere', h.seen[0].remote, true);
	check('and is never sent back out, or two tabs would pass it for ever', h.sent.length, 0);
})();

(function () {
	var h = harness({broadcast: function () { throw new Error('channel closed'); }, onError: function () {}});
	fsEvents.record('write', '/home/a.txt');
	h.tick(100);
	check('a channel that has closed does not cost this tab its own event', h.seen.length, 1);
})();

console.log('\nListeners');

(function () {
	var h = harness({onError: function () {}});
	var quiet = [];
	fsEvents.subscribe(function () { throw new Error('this listener is broken'); });
	fsEvents.subscribe(function (detail) { quiet.push(detail); });

	fsEvents.record('write', '/home/a.txt');
	h.tick(100);
	check('one listener throwing does not stop the next one hearing about it', quiet.length, 1);
})();

(function () {
	var h = harness();
	var mine = [];
	var stop = fsEvents.subscribe(function (detail) { mine.push(detail); });
	fsEvents.record('write', '/home/a.txt');
	h.tick(100);
	stop();
	fsEvents.record('write', '/home/b.txt');
	h.tick(100);
	check('unsubscribing works', mine.length, 1);
})();

(function () {
	var h = harness();
	var counts = {a: 0, b: 0};
	fsEvents.subscribe(function () { counts.a++; }, {owner: 'win-1'});
	fsEvents.subscribe(function () { counts.a++; }, {owner: 'win-1'});
	fsEvents.subscribe(function () { counts.b++; }, {owner: 'win-2'});

	check('two watchers belonging to a closed window go together', fsEvents.dropOwner('win-1'), 2);
	fsEvents.record('write', '/home/a.txt');
	h.tick(100);
	check('and the other window still hears about changes', [counts.a, counts.b], [0, 1]);
})();

(function () {
	var h = harness();
	var order = [];
	var stopSecond;
	fsEvents.subscribe(function () { order.push('first'); stopSecond(); });
	stopSecond = fsEvents.subscribe(function () { order.push('second'); });
	fsEvents.record('write', '/home/a.txt');
	h.tick(100);
	check('a listener that unsubscribes another mid-delivery does not resurrect or skip it',
		order, ['first']);
})();

(function () {
	var h = harness();
	check('subscribing with something that is not a function is survivable',
		typeof fsEvents.subscribe(null), 'function');
	check('and recording nothing records nothing',
		[fsEvents.record('write', null), fsEvents.record('write', [])], [null, null]);
	h.tick(200);
	check('so nothing is emitted', h.seen.length, 0);
})();

console.log('\nBefore anyone configured it');

(function () {
	fsEvents.reset();
	var got = [];
	fsEvents.subscribe(function (detail) { got.push(detail); });
	// No init(): a write during boot must not throw just because the wiring is not up yet.
	var entry = fsEvents.record('write', '/home/a.txt');
	check('recording works on the defaults', entry.path, '/home/a.txt');
	check('and flushing by hand delivers it', (fsEvents.flush(), got.length), 1);
	fsEvents.reset();
})();

console.log('\nWired to the one fs everybody shares');

// The module is only worth anything if it is attached to the object every writer actually
// uses, before any of them writes. That is a property of index.html, not of the module, and
// it is invisible from inside it -- so it is read here.
(function () {
	var shell = readFile('index.html');

	check('the shell wraps the fs it hands out, not a copy of it',
		/fsEvents\.watchFs\(window\.fs\)/.test(shell), true);

	// Anything wrapped after the first write is a write nobody heard about.
	var wrapAt = shell.indexOf('fsEvents.watchFs(window.fs)');
	var mountAt = shell.indexOf('new MountManager(');
	var firstWrite = shell.indexOf('fs.writeFile(');
	check('and does it before the mount manager exists, and before anything writes',
		[wrapAt !== -1 && wrapAt < mountAt, wrapAt < firstWrite], [true, true]);

	check('the fs is created and wrapped in the same function, so nothing can slip between',
		shell.indexOf('window.fs = BrowserFS.BFSRequire') < wrapAt, true);

	check('an app is given a way to watch, and to say what the shell could not see',
		[/window\.watchFiles = function/.test(shell), /window\.notifyFileChange = function/.test(shell)],
		[true, true]);

	check('a batch is also dispatched as an event, which needs no handshake',
		/dispatchEvent\(new CustomEvent\('pixos:fs-changed'/.test(shell), true);

	check('another tab is listened to', /fsEvents\.receive\(event\.data\)/.test(shell), true);

	check('a mount and an unmount are both worked out from the table',
		[/fsEvents\.record\('mount'/.test(shell), /fsEvents\.record\('unmount'/.test(shell)],
		[true, true]);
})();

(function () {
	var mm = readFile('js/mount-manager.js');
	check('the mount manager reports the whole table from the one place it changes',
		/this\.onChange\(list\)/.test(mm), true);
	check('and a listener throwing never fails the mount',
		/try \{\s*\n\s*this\.onChange\(list\);/.test(mm), true);
})();

(function () {
	var explorer = readFile('apps/explorer/index.html');
	check('Explorer hands over its own window, so the watch dies with it',
		/parent\.watchFiles\(window, function \(change\)/.test(explorer), true);
	check('and asks the batch about the folder it is showing',
		/change\.affects\(state\.cwd\)/.test(explorer), true);
	check('a refresh nobody asked for keeps the selection',
		/refreshCurrentDir\(true\)/.test(explorer), true);
	check('and waits rather than re-rendering rows out from under a drag',
		/state\.selectionBox \|\| state\.dragCommitInProgress/.test(explorer), true);
	check('and a mount is worth a refresh wherever it landed, for the sidebar',
		/entry\.kind === 'mount'/.test(explorer), true);
})();

(function () {
	var bm = readFile('apps/bookmarks/index.html');
	check('Bookmarks watches the one file it owns',
		/change\.touches\(FILE\)/.test(bm), true);
	check('and the watch is set up outside boot(), which returns early four ways out of five',
		/boot\(\)\.then\(watchForChanges, watchForChanges\)/.test(bm), true);
	check('a half-finished dialog is not thrown away by a refresh',
		/if \(editing\) \{/.test(bm), true);
})();

process.exit(report('fs-events') ? 1 : 0);
