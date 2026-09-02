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
		ENOSPC: 'There is no storage space left.'
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
