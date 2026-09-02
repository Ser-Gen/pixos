// The archive engine: 7-Zip, in WebAssembly, behind two functions.
//
// `inspect` says what is inside an archive; `extract` gets it out. Everything that
// decides *what a result means* is in ./parse.js, which is pure and tested; this file is
// the part that cannot be — loading the engine, moving bytes in and out of its private
// filesystem, and running one command.
//
// Three things about the engine shape the code around it, and none is obvious:
//
// 1. **One command per instance.** Emscripten does not reset memory between runs, so
//    JS7z refuses a second `callMain` and says why. Every run below starts a fresh
//    instance; listing an archive and then extracting it is two engines, not one.
// 2. **It has its own filesystem.** Nothing it touches is a real path — the archive is
//    written into `/in`, the output lands in `/out`, and the results are read back out
//    and handed over as bytes. The caller decides where they end up.
// 3. **Failure arrives as text.** `onExit` gives a coarse code; the reason is in the
//    lines 7-Zip printed. See ./parse.js.
//
// The engine itself is 1.4 MB and most sessions never open an archive, so it is loaded on
// first use rather than by Explorer at startup — as a plain `<script>`, because that is
// what the release is: a UMD bundle that assigns a global. Importing it as a module is
// not an option, and not only stylistically. Its Node branch calls `require` at the top
// level beside a top-level `await`, which no module loader will take.

import * as parse from './parse.js';

export var ARCHIVE_EXTENSIONS = parse.ARCHIVE_EXTENSIONS;
export var isArchiveName = parse.isArchiveName;
export var destinationFor = parse.destinationFor;
export var baseNameFor = parse.baseNameFor;

var enginePromise = null;

// Resolved against this module rather than the document: the document is Explorer, two
// folders away, and every relative guess from there is wrong.
function vendorUrl (file) {
	return new URL('../vendor/' + file, import.meta.url).href;
}

function engine () {
	if (enginePromise) {
		return enginePromise;
	}
	enginePromise = new Promise(function (resolve, reject) {
		if (typeof window !== 'undefined' && window.JS7z) {
			resolve(window.JS7z);
			return;
		}
		var script = document.createElement('script');
		script.src = vendorUrl('js7z.js');
		script.onload = function () {
			if (window.JS7z) {
				resolve(window.JS7z);
				return;
			}
			reject(ArchiveError({
				kind: 'engine',
				title: 'The archive engine did not load',
				message: 'The file loaded but defined nothing. It may have been replaced '
					+ 'by something else.'
			}));
		};
		script.onerror = function () {
			// The engine lives in the filesystem like any other app file, so the honest
			// reading of this is that it is not installed rather than that the network
			// failed -- nothing here is fetched from anywhere else.
			reject(ArchiveError({
				kind: 'engine',
				title: 'The archive engine is missing',
				message: 'apps/7z/vendor/js7z.js could not be loaded. Reload PixOS to have '
					+ 'the system files copied in again.'
			}));
		};
		document.head.appendChild(script);
	});
	// A failed load must not be remembered as the answer: the next attempt should try
	// again rather than replay the failure for the rest of the session.
	enginePromise.catch(function () {
		enginePromise = null;
	});
	return enginePromise;
}

// Thrown for anything a person should be told about. `failure` is the classification, so
// a caller reports the sentence rather than inventing one from an exit code.
export function ArchiveError (failure) {
	var error = new Error(failure.title + ' — ' + failure.message);
	error.name = 'ArchiveError';
	error.failure = failure;
	return error;
}

function asBytes (data) {
	if (data instanceof Uint8Array) {
		return data;
	}
	if (data && data.buffer) {
		return new Uint8Array(data.buffer, data.byteOffset || 0, data.length !== undefined ? data.length : data.byteLength);
	}
	return new Uint8Array(data);
}

