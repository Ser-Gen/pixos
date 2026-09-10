// Turning a failure into a sentence.
//
// `fetch` is deliberately vague about why it failed: a request blocked by CORS, a request
// blocked by an extension, and a request that died because the network is gone all reject
// with the same `TypeError: Failed to fetch` and no status. The browser knows the
// difference and will not tell the page, on purpose — so the best we can do is narrow it
// with what we *can* see, and say which possibilities are left rather than guess one.
//
// Everything here is pure. `online` and `pageOrigin` are arguments rather than reads of
// `navigator` and `location` so the whole thing is testable without a browser.

export function isCrossOrigin (url, pageOrigin) {
	try {
		return new URL(String(url), pageOrigin).origin !== pageOrigin;
	}
	catch (err) {
		// Not a URL at all. Whatever went wrong, it was not a cross-origin policy.
		return false;
	}
}

function statusSentence (status, statusText) {
	if (status === 404) {
		return 'The server says there is nothing at that address (404).';
	}
	if (status === 401 || status === 403) {
		return 'The server refused the request (' + status + '). It may need a sign-in that '
			+ 'PixOS cannot provide.';
	}
	if (status === 429) {
		return 'The server is rate-limiting us (429). Waiting a while usually clears it.';
	}
	if (status >= 500) {
		return 'The server failed on its end (' + status + (statusText ? ' ' + statusText : '') + ').';
	}
	return 'The server answered with ' + status + (statusText ? ' ' + statusText : '') + '.';
}

// `context` names the thing being attempted, e.g. 'Could not download the file'.
// `response` is the Response when one arrived; `error` is the rejection when none did.
export function describeFetchFailure (options) {
	var cfg = options || {};
	var url = cfg.url || '';
	var title = cfg.context || 'Request failed';

	if (cfg.response && !cfg.response.ok) {
		return {
			title: title,
			message: statusSentence(cfg.response.status, cfg.response.statusText),
			reason: 'http'
		};
	}

	var error = cfg.error;
	var message = error && error.message ? String(error.message) : String(error || 'Unknown error');

	// A rejected fetch with no response at all. This is the ambiguous one.
	if (error && (error.name === 'TypeError' || /failed to fetch|networkerror|load failed/i.test(message))) {
		if (cfg.online === false) {
			return {
				title: title,
				message: 'You are offline, so the request never left the browser.',
				reason: 'offline'
			};
		}
		if (isCrossOrigin(url, cfg.pageOrigin)) {
			return {
				title: title,
				message: 'The site did not allow PixOS to read it. Most sites only permit '
					+ 'this for requests they have opted into (CORS), and there is no way to '
					+ 'tell that apart from the site being unreachable — the browser reports '
					+ 'both the same way. Opening the address in a browser tab will show '
					+ 'which it is.',
				reason: 'cors'
			};
		}
		return {
			title: title,
			message: 'The request could not be made. The address may be unreachable, or '
				+ 'something in the browser blocked it.',
			reason: 'network'
		};
	}

	if (error && error.name === 'AbortError') {
		return {title: title, message: 'The request was cancelled.', reason: 'abort'};
	}

	return {title: title, message: message, reason: 'unknown'};
}

// The same job for anything that is not a fetch: an action that threw. Keeps the shape
// consistent so one reporter can take either. `options.online` is optional and, like the
// arguments above, is passed in rather than read from `navigator`.
// Chromium keeps each IndexedDB value whole and refuses to store one over 128 MiB —
// `134217728` is the number in its own error message. Firefox and Safari have ceilings of
// their own and publish neither. This is the lowest any of them is known to enforce, and
// PixOS keeps a file as exactly one value, so it is the largest file this filesystem can
// hold whatever else is going on.
export var MAX_FILE_BYTES = 128 * 1024 * 1024;

// The one of these in PixOS. It lives here rather than in `system-stats.js`, where it was,
// because that module reads `navigator` and attaches listeners the moment it is imported —
// so nothing pure could ever borrow it, and `peers.js` had written its own that rounded
// differently. Two spellings of the same number in two panels is how they come to
// disagree, and the pair of them already did: 256 MB in one place, 256.0 MB in the other.
export function formatBytes (bytes) {
	if (!bytes && bytes !== 0) {
		return '—';
	}
	var units = ['B', 'KB', 'MB', 'GB', 'TB'];
	var value = bytes;
	var unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return (value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)) + ' ' + units[unit];
}

// Asked *before* a write, and that is the whole point of it: BrowserFS reports a refused
// write as `EIO` with no detail at all, so afterwards there is nothing left to explain
// with. Answering here also means a 150 MB file is turned away before it is read into
// memory rather than after.
//
// `estimate` is `navigator.storage.estimate()`'s answer passed in, not read here, so this
// stays pure and testable. It is allowed to be missing: not every browser answers, and a
// check that refuses to run without one would be worse than one that only catches the
// certain case.
//
// Returns null when the write should go ahead. A sentence means it must not.
export function describeWriteLimit (bytes, estimate) {
	var size = Number(bytes);
	if (!isFinite(size) || size <= 0) {
		return null;
	}
	if (size > MAX_FILE_BYTES) {
		return {
			title: 'That file is too large to store',
			message: formatBytes(size) + ' — a browser keeps each file as a single entry '
				+ 'and will not accept one over ' + formatBytes(MAX_FILE_BYTES) + '. '
				+ 'Nothing was written.',
			reason: 'too-large'
		};
	}
	var quota = estimate && Number(estimate.quota);
	var usage = estimate && Number(estimate.usage);
	if (!isFinite(quota) || !isFinite(usage) || quota <= 0) {
		return null;
	}
	var free = quota - usage;
	if (size > free) {
		return {
			title: 'There is not enough room for that file',
			message: formatBytes(size) + ' needed, ' + formatBytes(Math.max(0, free))
				+ ' free of ' + formatBytes(quota) + '. Nothing was written.',
			reason: 'no-room'
		};
	}
	return null;
}

