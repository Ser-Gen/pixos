// Hot corners (phase 26, pass 6): what a corner can be set to, when one is drawn, how long the
// pointer rests before it starts anything, the corner that holds it off, and a press on a corner
// passed on to what is under it. Driven through a fake document and a clock moved by hand.

import {check, report} from './assert.mjs';
import fs from 'node:fs';

const corners = await import('../js/shell/hot-corners.js');
const {normalizeCorners, anyCorner, DWELL_MS} = corners;

// --- settings ---------------------------------------------------------------------------------------

const NONE = {topLeft: null, topRight: null, bottomLeft: null, bottomRight: null};
check('none by default', normalizeCorners(undefined), NONE);
check('the two actions, anywhere', normalizeCorners({topLeft: 'start', bottomRight: 'never'}),
	{topLeft: 'start', topRight: null, bottomLeft: null, bottomRight: 'never'});
check('anything else is nothing', normalizeCorners({topRight: 'lock', bottomLeft: true, middle: 'start'}), NONE);
check('whether any corner does anything', [anyCorner(NONE), anyCorner({topLeft: 'never'}), anyCorner(null)], [false, true, false]);

// --- the corners, driven ----------------------------------------------------------------------------

function element (tag) {
	const el = {
		tagName: tag.toUpperCase(), className: '', dataset: {}, style: {}, attributes: {}, listeners: {}, parent: null, clicked: 0,
		setAttribute (name, value) { this.attributes[name] = value; },
		addEventListener (type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
		fire (type, extra) {
			const e = Object.assign({type, prevented: false, preventDefault () { this.prevented = true; }}, extra);
			(this.listeners[type] || []).forEach(fn => fn(e));
			return e;
		},
		remove () { if (this.parent) { this.parent.children = this.parent.children.filter(k => k !== this); this.parent = null; } },
		click () { this.clicked++; },
		// Where each corner is, in a 1000 x 600 page.
		getBoundingClientRect () {
			const left = /Left$/.test(this.dataset.corner) ? 0 : 997;
			const top = /^top/.test(this.dataset.corner) ? 0 : 597;
			return {left, top, right: left + 3, bottom: top + 3};
		}
	};
	return el;
}

function world () {
	let now = 0;
	let next = 1;
	const timers = new Map();
	const host = {children: [], append (el) { el.parent = this; this.children.push(el); }};
	const head = [];
	const doc = {
		under: null,
		asked: [],
		moves: [],
		addEventListener (type, fn, capture) { if (type === 'pointermove' && capture === true) { this.moves.push(fn); } },
		removeEventListener (type, fn, capture) { if (capture === true) { this.moves = this.moves.filter(f => f !== fn); } },
		move (x, y) { this.moves.slice().forEach(fn => fn({type: 'pointermove', clientX: x, clientY: y})); },
		createElement: element,
		getElementById: id => head.find(el => el.id === id) || null,
		head: {append (el) { head.push(el); }},
		elementFromPoint (x, y) { this.asked.push([x, y]); return this.under; }
	};
	const log = [];
	return {
		host, doc, log, head, timers,
		setTimeout (fn, ms) { const id = next++; timers.set(id, {fn, at: now + ms}); return id; },
		clearTimeout (id) { timers.delete(id); },
		advance (ms) {
			const end = now + ms;
			for (;;) {
				let due = null;
				timers.forEach((timer, id) => { if (timer.at <= end && (!due || timer.at < due[1].at)) { due = [id, timer]; } });
				if (!due) { break; }
				now = due[1].at;
				timers.delete(due[0]);
				due[1].fn();
			}
			now = end;
		},
		corner (name) { return host.children.find(el => el.dataset.corner === name); }
	};
}

const w = world();
corners.init({host: w.host, doc: w.doc, setTimeout: w.setTimeout, clearTimeout: w.clearTimeout,
	corners: {topLeft: 'start', bottomRight: 'never'}, enabled: true,
	onStart: () => w.log.push('start'), onHold: held => w.log.push(held ? 'hold' : 'release')});

check('its style goes in once', w.head.length, 1);
check('a corner is drawn only where one is set', w.host.children.map(el => el.dataset.corner), ['topLeft', 'bottomRight']);
check('each a few pixels', /width: 3px;\s*height: 3px;/.test(w.head[0].textContent), true);
check('and hidden from a screen reader', w.corner('topLeft').attributes['aria-hidden'], 'true');

const tl = w.corner('topLeft');
tl.fire('pointerenter');
w.advance(DWELL_MS - 1);
check('passing through starts nothing', w.log, []);
tl.fire('pointerleave');
w.advance(DWELL_MS);
check('and leaving before the rest is over cancels it: the pointer was on its way to the tabs', w.log, []);
tl.fire('pointerenter');
w.advance(DWELL_MS);
check('resting there for it starts the screensaver', w.log, ['start']);
check('which is a third of a second', DWELL_MS, 300);
w.log.length = 0;
tl.fire('pointerenter');
w.advance(DWELL_MS / 2);
tl.fire('pointerenter');
w.advance(DWELL_MS);
check('arriving twice without leaving is one rest, and one start', w.log, ['start']);
w.log.length = 0;

const br = w.corner('bottomRight');
br.fire('pointerenter');
check('a never corner holds it off the moment the pointer is there', w.log, ['hold']);
w.advance(10 * DWELL_MS);
check('and starts nothing however long it rests', w.log, ['hold']);
br.fire('pointerleave');
check('leaving lets it go', w.log, ['hold', 'release']);
w.log.length = 0;

// A press, as on Start in the bottom-left corner or the peek strip in the bottom right.
const button = element('button');
w.doc.under = button;
tl.fire('pointerenter');
const press = tl.fire('pointerdown', {clientX: 1, clientY: 2});
check('a press cancels the wait', (w.advance(DWELL_MS), w.log), []);
check('and its mousedown, so a start menu opening does not see a click outside itself', press.prevented, true);
check('the corner gets out of the way', tl.style.pointerEvents, 'none');
check('and what is under the pointer is clicked', [w.doc.asked, button.clicked], [[[1, 2]], 1]);
w.advance(60000);
check('it stays out of the way however long the pointer rests there', tl.style.pointerEvents, 'none');
w.doc.move(5, 6);
check('and while it moves about in the corner', tl.style.pointerEvents, 'none');
w.doc.move(7, 1);
check('it is back once the pointer is seen more than a corner\'s width away', [tl.style.pointerEvents, w.doc.moves.length], ['', 0]);
tl.fire('pointerdown', {clientX: 0, clientY: 0});
w.doc.move(1, 7);
check('below it too', tl.style.pointerEvents, '');
tl.fire('pointerdown', {clientX: 0, clientY: 0});
tl.fire('pointerdown', {clientX: 0, clientY: 0});
check('pressed twice, it listens once', w.doc.moves.length, 1);
w.doc.move(500, 300);

w.doc.under = element('iframe');
tl.fire('pointerdown', {clientX: 0, clientY: 0});
check('a window under it is not clicked: its three pixels are lost', w.doc.under.clicked, 0);
w.doc.under = null;
tl.fire('pointerdown', {clientX: 0, clientY: 0});
check('nor is nothing', true, true);
w.doc.move(500, 300);

br.fire('pointerenter');
br.fire('pointerdown', {clientX: 999, clientY: 599});
check('a press in a never corner lets it go too: someone is there', w.log, ['hold', 'release']);
w.doc.move(996, 599);
check('the bottom right one is back when the pointer is away from it, not from the top left', br.style.pointerEvents, 'none');
w.doc.move(990, 599);
check('as it is', br.style.pointerEvents, '');
br.fire('pointerdown', {clientX: 999, clientY: 599});
w.doc.move(999, 590);
check('and when the pointer goes straight up from it', br.style.pointerEvents, '');
w.log.length = 0;

// Updates.
br.fire('pointerenter');
tl.fire('pointerenter');
corners.update({topLeft: 'start', bottomRight: 'never'}, true);
w.advance(DWELL_MS);
check('told the same again, nothing is redrawn and a rest under way goes on', [w.host.children.includes(tl), w.log], [true, ['hold', 'start']]);
w.log.length = 0;
tl.fire('pointerenter');
tl.fire('pointerdown', {clientX: 0, clientY: 0});
tl.fire('pointerenter');
corners.setEnabled(false);
check('a corner that went while out of the way stops listening for the pointer', w.doc.moves.length, 0);
check('no clock is left behind by a corner that went', w.timers.size, 0);
check('switched off -- the screensaver running -- the corners go, and what they held is let go',
	[w.host.children.length, w.log], [0, ['release']]);
w.advance(DWELL_MS);
check('and a rest under way starts nothing', w.log, ['release']);
corners.setEnabled(true);
check('switched on, they are back as they were', w.host.children.map(el => el.dataset.corner), ['topLeft', 'bottomRight']);
corners.update({topRight: 'start'}, true);
check('set otherwise, drawn otherwise', w.host.children.map(el => el.dataset.corner), ['topRight']);
corners.update({topRight: 'start'}, false);
check('with no screensaver chosen, none', w.host.children.length, 0);

const w2 = world();
corners.init({host: w2.host, doc: w2.doc, setTimeout: w2.setTimeout, clearTimeout: w2.clearTimeout, corners: {topLeft: 'start'}, enabled: true});
check('set up again, each time from nothing', [w.host.children.length, w2.host.children.length], [0, 1]);
w.log.length = 0;
w2.corner('topLeft').fire('pointerenter');
w2.advance(DWELL_MS);
check('with nobody to tell, it tells nobody -- not whoever was told before', w.log, []);
const w3 = world();
corners.init({host: w3.host, doc: w3.doc, setTimeout: w3.setTimeout, clearTimeout: w3.clearTimeout, corners: {topLeft: 'start'}, enabled: true});
check('and set up again with what the last one was told, still drawn', w3.host.children.length, 1);

// --- the wiring -------------------------------------------------------------------------------------

const shell = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
check('the shell puts them over the windows', /hotCorners\.init\(\{\s*host: document\.getElementById\('overlays'\)/.test(shell), true);
check('a corner starts the real thing, not a preview, so it locks', /onStart: function \(\) \{\s*screensaver\.start\(\);\s*\}/.test(shell), true);
check('they go while it runs and come back after', /hotCorners\.setEnabled\(false\);/.test(shell) && /hotCorners\.setEnabled\(!!screensaver\.getSettings\(\)\.show\);/.test(shell), true);
check('and follow the settings', /screensaver\.onChange\(function \(\) \{\s*var chosen = screensaver\.getSettings\(\);\s*hotCorners\.update\(chosen\.corners, !!chosen\.show && !screensaver\.isRunning\(\)\);/.test(shell), true);

process.exit(report('hot-corners') ? 1 : 0);
