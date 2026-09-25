// The screensavers PixOS knows of: the ones in /apps/screensavers, and the ones it can download
// into it. Phase 26, pass 4; docs/screensavers-plan.md.
//
// **Downloaded on first use, not at boot.** Matrix, Pipes and Desktop Habitats cost from half a
// megabyte to 17.6 MB a look, 23 MB together, and most people will choose one of them or none. So
// the served repo keeps them in apps/screensavers/, the generator lists them in
// apps/screensavers/index.json (scripts/screensaver-index.js), and a look's files are copied into
// BrowserFS the first time it is chosen. It works offline after that, and deleting its folder in
// Explorer gives the space back.
//
// **A look needs its own files and the shared ones, and only those are fetched.** The index lists
// them per look, so Riverscape does not bring Reefscape's rock with it, and the second look of a
// folder costs only what it adds. A file counts as here when BrowserFS has it: a write is one
// IndexedDB value, so a file is either all there or not there at all.
//
// **The page a look opens is written last.** A download cut short -- a lost connection, a closed
// tab -- then leaves a look whose page is missing, which fails to mount and says so, rather than
// one that starts and draws without half its textures. Choosing it again fetches what is missing.
//
// Everything that reaches the network or the filesystem is a parameter of `createCatalog`, which
// is the only reason any of this can be tested; index.html hands in window.fs and fetch.

import {isScreensaverPath, pageName, readLooks} from './wallpaper-page.js';

export var SCREENSAVERS_DIR = '/apps/screensavers';
// Served from the repo, never copied into BrowserFS.
export var INDEX_PATH = SCREENSAVERS_DIR + '/index.json';

// --- the pure half, exported for the tests ---------------------------------------------------------

function bare (value) {
	return String(value || '').replace(/\/+$/, '');
}

function isFolderName (name) {
	return /\.xscr\/?$/i.test(name);
}

function byName (a, b) {
	return a.name.localeCompare(b.name);
}

// A path the index may name: the screensaver itself, or a file inside its folder, with nothing
// that climbs out -- the index is served from the same place as the shell, but a path in it is
// written into BrowserFS, and /settings is right next door.
function inside (screensaver, file) {
	if (file === screensaver) {
		return !isFolderName(screensaver);
	}
	if (!isFolderName(screensaver) || file.indexOf(screensaver + '/') !== 0) {
		return false;
	}
	return file.slice(screensaver.length + 1).split('/').every(function (part) {
		return part && part !== '.' && part !== '..';
	});
}