export function describeError (context, error, options) {
	var cfg = options || {};
	var message = error && error.message ? String(error.message) : String(error || 'Unknown error');

	// Installing an app, updating one, loading a manifest -- all of them are a fetch
	// somewhere underneath, and when one fails the caller has an exception rather than a
	// Response, so it lands here instead of in describeFetchFailure and used to be
	// reported as the raw "TypeError: Failed to fetch". Same wording as above, minus the
	// origin guess: the caller that threw this one rarely knows which URL it was.
	// Matched on the message rather than the type: a TypeError saying something else is
	// an ordinary bug, not a network problem, and must not be dressed up as one.
	if (error && /failed to fetch|networkerror|load failed/i.test(message)) {
		if (cfg.online === false) {
			return {
				title: context || 'Something went wrong',
				message: 'You are offline, so the request never left the browser.',
				reason: 'offline'
			};
		}
		return {
			title: context || 'Something went wrong',
			message: 'The files could not be fetched. The address may be unreachable, or '
				+ 'something in the browser blocked the request.',
			reason: 'network'
		};
	}
	// BrowserFS speaks in errno codes, which mean nothing outside a terminal.
	var codes = {
		ENOENT: 'That file or folder no longer exists.',
		EEXIST: 'Something with that name is already there.',
		EISDIR: 'That is a folder, not a file.',
		ENOTDIR: 'That is a file, not a folder.',
		ENOTEMPTY: 'That folder is not empty.',
		EACCES: 'Permission denied.',
		EPERM: 'The filesystem refused that operation.',
		ENOSPC: 'There is no storage space left.',
		// The one errno that is not a reason. BrowserFS's IndexedDB backend translates a
		// *synchronous* failure properly -- QuotaExceededError becomes ENOSPC -- but an
		// asynchronous one goes through a handler that ignores `request.error` entirely
		// and reports EIO whatever happened. So this is the browser refusing to store
		// something, with the reason already thrown away, and the wording says which two
		// things it nearly always is rather than picking one.
		EIO: 'The browser refused to store that. Almost always it is either too large to '
			+ 'keep as a single file, or there is no room left for it.'
	};
	// BrowserFS does not always set .code -- some of its errors only carry the errno in
	// the message ("ENOENT: No such file or directory., '/image.png'"), which is how a raw
	// one reached the screen. Read it from either place.
	var code = (error && error.code) || (/^([A-Z]{4,10}):/.exec(message) || [])[1];
	if (code && codes[code]) {
		var quoted = /'([^']+)'/.exec(message);
		return {
			title: context || 'Something went wrong',
			// The errno message usually names the path; that is the useful half of it.
			message: codes[code] + (quoted ? '\n\n' + quoted[1] : ''),
			reason: code
		};
	}
	return {title: context || 'Something went wrong', message: message, reason: 'unknown'};
}

// A first boot builds the system out of files fetched over HTTP, and every one of those
// fetches used to fail into `console.error` and nothing else. That is how a server missing
// two files in `templates/` produced a PixOS with no `/home` folder at all — nothing else
// creates that directory, it exists only because a seed is written into it — and an About
// widget reading a file that had never been written. Everything looked like it had worked.
//
// Both of these describe a boot that did not get what it asked for. They are separate
// because the two failures are not the same size: a seed that 404s costs you one file,
// while a `preinstall.json` that 404s costs you every app and every seed at once.

// `failures` is [{path, from, error}] — where the file was going, which template it came
// from, and what went wrong. Returns null when nothing failed, so the caller can raise a
// note unconditionally on the result.
export function describeSeedFailure (failures) {
	var list = (Array.isArray(failures) ? failures : []).filter(function (item) {
		return item && item.path;
	});
	if (!list.length) {
		return null;
	}

	var one = list.length === 1;
	var reasons = [];
	var lines = list.map(function (item) {
		var reason = item.error && item.error.message
			? String(item.error.message)
			: String(item.error || '');
		if (reason && reasons.indexOf(reason) === -1) {
			reasons.push(reason);
		}
		return item.from ? item.path + '  ←  ' + item.from : item.path;
	});

	return {
		title: one ? 'A starter file is missing' : list.length + ' starter files are missing',
		// The destination and the source both, because they answer different questions:
		// the first says what you will find missing, the second says what to put on the
		// server. Whoever sees this note is usually the person who deployed it.
		message: lines.join('\n') + '\n\n'
			+ 'The server did not return ' + (one ? 'it' : 'them')
			+ (reasons.length === 1 ? ': ' + reasons[0] + '.' : '.')
			+ ' Nothing was written, so the next boot will try again.',
		reason: 'seed'
	};
}

// The fallback is not a quiet degradation: `FALLBACK_PREINSTALL` is Explorer, App Manager
// and the registry, and nothing else — no catalog apps, no seeds, no default apps. A
// system that came up on it looks like a working PixOS that someone emptied.
export function describeBootFallback (error) {
	var message = error && error.message ? String(error.message) : String(error || '');
	return {
		title: 'PixOS started with its built-in minimum',
		message: 'settings/preinstall.json could not be read'
			+ (message ? ' (' + message + ')' : '') + ', so only Explorer and App Manager '
			+ 'were set up: no apps were installed and no starter files were created. '
			+ 'Reload once that file is reachable.',
		reason: 'preinstall-config'
	};
}
