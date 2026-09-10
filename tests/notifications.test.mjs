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


// --- a message that is not finished yet --------------------------------------------------
//
// Installing `monaco` is 98 files fetched one at a time; a first boot installs five apps
// before the Start menu is worth opening. Every one of those was indistinguishable from a
// hang. The rules worth testing are about what happens around the bar, not the bar itself:
// it must not expire, it must not fold, an update must not rebuild the stack, and the user
// must stay in charge of a card they dismissed.

notifications.dismissAll();

const job = notifications.progress({title: 'Installing Monaco', total: 98, source: 'App Manager'});
check('a progress note is on the stack', notifications.list().map(n => n.title), ['Installing Monaco']);
check('and carries its bar', notifications.list()[0].progress.total, 98);
fire(600000);
// The whole point: this ends when the operation ends, not when a timer says so.
check('and never expires on its own', notifications.list().length, 1);

check('an update is applied', job.update({value: 12, message: 'vendor/monaco/vs/loader.js'}), true);
check('and moves the bar', notifications.list()[0].progress.value, 12);
check('and the line under it', notifications.list()[0].message, 'vendor/monaco/vs/loader.js');

// A 98-file install would otherwise rebuild every card on screen 98 times.
const card = host.children[0].children[0];
job.update({value: 13});
check('updating patches the card in place rather than rebuilding the stack',
	host.children[0].children[0] === card, true);

// Two installs at once are two operations. Folding them into "×2" would describe neither.
const second = notifications.progress({title: 'Installing Monaco', total: 98, source: 'App Manager'});
check('two identical operations are two notes', notifications.list().length, 2);
check('and not one with a counter', notifications.list()[0].count, 1);
second.dismiss();

// --- finishing -----------------------------------------------------------------------------

const finished = job.done({title: 'Monaco is installed'});
check('done() replaces the bar with a sentence',
	notifications.list().map(n => n.title), ['Monaco is installed']);
check('which is an ordinary info note, and goes away like one', typeof finished, 'number');
fire(6000);
check('and does', notifications.list(), []);

const failing = notifications.progress({title: 'Installing Monaco', total: 98});
failing.update({value: 40});
failing.fail({title: 'Could not install Monaco', message: 'The server says there is nothing at that address (404).'});
check('fail() replaces it with an error', notifications.list().map(n => n.level), ['error']);
fire(600000);
check('which stays, like every other error', notifications.list().length, 1);
notifications.dismissAll();

// --- the × on the card is a decision ---------------------------------------------------------

const dismissed = notifications.progress({title: 'Copying', total: 10});
dismissed.dismiss();
check('a dismissed bar is gone', notifications.list(), []);
check('and an update does not put it back', dismissed.update({value: 5}), false);
check('nor does it reappear', notifications.list(), []);
// "Stop telling me about this" is not "do not tell me it broke".
check('finishing quietly stays quiet', dismissed.done({title: 'Copied'}), null);
check('but a failure is still raised', typeof dismissed.fail({title: 'Could not copy'}), 'number');
check('as an error', notifications.list().map(n => n.level), ['error']);
notifications.dismissAll();

// --- what the bar says --------------------------------------------------------------------

const counted = notifications.progress({title: 'Copying', total: 4, unit: 'count'});
counted.update({value: 2});
check('a count reads as a count', notifications.list()[0].progress.unit, 'count');

// The boot sequence advances by a fraction of an app as each of its files lands, and being
// told three apps were done when the third had barely started is worse than no number.
counted.update({value: 2.9});
const countLine = host.children[0].children[0].children.find(node => node.className === 'PixNote__meta');
check('a fractional count is floored, never rounded up', countLine.children[0].textContent, '2 of 4');
check('and the percentage is the honest one', countLine.children[1].textContent, '73%');

counted.dismiss();

const sized = notifications.progress({title: 'Copying', total: 1048576, unit: 'bytes'});
sized.update({value: 524288});
const sizeLine = host.children[0].children[0].children.find(node => node.className === 'PixNote__meta');
check('bytes are spelled the one way PixOS spells them',
	sizeLine.children[0].textContent, '512 KB of 1.0 MB');
notifications.dismissAll();

// An operation that cannot count its own steps still has to look like it is running.
const waiting = notifications.progress({title: 'Extracting'});
check('no total means no percentage', notifications.list()[0].progress.total, null);
const waitingCard = host.children[0].children[0];
const bar = waitingCard.children.find(node => String(node.className).indexOf('PixNote__bar') === 0);
check('and a bar that says so instead', bar.className, 'PixNote__bar PixNote__bar--waiting');
waiting.dismiss();

check('nothing at all does not throw', typeof notifications.progress().id, 'number');
notifications.dismissAll();

process.exit(report('notifications') ? 1 : 0);
