// Wallpaper providers. The point of most of these is that a bad config must still
// render something: a wallpaper you cannot see is a wallpaper you cannot fix.

import {check, report} from './assert.mjs';
import * as wallpaper from '../js/shell/wallpaper.js';

function fakeElement () {
	return {
		style: {cssText: '', background: '', backgroundImage: '', backgroundSize: '', backgroundRepeat: '', backgroundPosition: ''},
		replaceChildren () {}
	};
}

check('a null config falls back to the default', wallpaper.normalize(null), wallpaper.DEFAULT_WALLPAPER);
check('an unknown type falls back rather than blanking', wallpaper.normalize({type: 'shader', value: 'x.glsl'}), wallpaper.DEFAULT_WALLPAPER);
check('a known type is kept', wallpaper.normalize({type: 'color', value: '#fff'}).value, '#fff');
check('phase 1 registers three providers', wallpaper.listTypes().sort(), ['color', 'gradient', 'image']);

let element = fakeElement();
wallpaper.apply(element, {type: 'gradient', value: 'dusk'});
check('a gradient renders from its preset', element.style.background, 'linear-gradient(145deg, #3a1c47, #160f22, #0a0a12)');

element = fakeElement();
wallpaper.apply(element, {type: 'gradient', value: 'nosuchpreset'});
check('an unknown preset still renders something', /^linear-gradient/.test(element.style.background), true);

element = fakeElement();
wallpaper.apply(element, {type: 'image', value: '/home/sea.jpg', options: {fit: 'contain'}});
check('a filesystem path is served through the worker', element.style.backgroundImage, 'url("/__browserfs__/home/sea.jpg")');
check('fit maps to background-size', element.style.backgroundSize, 'contain');
check('an image keeps a solid colour underneath it', element.style.background, '#12141a');

element = fakeElement();
wallpaper.apply(element, {type: 'image', value: '/__browserfs__/home/sea.jpg'});
check('an already-served path is not prefixed twice', element.style.backgroundImage, 'url("/__browserfs__/home/sea.jpg")');

element = fakeElement();
wallpaper.apply(element, {type: 'image', value: 'data:image/png;base64,AAAA'});
check('a data URL is passed through untouched', element.style.backgroundImage, 'url("data:image/png;base64,AAAA")');

element = fakeElement();
wallpaper.apply(element, {type: 'image', value: '/a"b.jpg'});
check('a quote in a filename cannot break out of url()', element.style.backgroundImage, 'url("/__browserfs__/a%22b.jpg")');

element = fakeElement();
wallpaper.apply(element, {type: 'image', value: '/x.jpg', options: {fit: 'tile'}});
check('tile repeats', element.style.backgroundRepeat, 'repeat');

wallpaper.pause();
wallpaper.resume();
check('pause and resume are safe on a provider without them', wallpaper.getConfig().type, 'image');

process.exit(report('wallpaper') ? 1 : 0);
