// Explorer saying that something failed — the module, not the wrapper.
//
// tests/explorer-reporting.test.mjs covers `guarded` and the dialog wrapping, which is what
// catches a failure. This covers what happens next: where the words go, who translates the
// errno, and what is said when there is no shell to translate it. Phase 21 moved all of it
// into apps/explorer/js/failure.js and made `shell`, `win`, `doc` and `nav` parameters,
// which is the only reason the standalone and cross-origin paths can be driven at all —
// in a browser they need, respectively, no PixOS and a PixOS on another origin.

import {check, report} from './assert.mjs';
import {createFailure} from '../apps/explorer/js/failure.js';

console.error = () => {};
console.warn = () => {};

// --- a world per case ----------------------------------------------------------------------

function world (shell) {
	const notes = [];
	const dialogs = [];
	const opened = [];
	const listeners = {};
	const win = {
		addEventListener: (name, fn) => { listeners[name] = fn; },
		open: (url, target, features) => { opened.push([url, target, features]); }
	};
	const failure = createFailure({
		shell: shell === 'standalone' ? win : shell,
		win: win,
		doc: {},
		nav: {},
		openInfoDialog: (title, message) => { dialogs.push({title: title, message: message}); }
	});
	return {failure, notes, dialogs, opened, listeners, win};
}

const shellThatNotifies = (notes) => ({
	notify: record => { notes.push(record); },
	describeError: (context, err) => ({
		title: context,
		message: 'No such file or directory: ' + (err && err.path)
	})
});

// --- the flag and the net ---------------------------------------------------------------------

{
	const w = world('standalone');
	check('the module claims Explorer reports its own errors', w.win.__pixosOwnErrors, true);
	check('and installs both last-resort listeners',
		Object.keys(w.listeners).sort(), ['error', 'unhandledrejection']);

	// A missing image in a folder listing fires window.onerror with no error object. It is
	// not worth interrupting anyone for, and this is the only place that decision is made.
	w.listeners.error({});
	check('an error event carrying no error is ignored', w.dialogs.length, 0);
	w.listeners.error({error: new Error('boom')});
	check('and one carrying an error is reported', w.dialogs.length, 1);
	check('under a heading that says where it happened',
		w.dialogs[0].title, 'Something went wrong in Explorer');

	w.listeners.unhandledrejection({reason: new Error('nobody awaited this')});
	check('a rejection nobody awaited is reported too', w.dialogs.length, 2);
	check('with the reason as the message',
		w.dialogs[1].message, 'nobody awaited this');
}

// --- where the words go ---------------------------------------------------------------------

{
	const notes = [];
	const w = world(shellThatNotifies(notes));
	w.failure.report('Could not rename', 'Something is in the way');
	check('inside PixOS a report becomes a card', notes.length, 1);
	check('and not a modal, which would steal the focus', w.dialogs.length, 0);
	check('the card says which app it came from', notes[0].source, 'Explorer');
	check('and is an error unless it says otherwise', notes[0].level, 'error');

	w.failure.report('That folder is gone', '/home/docs was deleted', 'warn');
	check('a level given is the level used', notes[1].level, 'warn');
	check('and actions default to none rather than undefined', notes[1].actions, []);
}

{
	// Explorer opened directly in a tab: `parent` is `window`, so there is no shell, and a
	// failure has to become its own dialog rather than silence.
	const w = world('standalone');
	w.failure.report('Could not rename', 'Something is in the way');
	check('with no shell a report becomes a dialog instead', w.dialogs,
		[{title: 'Could not rename', message: 'Something is in the way'}]);
}

{
	// PixOS embedded on another origin: every property access on `parent` throws. The report
	// still has to land somewhere.
	const hostile = new Proxy({}, {get () { throw new DOMExceptionLike(); }});
	function DOMExceptionLike () { this.name = 'SecurityError'; }
	const w = world(hostile);
	w.failure.report('Could not rename', 'Something is in the way');
	check('a parent that refuses to be touched falls back to the dialog',
		w.dialogs.length, 1);
}

// --- translating the errno ----------------------------------------------------------------

{
	const notes = [];
	const w = world(shellThatNotifies(notes));
	const err = Object.assign(new Error("ENOENT: No such file or directory., '/image.png'"),
		{code: 'ENOENT', path: '/image.png'});
	w.failure.reportFailure('Could not open that file', err);
	check('the shell is asked to turn the errno into a sentence',
		notes[0].message, 'No such file or directory: /image.png');
	check('under the label naming what was being done',
		notes[0].title, 'Could not open that file');
}

{
	const w = world('standalone');
	check('with nobody to translate, the raw message is better than nothing',
		w.failure.describeFailure('Could not open that file', new Error('EACCES')),
		{title: 'Could not open that file', message: 'EACCES'});
	check('and something thrown that is not an Error still reads',
		w.failure.describeFailure('Could not open that file', 'a string').message, 'a string');
}

// --- a download that did not happen ----------------------------------------------------------

{
	const notes = [];
	const shell = shellThatNotifies(notes);
	shell.describeFetchFailure = outcome => ({
		title: 'Could not download that file',
		message: 'The server said ' + outcome.response.status + '.'
	});
	const w = world(shell);
	w.failure.reportFetchFailure('https://example.com/a.zip', {response: {status: 404}});
	check('the shell classifies a failed download', notes[0].message.split('\n')[0],
		'The server said 404.');
	check('and the address is shown, because the message never names it',
		notes[0].message.endsWith('https://example.com/a.zip'), true);
	check('with a way out that does not depend on Explorer',
		notes[0].actions.map(action => action.label), ['Open in a browser tab']);
	notes[0].actions[0].run();
	check('which opens the address in a real tab',
		w.opened, [['https://example.com/a.zip', '_blank', 'noopener']]);
}

{
	// No shell to classify it: the status and the thrown error each have to produce a
	// sentence on their own.
	const w = world('standalone');
	w.failure.reportFetchFailure('https://example.com/a.zip', {response: {status: 503}});
	check('a status becomes a sentence unaided',
		w.dialogs[0].message.split('\n')[0], 'The server answered with 503.');
	w.failure.reportFetchFailure('https://example.com/b.zip', {error: new TypeError('Failed to fetch')});
	check('and a thrown error becomes its message',
		w.dialogs[1].message.split('\n')[0], 'Failed to fetch');
	check('the title is still the operation, not the exception',
		w.dialogs[1].title, 'Could not download that file');
}

// --- which keyboard is under their hands -------------------------------------------------------

function chord (nav) {
	return createFailure({
		shell: {}, win: {addEventListener () {}}, doc: {}, nav: nav, openInfoDialog () {}
	}).copyChordLabel();
}
check('a Mac is told to press Cmd+C', chord({platform: 'MacIntel'}), 'Cmd+C');
check('an iPad too', chord({platform: '', userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0)'}), 'Cmd+C');
check('everything else is told Ctrl+C', chord({platform: 'Win32'}), 'Ctrl+C');
check('and a browser that will not say gets the majority answer', chord({}), 'Ctrl+C');

process.exit(report('explorer-failure') ? 1 : 0);
