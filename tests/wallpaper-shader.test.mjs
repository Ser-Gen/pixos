// The shader provider registers itself with wallpaper.js on import, which is what lets
// the desktop treat it like any other background. Rendering needs a GPU; the first half
// covers the wiring and the shipped sources.
//
// The second half is phase 26's: a mount is an instance, so the same shader can be the
// background and the screensaver at once. Enough of WebGL to count draws, and a frame clock
// run by hand, show two of them drawing and pausing one at a time.

import {check, report} from './assert.mjs';

// --- enough of a browser ------------------------------------------------------------------

const windowListeners = [];
globalThis.window = {
	devicePixelRatio: 1,
	innerHeight: 600,
	addEventListener (type, fn) { windowListeners.push([type, fn]); },
	removeEventListener (type, fn) {
		const at = windowListeners.findIndex(([t, f]) => t === type && f === fn);
		if (at > -1) {
			windowListeners.splice(at, 1);
		}
	}
};

let pendingFrames = new Map();
let nextFrame = 1;
globalThis.requestAnimationFrame = fn => {
	pendingFrames.set(nextFrame, fn);
	return nextFrame++;
};
globalThis.cancelAnimationFrame = id => pendingFrames.delete(id);
let now = 1000;
function frame () {
	now += 100;
	const due = pendingFrames;
	pendingFrames = new Map();
	due.forEach(fn => fn(now));
}

let compiles = true;
let webgl2 = true;
function fakeGl () {
	const gl = {
		draws: 0,
		lost: false,
		VERTEX_SHADER: 1,
		FRAGMENT_SHADER: 2,
		COMPILE_STATUS: 3,
		LINK_STATUS: 4,
		ARRAY_BUFFER: 5,
		STATIC_DRAW: 6,
		FLOAT: 7,
		TRIANGLES: 8,
		createShader: () => ({}),
		shaderSource () {},
		compileShader () {},
		getShaderParameter: () => compiles,
		getShaderInfoLog: () => 'ERROR: 0:1: syntax error',
		deleteShader () {},
		createProgram: () => ({}),
		attachShader () {},
		bindAttribLocation () {},
		linkProgram () {},
		getProgramParameter: () => true,
		createBuffer: () => ({}),
		bindBuffer () {},
		bufferData () {},
		enableVertexAttribArray () {},
		vertexAttribPointer () {},
		getUniformLocation: () => ({}),
		viewport () {},
		useProgram () {},
		uniform3f () {},
		uniform1f () {},
		uniform1i () {},
		uniform4f () {},
		drawArrays () { gl.draws++; },
		getExtension: name => name === 'WEBGL_lose_context' ? {loseContext () { gl.lost = true; }} : null
	};
	return gl;
}

function fakeCanvas () {
	const canvas = {
		style: {},
		width: 0,
		height: 0,
		clientWidth: 800,
		clientHeight: 600,
		removed: false,
		gl: null,
		listeners: {},
		getContext () {
			canvas.gl = webgl2 ? fakeGl() : null;
			return canvas.gl;
		},
		addEventListener (type, fn) { canvas.listeners[type] = fn; },
		removeEventListener (type) { delete canvas.listeners[type]; },
		remove () { canvas.removed = true; }
	};
	return canvas;
}

globalThis.document = {createElement: () => fakeCanvas()};

function fakeHost () {
	const host = {
		canvas: null,
		style: {cssText: '', background: ''},
		append (child) { host.canvas = child; },
		replaceChildren () {}
	};
	return host;
}

const wallpaper = await import('../js/shell/wallpaper.js');
const shader = await import('../js/shell/wallpaper-shader.js');

// Lets a resolved source reach the instance that asked for it.
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// --- the wiring and the shipped sources -----------------------------------------------------

check('importing it registers a provider', wallpaper.listTypes().sort(), ['color', 'gradient', 'image', 'shader']);
check('a shader config is no longer rewritten to the default', wallpaper.normalize({type: 'shader', value: 'aurora'}).value, 'aurora');

