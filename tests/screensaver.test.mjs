// The screensaver (phase 26): when it starts, what ends it, and what happens to the input that
// did. The decisions are pure and tested as such; the module around them is driven through a
// fake window with a clock moved by hand, a fake IdleDetector, and a fake background provider
// that records what is done to it.

import {check, report} from './assert.mjs';
import fs from 'node:fs';

globalThis.window = {addEventListener () {}, removeEventListener () {}};
globalThis.document = {addEventListener () {}, getElementById: () => null};

const wallpaper = await import('../js/shell/wallpaper.js');
const saver = await import('../js/shell/screensaver.js');
const {decide, wakes, mediaPlaying, opaqueFocus, normalizeSettings, MOVE_GRACE_MS, TICK_MS} = saver;

// --- settings ----------------------------------------------------------------------------------------

wallpaper.register('fake', {mount: fakeMount});

const NO_CORNERS = {topLeft: null, topRight: null, bottomLeft: null, bottomRight: null};
check('a fresh system has no screensaver, and five minutes ready for when it has; no hot corners and no PIN',
	normalizeSettings(undefined), {show: null, minutes: 5, corners: NO_CORNERS, pin: null});
check('minutes as written in a file', normalizeSettings({minutes: '10'}).minutes, 10);
check('nothing under a minute, which is also all idle detection can do',
	[normalizeSettings({minutes: 0}).minutes, normalizeSettings({minutes: -3}).minutes, normalizeSettings({minutes: 'soon'}).minutes], [5, 5, 5]);
check('whole minutes', normalizeSettings({minutes: 2.6}).minutes, 3);
check('and at most a day', normalizeSettings({minutes: 99999}).minutes, 1440);
check('a choice of a type nobody draws is no choice', normalizeSettings({show: {type: 'teapot', value: 1}}).show, null);
check('the hot corners are kept', normalizeSettings({corners: {topLeft: 'start', topRight: 'teapot'}}).corners,
	{topLeft: 'start', topRight: null, bottomLeft: null, bottomRight: null});
check('a real one is kept, filled in', normalizeSettings({show: {type: 'shader', value: 'aurora'}}).show,
	{type: 'shader', value: 'aurora', options: {}});

// --- whether to start ----------------------------------------------------------------------------

const MIN = 60000;
function state (extra) {
	return Object.assign({enabled: true, running: false, hidden: false, locked: false, mode: 'fallback',
		userIdle: false, idleAt: 0, lastSeen: 0, lastBlocked: 0, minutes: 5, now: 10 * MIN, media: false, opaque: false}, extra);
}

check('off is off', decide(state({enabled: false})), 'off');
check('it does not start over itself', decide(state({running: true})), 'running');
check('nor in a hidden tab, where nobody would see it', decide(state({hidden: true})), 'hidden');
check('nor on a locked screen', decide(state({locked: true})), 'locked');
check('five minutes after the last input it starts', decide(state({lastSeen: 5 * MIN})), 'start');
check('a moment sooner it waits', decide(state({lastSeen: 5 * MIN + 1})), 'waiting');
check('something that held it off counts as input', decide(state({lastBlocked: 6 * MIN})), 'waiting');

let asked = 0;
const scan = () => { asked++; return false; };
decide(state({lastSeen: 9 * MIN, media: scan, opaque: scan}));
check('while it is waiting anyway, no window is searched for media', asked, 0);
decide(state({media: scan, opaque: scan}));
check('once the wait is over, both are looked at', asked, 2);

check('a video playing holds it off', decide(state({media: true})), 'media');
check('so does the focus in a window PixOS cannot see into', decide(state({opaque: true})), 'opaque');
check('media holds it off with idle detection too', decide(state({mode: 'detector', userIdle: true, idleAt: 9 * MIN, media: true})), 'media');
check('but an opaque window does not: the detector sees typing there',
	decide(state({mode: 'detector', userIdle: true, idleAt: 9 * MIN, opaque: true})), 'start');
check('with the detector saying active, it waits however long PixOS has seen nothing',
	decide(state({mode: 'detector', userIdle: false})), 'waiting');
check('the detector turning idle means the last input was the wait before that',
	decide(state({mode: 'detector', userIdle: true, idleAt: 10 * MIN})), 'start');
check('input PixOS saw since still counts', decide(state({mode: 'detector', userIdle: true, idleAt: 9 * MIN, lastSeen: 9.5 * MIN})), 'waiting');
check('but what it saw before the detector said idle is the detector\'s to judge',
	decide(state({mode: 'detector', userIdle: true, idleAt: 9 * MIN, lastSeen: 8.9 * MIN})), 'start');
check('and so does something that held it off since', decide(state({mode: 'detector', userIdle: true, idleAt: 9 * MIN, lastBlocked: 9 * MIN})), 'waiting');

// --- what ends it --------------------------------------------------------------------------------

