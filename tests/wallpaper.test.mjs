// Wallpaper providers. The point of most of these is that a bad config must still
// render something: a wallpaper you cannot see is a wallpaper you cannot fix.
//
// Since phase 26 a mount is a handle, and the handle owns two decisions no provider makes
// for itself: paused or not, and unloaded once it has stayed out of sight. The second half of
// this file drives that with a fake provider and a clock moved by hand.

import {check, report} from './assert.mjs';
import * as wallpaper from '../js/shell/wallpaper.js';

function fakeElement () {
	return {
		children: 0,
		style: {cssText: '', background: '', backgroundImage: '', backgroundSize: '', backgroundRepeat: '', backgroundPosition: ''},
		replaceChildren () {
			this.children = 0;
			this.style.cssText = '';
		}
	};
}

check('a null config falls back to the default', wallpaper.normalize(null), wallpaper.DEFAULT_WALLPAPER);
check('an unknown type falls back rather than blanking', wallpaper.normalize({type: 'shader', value: 'x.glsl'}), wallpaper.DEFAULT_WALLPAPER);
check('a known type is kept', wallpaper.normalize({type: 'color', value: '#fff'}).value, '#fff');
check('phase 1 registers three providers', wallpaper.listTypes().sort(), ['color', 'gradient', 'image']);

let element = fakeElement();
wallpaper.mount(element, {type: 'gradient', value: 'dusk'});
check('a gradient renders from its preset', element.style.background, 'linear-gradient(145deg, #3a1c47, #160f22, #0a0a12)');

element = fakeElement();
wallpaper.mount(element, {type: 'gradient', value: 'nosuchpreset'});
check('an unknown preset still renders something', /^linear-gradient/.test(element.style.background), true);

element = fakeElement();
wallpaper.mount(element, {type: 'image', value: '/home/sea.jpg', options: {fit: 'contain'}});
check('a filesystem path is served through the worker', element.style.backgroundImage, 'url("/__browserfs__/home/sea.jpg")');
check('fit maps to background-size', element.style.backgroundSize, 'contain');
check('an image keeps a solid colour underneath it', element.style.background, '#12141a');

element = fakeElement();
wallpaper.mount(element, {type: 'image', value: '/__browserfs__/home/sea.jpg'});
check('an already-served path is not prefixed twice', element.style.backgroundImage, 'url("/__browserfs__/home/sea.jpg")');

element = fakeElement();
wallpaper.mount(element, {type: 'image', value: 'data:image/png;base64,AAAA'});
check('a data URL is passed through untouched', element.style.backgroundImage, 'url("data:image/png;base64,AAAA")');

element = fakeElement();
wallpaper.mount(element, {type: 'image', value: '/a"b.jpg'});
check('a quote in a filename cannot break out of url()', element.style.backgroundImage, 'url("/__browserfs__/a%22b.jpg")');

element = fakeElement();
let plain = wallpaper.mount(element, {type: 'image', value: '/x.jpg', options: {fit: 'tile'}});
check('tile repeats', element.style.backgroundRepeat, 'repeat');
check('the handle carries the config it drew', plain.config.type, 'image');

// --- a handle that holds nothing is never unloaded ---------------------------------------

function clock () {
	const timers = [];
	return {
		timers,
		setTimeout (fn, ms) {
			const timer = {fn, ms, cleared: false};
			timers.push(timer);
			return timer;
		},
		clearTimeout (timer) {
			if (timer) {
				timer.cleared = true;
			}
		},
		// Runs every timer still pending, as though that much time had passed.
		elapse () {
			timers.splice(0).filter(t => !t.cleared).forEach(t => t.fn());
		}
	};
}

let time = clock();
plain = wallpaper.mount(fakeElement(), {type: 'color', value: '#000'}, time);
plain.pause();
check('pausing a colour starts no clock: there is nothing to unload', time.timers.length, 0);
plain.resume();
check('and pause and resume are safe on a provider without them', plain.isPaused(), false);

// --- the handle, around a provider that records what it is asked ---------------------------

const log = [];
let failNext = null;
wallpaper.register('fake', {
	mount (host, config, context) {
		log.push(config.value + ' mount');
		host.children = 1;
		if (failNext === 'sync') {
			failNext = null;
			context.fail('cannot draw at all');
			return {pause () { log.push('failed pause'); }, unmount () { log.push('failed unmount'); }};
		}
		return {
			pause () { log.push(config.value + ' pause'); },
			resume () { log.push(config.value + ' resume'); },
			unmount () { log.push(config.value + ' unmount'); },
			forward (event) { log.push(config.value + ' ' + event.type); }
		};
	}
});