const names = Object.keys(shader.BUILT_IN);
check('three shaders ship built in', names.length, 3);
check('each one is labelled', names.every(n => !!shader.BUILT_IN[n].label), true);
// Bundled rather than fetched, so a fresh install has an animated option offline.
check('each defines a Shadertoy-style entry point', names.every(n => shader.BUILT_IN[n].source.includes('void mainImage(')), true);
check('none reaches for a texture we do not bind', names.every(n => !/iChannel/.test(shader.BUILT_IN[n].source)), true);

// --- two at once ------------------------------------------------------------------------------

const hostA = fakeHost();
const hostB = fakeHost();
const a = wallpaper.mount(hostA, {type: 'shader', value: 'aurora'});
const b = wallpaper.mount(hostB, {type: 'shader', value: 'aurora'});
await settle();
check('each mount has a canvas of its own', !!hostA.canvas && !!hostB.canvas && hostA.canvas !== hostB.canvas, true);
check('and a context of its own', hostA.canvas.gl !== hostB.canvas.gl, true);

frame();
frame();
check('both draw', [hostA.canvas.gl.draws, hostB.canvas.gl.draws], [2, 2]);

a.pause();
frame();
frame();
check('pausing one stops only that one', [hostA.canvas.gl.draws, hostB.canvas.gl.draws], [2, 4]);

a.resume();
frame();
check('and it draws again once resumed', [hostA.canvas.gl.draws, hostB.canvas.gl.draws], [3, 5]);

b.unmount();
frame();
check('unmounting one leaves the other drawing', [hostA.canvas.gl.draws, hostB.canvas.gl.draws], [4, 5]);
check('and gives its context back at once', hostB.canvas.gl.lost, true);
check('and takes its canvas away', hostB.canvas.removed, true);
check('and stops following the pointer', windowListeners.filter(([t]) => t === 'mousemove').length, 1);
a.unmount();
check('the last one takes the last listener with it', windowListeners.length, 0);

// A pause can arrive before the source does -- at boot the desktop pauses a covered background
// straight away, and a .glsl file is still being fetched. The loop must not start behind it.
const hostC = fakeHost();
const c = wallpaper.mount(hostC, {type: 'shader', value: 'drift'});
c.pause();
await settle();
frame();
check('paused before its source arrived, it does not start drawing', hostC.canvas.gl.draws, 0);
c.resume();
frame();
check('and starts when resumed', hostC.canvas.gl.draws, 1);
c.unmount();

// --- the context going away and coming back -----------------------------------------------------

const hostD = fakeHost();
const d = wallpaper.mount(hostD, {type: 'shader', value: 'grid'});
await settle();
frame();
let prevented = false;
hostD.canvas.listeners.webglcontextlost({preventDefault () { prevented = true; }});
frame();
check('a lost context stops the loop', hostD.canvas.gl.draws, 1);
check('and asks for it back', prevented, true);
hostD.canvas.listeners.webglcontextrestored();
frame();
check('restored, the same mount draws again, without a reload', hostD.canvas.gl.draws, 2);
d.unmount();

// --- failing ----------------------------------------------------------------------------------------

const errors = [];
compiles = false;
const hostE = fakeHost();
const e = wallpaper.mount(hostE, {type: 'shader', value: 'aurora'}, {onError: message => errors.push(message)});
await settle();
check('a shader that does not compile says why', errors, ['ERROR: 0:1: syntax error']);
check('and takes its canvas away', hostE.canvas.removed, true);
check('and its context', hostE.canvas.gl.lost, true);
check('the handle knows', e.hasFailed(), true);
compiles = true;

errors.length = 0;
webgl2 = false;
const hostF = fakeHost();
wallpaper.mount(hostF, {type: 'shader', value: 'aurora'}, {onError: message => errors.push(message)});
check('no WebGL2 at all is said too', errors, ['WebGL2 is not available in this browser']);
check('with the canvas taken away', hostF.canvas.removed, true);
webgl2 = true;

errors.length = 0;
const hostG = fakeHost();
wallpaper.mount(hostG, {type: 'shader', value: 'nosuchshader'}, {onError: message => errors.push(message)});
await settle();
check('an unknown shader is a failure, not a black screen', errors, ['unknown shader: nosuchshader']);

process.exit(report('wallpaper-shader') ? 1 : 0);