check('a key', wakes({type: 'keydown'}, 0, null), true);
check('but not the key that started it, repeating', wakes({type: 'keydown', repeat: true}, 5000, null), false);
check('nor a key let go', wakes({type: 'keyup'}, 5000, null), false);
check('a press, even at once', [wakes({type: 'pointerdown'}, 0, null), wakes({type: 'mousedown'}, 0, null), wakes({type: 'touchstart'}, 0, null)], [true, true, true]);
check('a scroll', wakes({type: 'wheel'}, 0, null), true);
check('a move in the first second is the hand leaving the mouse',
	wakes({type: 'pointermove', clientX: 500, clientY: 500}, MOVE_GRACE_MS - 1, {x: 0, y: 0}), false);
check('after it, a move from where the pointer stood', wakes({type: 'pointermove', clientX: 106, clientY: 100}, MOVE_GRACE_MS, {x: 100, y: 100}), true);
check('but not a pixel or two of a desk being bumped', wakes({type: 'pointermove', clientX: 103, clientY: 103}, 5000, {x: 100, y: 100}), false);
check('nor a move from nowhere known', wakes({type: 'mousemove', clientX: 300, clientY: 300}, 5000, null), false);
check('anything else, no', [wakes({type: 'focus'}, 5000, null), wakes(null, 0, null)], [false, false]);

// --- media ------------------------------------------------------------------------------------------

function mediaEl (paused, ended) {
	return {tag: 'VIDEO', paused: paused, ended: !!ended};
}
function doc (media, frames) {
	return {
		querySelectorAll (selector) {
			return selector === 'video, audio' ? media || [] : frames || [];
		}
	};
}
function frameOf (inner) {
	return {contentDocument: inner};
}
const crossOrigin = {get contentDocument () { throw new Error('cross-origin'); }};

check('a paused video is nobody watching', mediaPlaying(doc([mediaEl(true)])), false);
check('a playing one is', mediaPlaying(doc([mediaEl(false)])), true);
check('one that has ended is not', mediaPlaying(doc([mediaEl(false, true)])), false);
check('found inside a window, and inside a frame in it',
	mediaPlaying(doc([], [frameOf(doc([], [frameOf(doc([mediaEl(false)]))]))])), true);
check('a cross-origin frame is passed over, not a crash', mediaPlaying(doc([], [crossOrigin, frameOf(null)])), false);
const desktopFrame = frameOf(doc([mediaEl(false)]));
const ownVideo = mediaEl(false);
check('what plays in the background and the screensaver is not someone watching',
	mediaPlaying(doc([ownVideo], [desktopFrame]), el => el === desktopFrame || el === ownVideo), false);

// --- the focus ---------------------------------------------------------------------------------------

function focusDoc (active, focused) {
	return {hasFocus: () => focused !== false, activeElement: active};
}
check('focus outside the page says nothing: that is usually someone gone',
	opaqueFocus(focusDoc({tagName: 'IFRAME', contentDocument: null}, false)), false);
check('focus in the shell itself is seen', opaqueFocus(focusDoc({tagName: 'BODY'})), false);
check('in an app PixOS can read, seen', opaqueFocus(focusDoc({tagName: 'IFRAME', contentDocument: {activeElement: {tagName: 'INPUT'}}})), false);
check('in a web page opened as a window, not', opaqueFocus(focusDoc({tagName: 'IFRAME', contentDocument: null})), true);
check('nor in a cross-origin frame inside an app, as in Photopea',
	opaqueFocus(focusDoc({tagName: 'IFRAME', contentDocument: {activeElement: {tagName: 'IFRAME', get contentDocument () { throw new Error('x'); }}}})), true);

// --- the module, driven --------------------------------------------------------------------------

// A background provider that says what was done to it.
const mounted = [];
function fakeMount (element, config) {
	const instance = {config, log: [], pause () { this.log.push('pause'); }, resume () { this.log.push('resume'); }, unmount () { this.log.push('unmount'); }};
	mounted.push(instance);
	return instance;
}

