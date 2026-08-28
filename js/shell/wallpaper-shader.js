// WebGL2 shader wallpaper.
//
// Registers itself as another wallpaper provider, so nothing else in the shell knows it
// is special. Two things here are not optional and are the reason this landed in phase 2
// rather than phase 1:
//
//   Throttling. An animated background behind opaque windows renders pixels nobody can
//   see. The desktop already knows when that is the case and calls pause(); this stops
//   the loop outright rather than merely slowing it.
//
//   Failing visibly. A shader that will not compile must not leave a black rectangle
//   with the reason buried in devtools -- it falls back to a gradient and keeps the log.

import * as wallpaper from './wallpaper.js';

// Shadertoy-compatible uniforms, so shaders can be pasted in from the wild with a
// mainImage() wrapper and little else.
var VERTEX_SHADER = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

var FRAGMENT_PRELUDE = `#version 300 es
precision highp float;
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int iFrame;
uniform vec4 iMouse;
out vec4 pixColor;
`;

var FRAGMENT_EPILOGUE = `
void main() { mainImage(pixColor, gl_FragCoord.xy); }
`;

export var BUILT_IN = {
	aurora: {
		label: 'Aurora',
		source: `
vec3 band(float y, float t, vec3 tint) {
	float wave = sin(y * 3.0 + t) * 0.5 + sin(y * 7.0 - t * 1.3) * 0.25;
	return tint * smoothstep(0.55, 0.0, abs(wave));
}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
	vec2 uv = fragCoord / iResolution.xy;
	float t = iTime * 0.25;
	vec3 color = mix(vec3(0.03, 0.04, 0.08), vec3(0.05, 0.09, 0.16), uv.y);
	color += band(uv.x + uv.y * 0.4, t, vec3(0.10, 0.42, 0.45)) * 0.55;
	color += band(uv.x - uv.y * 0.3, t * 1.4 + 2.0, vec3(0.30, 0.14, 0.42)) * 0.45;
	fragColor = vec4(color, 1.0);
}
`
	},
	drift: {
		label: 'Drift',
		source: `
float blob(vec2 uv, vec2 at, float r) {
	return smoothstep(r, 0.0, length(uv - at));
}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
	vec2 uv = fragCoord / iResolution.xy;
	uv.x *= iResolution.x / iResolution.y;
	float t = iTime * 0.15;
	vec3 color = vec3(0.05, 0.05, 0.07);
	color += vec3(0.16, 0.25, 0.42) * blob(uv, vec2(0.4 + sin(t) * 0.25, 0.55 + cos(t * 0.8) * 0.2), 0.55);
	color += vec3(0.36, 0.16, 0.30) * blob(uv, vec2(0.9 + cos(t * 1.1) * 0.3, 0.35 + sin(t * 0.6) * 0.25), 0.5);
	color += vec3(0.10, 0.30, 0.28) * blob(uv, vec2(0.2 + cos(t * 0.7) * 0.2, 0.15 + sin(t) * 0.15), 0.45);
	fragColor = vec4(color, 1.0);
}
`
	},
	grid: {
		label: 'Grid',
		source: `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
	vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
	float t = iTime * 0.08;
	uv *= mat2(cos(t), -sin(t), sin(t), cos(t));
	vec2 cell = abs(fract(uv * 8.0) - 0.5);
	float line = smoothstep(0.46, 0.5, max(cell.x, cell.y));
	float glow = smoothstep(0.9, 0.0, length(uv));
	vec3 color = mix(vec3(0.04, 0.05, 0.07), vec3(0.10, 0.16, 0.24), glow);
	fragColor = vec4(color + line * glow * vec3(0.12, 0.28, 0.38), 1.0);
}
`
	}
};

var canvas = null;
var gl = null;
var program = null;
var uniforms = {};
var frameHandle = null;
var running = false;
var startTime = 0;
var lastFrame = 0;
var frameCount = 0;
var mouse = [0, 0, 0, 0];
var fpsCap = 30;
var lastLog = null;

export function getLastError () {
	return lastLog;
}

function compile (source, type) {
	var shader = gl.createShader(type);
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		var log = gl.getShaderInfoLog(shader);
		gl.deleteShader(shader);
		throw new Error(log || 'shader failed to compile');
	}
	return shader;
}

function build (fragmentSource) {
	var vertex = compile(VERTEX_SHADER, gl.VERTEX_SHADER);
	var fragment = compile(FRAGMENT_PRELUDE + fragmentSource + FRAGMENT_EPILOGUE, gl.FRAGMENT_SHADER);
	var built = gl.createProgram();
	gl.attachShader(built, vertex);
	gl.attachShader(built, fragment);
	gl.bindAttribLocation(built, 0, 'position');
	gl.linkProgram(built);
	if (!gl.getProgramParameter(built, gl.LINK_STATUS)) {
		throw new Error(gl.getProgramInfoLog(built) || 'shader failed to link');
	}

	var buffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

	return built;
}

function resize () {
	if (!canvas) {
		return;
	}
	// Deliberately capped below devicePixelRatio: a full-resolution retina background is
	// four times the fragment work for something nobody looks at closely.
	var scale = Math.min(window.devicePixelRatio || 1, 1.5);
	var width = Math.max(1, Math.round(canvas.clientWidth * scale));
	var height = Math.max(1, Math.round(canvas.clientHeight * scale));
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
		gl.viewport(0, 0, width, height);
	}
}

