// The promise wrappers around BrowserFS, which is where an error either survives or does not.
//
// This file exists because one of them did not. `mkdir` ignored the callback's error and
// resolved regardless, so **New Folder** with a name it could not create closed its dialog,
// created nothing, and said nothing at all — there was no error left anywhere above it to
// catch, because it had already been thrown away here. Everything below asks the same
// question of every wrapper: when the filesystem refuses, does the caller find out?
//
// Three of them answer "no" on purpose, and those are pinned too, because a deliberate
// swallow that nobody wrote down is indistinguishable from this bug.

import {check, report} from './assert.mjs';
import {createFsHelpers} from '../apps/explorer/js/fs-helpers.js';

// --- a filesystem that refuses whatever it is told to -------------------------------------

function errno (code, message, path) {
	// BrowserFS is inconsistent about this and the code has to cope with both shapes: some
	// of its errors carry `.code`, others only spell the errno at the front of the message.
	var err = new Error(code + ': ' + message + (path ? ", '" + path + "'" : ''));
	if (code !== 'bare') err.code = code;
	return err;
}

function messageOnlyErrno (code, message) {
	var err = new Error(code + ': ' + message);
	return err;
}

function fakeFs (options) {
	options = options || {};
	var log = [];
	var dirs = new Set(options.dirs || ['/']);
	var files = new Map(Object.entries(options.files || {}));
	var fs = {
		log: log,
		dirs: dirs,
		mkdir: function (p, cb) {
			log.push('mkdir ' + p);
			if (options.mkdirFails && options.mkdirFails(p)) {
				return cb(options.mkdirFails(p));
			}
			dirs.add(p);
			cb(null);
		},
		stat: function (p, cb) {
			if (dirs.has(p)) return cb(null, {isDirectory: function () { return true; }, size: 0});
			if (files.has(p)) return cb(null, {isDirectory: function () { return false; }, size: files.get(p).length});
			cb(errno('ENOENT', 'No such file or directory.', p));
		},
		writeFile: function (p, content, cb) { log.push('writeFile ' + p); files.set(p, content); cb(null); },
		readFile: function (p, cb) {
			if (!files.has(p)) return cb(errno('ENOENT', 'No such file or directory.', p));
			cb(null, files.get(p));
		},
		readdir: function (p, cb) {
			if (options.readdirFails) return cb(options.readdirFails, null);
			cb(null, []);
		},
		rename: function (a, b, cb) { cb(options.renameFails || null); },
		unlink: function (p, cb) { cb(options.unlinkFails || null); },
		rmdir: function (p, cb) { cb(options.rmdirFails || null); }
	};
	return fs;
}

var path = {
	join: function () {
		var parts = Array.prototype.slice.call(arguments).filter(Boolean);
		return ('/' + parts.join('/')).replace(/\/+/g, '/');
	},
	dirname: function (p) {
		var at = p.lastIndexOf('/');
		return at <= 0 ? '/' : p.slice(0, at);
	}
};

function helpers (fs) {
	return createFsHelpers({
		fs: fs,
		path: path,
		mountManager: null,
		normalizePath: function (p) { return ('/' + String(p)).replace(/\/+/g, '/'); }
	});
}

async function caught (promise) {
	try {
		await promise;
		return null;
	}
	catch (err) {
		return err;
	}
}

// For the two wrappers whose answer is a value rather than a rejection: a mutation that turns
// one of them into a rejection would otherwise end this file instead of failing a line of it.
async function settled (promise) {
	try {
		return {value: await promise, threw: false};
	}
	catch (err) {
		return {value: null, threw: true};
	}
}

// --- mkdir, the one that was silent --------------------------------------------------------

{
	const fs = fakeFs({mkdirFails: function (p) { return p === '/home/nope/here' ? errno('ENOENT', 'No such file or directory.', p) : null; }});
	const h = helpers(fs);
	const err = await caught(h.mkdir('/home/nope/here'));
	check('a refused mkdir rejects instead of resolving', err !== null, true);
	check('and hands the errno on, so it can be translated', err && err.code, 'ENOENT');
}

{
	const fs = fakeFs();
	const h = helpers(fs);
	const err = await caught(h.mkdir('/home/new'));
	check('a mkdir that works still resolves', err, null);
	check('and made the folder', fs.dirs.has('/home/new'), true);
}

