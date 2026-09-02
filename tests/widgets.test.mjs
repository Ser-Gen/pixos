// Desktop widgets: whether they lead anywhere, and what a click on one means.
//
// The phase this belongs to had one sentence for its done-when — every widget is a door,
// not a dead end — and the way that regresses is not a broken click. It is a fifth widget
// added later with no destination, which looks finished and reads as a number you cannot
// act on. So the first check here is over the source: every registered widget declares
// where it leads.

import fs from 'fs';
import {check, report} from './assert.mjs';

// --- every widget leads somewhere ----------------------------------------------------

const source = fs.readFileSync(new URL('../js/shell/widgets.js', import.meta.url), 'utf8');
const registrations = source.split(/\nregister\(/).slice(1).map(block => ({
	id: (block.match(/^'([^']+)'/) || [])[1],
	body: block.split('\n});')[0]
}));

check('all four widgets were found', registrations.map(r => r.id),
	['clock', 'storage', 'battery', 'about']);
check('and every one of them says where it leads',
	registrations.filter(r => !/\bopen:\s*\{[\s\S]*?run:/.test(r.body)).map(r => r.id), []);

// The peek is the desktop's, not the widgets': a card can only ask for it to end.
const desktop = fs.readFileSync(new URL('../js/shell/desktop.js', import.meta.url), 'utf8');
check('the desktop hands the container a way to end a peek',
	/widgets\.mount\([\s\S]*?onOpen:/.test(desktop), true);

// --- what a click does ---------------------------------------------------------------

// Enough of a browser for the module to import and mount. system-stats registers its
// online/offline listeners at module scope, which is why `window` has to exist first.
class El {
	constructor (tag) {
		this.tagName = String(tag).toUpperCase();
		this.children = [];
		this.style = {};
		this.dataset = {};
		this.classes = new Set();
		this.classList = {
			add: name => this.classes.add(name),
			toggle: (name, on) => (on ? this.classes.add(name) : this.classes.delete(name))
		};
	}
	set className (value) { this.classes = new Set(String(value).split(' ').filter(Boolean)); }
	get className () { return Array.from(this.classes).join(' '); }
	append (...kids) { kids.forEach(kid => this.children.push(kid)); }
	remove () {}
	set innerHTML (value) { if (!value) { this.children = []; } }
}

globalThis.window = {addEventListener () {}, notify: null};
globalThis.document = {
	hidden: false,
	addEventListener () {},
	baseURI: 'http://localhost:8000/',
	getElementById: () => null,
	createElement: tag => new El(tag),
	head: new El('head')
};
globalThis.fetch = () => new Promise(() => {});
globalThis.setInterval = () => 1;
globalThis.clearInterval = () => {};

const widgets = await import('../js/shell/widgets.js');

const opened = [];
let fail = null;
widgets.register('door', {
	label: 'Door',
	open: {title: 'Open the thing', run: () => (fail ? Promise.reject(fail) : opened.push('door'))}
});
widgets.register('sign', {label: 'Sign'});

const peeks = [];
const host = new El('div');
widgets.mount(host, ['door', 'sign'], {onOpen: () => peeks.push('ended')});

const [door, sign] = host.children[0].children;
check('a widget that leads somewhere is marked as clickable',
	door.classes.has('PixWidget--open'), true);
check('and says where, before you press it', door.title, 'Open the thing');
check('one that does not is left alone — a pointer cursor over nothing is a lie',
	sign.classes.has('PixWidget--open'), false);
check('and takes no clicks', typeof sign.onclick, 'undefined');

// A click on the card, not on something inside it that has its own destination. The run
// is deliberately a promise — opening may have to install an app first — so the click is
// not finished when the handler returns.
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
async function click (target) {
	door.onclick({target: {closest: selector => (target === selector ? {} : null)}});
	await settle();
}

await click(null);
check('clicking the card opens it', opened, ['door']);
check('and the peek ends first — an install can take a moment, and a desktop still '
	+ 'peeking through it looks like a click that did nothing', peeks, ['ended']);

await click('a');
check('a click on a link inside is the link\'s, not the card\'s', opened, ['door']);
check('and does not end the peek either', peeks.length, 1);

// --- a failure is said out loud -------------------------------------------------------

const notes = [];
globalThis.window.notify = note => notes.push(note);
globalThis.window.describeError = (context, err) => ({title: context, message: err.message});
console.error = () => {};

fail = new Error('treemap is not installed');
await click(null);

check('an open that fails reports it', notes.length, 1);
check('as an error, on the surface everything else uses', notes[0].level, 'error');
check('naming the widget you pressed, since nothing else on screen would',
	notes[0].title.includes('Door'), true);
check('and saying what actually went wrong', notes[0].message, 'treemap is not installed');
check('the card is still there and still clickable', door.classes.has('PixWidget--open'), true);

// --- the tray leads to the same places -------------------------------------------------
//
// The taskbar shows three of these readings in miniature. A click there has to land where
// the card lands, and the only way to be sure of that is for the tray to ask this module
// which widget is behind a reading rather than to write "the clock opens the calendar"
// down a second time. Two copies is how they come to disagree, and the tray is the copy
// nobody would think to check.

const taskbarSource = fs.readFileSync(new URL('../js/shell/taskbar.js', import.meta.url), 'utf8');

check('the tray asks this module for the widget behind a reading',
	/widgets\.get\(/.test(taskbarSource), true);
check('and uses the same click handler, which is what ends the peek there too',
	/widgets\.openHandler\(/.test(taskbarSource), true);
['clock', 'storage', 'battery'].forEach(id => {
	check('the tray\'s ' + id + ' leads somewhere',
		new RegExp("openFromTray\\(elements\\." + id + ", '").test(taskbarSource), true);
});
check('and the tray names no destination of its own',
	/openCatalogApp|openFile\(/.test(taskbarSource), false);

process.exit(report('widgets') ? 1 : 0);