function draw (now) {
	frameHandle = null;
	if (!running || !gl || !program) {
		return;
	}

	var minInterval = 1000 / fpsCap;
	if (now - lastFrame < minInterval - 1) {
		schedule();
		return;
	}

	var delta = lastFrame ? (now - lastFrame) / 1000 : 0;
	lastFrame = now;

	resize();
	gl.useProgram(program);
	gl.uniform3f(uniforms.iResolution, canvas.width, canvas.height, 1);
	gl.uniform1f(uniforms.iTime, (now - startTime) / 1000);
	gl.uniform1f(uniforms.iTimeDelta, delta);
	gl.uniform1i(uniforms.iFrame, frameCount++);
	gl.uniform4f(uniforms.iMouse, mouse[0], mouse[1], mouse[2], mouse[3]);
	gl.drawArrays(gl.TRIANGLES, 0, 3);

	schedule();
}

function schedule () {
	if (running && frameHandle === null) {
		frameHandle = requestAnimationFrame(draw);
	}
}

function onMouseMove (e) {
	mouse[0] = e.clientX;
	mouse[1] = window.innerHeight - e.clientY;
}

function onContextLost (e) {
	// Without this the browser never fires a restore and the background stays dead
	// until a reload.
	e.preventDefault();
	running = false;
	program = null;
}

function onContextRestored () {
	var config = wallpaper.getConfig();
	if (config && config.type === 'shader') {
		wallpaper.apply(canvas.parentNode, config);
	}
}

function resolveSource (config) {
	var value = config.value;
	if (typeof value === 'string' && BUILT_IN[value]) {
		return Promise.resolve(BUILT_IN[value].source);
	}
	if (typeof value === 'string' && /\.(glsl|frag)$/i.test(value)) {
		var url = value.indexOf('/__browserfs__') === 0 ? value : '/__browserfs__' + (value.charAt(0) === '/' ? value : '/' + value);
		return fetch(url).then(function (response) {
			if (!response.ok) {
				throw new Error('cannot read ' + value);
			}
			return response.text();
		});
	}
	if (typeof value === 'string' && value.indexOf('mainImage') > -1) {
		return Promise.resolve(value);
	}
	return Promise.reject(new Error('unknown shader: ' + value));
}

// The gradient the desktop falls back to when a shader cannot run at all. Rendered
// directly rather than by re-entering wallpaper.apply(), which would overwrite the
// user's stored choice with the fallback.
function paintFallback (element, message) {
	lastLog = message;
	console.error('Shader wallpaper: ' + message);
	var preset = wallpaper.PRESETS[wallpaper.DEFAULT_WALLPAPER.value];
	element.style.background = 'linear-gradient(' + preset.angle + 'deg, ' + preset.stops.join(', ') + ')';
}

wallpaper.register('shader', {
	mount: function (element, config) {
		lastLog = null;
		fpsCap = (config.options && config.options.fps) || 30;

		canvas = document.createElement('canvas');
		canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
		element.append(canvas);

		gl = canvas.getContext('webgl2', {antialias: false, depth: false, powerPreference: 'low-power'});
		if (!gl) {
			canvas.remove();
			canvas = null;
			paintFallback(element, 'WebGL2 is not available in this browser');
			return;
		}

		canvas.addEventListener('webglcontextlost', onContextLost);
		canvas.addEventListener('webglcontextrestored', onContextRestored);
		window.addEventListener('mousemove', onMouseMove);

		resolveSource(config).then(function (source) {
			program = build(source);
			uniforms = {
				iResolution: gl.getUniformLocation(program, 'iResolution'),
				iTime: gl.getUniformLocation(program, 'iTime'),
				iTimeDelta: gl.getUniformLocation(program, 'iTimeDelta'),
				iFrame: gl.getUniformLocation(program, 'iFrame'),
				iMouse: gl.getUniformLocation(program, 'iMouse')
			};
			startTime = performance.now();
			lastFrame = 0;
			frameCount = 0;
			running = true;
			schedule();
		}).catch(function (err) {
			if (canvas) {
				canvas.remove();
				canvas = null;
			}
			paintFallback(element, err.message);
		});
	},

	unmount: function () {
		running = false;
		if (frameHandle !== null) {
			cancelAnimationFrame(frameHandle);
			frameHandle = null;
		}
		window.removeEventListener('mousemove', onMouseMove);
		if (canvas) {
			canvas.removeEventListener('webglcontextlost', onContextLost);
			canvas.removeEventListener('webglcontextrestored', onContextRestored);
			// Frees the GPU resources now instead of whenever the canvas is collected.
			var lose = gl && gl.getExtension('WEBGL_lose_context');
			if (lose) {
				lose.loseContext();
			}
			canvas.remove();
			canvas = null;
		}
		gl = null;
		program = null;
	},

	pause: function () {
		running = false;
		if (frameHandle !== null) {
			cancelAnimationFrame(frameHandle);
			frameHandle = null;
		}
	},

	resume: function () {
		if (!program || running) {
			return;
		}
		running = true;
		// Skip the gap: without this iTimeDelta jumps by however long the pause lasted.
		lastFrame = 0;
		schedule();
	}
});
