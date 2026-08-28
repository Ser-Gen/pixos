// One answer to "what can I launch, and what did I launch recently".
//
// The desktop menu, the start menu and the command palette all read from here, so they
// cannot disagree about what exists or about the order things appear in. The registry
// lookup itself stays in the shell -- this wraps it with recency and matching.

var listApps = function () { return []; };
var readRecents = function () { return Promise.resolve([]); };
var writeRecents = function () { return Promise.resolve(); };

var recents = [];

var RECENT_LIMIT = 8;

export function init (cfg) {
	listApps = cfg.listApps || listApps;
	readRecents = cfg.readRecents || readRecents;
	writeRecents = cfg.writeRecents || writeRecents;
}

export async function load () {
	var stored = await readRecents();
	recents = Array.isArray(stored) ? stored.filter(function (id) { return typeof id === 'string'; }) : [];
	return recents;
}

export function listAll () {
	return listApps();
}

// Recents are stored as bare ids, so an app that has since been uninstalled just drops
// out of the list rather than producing a launcher entry that opens nothing.
export function listRecent (limit) {
	var known = {};
	listApps().forEach(function (app) {
		known[app.id] = app;
	});
	return recents
		.map(function (id) { return known[id]; })
		.filter(Boolean)
		.slice(0, limit || RECENT_LIMIT);
}

// Recents first, then everything else alphabetically. The full list stays complete:
// promoting an app must never make it disappear from where someone expects it.
export function ordered () {
	var recentIds = {};
	var head = listRecent();
	head.forEach(function (app) {
		recentIds[app.id] = true;
	});
	var tail = listApps().filter(function (app) {
		return !recentIds[app.id];
	});
	return {recent: head, rest: tail};
}

export function noteLaunch (appId) {
	if (!appId) {
		return Promise.resolve();
	}
	recents = [appId].concat(recents.filter(function (id) {
		return id !== appId;
	})).slice(0, RECENT_LIMIT * 2);
	return writeRecents(recents);
}

export function getRecentIds () {
	return recents.slice();
}

// Higher is better, null means no match. The tiers matter more than the numbers: an
// exact name always wins, then a prefix, then a word start, then anything contained,
// and only then a scattered subsequence -- so typing "ma" reaches "App Manager" without
// "ma" buried in some other name outranking it.
export function score (text, query) {
	var haystack = String(text || '').toLowerCase();
	var needle = String(query || '').toLowerCase().trim();

	if (!needle) {
		return 0;
	}
	if (!haystack) {
		return null;
	}
	if (haystack === needle) {
		return 1000;
	}
	if (haystack.indexOf(needle) === 0) {
		return 900 - haystack.length;
	}

	var words = haystack.split(/[\s\-_./]+/);
	for (var i = 0; i < words.length; i++) {
		if (words[i].indexOf(needle) === 0) {
			return 800 - i - haystack.length * 0.01;
		}
	}
	// Initials: "dt" finds "Disk Treemap".
	if (words.length > 1) {
		var initials = words.map(function (word) { return word.charAt(0); }).join('');
		if (initials.indexOf(needle) === 0) {
			return 780;
		}
	}
	if (haystack.indexOf(needle) > -1) {
		return 700 - haystack.indexOf(needle);
	}

	return subsequenceScore(haystack, needle);
}

// Letters in order but not adjacent. Penalised by how spread out the match is, so a
// tight match ranks above a scattered one.
function subsequenceScore (haystack, needle) {
	var index = 0;
	var first = -1;
	var last = -1;
	for (var i = 0; i < haystack.length && index < needle.length; i++) {
		if (haystack.charAt(i) === needle.charAt(index)) {
			if (first === -1) {
				first = i;
			}
			last = i;
			index++;
		}
	}
	if (index < needle.length) {
		return null;
	}
	return 600 - (last - first);
}

export function search (query, limit) {
	var trimmed = String(query || '').trim();
	if (!trimmed) {
		var all = ordered();
		return all.recent.concat(all.rest).slice(0, limit || 50);
	}
	return listApps()
		.map(function (app) {
			// An app is findable by what it is called and by what it is called on disk.
			var best = Math.max(
				score(app.name, trimmed) === null ? -1 : score(app.name, trimmed),
				score(app.id, trimmed) === null ? -1 : score(app.id, trimmed) - 5
			);
			return {app: app, score: best};
		})
		.filter(function (entry) {
			return entry.score >= 0;
		})
		.sort(function (a, b) {
			return b.score - a.score || a.app.name.localeCompare(b.app.name);
		})
		.slice(0, limit || 50)
		.map(function (entry) {
			return entry.app;
		});
}
