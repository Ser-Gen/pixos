// Finding a file by part of its name, without an index.
//
// The palette used to list exactly one directory, so a file you could not remember the
// path of was a file you could not open. This walks the tree instead — and the walk is
// the entire design problem, because a filesystem in a browser has no `find` and no way
// to ask how big it is before starting.
//
// Four rules, each of them the answer to a way this goes wrong:
//
//   - **Breadth-first.** Shallow matches are the ones you probably meant. A depth-first
//     walk spends its whole budget inside the first deep folder it finds and reports
//     nothing from the four beside it.
//   - **A result cap and a time budget, and the result says which one it hit.** Stopping
//     silently at 200 matches would misreport a truncated answer as a complete one, which
//     is worse than being slow.
//   - **The budget is a deadline, not a between-directories check.** A mount reads over
//     the network, and one `readdir` that never answers would hang the walk however often
//     the elapsed time is checked around it. So each read races the remaining budget.
//   - **Cancellable.** Typing eight characters starts eight walks; without a token the
//     first seven keep reading the disk to produce answers nobody will see.
//
// `readdir` is injected — the shell hands in one backed by BrowserFS — so all of this is
// testable against a tree made of object literals.

var DEFAULT_LIMIT = 200;
var DEFAULT_BUDGET = 300;

// /apps is thousands of vendored library files (Monaco alone is 94) and is almost never
// what anyone is looking for. Naming it in the query opts back in, so the skip is a
// default rather than a wall.
export function buildSkip (query, root) {
	var optedIn = /^\/apps(\/|$)/i.test(String(query || ''))
		|| /^\/apps(\/|$)/i.test(String(root || ''));
	return function (dirPath) {
		return !optedIn && /^\/apps(\/|$)/i.test(dirPath);
	};
}

export function createToken () {
	var token = {cancelled: false};
	token.cancel = function () {
		token.cancelled = true;
	};
	return token;
}

function joinPath (dir, name) {
	return (dir === '/' ? '' : dir) + '/' + name;
}

// Resolves to `fallback` if the promise has not settled within `ms`. The walk keeps its
// deadline even when the thing it is waiting on never answers.
function withDeadline (promise, ms, fallback, timers) {
	if (!(ms > 0)) {
		return Promise.resolve(fallback);
	}
	return new Promise(function (resolve) {
		var settled = false;
		var timer = timers.setTimeout(function () {
			if (!settled) {
				settled = true;
				resolve(fallback);
			}
		}, ms);
		Promise.resolve(promise).then(function (value) {
			if (!settled) {
				settled = true;
				timers.clearTimeout(timer);
				resolve(value);
			}
		}, function () {
			if (!settled) {
				settled = true;
				timers.clearTimeout(timer);
				resolve(fallback);
			}
		});
	});
}

// cfg: {readdir, query, root, limit, budgetMs, skip, token, now, setTimeout, clearTimeout}
//
// Resolves to {matches, partial, reason, scanned, cancelled}. `partial` is what the
// caller shows the user; `reason` is which limit stopped it.
export async function search (cfg) {
	var config = cfg || {};
	var needle = String(config.query || '').toLowerCase().trim();
	var root = config.root || '/';
	var limit = config.limit || DEFAULT_LIMIT;
	var budget = config.budgetMs === undefined ? DEFAULT_BUDGET : config.budgetMs;
	// Defaulted rather than required: a caller that forgets would otherwise crawl every
	// vendored library file in /apps, which is the one directory nobody means.
	var skip = config.skip || buildSkip(config.query, root);
	var token = config.token || null;
	var now = config.now || Date.now;
	var timers = {
		setTimeout: config.setTimeout || function (fn, ms) { return setTimeout(fn, ms); },
		clearTimeout: config.clearTimeout || function (id) { return clearTimeout(id); }
	};

	var result = {matches: [], partial: false, reason: null, scanned: 0, cancelled: false};
	if (!needle || !config.readdir) {
		return result;
	}

	var started = now();
	var queue = [{path: root, depth: 0}];

	while (queue.length) {
		if (token && token.cancelled) {
			result.cancelled = true;
			return result;
		}
		var remaining = budget - (now() - started);
		if (remaining <= 0) {
			result.partial = true;
			result.reason = 'budget';
			return result;
		}

		var current = queue.shift();
		var entries = await withDeadline(
			Promise.resolve().then(function () { return config.readdir(current.path); }),
			remaining, [], timers);
		result.scanned++;

		for (var i = 0; i < entries.length; i++) {
			var entry = entries[i];
			var full = joinPath(current.path, entry.name);
			if (String(entry.name).toLowerCase().indexOf(needle) > -1) {
				result.matches.push({
					name: entry.name,
					path: full,
					isDirectory: !!entry.isDirectory,
					depth: current.depth + 1
				});
				if (result.matches.length >= limit) {
					result.partial = true;
					result.reason = 'limit';
					return result;
				}
			}
			if (entry.isDirectory && !skip(full)) {
				queue.push({path: full, depth: current.depth + 1});
			}
		}
	}

	return result;
}

// What to say about a truncated result, in one place so the palette cannot describe the
// two limits as if they were the same thing — one means "narrow the query", the other
// means "the tree is bigger than the time allowed".
export function describe (result) {
	if (!result || !result.partial) {
		return null;
	}
	if (result.reason === 'limit') {
		return 'First ' + result.matches.length + ' matches — type more to narrow it down';
	}
	return 'Stopped searching after a moment. These are the matches found so far';
}
