// The shell's error surface.
//
// The rules worth testing are not about pixels: an error must not disappear on its own, a
// failure that repeats must not bury everything else, and a note raised by an app must
// always say which app — because `parent.notify` is reachable from inside any iframe, and
// a note that looked like the system speaking would be a way to lie to the user.

import {check, report} from './assert.mjs';

// A DOM small enough to run the module and large enough to inspect what it drew.
function element (tag) {
	return {
		tagName: String(tag).toUpperCase(),
		children: [],
		style: {},
		dataset: {},
		className: '',
		textContent: '',
		title: '',
		parentElement: null,
		set innerHTML (value) {
			if (value === '') {
				this.children = [];
			}
		},
		get innerHTML () {
			return '';
		},
		append (...nodes) {
			nodes.forEach(node => {
				node.parentElement = this;
				this.children.push(node);
			});
		},
		setAttribute (name, value) {
			this[name] = value;
		},
		querySelector: () => null
	};
}

const head = element('head');
globalThis.document = {
	head: head,
	getElementById: id => head.children.find(node => node.id === id) || null,
	createElement: element
};

// Timers the test drives by hand, so an auto-dismiss can be observed without waiting.
const timers = new Map();
let nextTimer = 1;
globalThis.setTimeout = (fn, ms) => {
	const id = nextTimer++;
	timers.set(id, {fn, ms});
	return id;
};
globalThis.clearTimeout = id => timers.delete(id);
function fire (ms) {
	Array.from(timers.entries())
		.filter(([, timer]) => timer.ms <= ms)
		.forEach(([id, timer]) => {
			timers.delete(id);
			timer.fn();
		});
}

const notifications = await import('../js/shell/notifications.js');

const host = element('div');
const container = notifications.init({host: host});

// Identity, not deep equality: these nodes reference their parents and JSON cannot walk them.
check('the container is mounted into the host it was given', container.parentElement === host, true);
check('and the stylesheet went in once', head.children.length, 1);
notifications.init({host: host});
check('a second init does not add another', head.children.length, 1);
check('nor another container', host.children.length, 1);

// --- levels decide what disappears ------------------------------------------------------

notifications.dismissAll();
notifications.notify({title: 'Saved', level: 'info'});
check('an info note is shown', notifications.list().map(n => n.title), ['Saved']);
fire(6000);
check('and goes away on its own', notifications.list(), []);

notifications.notify({title: 'Disk nearly full', level: 'warn'});
notifications.notify({title: 'Download failed', level: 'error'});
fire(600000);
// The whole point of the module: an error you did not see is the bug being fixed.
check('a warning and an error never disappear on their own',
	notifications.list().map(n => n.title), ['Disk nearly full', 'Download failed']);

notifications.dismissAll();
check('dismissAll clears the stack', notifications.list(), []);

notifications.dismissAll();
notifications.notify({title: 'x', level: 'catastrophe'});
check('an unknown level falls back to info rather than throwing',
	notifications.list()[0].level, 'info');
notifications.dismissAll();

// --- a repeating failure folds instead of flooding ----------------------------------------

notifications.dismissAll();
const first = notifications.notify({level: 'error', title: 'Write failed', message: 'ENOSPC'});
for (let i = 0; i < 20; i++) {
	notifications.notify({level: 'error', title: 'Write failed', message: 'ENOSPC'});
}
check('twenty identical failures are one note', notifications.list().length, 1);
check('counted', notifications.list()[0].count, 21);
check('and it is still the same note', notifications.list()[0].id, first);

notifications.notify({level: 'error', title: 'Write failed', message: 'EACCES'});
check('a different message is a different note', notifications.list().length, 2);
notifications.notify({level: 'error', title: 'Write failed', message: 'ENOSPC', source: 'Explorer'});
check('and so is a different source', notifications.list().length, 3);

// --- nothing that stays is ever dropped to make room -----------------------------------------
//
// The first version capped the stack at four and dropped the oldest. In a system where
// errors deliberately do not expire, that discards an unread error to show a newer one --
// throwing away precisely what the module exists to keep.

notifications.dismissAll();
['a', 'b', 'c', 'd', 'e', 'f'].forEach(title => notifications.notify({level: 'error', title: title}));
check('six errors are six errors', notifications.list().length, 6);
check('and the first one raised is still there', notifications.list()[0].title, 'a');

notifications.dismissAll();
for (let i = 0; i < 30; i++) {
	notifications.notify({level: 'error', title: 'error ' + i});
}
check('thirty distinct errors all survive', notifications.list().length, 30);
check('including the oldest', notifications.list()[0].title, 'error 0');
check('warnings are kept too', (() => {
	notifications.dismissAll();
	['a', 'b', 'c', 'd', 'e', 'f'].forEach(t => notifications.notify({level: 'warn', title: t}));
	return notifications.list().length;
})(), 6);