function since (mark) {
	return log.slice(mark);
}

time = clock();
element = fakeElement();
let handle = wallpaper.mount(element, {type: 'fake', value: 'a'}, time);
let mark = log.length;
handle.pause();
handle.pause();
check('a pause reaches the provider once, however often it is asked', since(mark), ['a pause']);
check('and starts the clock to unload it', time.timers.map(t => t.ms), [wallpaper.UNLOAD_AFTER_MS]);
check('which is thirty seconds', wallpaper.UNLOAD_AFTER_MS, 30000);

mark = log.length;
handle.resume();
handle.resume();
check('seen again before the clock ran out, it resumes where it was', since(mark), ['a resume']);
check('and the clock is stopped', time.timers[0].cleared, true);
time.elapse();
check('so it never unloads', handle.isUnloaded(), false);

mark = log.length;
handle.pause();
time.elapse();
check('out of sight for the whole time, it is unloaded', since(mark), ['a pause', 'a unmount']);
check('and leaves nothing behind in the element', element.children, 0);
check('the handle says so', handle.isUnloaded(), true);

mark = log.length;
handle.forward({type: 'click'});
check('input does not reach one that is unloaded', since(mark), []);

mark = log.length;
handle.resume();
check('seen again, it is mounted afresh rather than resumed', since(mark), ['a mount']);
check('and draws into the element again', element.children, 1);
check('and is no longer unloaded', handle.isUnloaded(), false);

mark = log.length;
handle.forward({type: 'pointermove'});
check('input reaches one that can be seen', since(mark), ['a pointermove']);
handle.pause();
mark = log.length;
handle.forward({type: 'pointermove'});
check('but not one that is paused', since(mark), []);

mark = log.length;
handle.unmount();
check('unmounting a paused handle stops its clock', time.timers.every(t => t.cleared), true);
check('and takes the instance away', since(mark), ['a unmount']);
handle.unmount();
handle.resume();
check('after which nothing reaches it', since(mark), ['a unmount']);

// --- two at once --------------------------------------------------------------------------

time = clock();
const background = wallpaper.mount(fakeElement(), {type: 'fake', value: 'bg'}, time);
const saver = wallpaper.mount(fakeElement(), {type: 'fake', value: 'saver'}, time);
mark = log.length;
background.pause();
saver.forward({type: 'click'});
check('two of one provider are paused one at a time', since(mark), ['bg pause', 'saver click']);
check('each its own', [background.isPaused(), saver.isPaused()], [true, false]);
background.unmount();
saver.unmount();

// --- failing -------------------------------------------------------------------------------

// A provider that fails after it has mounted -- a shader that will not compile, a page that
// 404s. It says so through its context, having taken away what it added.
const errors = [];
let failLate = null;
wallpaper.register('fake-late', {
	mount (host, config, context) {
		failLate = context.fail;
		return {
			pause () { log.push('late pause'); },
			resume () { log.push('late resume'); },
			unmount () { log.push('late unmount'); }
		};
	}
});
time = clock();
element = fakeElement();
handle = wallpaper.mount(element, {type: 'fake-late', value: 'late'}, Object.assign({
	onError: (message, config) => errors.push([message, config.value])
}, time));
handle.pause();
failLate('it broke');
check('a failure is reported with the config it failed on', errors, [['it broke', 'late']]);
check('and paints the default gradient', element.style.background, wallpaper.gradientCss(wallpaper.PRESETS.midnight));
check('the handle says so', handle.hasFailed(), true);
check('the clock it had started is stopped', time.timers[0].cleared, true);
failLate('again');
check('a provider fails once', errors.length, 1);
mark = log.length;
handle.resume();
handle.pause();
check('nothing reaches the instance after it failed', since(mark), []);
check('and no clock starts for it', time.timers.length, 1);
handle.unmount();
check('not even an unmount: it already took itself away', since(mark), []);

errors.length = 0;
failNext = 'sync';
element = fakeElement();
handle = wallpaper.mount(element, {type: 'fake', value: 'c'}, {onError: message => errors.push(message)});
check('a provider can fail while it mounts', errors, ['cannot draw at all']);
check('and still leaves the gradient', element.style.background, wallpaper.gradientCss(wallpaper.PRESETS.midnight));
mark = log.length;
handle.pause();
handle.unmount();
check('what it returned while failing is ignored', since(mark), []);

process.exit(report('wallpaper') ? 1 : 0);
