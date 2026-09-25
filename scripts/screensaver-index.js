'use strict';

// apps/screensavers/index.json: every screensaver PixOS can download, written from the folders
// beside it. Phase 26, pass 4; docs/screensavers-plan.md.
//
// A screensaver that settings/preinstall.json copies in (the slideshow) is not listed: it is
// already there. Everything else in apps/screensavers is, with each of its files, their sizes and
// hashes, and its looks -- so the shell's gallery knows what a look costs and what to fetch
// without a hand-kept list that would rot the way apps/app-catalog.js once did.
//
// **A look claims the files only it needs, and every file no look claims is shared.** Reefscape is
// 15 MB of rock and Riverscape 4 MB of wood and sand; a look that claimed nothing would download
// both. So a look's `files` in looks.json name what it owns -- a file, or a folder ending in `/` --
// and what it needs is its own files plus the shared ones. A folder with no looks.json is one look,
// named after the screensaver, needing everything.
//
// Written by scripts/generate-apps-catalog.js, and required by tests/screensaver-index.test.mjs,
// which builds it again from disk and compares. Anything wrong with a looks.json throws, naming
// the folder: a look that silently claimed nothing would silently download too much.

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var SKIP_FILE_NAMES = {'.DS_Store': true, 'Thumbs.db': true, 'desktop.ini': true};
var LOOKS_FILE = 'looks.json';

function isScreensaverName (name) {
	return /\.xscr(\.html?)?$/i.test(name);
}

function screensaverName (name) {
	return name.replace(/\.xscr(\.html?)?$/i, '');
}

// Every file under `dir`, as a path relative to it with forward slashes, sorted.
function walk (dir, prefix, list) {
	fs.readdirSync(dir, {withFileTypes: true}).forEach(function (entry) {
		if (SKIP_FILE_NAMES[entry.name]) {
			return;
		}
		var relative = prefix ? prefix + '/' + entry.name : entry.name;
		if (entry.isDirectory()) {
			walk(path.join(dir, entry.name), relative, list);
		}
		else if (entry.isFile()) {
			list.push(relative);
		}
	});
	return list;
}

function byPath (a, b) {
	return a < b ? -1 : (a > b ? 1 : 0);
}

