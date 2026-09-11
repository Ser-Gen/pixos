// Explorer reporting a failure instead of losing it.
//
// The `actions` table is wrapped, which covers everything the user clicks. It does not
// cover what happens *after* — a dialog's submit handler runs long after the action that
// opened the dialog returned, so a rejection in there escaped both the wrapper and the
// shell's global handlers (a rejection inside an app fires on that app's window, not on
// the shell's). Renaming a file another window had just deleted was the visible symptom:
// `Uncaught (in promise)` in the console, and nothing at all on screen.
//
// Extracted from apps/explorer/index.html rather than duplicated, so that rearranging the
// wrapping breaks these tests rather than slipping past them.

import fs from 'fs';
import {check, report} from './assert.mjs';
import {createFailure} from '../apps/explorer/js/failure.js';

const source = fs.readFileSync(new URL('../apps/explorer/index.html', import.meta.url), 'utf8');
const failureSource = fs.readFileSync(
	new URL('../apps/explorer/js/failure.js', import.meta.url), 'utf8');

// Pulls out `function name (...) { ... }` by matching braces, so the tests do not depend
// on what happens to sit after it in the file.
function fn (name) {
	const start = source.indexOf('function ' + name + ' (');
	if (start === -1) {
		console.error('explorer-reporting.test.mjs: could not find function ' + name);
		process.exit(1);
	}
	let depth = 0;
	for (let i = source.indexOf('{', start); i < source.length; i++) {
		if (source[i] === '{') { depth++; }
		else if (source[i] === '}') {
			depth--;
			if (depth === 0) { return source.slice(start, i + 1); }
		}
	}
	console.error('explorer-reporting.test.mjs: unbalanced braces in ' + name);
	process.exit(1);
}

const code = [fn('isCallbackName'), fn('openDialog')].join('\n');

const failures = [];
const logged = [];
const state = {dialog: null};

// `guarded` and `readableActionName` are the real ones now -- phase 21 moved them into
// js/failure.js, and importing them beats cutting them back out of the HTML. What the
// factory wants is a shell and a window that are not the same object, which is how every
// branch in that module decides whether there is a PixOS to report to.
const shell = {
	notify: record => { failures.push({label: record.title, message: record.message}); },
	describeError: (context, err) => ({
		title: context,
		message: String(err && err.message ? err.message : err)
	})
};
console.error = (...args) => { logged.push(args.join(' ')); };

const failure = createFailure({
	shell: shell,
	win: {addEventListener: () => {}},
	doc: {},
	nav: {},
	openInfoDialog: () => {}
});

const explorer = new Function('state', 'renderOverlays', 'guarded', 'readableActionName', code + `
	return {openDialog: openDialog};
`)(
	state,
	() => {},
	failure.guarded,
	failure.readableActionName
);
explorer.guarded = failure.guarded;
explorer.readableActionName = failure.readableActionName;

// --- the wrapper itself ------------------------------------------------------------------

failures.length = 0;
check('a call that works returns its value untouched',
	explorer.guarded(() => 42, 'X failed')(), 42);
check('and reports nothing', failures.length, 0);

explorer.guarded(() => { throw new Error('sync boom'); }, 'X failed')();
check('a synchronous throw is reported', failures, [{label: 'X failed', message: 'sync boom'}]);

failures.length = 0;
const settled = await explorer.guarded(async () => { throw new Error('async boom'); }, 'Y failed')();
check('a rejected promise is reported too', failures, [{label: 'Y failed', message: 'async boom'}]);
// The rejection must be *handled*, not merely observed: an escaping one is the bug.
check('and the rejection does not escape', settled, undefined);

failures.length = 0;
check('arguments are passed through',
	await explorer.guarded(async (a, b) => a + b, 'Z failed')(2, 3), 5);

// --- dialogs get the same treatment -------------------------------------------------------

failures.length = 0;
explorer.openDialog({
	type: 'rename',
	onSubmit: async function () {
		throw Object.assign(new Error("ENOENT: No such file or directory., '/image.png'"), {code: 'ENOENT'});
	}
});
await state.dialog.onSubmit('whatever');
check('a dialog submit that fails is reported, not swallowed', failures.length, 1);
check('under a label naming the dialog', failures[0].label, 'Rename failed');

// Every on*-shaped callback, not a list of the ones that existed the day it was written:
// onOpenManager and onManageDefaults were both missed by the first version's list.
failures.length = 0;
explorer.openDialog({
	type: 'openWith',
	onSubmit: () => { throw new Error('a'); },
	onOpenManager: () => { throw new Error('b'); },
	onManageDefaults: () => { throw new Error('c'); },
	onSomethingAddedLater: () => { throw new Error('d'); }
});
['onSubmit', 'onOpenManager', 'onManageDefaults', 'onSomethingAddedLater']
	.forEach(name => state.dialog[name]());
check('every callback on the dialog is wrapped', failures.map(f => f.message), ['a', 'b', 'c', 'd']);
check('all under the dialog label', failures.every(f => f.label === 'Open with failed'), true);

failures.length = 0;
explorer.openDialog({type: 'info', title: 'x', message: 'y', items: [1, 2], onDone: 'not a function'});
check('data on the dialog is left alone', state.dialog.items, [1, 2]);
check('and a non-function on* property is not turned into one', state.dialog.onDone, 'not a function');
check('a dialog with no callbacks does not throw', state.dialog.type, 'info');
explorer.openDialog(null);
check('closing by opening nothing is fine', state.dialog, null);

// --- labels -------------------------------------------------------------------------------

check('a camelCase name becomes a sentence',
	explorer.readableActionName('downloadSelected'), 'Download selected failed');
check('a single word too', explorer.readableActionName('rename'), 'Rename failed');
check('and an unnamed dialog still gets something readable',
	explorer.readableActionName('dialog'), 'Dialog failed');

// --- nothing hand-builds an error dialog any more --------------------------------------------
//
// openInfoDialog skips the errno translation and shows a modal where the rest of the system
// shows a card. That is how a raw "ENOENT: No such file or directory." reached the screen,
// and how an offline install reported itself as "TypeError: Failed to fetch".

const handBuilt = source.split('\n')
	.map((line, i) => ({line: line.trim(), number: i + 1}))
	.filter(entry => /openInfoDialog\(/.test(entry.line))
	.filter(entry => /String\(err|String\(e\)|err\.message|e\.message|readErr\.message/.test(entry.line));
check('no call site turns a caught error into a dialog by hand',
	handBuilt.map(entry => entry.number + ': ' + entry.line), []);

// Both listeners moved into js/failure.js with everything else that reports; they are
// registered by the factory call rather than by reaching the middle of openExplorer, which
// is strictly earlier and so covers strictly more.
check('the last-resort net is installed',
	/addEventListener\('unhandledrejection'/.test(failureSource), true);
check('and covers uncaught errors as well',
	/addEventListener\('error', function \(e\) \{[\s\S]{0,400}reportFailure/.test(failureSource), true);
check('a reported failure also reaches the console, where a bug report can find it',
	logged.length > 0, true);

process.exit(report('explorer-reporting') ? 1 : 0);