function element (tag, owner) {
	const el = {
		tagName: tag.toUpperCase(), children: [], parent: null, style: {}, attributes: {}, listeners: {}, className: '',
		classList: {
			add (name) { el.className = (el.className + ' ' + name).trim(); },
			contains (name) { return el.className.split(' ').includes(name); },
			remove (name) { el.className = el.className.split(' ').filter(n => n !== name).join(' '); }
		},
		setAttribute (name, value) { this.attributes[name] = value; },
		append (...kids) { kids.forEach(kid => { kid.parent = this; this.children.push(kid); }); },
		replaceChildren () { this.children = []; },
		remove () { if (this.parent) { this.parent.children = this.parent.children.filter(k => k !== this); this.parent = null; } },
		addEventListener (type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
		focus () { owner.activeElement = this; },
		contains (other) { for (let at = other; at; at = at.parent) { if (at === this) { return true; } } return false; },
		get isConnected () { for (let at = this; at; at = at.parent) { if (at === owner.body) { return true; } } return false; },
		querySelectorAll () { return []; }
	};
	return el;
}

function event (type, extra) {
	return Object.assign({type, prevented: false, stopped: false,
		preventDefault () { this.prevented = true; },
		stopPropagation () { this.stopped = true; },
		stopImmediatePropagation () { this.stopped = true; }}, extra);
}

function makeEnv (options) {
	options = options || {};
	let now = 1000000;
	let nextTimer = 1;
	const timers = new Map();
	const listeners = {};
	const d = {
		hidden: false, activeElement: null, listeners: {}, media: [], focused: true,
		createElement: tag => element(tag, d),
		getElementById: () => null,
		head: {append () {}},
		addEventListener (type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
		hasFocus () { return this.focused; },
		querySelectorAll (selector) { return selector === 'video, audio' ? d.media : []; }
	};
	d.body = element('body', d);
	const host = element('div', d);
	d.body.append(host);
	const app = element('iframe', d);
	// An app PixOS can read into, until a test says otherwise.
	app.contentDocument = {activeElement: null};
	d.body.append(app);
	d.activeElement = app;
	const env = {
		document: d,
		addEventListener (type, fn, opts) { (listeners[type] = listeners[type] || []).push({fn, opts}); },
		setInterval (fn, ms) { const id = nextTimer++; timers.set(id, {fn, ms, every: true, at: now + ms}); return id; },
		clearInterval (id) { timers.delete(id); },
		setTimeout (fn, ms) { const id = nextTimer++; timers.set(id, {fn, ms, every: false, at: now + ms}); return id; },
		clearTimeout (id) { timers.delete(id); },
		navigator: options.navigator || {}
	};
	if (options.IdleDetector) {
		env.IdleDetector = options.IdleDetector;
	}
	return {
		env, doc: d, host, app, listeners, timers,
		now: () => now,
		// Moves the clock, firing each timer that falls due on the way.
		advance (ms) {
			const end = now + ms;
			for (;;) {
				let due = null;
				timers.forEach((timer, id) => { if (timer.at <= end && (!due || timer.at < due[1].at)) { due = [id, timer]; } });
				if (!due) { break; }
				now = due[1].at;
				if (due[1].every) { due[1].at += due[1].ms; } else { timers.delete(due[0]); }
				due[1].fn();
			}
			now = end;
		},
		key (type, extra) {
			const e = event(type, extra);
			(listeners[type] || []).filter(l => l.opts === true).forEach(l => l.fn(e));
			return e;
		},
		seen (type) {
			(listeners[type] || []).filter(l => l.opts && l.opts.passive).forEach(l => l.fn(event(type)));
		}
	};
}

function makeWm () {
	const handlers = {};
	return {
		on (name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
		emit (name, payload) { (handlers[name] || []).forEach(fn => fn(payload)); }
	};
}

const FAKE = {type: 'fake', value: 'waves'};
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

{
	const t = makeEnv();
	const wm = makeWm();
	const persisted = [];
	const calls = [];
	saver.init({env: t.env, host: t.host, wm, settings: undefined, now: t.now,
		persist: patch => { persisted.push(patch); return Promise.resolve(); },
		onStart: () => calls.push('start'), onStop: () => calls.push('stop')});

	check('off: no clock is kept at all', t.timers.size, 0);
	check('its key listeners go on window in the capture phase', ['keydown', 'keypress', 'keyup'].every(type => t.listeners[type].some(l => l.opts === true)), true);
	check('and what it counts as activity is listened to passively',
		['keydown', 'pointerdown', 'pointermove', 'wheel'].every(type => t.listeners[type].some(l => l.opts && l.opts.passive && l.opts.capture)), true);
	check('with nothing chosen there is nothing to start', saver.start(), false);
	check('and no browser idle detection, it says so', saver.idleStatus(), {mode: 'fallback', permission: 'unsupported'});

	// Chosen after ten quiet minutes: the choosing is someone at the machine, and the wait starts from it.
	t.advance(10 * MIN);
	const saved = await saver.setSettings({show: FAKE});
	check('choosing one writes it beside the wallpaper', persisted,
		[{screensaver: {show: {type: 'fake', value: 'waves', options: {}}, minutes: 5, corners: NO_CORNERS, pin: null}}]);
	check('and says what it now is', saved.show.value, 'waves');
	check('and keeps a clock', t.timers.size, 1);

	t.advance(4 * MIN);
	check('four minutes on, nothing', saver.isRunning(), false);
	t.seen('pointermove');
	t.advance(4 * MIN);
	check('a pointer move in the shell started the wait again', saver.isRunning(), false);
	wm.emit('activity');
	t.advance(4.5 * MIN);
	check('and so did activity inside a window, which the WM passes on', saver.isRunning(), false);
	t.advance(MIN);
	check('five minutes of nothing: it starts', saver.isRunning(), true);
	check('the launchers were closed and the desktop told it is covered', calls, ['start']);
	const layer = t.host.children.find(c => c.className === 'PixScreensaver');
	check('its layer is in the shell', !!layer, true);
	check('with the focus, taken from the app that had it', t.doc.activeElement === layer, true);
	check('and what was chosen drawn on it', mounted[mounted.length - 1].config.value, 'waves');

	const repeat = t.key('keydown', {repeat: true});
	check('the chord that started it, still held, does not end it', saver.isRunning(), true);
	check('but goes nowhere either', [repeat.prevented, repeat.stopped], [true, true]);
	const first = t.key('keydown', {code: 'KeyK', ctrlKey: true});
	check('a key ends it', saver.isRunning(), false);
	check('and is swallowed: not the app, not the palette', [first.prevented, first.stopped], [true, true]);
	check('the desktop is told it is uncovered', calls, ['start', 'stop']);
	check('the layer stays while it fades, catching the rest', layer.parent === t.host && layer.classList.contains('PixScreensaver--closing'), true);
	const up = t.key('keyup');
	check('the key let go is swallowed too', up.stopped, true);
	t.advance(200);
	check('then it is gone', layer.parent === null, true);
	check('with its picture unloaded', mounted[mounted.length - 1].log, ['unmount']);
	check('and the focus back in the app', t.doc.activeElement === t.app, true);
	check('keys are the app\'s again', t.key('keydown').stopped, false);

	// A press: it goes on catching until the button is let go, or the click would land below.
	saver.start();
	const layer2 = t.host.children.find(c => c.className === 'PixScreensaver');
	layer2.listeners.pointerdown[0](event('pointerdown'));
	check('a press ends it', saver.isRunning(), false);
	t.advance(400);
	check('held past the fade, the layer is still there to catch the release and the click', layer2.parent === t.host, true);
	layer2.listeners.pointerup[0](event('pointerup'));
	check('after the release, not yet: the click comes next', layer2.parent === t.host, true);
	t.advance(1);
	check('and then it is gone', layer2.parent === null, true);

	// A click quicker than the fade: gone once the fade is over, not before.
	saver.start();
	const quick = t.host.children.find(c => c.className === 'PixScreensaver');
	quick.listeners.pointerdown[0](event('pointerdown'));
	check('while it fades, it will not start again over itself', saver.start(), false);
	quick.listeners.pointerup[0](event('pointerup'));
	t.advance(1);
	check('a click let go before the fade is over leaves it fading', quick.parent === t.host, true);
	t.advance(200);
	check('and gone when it is', quick.parent === null, true);

	// A move: only after the first second, and only from where the pointer stood.
	saver.start();
	const layer3 = t.host.children.find(c => c.className === 'PixScreensaver');
	const move = (x, y) => layer3.listeners.pointermove[0](event('pointermove', {clientX: x, clientY: y}));
	move(10, 10);
	move(400, 400);
	check('a move in the first second does not end it', saver.isRunning(), true);
	t.advance(MOVE_GRACE_MS);
	move(402, 401);
	check('nor does a bump after it', saver.isRunning(), true);
	move(420, 400);
	check('a real move does', saver.isRunning(), false);
	t.advance(200);

	t.advance(5 * MIN - 1000);
	check('ended by a move, it waits the whole time again', saver.isRunning(), false);
	t.advance(1000 + TICK_MS);
	check('and then starts again', saver.isRunning(), true);
	saver.stop();
	check('stopped at once: no fade', t.host.children.filter(c => c.className.indexOf('PixScreensaver') === 0).length, 0);

	t.doc.media = [mediaEl(false)];
	t.advance(5 * MIN + TICK_MS);
	check('a video playing holds it off', saver.isRunning(), false);
	t.doc.media = [];
	t.advance(4 * MIN);
	check('stopped, it still waits the whole time from when it last was', saver.isRunning(), false);
	t.advance(MIN + TICK_MS);
	check('and then starts', saver.isRunning(), true);
	saver.stop();

	t.app.contentDocument = null;
	t.doc.activeElement = t.app;
	t.advance(6 * MIN);
	check('the focus in a window PixOS cannot see into holds it off', saver.isRunning(), false);
	t.doc.activeElement = t.doc.body;
	t.advance(6 * MIN);
	check('and back in the shell, it starts', saver.isRunning(), true);

	t.doc.hidden = true;
	t.doc.listeners.visibilitychange.forEach(fn => fn());
	check('a hidden tab pauses what it shows', mounted[mounted.length - 1].log, ['pause']);
	t.doc.hidden = false;
	t.doc.listeners.visibilitychange.forEach(fn => fn());
	check('and showing it again resumes it', mounted[mounted.length - 1].log, ['pause', 'resume']);

	wm.emit('keydown', event('keydown'));
	check('a key pressed in an app that took the focus back ends it too', saver.isRunning(), false);
	t.advance(200);

	t.doc.hidden = true;
	t.advance(20 * MIN);
	check('it never starts in a hidden tab', saver.isRunning(), false);
	t.doc.hidden = false;
	t.doc.listeners.visibilitychange.forEach(fn => fn());
	t.advance(4 * MIN);
	check('and coming back to the tab is someone being there', saver.isRunning(), false);

	const preview = {type: 'fake', value: 'preview'};
	await saver.setSettings({show: null});
	check('turned off, the clock goes', t.timers.size, 0);
	check('a preview shows what it is given, chosen or not', saver.start(preview), true);
	check('that one', mounted[mounted.length - 1].config.value, 'preview');
	saver.stop();

	let heard = 0;
	const unsubscribe = saver.onChange(() => heard++);
	saver.start(preview);
	saver.stop();
	check('the dialog hears it start and stop', heard >= 2, true);
	unsubscribe();
	heard = 0;
	saver.start(preview);
	saver.stop();
	check('and stops hearing when it asks to', heard, 0);
}

{
	// What plays on the desktop is the background's own: it holds nothing off.
	const t = makeEnv();
	const desktopLayer = element('div', t.doc);
	t.doc.body.append(desktopLayer);
	const backgroundVideo = element('video', t.doc);
	backgroundVideo.paused = false;
	backgroundVideo.ended = false;
	desktopLayer.append(backgroundVideo);
	t.doc.media = [backgroundVideo];
	saver.init({env: t.env, host: t.host, settings: {show: FAKE}, ignore: [desktopLayer], now: t.now});
	t.advance(5 * MIN + TICK_MS);
	check('a video playing in the background does not hold it off', saver.isRunning(), true);
	saver.stop();
}

// --- with idle detection -------------------------------------------------------------------------

function makeDetectorWorld (initial) {
	const world = {permission: initial, requested: 0, detectors: [], queried: 0};
	class FakeIdleDetector {
		constructor () { this.userState = 'active'; this.screenState = 'unlocked'; this.handlers = []; world.detectors.push(this); }
		static requestPermission () { world.requested++; world.permission = world.answer || 'granted'; return Promise.resolve(world.permission); }
		addEventListener (type, fn) { this.handlers.push(fn); }
		start (options) {
			this.threshold = options.threshold;
			this.signal = options.signal;
			return world.refuse ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
		}
		set (user, screen) { this.userState = user; this.screenState = screen || 'unlocked'; this.handlers.forEach(fn => fn()); }
	}
	world.IdleDetector = FakeIdleDetector;
	world.navigator = {permissions: {query: () => { world.queried++; return Promise.resolve({state: world.permission}); }}};
	return world;
}

{
	const world = makeDetectorWorld('granted');
	const t = makeEnv({IdleDetector: world.IdleDetector, navigator: world.navigator});
	saver.init({env: t.env, host: t.host, settings: {show: FAKE, minutes: 3}, now: t.now});
	await flush();
	const detector = world.detectors[world.detectors.length - 1];
	check('allowed already: the detector runs, with the wait as its threshold', [saver.idleStatus().mode, detector.threshold], ['detector', 3 * MIN]);
	t.advance(10 * MIN);
	check('while it says someone is there, it waits however quiet PixOS is', saver.isRunning(), false);
	detector.set('idle');
	check('when it says idle, it starts', saver.isRunning(), true);
	detector.set('idle', 'locked');
	check('the screen locked under it: what it shows is paused', mounted[mounted.length - 1].log, ['pause']);
	detector.set('idle', 'unlocked');
	check('and unlocked, resumed', mounted[mounted.length - 1].log, ['pause', 'resume']);
	saver.stop();

	// Idle, then a key PixOS saw, then the detector reporting again before it noticed the key.
	detector.set('active');
	t.doc.hidden = true;
	detector.set('idle');
	t.advance(10000);
	t.seen('keydown');
	t.doc.hidden = false;
	detector.set('idle', 'unlocked');
	check('a second report of idle does not move when idle began, and the key since still counts', saver.isRunning(), false);
	detector.set('active');
	detector.set('idle', 'locked');
	t.advance(TICK_MS);
	check('not on a locked screen', saver.isRunning(), false);

	await saver.setSettings({minutes: 10});
	await flush();
	const second = world.detectors[world.detectors.length - 1];
	check('a new wait is a new detector', [second !== detector, second.threshold], [true, 10 * MIN]);
	check('and the old one is stopped', detector.signal.aborted, true);
	detector.set('idle');
	check('and no longer heard', saver.isRunning(), false);
	await saver.setSettings({show: null});
	check('turned off, no detector runs at all', [second.signal.aborted, saver.idleStatus().mode], [true, 'fallback']);
}

{
	const world = makeDetectorWorld('prompt');
	const t = makeEnv({IdleDetector: world.IdleDetector, navigator: world.navigator});
	saver.init({env: t.env, host: t.host, settings: {show: FAKE}, now: t.now});
	await flush();
	check('not asked yet: counted from what PixOS sees, and it says it could ask', saver.idleStatus(), {mode: 'fallback', permission: 'prompt'});
	check('nothing is asked for without a click', world.requested, 0);
	const answered = saver.askForIdle();
	check('asked at once, inside the click, before anything is awaited', world.requested, 1);
	check('allowed, it says so', await answered, 'granted');
	await flush();
	check('and the detector takes over', saver.idleStatus().mode, 'detector');
}

{
	const world = makeDetectorWorld('denied');
	const t = makeEnv({IdleDetector: world.IdleDetector, navigator: world.navigator});
	saver.init({env: t.env, host: t.host, settings: {show: FAKE}, now: t.now});
	await flush();
	await saver.askForIdle();
	check('refused before: not asked again, since the browser would not ask either', world.requested, 0);
	check('and PixOS counts what it sees', saver.idleStatus(), {mode: 'fallback', permission: 'denied'});
	t.advance(5 * MIN);
	check('which still starts it', saver.isRunning(), true);
	saver.stop();
}

{
	const world = makeDetectorWorld('granted');
	world.refuse = true;
	const t = makeEnv({IdleDetector: world.IdleDetector, navigator: world.navigator});
	const warn = console.warn;
	console.warn = () => {};
	saver.init({env: t.env, host: t.host, settings: {show: FAKE}, now: t.now});
	await flush();
	console.warn = warn;
	check('a detector that will not start leaves the fallback in charge', saver.idleStatus(), {mode: 'fallback', permission: 'granted'});
	t.advance(5 * MIN);
	check('and it still starts', saver.isRunning(), true);
	saver.stop();
}

// --- held off by a hot corner, and still on battery (pass 6) --------------------------------------

check('a pointer resting in a never corner holds it off once the wait is over', decide(state({held: true})), 'corner');
check('and says nothing before', decide(state({held: true, lastSeen: 9 * MIN})), 'waiting');

{
	const t = makeEnv();
	saver.init({env: t.env, host: t.host, settings: {show: FAKE}, now: t.now, storage: null});
	saver.setHeld(true);
	t.advance(20 * MIN);
	check('held by a corner, it does not start', saver.isRunning(), false);
	saver.setHeld(false);
	t.advance(5 * MIN - TICK_MS);
	check('let go, it waits the whole time from the last moment it was held', saver.isRunning(), false);
	t.advance(2 * TICK_MS);
	check('and then starts', saver.isRunning(), true);
	saver.stop();
}

{
	// A provider whose handle says what still did: wallpaper.js's own handle, around the fake.
	const t = makeEnv();
	saver.init({env: t.env, host: t.host, settings: {show: FAKE}, now: t.now, storage: null});
	saver.setStill(true);
	saver.start();
	const shown = mounted[mounted.length - 1];
	check('on battery, what it shows moves at first', shown.log, []);
	t.advance(wallpaper.STILL_AFTER_MS);
	check('and then holds still', shown.log, ['pause']);
	saver.setStill(false);
	check('plugged in, it moves again', shown.log, ['pause', 'resume']);
	saver.stop();
	saver.setStill(true);
	saver.start();
	saver.setStill(false);
	t.advance(wallpaper.STILL_AFTER_MS);
	check('one started on battery and plugged in before it held never holds', mounted[mounted.length - 1].log, []);
	saver.stop();
}

// --- the PIN (pass 6) -----------------------------------------------------------------------------

function memory () {
	const items = {};
	const store = {
		items,
		getItem (key) { return key in items ? items[key] : null; },
		setItem (key, value) { items[key] = String(value); },
		removeItem (key) { delete items[key]; }
	};
	return store;
}

const pinModule = await import('../js/shell/pin.js');
const PIN = await pinModule.makePin('2468', globalThis.crypto);
const settle = async () => { for (let i = 0; i < 5; i++) { await flush(); } };

function padOf (t) {
	const layer = t.host.children.find(c => c.className.indexOf('PixScreensaver') === 0);
	const box = layer && layer.children.find(c => c.className === 'PixScreensaver__pad');
	if (!box) {
		return null;
	}
	return {layer, box, input: box.children.find(c => c.tagName === 'INPUT'), button: box.children.find(c => c.tagName === 'BUTTON'),
		note: box.children.find(c => c.className === 'PixScreensaver__padNote')};
}

{
	const t = makeEnv();
	const store = memory();
	const persisted = [];
	saver.init({env: t.env, host: t.host, settings: {show: FAKE}, now: t.now, storage: store, crypto: globalThis.crypto,
		persist: patch => { persisted.push(patch); return Promise.resolve(); }});
	check('no PIN at first', saver.hasPin(), false);
	check('one can be set here', saver.canUsePin(), true);
	await saver.setPin('2468');
	check('set, it is kept as its hash beside the rest', [saver.hasPin(), persisted[0].screensaver.pin.hash.length], [true, 64]);
	check('and not handed out', 'pin' in saver.getSettings(), false);

	check('a preview is not locked', [saver.start(FAKE), saver.isLocked()], [true, false]);
	t.key('keydown', {key: 'a'});
	check('and ends at a key as before', saver.isRunning(), false);
	t.advance(200);

	check('Start screensaver, a corner or the wait: locked', [saver.start(), saver.isLocked()], [true, true]);
	check('and written down for the other tabs and a reload', pinModule.readLock(store).hash, persisted[0].screensaver.pin.hash);
	const woke = t.key('keydown', {key: 'x'});
	check('a key does not end it', saver.isRunning(), true);
	check('it goes nowhere', [woke.prevented, woke.stopped], [true, true]);
	let pad = padOf(t);
	check('it asks for the PIN', !!pad, true);
	check('with the field ready to type in', t.doc.activeElement === pad.input, true);
	check('and the pointer shown', pad.layer.classList.contains('PixScreensaver--asking'), true);

	const typed = t.key('keydown', {key: '2', target: pad.input});
	check('a digit is typed into the field: nothing stops it there', typed.prevented, false);
	check('but it reaches nothing past the screensaver', typed.stopped, true);
	const tab = t.key('keydown', {key: 'Tab', target: pad.input});
	check('Tab does not take the focus out to the page under it', tab.prevented, true);
	const stray = t.key('keydown', {key: '5', target: pad.layer});
	check('a key with the focus elsewhere is not typed, and the field gets the focus back',
		[stray.prevented, t.doc.activeElement === pad.input], [true, true]);

	const onPad = event('pointerdown', {target: pad.button});
	pad.layer.listeners.pointerdown[0](onPad);
	check('a press on the pad is the pad\'s: its button and field take it as any would', [onPad.prevented, onPad.stopped], [false, false]);

	pad.input.value = '1111';
	t.key('keydown', {key: 'Enter', target: pad.input});
	await settle();
	check('a wrong PIN does not end it', saver.isRunning(), true);
	check('it says so, and empties the field', [pad.note.textContent, pad.input.value], ['That is not the PIN.', '']);
	check('and the try is written down', pinModule.readLock(store).failures, 1);

	t.key('keydown', {key: 'Escape', target: pad.input});
	check('Escape puts the pad away and the screensaver goes on', [padOf(t), saver.isRunning()], [null, true]);
	check('with the keys back on the layer, and the pointer hidden again',
		[t.doc.activeElement === pad.layer, pad.layer.classList.contains('PixScreensaver--asking')], [true, false]);
	pad.layer.listeners.pointerdown[0](event('pointerdown', {target: pad.layer}));
	pad.layer.listeners.pointerup[0](event('pointerup', {target: pad.layer}));
	pad = padOf(t);
	check('a press asks again', !!pad, true);
	t.advance(saver.PAD_IDLE_MS - 1);
	check('typed in or not, the pad stays a while', !!padOf(t), true);
	t.advance(1);
	check('left alone half a minute, it goes away', [padOf(t), saver.PAD_IDLE_MS], [null, 30000]);

	t.key('keydown', {key: ' '});
	pad = padOf(t);
	for (let i = 0; i < 4; i++) {
		pad.input.value = '0000';
		t.key('keydown', {key: 'Enter', target: pad.input});
		await settle();
	}
	check('the fifth wrong PIN costs half a minute', pad.note.textContent, 'Too many wrong PINs. Try again in 30 s.');
	pad.input.value = '2468';
	t.key('keydown', {key: 'Enter', target: pad.input});
	await settle();
	check('in which not even the right one is taken', [saver.isRunning(), pad.note.textContent], [true, 'Too many wrong PINs. Try again in 30 s.']);
	t.advance(10000);
	t.key('keydown', {key: 'Enter', target: pad.input});
	check('it counts down', pad.note.textContent, 'Too many wrong PINs. Try again in 20 s.');
	t.advance(20000);
	pad = padOf(t) || (t.key('keydown', {key: ' '}), padOf(t));
	pad.input.value = '2468';
	pad.button.listeners.click[0](event('click'));
	await settle();
	check('then the right PIN, by the button, ends it', [saver.isRunning(), saver.isLocked()], [false, false]);
	check('and the lock is gone for every tab', pinModule.readLock(store), null);
	t.advance(200);
	check('the layer with it', t.host.children.filter(c => c.className.indexOf('PixScreensaver') === 0).length, 0);

	// A reload while locked, and another tab.
	saver.start();
	const written = pinModule.readLock(store);
	// Since changed, somewhere, to 1357.
	const NEWER = await pinModule.makePin('1357', globalThis.crypto);
	saver.init({env: t.env, host: t.host, settings: {show: FAKE, pin: NEWER}, now: t.now, storage: store, crypto: globalThis.crypto});
	check('set up again, not locked until told to', saver.isRunning(), false);
	check('reloaded while locked, it comes back locked', [saver.restoreLock(), saver.isRunning(), saver.isLocked()], [true, true, true]);
	t.key('keydown', {key: 'x'});
	pad = padOf(t);
	pad.input.value = '1357';
	t.key('keydown', {key: 'Enter', target: pad.input});
	await settle();
	check('the PIN set since does not open a lock made before it', [saver.isRunning(), written.failures], [true, 0]);
	pad.input.value = '2468';
	t.key('keydown', {key: 'Enter', target: pad.input});
	await settle();
	check('the one it was locked with does', saver.isRunning(), false);
	t.advance(200);
	saver.init({env: t.env, host: t.host, settings: {show: FAKE, pin: PIN}, now: t.now, storage: store, crypto: globalThis.crypto});
	const storageEvent = value => { t.listeners.storage.forEach(l => l.fn({key: pinModule.LOCK_KEY, newValue: value})); };
	saver.start();
	check('locked again', saver.isLocked(), true);
	store.removeItem(pinModule.LOCK_KEY);
	storageEvent(null);
	check('unlocked in another tab, it ends here too', [saver.isLocked(), saver.isRunning()], [false, false]);
	t.advance(200);

	pinModule.writeLock(store, pinModule.normalizeLock(PIN));
	t.listeners.storage.forEach(l => l.fn({key: 'something-else', newValue: '1'}));
	check('another key changing is nothing', saver.isRunning(), false);
	storageEvent('x');
	check('locked in another tab, it is shown here at once, locked', [saver.isRunning(), saver.isLocked()], [true, true]);
	t.key('keydown', {key: 'x'});
	pad = padOf(t);
	pad.input.value = '2468';
	t.key('keydown', {key: 'Enter', target: pad.input});
	await settle();
	check('and opened with that lock\'s PIN', saver.isRunning(), false);
	t.advance(200);
	await saver.removePin();
	check('removed, there is none', saver.hasPin(), false);
	saver.start();
	check('and starting it locks nothing', saver.isLocked(), false);
	saver.stop();
}

{
	// A lock left written down -- stopped at once rather than opened -- is taken up again by the next
	// start if it is for the same PIN, with its wrong tries; one for a PIN since changed is not.
	const t = makeEnv();
	const store = memory();
	const OLD = await pinModule.makePin('1357', globalThis.crypto);
	pinModule.writeLock(store, Object.assign(pinModule.normalizeLock(OLD), {failures: 3}));
	saver.init({env: t.env, host: t.host, settings: {show: FAKE, pin: PIN}, now: t.now, storage: store, crypto: globalThis.crypto});
	saver.start();
	check('a lock for another PIN is replaced, its tries with it', [pinModule.readLock(store).hash === PIN.hash, pinModule.readLock(store).failures], [true, 0]);
	pinModule.writeLock(store, Object.assign(pinModule.readLock(store), {failures: 3}));
	// Stopped at once: not someone at the pad, so the lock stays written down.
	saver.stop();
	check('stopped at once, the lock stays written down', pinModule.readLock(store).failures, 3);
	check('but this tab is not locked while nothing shows', saver.isLocked(), false);
	check('so a preview after it is not locked either', [saver.start(FAKE), saver.isLocked()], [true, false]);
	saver.stop();
	saver.start();
	check('a lock for the same PIN keeps its wrong tries', pinModule.readLock(store).failures, 3);

	// Another tab counted one more meanwhile: the fifth, here, costs the wait.
	pinModule.writeLock(store, Object.assign(pinModule.readLock(store), {failures: 4}));
	t.key('keydown', {key: 'x'});
	let pad = padOf(t);
	pad.input.value = '0000';
	t.key('keydown', {key: 'Enter', target: pad.input});
	await settle();
	check('the tries another tab counted count here', [pinModule.readLock(store).failures, pad.note.textContent],
		[5, 'Too many wrong PINs. Try again in 30 s.']);

	// Stopped with the pad up: the next start draws its own.
	saver.stop();
	saver.start();
	t.key('keydown', {key: 'x'});
	pad = padOf(t);
	check('stopped with the pad up, the next start asks on a pad of its own', !!pad, true);
	// Half a minute: the wait is over, and the pad, left alone that long, has gone.
	t.advance(30000);
	t.key('keydown', {key: 'x'});
	pad = padOf(t);
	pad.input.value = '2468';
	t.key('keydown', {key: 'Enter', target: pad.input});
	await settle();
	check('and opens', saver.isRunning(), false);
	t.advance(200);
}

{
	// Locked from another tab with nothing chosen here: a blank screen, locked.
	const t = makeEnv();
	const store = memory();
	pinModule.writeLock(store, pinModule.normalizeLock(PIN));
	saver.init({env: t.env, host: t.host, settings: {}, now: t.now, storage: store, crypto: globalThis.crypto});
	saver.restoreLock();
	const blank = t.host.children[0];
	check('nothing chosen, it locks on a blank screen', [saver.isLocked(), t.host.children.length, blank.children[0].style.background], [true, 1, '#000000']);
	saver.stop();

	// Where nothing can hash -- http, not localhost -- nothing locks, rather than lock someone out.
	const t2 = makeEnv();
	saver.init({env: t2.env, host: t2.host, settings: {show: FAKE, pin: PIN}, now: t2.now, storage: store, crypto: {}});
	check('with no way to check a PIN, a lock written down is not honoured', [saver.restoreLock(), saver.isRunning()], [false, false]);
	check('and a PIN cannot be set', saver.canUsePin(), false);
	saver.start();
	check('and starting it locks nothing', saver.isLocked(), false);
	saver.stop();
}

// --- the wiring ------------------------------------------------------------------------------------

const shell = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
check('index.html sets it up before the desktop, so its key listener is first on window',
	shell.indexOf('screensaver.init({') > -1 && shell.indexOf('screensaver.init({') < shell.indexOf('desktop.init({'), true);
check('and closes every launcher as it starts, whose Escape handlers come earlier still',
	/onStart: function \(\) \{\s*startMenu\.close\(\);\s*palette\.close\(\);\s*overview\.close\(\);\s*shortcuts\.close\(\);\s*contextMenu\.close\(\);\s*desktop\.setObscured\(true\);/.test(shell), true);
check('its key is one of the shell\'s', /shortcuts\.matchesAny\(e, shortcuts\.shellKeys\('screensaver'\)\)/.test(shell), true);
check('a lock written down is shown straight after the desktop is set up, which starting tells it is covered',
	shell.indexOf('screensaver.restoreLock();') > shell.indexOf('desktop.init({') && shell.indexOf('screensaver.restoreLock();') < shell.indexOf('hotCorners.init({'), true);
check('on battery it is held still, if that was not turned off, and with motion reduced either way',
	/var still = \(power\.still && power\.onBattery\) \|\| display\.reduced\(\);\s*desktop\.setStill\(still\);\s*screensaver\.setStill\(still\);/.test(shell)
	&& /still: settings\.stillOnBattery !== false/.test(shell), true);
check('and that is applied once as soon as it is defined, for a reduced motion already on',
	/screensaver\.setStill\(still\);\s*\};\s*(\/\/[^\n]*\n\s*)*applyPower\(\);/.test(shell), true);

process.exit(report('screensaver') ? 1 : 0);