// The file a look's page is, from its entry: no query, no hash, unescaped.
export function entryFile (screensaver, entry) {
	if (!isFolderName(screensaver)) {
		return screensaver;
	}
	var page = String(entry || 'index.html').split(/[?#]/)[0];
	try {
		page = decodeURIComponent(page);
	}
	catch (err) {
		// A stray % is a character in a filename.
	}
	return bare(screensaver) + '/' + page;
}

// The generated index, taken defensively: a screensaver or a look the shell could not download is
// left out, and anything that is not an index is an empty one.
export function readIndex (doc) {
	var list = doc && Array.isArray(doc.screensavers) ? doc.screensavers : [];
	return list.filter(function (entry) {
		return entry && typeof entry.path === 'string' && entry.path.indexOf('/') === -1
			&& isScreensaverPath(entry.path) && Array.isArray(entry.files) && Array.isArray(entry.looks);
	}).map(function (entry) {
		var sizes = {};
		entry.files.forEach(function (file) {
			if (file && typeof file.path === 'string' && inside(entry.path, file.path) && Number(file.size) >= 0) {
				sizes[file.path] = Number(file.size);
			}
		});
		var named = readLooks({looks: entry.looks});
		var looks = named.map(function (look) {
			var raw = entry.looks.find(function (candidate) {
				return candidate && typeof candidate.name === 'string' && candidate.name.trim() === look.name;
			});
			return Object.assign(look, {files: raw && Array.isArray(raw.files) ? raw.files : null});
		}).filter(function (look) {
			return look.files && look.files.length && look.files.every(function (file) {
				return Object.prototype.hasOwnProperty.call(sizes, file);
			}) && look.files.indexOf(entryFile(entry.path, look.entry)) > -1;
		});
		return {
			name: typeof entry.name === 'string' && entry.name ? entry.name : pageName(entry.path),
			path: entry.path,
			sizes: sizes,
			looks: looks
		};
	}).filter(function (entry) {
		return entry.looks.length > 0;
	});
}

function bytesOf (entry, files) {
	return files.reduce(function (sum, file) {
		return sum + (entry.sizes[file] || 0);
	}, 0);
}

// What the gallery offers: one entry per screensaver, by name -- every one the index can download
// and every one on disk -- each with its looks and how much each still has to fetch.
//
//   index   readIndex's
//   local   what is in /apps/screensavers: [{name: 'Matrix.xscr', looks, present}], where `looks`
//           is its looks.json read (a folder the index does not know) and `present` the paths,
//           relative to /apps/screensavers, that are there
//
// `looks` is null for a screensaver with none: one page, one tile. **A look is offered when its
// page is here or the index can download it**: offline there is no index, and a folder with one
// look of two downloaded still lists both in its looks.json. A folder with looks and none of their
// pages is left out -- there is nothing in it to show.
export function gallery (index, local) {
	var known = {};
	var out = (index || []).map(function (entry) {
		known[entry.path] = true;
		var here = (local || []).find(function (item) {
			return bare(item.name) === entry.path;
		});
		var present = (here && here.present) || new Set();
		return {
			name: entry.name,
			path: SCREENSAVERS_DIR + '/' + entry.path,
			looks: entry.looks.map(function (look) {
				return describeLook(look, bytesOf(entry, look.files.filter(function (file) {
					return !present.has(file);
				})));
			})
		};
	});
	(local || []).forEach(function (item) {
		var name = bare(item.name);
		if (known[name] || !isScreensaverPath(name)) {
			return;
		}
		var looks = (item.looks || []).filter(function (look) {
			return !item.present || item.present.has(entryFile(name, look.entry));
		});
		if (item.looks && item.looks.length && !looks.length) {
			return;
		}
		out.push({
			name: pageName(name),
			path: SCREENSAVERS_DIR + '/' + name,
			looks: looks.length ? looks.map(function (look) {
				return describeLook(look, 0);
			}) : null
		});
	});
	return out.sort(byName);
}

function describeLook (look, missing) {
	var out = {name: look.name, missing: missing};
	if (look.entry !== undefined) {
		out.entry = look.entry;
	}
	if (look.tile !== undefined) {
		out.tile = look.tile;
	}
	return out;
}

// What to fetch for one look, in the order to write it: what it needs that is not here, the page
// that opens it last. Null when the screensaver has no such look.
export function downloadPlan (entry, lookName, present) {
	var look = entry && entry.looks.find(function (candidate) {
		return candidate.name === lookName;
	});
	if (!look) {
		return null;
	}
	var opens = entryFile(entry.path, look.entry);
	var have = present || new Set();
	return look.files.filter(function (file) {
		return !have.has(file);
	}).sort(function (a, b) {
		return (a === opens) - (b === opens) || (a < b ? -1 : (a > b ? 1 : 0));
	}).map(function (file) {
		return {path: file, size: entry.sizes[file]};
	});
}

// --- the catalog -----------------------------------------------------------------------------------

// deps, every one returning a promise:
//   loadIndex()             the served index.json, parsed, or null
//   readdir(path)           names in a BrowserFS folder; rejects when there is none
//   stat(path)              {isDirectory: bool}, or null when there is nothing there
//   readText(path)          a BrowserFS file as text
//   fetchFile(path)         a file from the served repo, by the path it will have in BrowserFS, as
//                           an ArrayBuffer or a typed array; rejects on anything but a 200
//   writeFile(path, bytes)  rejects when BrowserFS refuses it
//   mkdir(path)             resolves when the folder is there, made now or before
export function createCatalog (deps) {
	var running = {};

	function loadIndex () {
		return Promise.resolve().then(deps.loadIndex).then(readIndex, function () {
			return [];
		});
	}

	// Every file under `dir`, relative to /apps/screensavers, or nothing if there is no such folder.
	function walk (dir) {
		var found = new Set();
		function visit (folder) {
			return deps.readdir(folder).then(function (names) {
				return Promise.all(names.map(function (name) {
					var full = folder + '/' + name;
					return deps.stat(full).then(function (stats) {
						if (stats && stats.isDirectory) {
							return visit(full);
						}
						if (stats) {
							found.add(full.slice(SCREENSAVERS_DIR.length + 1));
						}
					});
				}));
			});
		}
		return visit(dir).then(function () {
			return found;
		}, function () {
			return found;
		});
	}

	function present (name) {
		var full = SCREENSAVERS_DIR + '/' + name;
		if (isFolderName(name)) {
			return walk(full);
		}
		return deps.stat(full).then(function (stats) {
			return new Set(stats ? [name] : []);
		}, function () {
			return new Set();
		});
	}

	function localLooks (name) {
		if (!isFolderName(name)) {
			return Promise.resolve(null);
		}
		return Promise.resolve().then(function () {
			return deps.readText(SCREENSAVERS_DIR + '/' + name + '/looks.json');
		}).then(function (text) {
			return readLooks(JSON.parse(text));
		}).catch(function () {
			return null;
		});
	}

	// One at a time, and each once: `made` is what this download has already made.
	function makeDirs (dir, made) {
		var parts = dir.split('/').filter(Boolean);
		return parts.reduce(function (chain, part, index) {
			var folder = '/' + parts.slice(0, index + 1).join('/');
			return chain.then(function () {
				if (made[folder]) {
					return;
				}
				return Promise.resolve(deps.mkdir(folder)).then(function () {
					made[folder] = true;
				});
			});
		}, Promise.resolve());
	}

	function list () {
		return Promise.all([
			loadIndex(),
			Promise.resolve().then(function () {
				return deps.readdir(SCREENSAVERS_DIR);
			}).catch(function () {
				return [];
			})
		]).then(function (both) {
			var index = both[0];
			var indexed = {};
			index.forEach(function (entry) {
				indexed[entry.path] = true;
			});
			return Promise.all(both[1].filter(isScreensaverPath).map(function (raw) {
				var name = bare(raw);
				return Promise.all([present(name), indexed[name] ? null : localLooks(name)]).then(function (read) {
					return {name: name, looks: read[1], present: read[0]};
				});
			})).then(function (local) {
				return gallery(index, local);
			});
		});
	}

	// `path` is the screensaver's, as the gallery gives it. Resolves when every file the look needs
	// is written. `onProgress(done, total, file)` is called with 0 first and after each file, in
	// bytes; `file` is the one just written, relative to the screensaver's folder. Asked for twice
	// while it runs, it is the same download.
	function download (path, lookName, onProgress) {
		var key = bare(path) + '\n' + lookName;
		if (running[key]) {
			return running[key];
		}
		var report = typeof onProgress === 'function' ? onProgress : function () {};
		var name = bare(path).slice(SCREENSAVERS_DIR.length + 1);
		var job = loadIndex().then(function (index) {
			var entry = bare(path).indexOf(SCREENSAVERS_DIR + '/') === 0 && index.find(function (candidate) {
				return candidate.path === name;
			});
			if (!entry) {
				throw new Error((pageName(path) || path) + ' is not a screensaver PixOS can download.');
			}
			return present(name).then(function (have) {
				var plan = downloadPlan(entry, lookName, have);
				if (!plan) {
					throw new Error(entry.name + ' has no look called ' + lookName + '.');
				}
				var total = plan.reduce(function (sum, file) {
					return sum + file.size;
				}, 0);
				var done = 0;
				var made = {};
				report(0, total, null);
				return plan.reduce(function (chain, file) {
					return chain.then(function () {
						var target = SCREENSAVERS_DIR + '/' + file.path;
						return Promise.resolve(deps.fetchFile(target)).then(function (bytes) {
							var size = bytes ? (bytes.byteLength !== undefined ? bytes.byteLength : bytes.length) : -1;
							// The server's fallback page for a missing file is a 200 too, on some hosts.
							if (size !== file.size) {
								throw new Error(file.path + ' should be ' + file.size + ' bytes, and the server sent ' + size + '.');
							}
							return makeDirs(target.slice(0, target.lastIndexOf('/')), made).then(function () {
								return deps.writeFile(target, bytes);
							});
						}).then(function () {
							done += file.size;
							report(done, total, file.path.slice(name.length + 1) || file.path);
						});
					});
				}, Promise.resolve()).then(function () {
					return {files: plan.length, bytes: total};
				});
			});
		});
		running[key] = job;
		var clear = function () {
			delete running[key];
		};
		job.then(clear, clear);
		return job;
	}

	return {list: list, download: download};
}