// Transient notes are still capped: they are on their way out anyway, and four stacked
// toasts is already more than anyone reads.
notifications.dismissAll();
['a', 'b', 'c', 'd', 'e', 'f'].forEach(title => notifications.notify({level: 'info', title: title}));
check('info notes are capped', notifications.list().length, 4);
check('dropping the oldest, which was about to expire anyway',
	notifications.list().map(n => n.title), ['c', 'd', 'e', 'f']);

// A mixed stack must not let an expiring note evict a permanent one.
notifications.dismissAll();
notifications.notify({level: 'error', title: 'kept'});
['a', 'b', 'c', 'd', 'e', 'f'].forEach(title => notifications.notify({level: 'info', title: title}));
check('the error survives a flood of info notes',
	notifications.list().some(n => n.title === 'kept'), true);
check('and only the info notes were trimmed', notifications.list().length, 5);

// --- a pile gets a way to clear it -----------------------------------------------------------

notifications.dismissAll();
notifications.notify({level: 'error', title: 'one'});
check('one note needs no Dismiss all -- its own × is shorter',
	container.children.some(c => c.className === 'PixNotes__clear'), false);
notifications.notify({level: 'error', title: 'two'});
const clear = container.children.find(c => c.className === 'PixNotes__clear');
check('two do', !!clear, true);
clear.onclick();
check('and it clears them', notifications.list(), []);

// --- dismissal ------------------------------------------------------------------------------

notifications.dismissAll();
const id = notifications.notify({level: 'error', title: 'Gone soon'});
check('a note can be dismissed by id', notifications.dismiss(id), true);
check('and is then absent', notifications.list(), []);
check('dismissing it twice is not an error', notifications.dismiss(id), false);
check('nor is dismissing something that never existed', notifications.dismiss(9999), false);

// --- every note says who raised it -------------------------------------------------------------
//
// parent.notify is reachable from inside any app iframe. A note with no attribution would
// let an app put words in the system's mouth, so the label is not optional.

notifications.dismissAll();
notifications.notify({level: 'error', title: 'From an app', source: 'Explorer'});
const [note] = container.children;
const sourceLine = note.children.find(child => child.className === 'PixNote__source');
check('the source is drawn', sourceLine.textContent, 'Explorer');

notifications.dismissAll();
notifications.notify({level: 'error', title: 'From the shell'});
const [systemNote] = container.children;
check('a note with no source is attributed to PixOS, not left blank',
	systemNote.children.find(child => child.className === 'PixNote__source').textContent, 'PixOS');

check('an error is announced to assistive tech', systemNote.role, 'alert');
notifications.dismissAll();
notifications.notify({level: 'info', title: 'Quiet'});
check('an info note is not', container.children[0].role, 'status');

// --- actions ----------------------------------------------------------------------------------

notifications.dismissAll();
let ran = 0;
const withAction = notifications.notify({
	level: 'error',
	title: 'Could not download',
	actions: [{label: 'Open in a browser tab', run: () => { ran++; }}]
});
const actionRow = container.children[0].children.find(c => c.className === 'PixNote__actions');
check('the action is drawn as a button', actionRow.children[0].textContent, 'Open in a browser tab');
actionRow.children[0].onclick();
check('clicking it runs the action', ran, 1);
check('and dismisses the note', notifications.list().find(n => n.id === withAction), undefined);

notifications.dismissAll();
notifications.notify({level: 'error', title: 'Throws', actions: [{label: 'Boom', run: () => { throw new Error('x'); }}]});
const boom = container.children[0].children.find(c => c.className === 'PixNote__actions');
boom.children[0].onclick();
check('an action that throws does not take the shell down with it', notifications.list().length, 0);

notifications.dismissAll();
notifications.notify({level: 'error', title: 'Half an action', actions: [{run: () => {}}, null]});
const sparse = container.children[0].children.find(c => c.className === 'PixNote__actions');
check('an action with no label is skipped rather than drawn blank', sparse.children.length, 0);

// --- shapes it should survive -------------------------------------------------------------------

notifications.dismissAll();
check('no argument at all does not throw', typeof notifications.notify(), 'number');
check('and produces something readable', notifications.list()[0].title, 'Something happened');
notifications.dismissAll();
notifications.notify({title: 'No message'});
check('a note with no message is fine', notifications.list()[0].message, '');

process.exit(report('notifications') ? 1 : 0);