// One command, one engine, one promise. `setup` gets the instance before main runs, which
// is the only moment its filesystem can be filled.
function run (args, setup) {
	return engine().then(function (JS7z) {
		return new Promise(function (resolve, reject) {
			var stdout = [];
			var stderr = [];
			var instance = null;
			var settled = false;

			function settle (code) {
				if (settled) {
					return;
				}
				settled = true;
				resolve({
					code: code,
					stdout: stdout,
					stderr: stderr,
					fs: instance ? instance.FS : null
				});
			}

			JS7z({
				// `locateFile` rather than letting Emscripten work it out: it takes the
				// wasm's location from the script's own URL, and Explorer loads this one
				// from a folder of its own.
				locateFile: vendorUrl,
				print: function (line) { stdout.push(line); },
				printErr: function (line) { stderr.push(line); },
				onAbort: function (reason) {
					if (settled) {
						return;
					}
					settled = true;
					reject(ArchiveError({
						kind: 'engine',
						title: 'The archive engine stopped',
						message: String(reason || 'It gave no reason.')
					}));
				},
				onExit: settle
			}).then(function (js7z) {
				instance = js7z;
				try {
					setup(js7z);
					js7z.callMain(args);
				}
				catch (err) {
					if (!settled) {
						settled = true;
						reject(err);
					}
					return;
				}
				// This build runs on the calling thread, so by here the command has
				// finished. `onExit` has normally fired already; if it has not, the run
				// still has to end — a promise that never settles is a dialog that spins
				// for ever.
				settle(0);
			}).catch(function (err) {
				if (!settled) {
					settled = true;
					reject(err);
				}
			});
		});
	});
}

function withArchive (bytes, extra) {
	return function (js7z) {
		js7z.FS.mkdir('/in');
		js7z.FS.mkdir('/out');
		js7z.FS.writeFile('/in/archive', asBytes(bytes));
		if (extra) {
			extra(js7z);
		}
	};
}

// Every file under `dir`, as {path, data}, with `path` relative to it. Directories are
// not returned: an empty one is worth keeping, so it comes back separately.
function collect (fs, dir) {
	var files = [];
	var dirs = [];

	function walk (current, prefix) {
		var names;
		try {
			names = fs.readdir(current);
		}
		catch (err) {
			return;
		}
		names.forEach(function (name) {
			if (name === '.' || name === '..') {
				return;
			}
			var full = current + '/' + name;
			var relative = prefix ? prefix + '/' + name : name;
			var stats = fs.stat(full);
			if (fs.isDir(stats.mode)) {
				dirs.push(relative);
				walk(full, relative);
			}
			else {
				files.push({path: relative, data: fs.readFile(full)});
			}
		});
	}

	walk(dir, '');
	return {files: files, dirs: dirs};
}

// What is inside, without writing anything anywhere.
//
// Returns {entries, encrypted, needsPassword, failure, unwrapped}. A password is not an
// error here: an archive whose *headers* are encrypted cannot even be listed without one,
// so `needsPassword` is the answer and the caller asks.
export async function inspect (bytes, options) {
	var cfg = options || {};
	var result = await run(parse.listArgs({password: cfg.password}), withArchive(bytes));
	var failure = parse.classify({
		code: result.code,
		stdout: result.stdout,
		stderr: result.stderr,
		hadPassword: !!cfg.password,
		expect: 'listing'
	});

	if (failure.kind === 'password' || failure.kind === 'password-needed') {
		return {entries: [], encrypted: true, needsPassword: true, failure: failure};
	}
	if (failure.kind !== 'ok' && failure.kind !== 'partial') {
		return {entries: [], encrypted: false, needsPassword: false, failure: failure};
	}

	var entries = parse.parseListing(result.stdout.join('\n'));

	// A `.tar.gz` lists exactly one thing: the tar inside it. Showing that as the contents
	// would be true and useless, so the wrapper is opened and the real listing comes from
	// within. It costs a full decompression to answer a question about the contents, and
	// that is the honest price of the format.
	if (parse.isTarball(cfg.name) && entries.length === 1) {
		var inner = await extractRaw(bytes, {password: cfg.password});
		if (inner.files.length === 1) {
			var nested = await inspect(inner.files[0].data, {name: inner.files[0].path});
			nested.unwrapped = true;
			return nested;
		}
	}

	return {
		entries: entries,
		encrypted: parse.isEncryptedListing(entries),
		needsPassword: false,
		failure: null
	};
}

// One pass, no unwrapping, no error translation -- the shared middle of the two public
// paths.
async function extractRaw (bytes, options) {
	var cfg = options || {};
	var listFile = (cfg.paths && cfg.paths.length) ? '/in/selected.txt' : null;
	var result = await run(
		parse.extractArgs({password: cfg.password, listFile: listFile}),
		withArchive(bytes, listFile ? function (js7z) {
			js7z.FS.writeFile(listFile, cfg.paths.join('\n') + '\n');
		} : null)
	);
	var failure = parse.classify({
		code: result.code,
		stdout: result.stdout,
		stderr: result.stderr,
		hadPassword: !!cfg.password
	});
	if (failure.kind !== 'ok' && failure.kind !== 'partial') {
		// Deliberately before reading anything back: a failed run still leaves files in
		// `/out` — truncated, or filled with the garbage a wrong password decrypts to —
		// and writing those into somebody's folder is worse than the failure itself.
		throw ArchiveError(failure);
	}
	var collected = collect(result.fs, '/out');
	return {files: collected.files, dirs: collected.dirs, failure: failure};
}