{
	// The whole point of the fix, at the height the user meets it: New Folder named
	// `nope/here` is a folder inside a folder that is not there.
	const fs = fakeFs({dirs: ['/', '/home'], mkdirFails: function (p) {
		return p === '/home/nope/here' ? errno('ENOENT', 'No such file or directory.', p) : null;
	}});
	const h = helpers(fs);
	const err = await caught(h.mkdir(path.join('/home', 'nope/here')));
	check('New Folder named nope/here fails loudly', err !== null, true);
	check('and nothing was created', fs.dirs.has('/home/nope'), false);
}

// --- ensureDir, which is allowed to ignore exactly one errno -------------------------------

{
	const fs = fakeFs({dirs: ['/']});
	const h = helpers(fs);
	const err = await caught(h.ensureDir('/home/a/b'));
	check('ensureDir builds the whole chain', err, null);
	check('one level at a time', fs.log, ['mkdir /home', 'mkdir /home/a', 'mkdir /home/a/b']);
}

{
	// Two writes into the same new folder race: the loser finds it already made, which is
	// the good outcome, not a failure to pass on.
	const fs = fakeFs({dirs: ['/'], mkdirFails: function (p) { return p === '/home' ? errno('EEXIST', 'File exists.', p) : null; }});
	const h = helpers(fs);
	const err = await caught(h.ensureDir('/home/a'));
	check('EEXIST is the one errno ensureDir swallows', err, null);
	check('and it carries on down the chain', fs.dirs.has('/home/a'), true);
}

{
	const fs = fakeFs({dirs: ['/'], mkdirFails: function () { return messageOnlyErrno('EEXIST', 'File exists.'); }});
	const h = helpers(fs);
	const err = await caught(h.ensureDir('/home/a'));
	check('an EEXIST spelled only in the message is read too', err, null);
}

{
	const fs = fakeFs({dirs: ['/'], mkdirFails: function () { return errno('ENOSPC', 'No space left on device.'); }});
	const h = helpers(fs);
	const err = await caught(h.ensureDir('/home/a'));
	check('every other errno reaches the caller', err && err.code, 'ENOSPC');
}

{
	// ensureDir runs in front of every write there is, so a swallow here is a write that
	// looks like it worked.
	const fs = fakeFs({dirs: ['/'], mkdirFails: function () { return errno('EACCES', 'Permission denied.'); }});
	const h = helpers(fs);
	const err = await caught(h.writeFile('/home/a/note.txt', 'hello'));
	check('a write whose folder could not be made fails, rather than reporting success',
		err && err.code, 'EACCES');
	check('and nothing was written', fs.log.filter(l => l.startsWith('writeFile')), []);
}

// --- the wrappers that were already honest -------------------------------------------------

{
	const fs = fakeFs({renameFails: errno('ENOENT', 'No such file or directory.', '/home/gone')});
	const h = helpers(fs);
	check('fsRename rejects', (await caught(h.fsRename('/home/gone', '/home/x'))) !== null, true);
}

{
	const fs = fakeFs({unlinkFails: errno('EPERM', 'Operation not permitted.')});
	const h = helpers(fs);
	check('unlinkFile rejects', (await caught(h.unlinkFile('/home/x'))) !== null, true);
}

{
	const fs = fakeFs({rmdirFails: errno('ENOTEMPTY', 'Directory not empty.')});
	const h = helpers(fs);
	check('rmdir rejects', (await caught(h.rmdir('/home/x'))) !== null, true);
}

{
	const fs = fakeFs();
	const h = helpers(fs);
	check('readFile rejects for a file that is not there',
		(await caught(h.readFile('/home/missing.txt'))) !== null, true);
}

// --- the two that answer "no" on purpose ---------------------------------------------------
//
// Both are pinned, because a deliberate swallow nobody wrote down looks exactly like the
// mkdir bug to whoever reads it next.

{
	const fs = fakeFs();
	const h = helpers(fs);
	const missing = await settled(h.stat('/home/missing.txt'));
	check('stat does not reject -- it is a "does this exist" question', missing.threw, false);
	check('and answers false', missing.value, false);
}

{
	const fs = fakeFs({readdirFails: errno('EACCES', 'Permission denied.')});
	const h = helpers(fs);
	const locked = await settled(h.readdir('/home/locked'));
	check('readdir does not reject either', locked.threw, false);
	check('it answers with an empty folder', locked.value, []);
	const listing = await settled(h.listDirectory('/home/locked'));
	check('so a listing of an unreadable folder shows nothing rather than saying why',
		listing.threw, false);
	check('which is a folder that looks empty', listing.value, []);
}

report('explorer-fs-helpers');
