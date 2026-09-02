// The chooser for a file with no default app.
//
// Two rules carry the weight. The list always ends with the two routes that exist for any
// file at all, so the dialog can never come up empty and leave you with nothing to press.
// And "always open .csv this way" can only ever name an *app*: a default association maps
// an extension to an app id, so offering to remember "a browser tab" would be a checkbox
// that appears to work and silently stores nothing.

import fs from 'fs';
import {check, report} from './assert.mjs';
import * as openWith from '../js/shell/open-with.js';

// Hover-to-select is right in the palette and wrong here, and the difference is one line
// of code away from being lost again. The highlighted row decides whether the
// remember-this box is usable, so a pointer travelling down to Cancel would sweep across
// the two entries that disable it and untick what was just asked for — you would have to
// steer around them. Guarded here because it is a temptation, not an accident.
const source = fs.readFileSync(new URL('../js/shell/open-with.js', import.meta.url), 'utf8');
check('the highlight does not follow the pointer',
	/onmousemove|onmouseenter|onmouseover/.test(source), false);

const APPS = [
	{id: 'ace', label: 'Ace', installed: true},
	{id: 'monaco-cdn', label: 'Monaco', installed: true},
	{id: 'markdown-viewer', label: 'Markdown Viewer', installed: false}
];

// --- what is offered ---------------------------------------------------------------------

let choices = openWith.plan({path: '/home/notes.csv', extension: 'csv', apps: APPS});

check('every app is offered, in the order it was given',
	choices.filter(c => c.kind === 'app').map(c => c.appId),
	['ace', 'monaco-cdn', 'markdown-viewer']);
check('and the two universal routes come last', choices.slice(-2).map(c => c.kind),
	[openWith.BROWSER_TAB, openWith.RAW_WINDOW]);

check('an app that is not on disk yet says so before you pick it',
	choices.find(c => c.appId === 'markdown-viewer').hint,
	'Not installed yet — picking it installs it first');
check('and is flagged, so the caller knows to install first',
	choices.map(c => c.install), [false, false, true, false, false]);
check('installed and installable are separate groups',
	choices.map(c => c.group),
	['Apps', 'Apps', 'Available to install', 'Always available', 'Always available']);

// The whole reason this beats the silent fallback: with nothing installed that can read
// the file there is still something to press, and it is named.
const bare = openWith.plan({path: '/home/thing.xyz', extension: 'xyz', apps: []});
check('with no compatible app at all the dialog is still not empty', bare.length, 2);
check('it offers the browser', bare[0].label, 'Open in a browser tab');
check('and the old silent fallback, now as a choice', bare[1].label,
	'Open as a plain file in a window');

// A folder is neither: the browser has no viewer for one, and there is no file to put in
// a window. Explorer's *Open with...* on a folder says so by asking for this.
const folder = openWith.plan({
	subtitle: '/home/docs',
	universal: false,
	apps: [{id: 'explorer', label: 'Explorer', installed: true}, {id: 'treemap', label: 'Disk Treemap', installed: false}]
});
check('a folder is offered apps and nothing else', folder.map(c => c.kind), ['app', 'app']);
check('and is still not an empty dialog, because a folder always has apps', folder.length, 2);
check('the two are back for a file', openWith.plan({apps: [], universal: true}).length, 2);

check('choices are numbered so a digit can pick one', choices.map(c => c.number), [1, 2, 3, 4, 5]);
const many = openWith.plan({
	path: '/a.txt',
	extension: 'txt',
	apps: Array.from({length: 10}, (_, i) => ({id: 'app' + i, label: 'App ' + i, installed: true}))
});
check('past nine there is no number rather than a key that does not exist',
	many.slice(8).map(c => c.number), [9, null, null, null]);

check('an app record with no id is dropped rather than becoming a nameless row',
	openWith.plan({apps: [{label: 'Nothing'}, {id: 'ace', label: 'Ace', installed: true}]})
		.filter(c => c.kind === 'app').length, 1);