// The same rule the shell's pageUrl applies to a look's page: relative, and inside the folder.
function badEntry (entry) {
	return typeof entry !== 'string' || !entry || entry.charAt(0) === '/'
		|| /^[a-z][a-z0-9+.-]*:/i.test(entry) || /(^|\/)\.\.(\/|$|\?|#)/.test(entry);
}

// The page a look opens, without its query or hash and unescaped: the file it has to have. The
// shell's entryFile in js/shell/screensaver-catalog.js reads it the same way.
function entryFile (entry) {
	var page = String(entry).split(/[?#]/)[0];
	try {
		return decodeURIComponent(page);
	}
	catch (err) {
		return page;
	}
}

function readLooks (folder, label, files) {
	var file = path.join(folder, LOOKS_FILE);
	if (!fs.existsSync(file)) {
		return [{name: label, own: []}];
	}
	var fail = function (why) {
		throw new Error(path.basename(folder) + '/' + LOOKS_FILE + ': ' + why);
	};
	var doc;
	try {
		doc = JSON.parse(fs.readFileSync(file, 'utf8'));
	}
	catch (err) {
		fail('not JSON (' + err.message + ')');
	}
	if (!doc || !Array.isArray(doc.looks) || !doc.looks.length) {
		fail('needs a non-empty "looks" array');
	}
	var seen = {};
	return doc.looks.map(function (look, index) {
		var where = 'look ' + (index + 1);
		if (!look || typeof look.name !== 'string' || !look.name.trim()) {
			fail(where + ' has no name');
		}
		var name = look.name.trim();
		if (seen[name]) {
			fail('two looks are called ' + name);
		}
		seen[name] = true;
		if (look.entry !== undefined) {
			if (badEntry(look.entry)) {
				fail(name + ': "entry" must be a page inside the folder, not ' + JSON.stringify(look.entry));
			}
			if (files.indexOf(entryFile(look.entry)) === -1) {
				fail(name + ': its entry ' + entryFile(look.entry) + ' is not in the folder');
			}
		}
		else if (files.indexOf('index.html') === -1) {
			fail(name + ': no "entry", and no index.html to open instead');
		}
		if (look.tile !== undefined && typeof look.tile !== 'string') {
			fail(name + ': "tile" is a CSS background, a string');
		}
		var claims = look.files === undefined ? [] : look.files;
		if (!Array.isArray(claims)) {
			fail(name + ': "files" is a list');
		}
		var own = [];
		claims.forEach(function (claim) {
			if (typeof claim !== 'string' || !claim) {
				fail(name + ': a claim in "files" is not a path');
			}
			var matched = files.filter(function (candidate) {
				return claim.charAt(claim.length - 1) === '/' ? candidate.indexOf(claim) === 0 : candidate === claim;
			});
			if (!matched.length) {
				fail(name + ': "' + claim + '" matches no file');
			}
			own = own.concat(matched);
		});
		var out = {name: name, own: own};
		if (look.entry !== undefined) {
			out.entry = look.entry;
		}
		if (look.tile !== undefined) {
			out.tile = look.tile;
		}
		return out;
	});
}

// One screensaver, `name` in `dir`: a folder, or a single page.
function buildEntry (dir, name) {
	var full = path.join(dir, name);
	var folder = fs.statSync(full).isDirectory();
	// Inside the folder, which is what looks.json claims by; a single page is one file and one look
	// with nothing to claim. Every path written out is relative to apps/screensavers, so a folder's
	// files and a single page are fetched and written the same way.
	var relative = folder ? walk(full, '', []).sort(byPath) : [];
	var served = function (file) {
		return folder ? name + '/' + file : name;
	};
	var files = (folder ? relative : ['']).map(function (file) {
		var data = fs.readFileSync(folder ? path.join(full, file) : full);
		return {
			path: served(file),
			size: data.length,
			sha256: 'sha256:' + crypto.createHash('sha256').update(data).digest('hex')
		};
	});
	var sizes = {};
	files.forEach(function (file) {
		sizes[file.path] = file.size;
	});
	var label = screensaverName(name);
	var looks = folder ? readLooks(full, label, relative) : [{name: label, own: []}];
	var claimed = {};
	looks.forEach(function (look) {
		look.own.forEach(function (file) {
			claimed[file] = true;
		});
	});
	var shared = (folder ? relative : ['']).filter(function (file) {
		return !claimed[file];
	});
	return {
		name: label,
		path: name,
		size: files.reduce(function (sum, file) { return sum + file.size; }, 0),
		files: files,
		looks: looks.map(function (look) {
			var needs = shared.concat(look.own.filter(function (file, i, all) {
				return all.indexOf(file) === i;
			})).map(served).sort(byPath);
			var out = {name: look.name};
			if (look.entry !== undefined) {
				out.entry = look.entry;
			}
			if (look.tile !== undefined) {
				out.tile = look.tile;
			}
			out.size = needs.reduce(function (sum, file) { return sum + sizes[file]; }, 0);
			out.files = needs;
			return out;
		})
	};
}

// Whether preinstall.json copies anything under `name` -- then it is there already.
function preinstalled (preinstall, name) {
	var prefix = '/apps/screensavers/' + name;
	return ((preinstall && preinstall.files) || []).some(function (item) {
		var copied = typeof item === 'string' ? item : item && item.path;
		return typeof copied === 'string' && (copied === prefix || copied.indexOf(prefix + '/') === 0);
	});
}

function buildIndex (dir, preinstall) {
	var names = fs.readdirSync(dir).filter(isScreensaverName).filter(function (name) {
		return !preinstalled(preinstall, name);
	}).sort(byPath);
	return {
		_comment: [
			'Generated by scripts/generate-apps-catalog.js from the folders beside it. Do not edit by hand.',
			'Every screensaver PixOS downloads on first use rather than copying in at boot. A look needs',
			'its `files`; the shell fetches the ones not already in BrowserFS. See scripts/screensaver-index.js.'
		],
		version: 1,
		screensavers: names.map(function (name) {
			return buildEntry(dir, name);
		})
	};
}

module.exports = {
	buildIndex: buildIndex,
	buildEntry: buildEntry,
	isScreensaverName: isScreensaverName
};