// The contents, as bytes. `paths` selects a subset by the paths `inspect` returned;
// omitted, everything comes out.
export async function extract (bytes, options) {
	var cfg = options || {};

	if (!parse.isTarball(cfg.name)) {
		return extractRaw(bytes, cfg);
	}

	// A tarball is two archives. Unwrap the outer one whole -- there is nothing to select
	// from, it holds a single tar -- and apply the selection to the tar inside.
	var outer = await extractRaw(bytes, {password: cfg.password});
	if (outer.files.length !== 1) {
		return outer;
	}
	var inner = await extractRaw(outer.files[0].data, {paths: cfg.paths});
	inner.unwrapped = true;
	return inner;
}

// Making one. `files` and `dirs` are what the caller read out of its own filesystem --
// this module has no idea what BrowserFS is, exactly as it does not when extracting, and
// the two directions are symmetrical: files in, archive out; archive in, files out.
//
// options: {name, format, preset, password, encryptNames, files: [{path, data}], dirs: []}
// Returns {name, data}.
export async function compress (options) {
	var cfg = options || {};
	var steps = parse.compressSteps(cfg);
	var files = cfg.files || [];
	var dirs = cfg.dirs || [];

	// The names handed to 7-Zip are the top level of what was selected, and the engine
	// recurses into the folders itself. Passing every path would flatten a selection into
	// a list and lose the shape of it.
	var roots = [];
	var seen = {};
	files.concat(dirs.map(function (dir) {
		return {path: dir};
	})).forEach(function (entry) {
		var root = String(entry.path || '').split('/')[0];
		if (root && !seen[root]) {
			seen[root] = true;
			roots.push(root);
		}
	});
	if (!roots.length) {
		throw ArchiveError({
			kind: 'empty',
			title: 'There is nothing to compress',
			message: 'No files were selected, or the folder is empty.'
		});
	}

	var carried = null;
	var result = null;

	for (var i = 0; i < steps.length; i++) {
		var step = steps[i];
		var previous = carried;
		var run7z = await run(step.args, (function (stage, before) {
			return function (js7z) {
				js7z.FS.mkdir('/in');
				js7z.FS.mkdir('/out');
				if (stage.fromPrevious) {
					// The second half of a tarball: this engine has never seen the source
					// files, only what the first one produced.
					js7z.FS.writeFile('/in/' + before.name, before.data);
				}
				else {
					dirs.forEach(function (dir) {
						makeDirs(js7z.FS, '/in/' + dir);
					});
					files.forEach(function (file) {
						makeDirs(js7z.FS, dirname('/in/' + file.path));
						js7z.FS.writeFile('/in/' + file.path, asBytes(file.data));
					});
					js7z.FS.writeFile('/list.txt', roots.join('\n') + '\n');
				}
				// Relative names, so the archive holds `notes/a.txt` rather than
				// `/in/notes/a.txt`. Every archive tool would show the second, and every
				// person would call it a bug.
				js7z.FS.chdir('/in');
			};
		}(step, previous)));

		var failure = parse.classify({
			code: run7z.code,
			stdout: run7z.stdout,
			stderr: run7z.stderr,
			hadPassword: !!cfg.password
		});
		if (failure.kind !== 'ok' && failure.kind !== 'partial') {
			throw ArchiveError(failure);
		}

		var data;
		try {
			data = run7z.fs.readFile(step.output);
		}
		catch (err) {
			throw ArchiveError({
				kind: 'failed',
				title: 'The archive was not written',
				message: 'The engine reported success but produced no file, which should '
					+ 'not be possible.'
			});
		}
		carried = {name: step.name, data: data};
		result = carried;
	}

	return result;
}

function dirname (filePath) {
	var parts = String(filePath).split('/');
	parts.pop();
	return parts.join('/') || '/';
}

function makeDirs (fs, dirPath) {
	var parts = String(dirPath).split('/').filter(Boolean);
	var current = '';
	parts.forEach(function (part) {
		current += '/' + part;
		try {
			fs.mkdir(current);
		}
		catch (err) {
			// Already there, which is the common case: every file in a folder asks for it.
		}
	});
}
