// Explorer's three layers of saying that something failed, lifted out of openExplorer by
// phase 21. Nothing in here reads `state` or `ui`, which is why it could move without the
// context object the rest of the split needs.
//
// `shell` is the parent window when Explorer runs inside PixOS and is the same object as
// `win` when it does not -- every branch in here turns on that comparison, so a test drives
// the standalone path by passing the same object twice.
//
// Calling this factory has side effects, and they are the point: it claims
// `win.__pixosOwnErrors` and registers the two last-resort listeners. Call it once, early,
// before anything that can fail.

export function createFailure (deps) {
	var shell = deps.shell;
	var win = deps.win;
	var doc = deps.doc;
	var nav = deps.nav;
	// Late-bound on purpose: openInfoDialog is still a closure inside openExplorer, and this
	// module is built before the dialog machinery exists to be called.
	var openInfoDialog = deps.openInfoDialog;

	// Runs `fn` and reports whatever it throws -- synchronously or as a rejected promise --
	// under `label`, rather than letting it disappear.
	function guarded (fn, label) {
		return function () {
			var result;
			try {
				result = fn.apply(this, arguments);
			}
			catch (err) {
				reportFailure(label, err);
				return;
			}
			if (result && typeof result.then === 'function') {
				return result.catch(function (err) {
					reportFailure(label, err);
				});
			}
			return result;
		};
	}

	// The shell now puts a reporter in front of every app document, so that an app whose
	// script never ran is not a blank window and a console line. Explorer's own three
	// layers are better than that generic one -- they name the operation and translate the
	// errno -- so it opts out, and two notes for one failure do not happen. Declared here,
	// beside the handlers it is talking about, rather than at the top where it would read
	// as a setting.
	win.__pixosOwnErrors = true;

	// The last resort, for what neither wrapper covers: a listener, a timer, a promise
	// nobody awaited. The shell's own handlers cannot see any of it -- a rejection inside
	// an app fires on that app's window, not on the shell's -- so Explorer has to catch
	// its own or it stays a console line, which is the thing this phase exists to end.
	win.addEventListener('unhandledrejection', function (e) {
		reportFailure('Something went wrong in Explorer', e.reason);
	});

	win.addEventListener('error', function (e) {
		// A missing image in a folder listing fires this too, with no error object. Not
		// worth interrupting anyone for.
		if (!e.error) {
			return;
		}
		reportFailure('Something went wrong in Explorer', e.error);
	});

	// Prefers the shell's notification layer, which does not steal the focus and stacks
	// when several things fail. Standalone -- Explorer opened directly in a tab -- there is
	// no shell, so it falls back to its own dialog rather than to silence.
	//
	// Everything Explorer reports goes through here. A call site that reaches for
	// openInfoDialog directly gets a modal where the rest of the system gets a card, and
	// skips the errno translation with it -- which is how a raw ENOENT reached the screen.
	function report (title, message, level, actions) {
		try {
			if (shell !== win && typeof shell.notify === 'function') {
				shell.notify({
					level: level || 'error',
					title: title,
					message: message,
					source: 'Explorer',
					actions: actions || []
				});
				return;
			}
		}
		catch (crossOrigin) {
			// Not our parent. Fall through to the dialog.
		}
		openInfoDialog(title, message);
	}

	// Two attempts and then an honest surrender. The async API is the right one and is
	// what a modern browser grants; execCommand still works in places it does not --
	// notably an iframe without clipboard permission, which is exactly what Explorer is.
	async function copyTextToClipboard (text) {
		try {
			if (nav.clipboard && nav.clipboard.writeText) {
				await nav.clipboard.writeText(text);
				return true;
			}
		}
		catch (err) {
			console.warn('Explorer: the clipboard refused a write', err);
		}
		try {
			var area = doc.createElement('textarea');
			area.value = text;
			area.setAttribute('readonly', '');
			area.style.position = 'fixed';
			area.style.top = '-1000px';
			doc.body.appendChild(area);
			area.select();
			var copied = doc.execCommand('copy');
			area.remove();
			return !!copied;
		}
		catch (fallbackErr) {
			return false;
		}
	}

	// What to tell someone to press. Not a capability check -- purely which keyboard is
	// under their hands.
	function copyChordLabel () {
		return /Mac|iPhone|iPad|iPod/i.test(nav.platform || nav.userAgent || '')
			? 'Cmd+C'
			: 'Ctrl+C';
	}

	function reportFailure (label, err) {
		console.error('Explorer: ' + label, err);
		var described = describeFailure(label, err);
		report(described.title, described.message);
	}

	// A download that did not happen, explained. The classification lives in the shell
	// (js/shell/failure.js) because an app cannot import shell modules -- so this asks the
	// parent, and degrades to the raw message when there is no parent to ask.
	function reportFetchFailure (url, outcome) {
		var described;
		try {
			if (shell !== win && typeof shell.describeFetchFailure === 'function') {
				described = shell.describeFetchFailure(Object.assign({
					url: url,
					context: 'Could not download that file'
				}, outcome));
			}
		}
		catch (crossOrigin) {
			described = null;
		}
		if (!described) {
			described = {
				title: 'Could not download that file',
				message: outcome.response
					? 'The server answered with ' + outcome.response.status + '.'
					: String(outcome.error && outcome.error.message ? outcome.error.message : outcome.error)
			};
		}

		var actions = [{
			label: 'Open in a browser tab',
			run: function () {
				win.open(url, '_blank', 'noopener');
			}
		}];

		try {
			if (shell !== win && typeof shell.notify === 'function') {
				shell.notify({
					level: 'error',
					title: described.title,
					message: described.message + '\n\n' + url,
					source: 'Explorer',
					actions: actions
				});
				return;
			}
		}
		catch (crossOrigin) {
			// Fall through to the dialog.
		}
		openInfoDialog(described.title, described.message + '\n\n' + url);
	}

	function describeFailure (context, err) {
		try {
			if (shell !== win && typeof shell.describeError === 'function') {
				return shell.describeError(context, err);
			}
		}
		catch (crossOrigin) {
			// Fall through.
		}
		return {title: context, message: String(err && err.message ? err.message : err)};
	}

	// 'downloadSelected' -> 'Download selected failed'. Better than the raw key, and it
	// costs nothing to be readable about which thing went wrong.
	function readableActionName (name) {
		var words = String(name).replace(/([A-Z])/g, ' $1').toLowerCase().trim();
		return words.charAt(0).toUpperCase() + words.slice(1) + ' failed';
	}

	return {
		guarded: guarded,
		report: report,
		copyTextToClipboard: copyTextToClipboard,
		copyChordLabel: copyChordLabel,
		reportFailure: reportFailure,
		reportFetchFailure: reportFetchFailure,
		describeFailure: describeFailure,
		readableActionName: readableActionName
	};
}
