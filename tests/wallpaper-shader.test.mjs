// The shader provider registers itself with wallpaper.js on import, which is what lets
// the desktop treat it like any other background. Rendering needs a GPU; this covers the
// wiring and the shipped sources.

import {check, report} from './assert.mjs';
import * as wallpaper from '../js/shell/wallpaper.js';
import * as shader from '../js/shell/wallpaper-shader.js';

check('importing it registers a provider', wallpaper.listTypes().sort(), ['color', 'gradient', 'image', 'shader']);
check('a shader config is no longer rewritten to the default', wallpaper.normalize({type: 'shader', value: 'aurora'}).value, 'aurora');

const names = Object.keys(shader.BUILT_IN);
check('three shaders ship built in', names.length, 3);
check('each one is labelled', names.every(n => !!shader.BUILT_IN[n].label), true);
// Bundled rather than fetched, so a fresh install has an animated option offline.
check('each defines a Shadertoy-style entry point', names.every(n => shader.BUILT_IN[n].source.includes('void mainImage(')), true);
check('none reaches for a texture we do not bind', names.every(n => !/iChannel/.test(shader.BUILT_IN[n].source)), true);

process.exit(report('wallpaper-shader') ? 1 : 0);
