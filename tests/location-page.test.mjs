// The Location page of Settings (phase 27, pass 1): js/shell/location-page.js, drawn into the Settings
// window on tests/fake-dom.mjs, with location.js's half made of plain objects. What it has to get
// right: Follow me turned on only by finding the place in the click, and left off when that fails; the
// box offered only when the browser could ever answer; what the row says for each permission; a typed
// place turning Follow me off; and the page's subscription let go when it stops being shown.

import {check, report} from './assert.mjs';
import {element, doc, all, byClass} from './fake-dom.mjs';

const settings = await import('../js/shell/settings.js');
const page = await import('../js/shell/location-page.js');

// --- the pure half ---------------------------------------------------------------------------------

check('two typed fields are a location', page.readLocationFields(' 56,9496 ', '24.1052'), {location: {latitude: 56.9496, longitude: 24.1052}});
check('a wrong field says which, and why', [page.readLocationFields('91', '0').field, page.readLocationFields('0', 'east').field],
	['latitude', 'longitude']);

const notes = {};
for (const on of [false, true]) {
	for (const state of ['granted', 'prompt', 'denied', 'unsupported']) {
		notes[(on ? 'on ' : 'off ') + state] = page.followNote(on, state);
	}
}
check('every state says something of its own', new Set(Object.values(notes)).size, 7);
check('a browser that cannot say is the same on or off', notes['on unsupported'], notes['off unsupported']);
check('granted and on: found at every start', notes['on granted'], 'Found again each time PixOS starts.');
check('on but the browser would ask: it is not found, and says why', /never asks at start/.test(notes['on prompt']), true);
check('off, it says turning it on asks now and never at start', /asks once now, and never at start/.test(notes['off prompt']), true);
check('off and granted, it says nothing will be asked', /will not ask you/.test(notes['off granted']), true);
check('denied and on says it is on, and why nothing is found', /^On, but the browser was told not to/.test(notes['on denied']), true);
check('denied and off does not', /^On/.test(notes['off denied']), false);
check('denied says where that is changed, on or off', [notes['on denied'], notes['off denied']].every(n => /site's settings in the browser/.test(n)),
	true);

// --- the page --------------------------------------------------------------------------------------

function place (options) {
	const p = {
		current: {latitude: 56.9496, longitude: 24.1052},
		saved: false,
		following: false,
		state: 'prompt',
		listeners: [],
		calls: [],
		followAnswer: null,
		get () { return Object.assign({}, p.current); },
		isSet () { return p.saved; },
		isFollowing () { return p.following; },
		permission () { p.calls.push('permission'); return Promise.resolve(p.state); },
		subscribe (fn) {
			p.listeners.push(fn);
			fn(p.get());
			return () => { p.listeners = p.listeners.filter(other => other !== fn); };
		},
		set (where, opts) {
			p.calls.push(['set', where, opts]);
			p.current = where;
			p.saved = true;
			if (opts && typeof opts.follow === 'boolean') {
				p.following = opts.follow;
			}
			return Promise.resolve(p.get());
		},
		locate () { p.calls.push('locate'); return Promise.resolve({latitude: 59.44, longitude: 24.75}); },
		follow (on) {
			p.calls.push(['follow', on]);
			return new Promise((resolve, reject) => { p.followAnswer = {resolve, reject}; });
		}
	};
	return Object.assign(p, options);
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const host = element('div');
settings.init({host});
const where = place();
page.addLocationPage({settings, location: where});

settings.open('location');
const win = () => host.children[0];
const body = () => byClass(win(), 'PixSettings__body')[0];
const boxOf = () => all(body(), n => n.tagName === 'INPUT' && n.type === 'checkbox')[0];
const notesOf = () => byClass(body(), 'PixDialog__note').filter(n => !n.hidden).map(n => n.textContent);
check('the page is there, named', [settings.currentPage(), byClass(win(), 'PixSettings__page').map(t => t.textContent)], ['location', ['Location']]);
check('showing it subscribes, and asks the browser what it would say', [where.listeners.length, where.calls], [1, ['permission']]);
check('not set: it says Riga stands in', notesOf().some(n => /Riga stands in/.test(n)), true);
check('the box starts off, and may be turned on', [boxOf().checked, boxOf().disabled], [false, false]);

// Turning it on, and the browser answering.
let box = boxOf();
box.checked = true;
box.onchange();
check('turning it on asks location.js to follow, in the click', where.calls.slice(-1), [['follow', true]]);
check('the box waits, and says what it is doing', [box.disabled, notesOf().includes('Finding where this is…')], [true, true]);
where.following = true;
where.saved = true;
where.state = 'granted';
where.followAnswer.resolve({latitude: 59.44, longitude: 24.75});
await tick();
check('once found, the page is drawn again from what is so now', [boxOf() !== box, boxOf().checked, boxOf().disabled], [true, true, false]);
check('saying it will be found at every start', notesOf().includes('Found again each time PixOS starts.'), true);
check('and no longer that Riga stands in', notesOf().some(n => /Riga stands in/.test(n)), false);

// Turning it on, and the browser refusing.
where.following = false;
settings.refresh();
box = boxOf();
box.checked = true;
box.onchange();
where.followAnswer.reject(new Error('The browser was not allowed to say where this is.'));
await tick();
check('refused: the box is off again, may be tried again, and says why', [box.checked, box.disabled,
	notesOf().includes('The browser was not allowed to say where this is.')], [false, false, true]);

// Turning it off.
settings.refresh();
box = boxOf();
box.checked = false;
box.onchange();
check('unticked, it asks location.js to stop following', where.calls.filter(c => c[0] === 'follow').pop(), ['follow', false]);
where.followAnswer.resolve(where.get());
await tick();

// What the browser would say decides whether there is a box to tick.
const drawnFor = async (state, following) => {
	where.state = state;
	where.following = following;
	settings.close();
	settings.open('location');
	await tick();
	return boxOf().disabled;
};
check('a browser that cannot say: no box to tick', await drawnFor('unsupported', false), true);
check('told not to, and off: nothing to tick either', await drawnFor('denied', false), true);
check('told not to, but on: it can still be turned off', await drawnFor('denied', true), false);
check('would ask: it can be turned on, which is when it asks', await drawnFor('prompt', false), false);

// A typed place turns it off.
where.following = true;
settings.refresh();
const [latitude, longitude] = all(body(), n => n.tagName === 'INPUT' && n.type === 'text');
latitude.value = '48,8566';
longitude.value = '2.3522';
const set = all(body(), n => n.tagName === 'BUTTON' && n.textContent === 'Set')[0];
set.onclick();
await tick();
check('a typed place is set with Follow me off', where.calls.filter(c => c[0] === 'set').pop(),
	['set', {latitude: 48.8566, longitude: 2.3522}, {follow: false}]);
check('and the page says so', boxOf().checked, false);
const found = all(body(), n => n.tagName === 'BUTTON' && n.textContent === 'Use my location')[0];
found.onclick();
await tick();
check('a found one leaves it as it was', where.calls.filter(c => c[0] === 'set').pop(), ['set', {latitude: 59.44, longitude: 24.75}, undefined]);

// A change made somewhere else is drawn; and a page no longer shown lets go.
const before = body().children.length;
where.current = {latitude: 1, longitude: 2};
where.listeners.forEach(fn => fn(where.get()));
check('a change from elsewhere is drawn', all(body(), n => n.tagName === 'INPUT' && n.type === 'text').map(n => n.value), ['1', '2']);
check('the same page, drawn again', body().children.length, before);
settings.close();
check('closed, it no longer listens', where.listeners.length, 0);

process.exit(report('location-page') ? 1 : 0);