check('an app with no label falls back to its id',
	openWith.plan({apps: [{id: 'ace', installed: true}]})[0].label, 'ace');
check('no apps at all is not an error', openWith.plan({}).length, 2);

// --- what can be remembered ---------------------------------------------------------------

check('an app can become the default for the extension',
	openWith.canSetDefault(choices[0], 'csv'), true);
check('a browser tab cannot -- there is no app id to store',
	openWith.canSetDefault(choices[3], 'csv'), false);
check('and neither can the raw window', openWith.canSetDefault(choices[4], 'csv'), false);
check('nor can anything, for a file with no extension to hang it on',
	openWith.canSetDefault(choices[0], ''), false);
check('an app that still has to be installed can still be made the default -- the shell '
	+ 'installs it first', openWith.canSetDefault(choices[2], 'csv'), true);
check('nothing highlighted is not something that can be remembered',
	openWith.canSetDefault(undefined, 'csv'), false);

// Moving the highlight around must not quietly undo a tick. The row decides whether the
// box *can* be ticked; what the person asked for is remembered separately, and comes back
// when a row that can honour it is highlighted again.
const app = choices[0];
const tab = choices[3];
check('ticked on an app, it is ticked', openWith.rememberState(app, 'csv', true),
	{enabled: true, checked: true});
check('moving onto the browser tab greys it out and unticks it',
	openWith.rememberState(tab, 'csv', true), {enabled: false, checked: false});
check('and moving back to an app puts the tick back — the ask did not go anywhere',
	openWith.rememberState(app, 'csv', true), {enabled: true, checked: true});
check('never ticked stays never ticked', openWith.rememberState(app, 'csv', false),
	{enabled: true, checked: false});
check('and a file with no extension can never remember anything',
	openWith.rememberState(app, '', true), {enabled: false, checked: false});

check('the checkbox names the extension it would apply to',
	openWith.rememberLabel('csv'), 'Always open .csv files this way');
check('and says something true when there is none',
	openWith.rememberLabel(''), 'Always open files like this this way');

// --- keys -------------------------------------------------------------------------------

function key (init) {
	return Object.assign({key: '', code: '', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false}, init);
}

check('Esc cancels', openWith.resolveKey(key({key: 'Escape'}), 5), {action: 'cancel'});
check('Enter takes the highlighted one', openWith.resolveKey(key({key: 'Enter'}), 5), {action: 'activate'});
check('so does Space', openWith.resolveKey(key({key: ' '}), 5), {action: 'activate'});
check('arrows move', openWith.resolveKey(key({key: 'ArrowDown'}), 5), {action: 'move', delta: 1});
check('in both directions', openWith.resolveKey(key({key: 'ArrowUp'}), 5), {action: 'move', delta: -1});
check('Tab moves too', openWith.resolveKey(key({key: 'Tab'}), 5), {action: 'move', delta: 1});
check('and Shift+Tab back', openWith.resolveKey(key({key: 'Tab', shiftKey: true}), 5),
	{action: 'move', delta: -1});
check('a digit picks', openWith.resolveKey(key({key: '2', code: 'Digit2'}), 5), {action: 'pick', index: 1});
check('a digit past the end does nothing rather than something arbitrary',
	openWith.resolveKey(key({key: '7', code: 'Digit7'}), 5), {action: 'ignore'});

// Same contract as the overview: anything unclaimed returns null, because the handler
// prevents the default of whatever this names and of nothing else.
check('Ctrl+digit belongs to the desktops, not here',
	openWith.resolveKey(key({key: '2', code: 'Digit2', ctrlKey: true}), 5), null);
check('an ordinary letter is not claimed',
	openWith.resolveKey(key({key: 'a', code: 'KeyA'}), 5), null);

process.exit(report('open-with') ? 1 : 0);
