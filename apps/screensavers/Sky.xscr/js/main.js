// Draws the sky js/sky.js works out: the pen's layers lit for where the sun is, and on a canvas above
// them the stars, the planets and the moon; on the sea, the path the sun and the moon light on it; a
// label for whatever the pointer is over. Phase 26, the Sky pass; docs/screensavers-plan.md.
//
// **What moves.** Now, the sky turns a degree every four minutes: the scene is worked out and drawn
// about fifteen times a second, for the stars' twinkling, and the layers are touched only when what
// they show has changed. The two time-lapses draw every frame. Nothing runs between frames, so
// pixosPause, which PixOS calls when a window covers the page, stops everything by not asking for
// the next one; the time-lapses resume where they were, and now resumes at now.
//
// **Where it is** comes from PixOS: `parent.watchLocation(window, handler)` calls back at once and
// again whenever the location in the Wallpaper dialog changes. Outside PixOS it is Riga.

import * as SunCalc from '../lib/suncalc.js';
import * as sky from './sky.js';

const pace = sky.readPace(location.search);
const start = sky.readStart(location.search) || new Date();
const began = performance.now();
const NOW_FRAME_MS = 66;
const LABEL_MS = 2500;

let place = sky.DEFAULT_LOCATION;
let stars = [];
let vectors = [];
let twinkles = [];
let view = null;
let drawn = [];
let paused = false;
let pausedFor = 0;
let pausedAt = 0;
let frame = 0;
let lastDraw = -Infinity;
let layerCache = {};
let pointer = null;
let labelTimer = 0;
let scene = null;

const byId = id => document.getElementById(id);
const heavens = byId('heavens');
const sunPath = byId('sunPath');
const moonPath = byId('moonPath');
const label = byId('label');
const captionEl = byId('caption');

const LAYERS = ['sky', 'horizon', 'sun', 'sunSet', 'sunDay', 'darknessSky', 'night', 'horizonNight', 'darknessSea'];

function clock (ms) {
	return new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

// How long the look has run, not counting the time it spent paused.
function elapsed (now) {
	return now - began - pausedFor;
}

function resize () {
	const width = window.innerWidth;
	const height = window.innerHeight;
	const ratio = window.devicePixelRatio || 1;
	view = sky.makeView(place.latitude, width, height);
	[[heavens, view.horizonY], [sunPath, height - view.horizonY], [moonPath, height - view.horizonY]].forEach(function ([canvas, h]) {
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(h * ratio);
		canvas.style.height = h + 'px';
		canvas.getContext('2d').setTransform(ratio, 0, 0, ratio, 0, 0);
	});
	layerCache = {};
	lastDraw = -Infinity;
}

// Sets a style only when it differs from what was set last, so a still sky costs no style work.
function setStyle (element, property, value) {
	const key = element.id + ':' + property;
	if (layerCache[key] === value) {
		return;
	}
	layerCache[key] = value;
	if (property.charAt(0) === '-') {
		element.style.setProperty(property, value);
	}
	else {
		element.style[property] = value;
	}
}

function drawLayers (lit, glow, moonAt, moonUp) {
	const values = {
		sky: lit.sky, horizon: lit.horizon, sun: lit.sun, sunSet: lit.sunSet, sunDay: lit.sunDay,
		darknessSky: lit.darknessSky, night: lit.night, horizonNight: lit.horizonNight, darknessSea: lit.darknessSea
	};
	LAYERS.forEach(function (id) {
		setStyle(byId(id), 'opacity', values[id].toFixed(3));
	});
	setStyle(byId('seaDistance'), 'opacity', lit.seaDistance.toFixed(3));
	const at = Math.round(glow.x) + 'px ' + Math.round(glow.y) + 'px';
	['sun', 'sunSet', 'sunDay'].forEach(function (id) {
		setStyle(byId(id), '--at', at);
	});
	setStyle(byId('night'), '--at', moonUp ? Math.round(moonAt.x) + 'px ' + Math.round(moonAt.y) + 'px' : '50% 110%');
}

// A path of light on the sea under `x`: narrow at the horizon, wider toward the shore, broken into
// the bands a real one is. Drawn only when it changes.
function drawPath (canvas, x, strength, color, key) {
	if (layerCache[canvas.id] === key) {
		return;
	}
	layerCache[canvas.id] = key;
	const ctx = canvas.getContext('2d');
	const width = view.width;
	const height = view.height - view.horizonY;
	ctx.clearRect(0, 0, width, height);
	if (strength <= 0.01 || x < -width * 0.2 || x > width * 1.2) {
		return;
	}
	for (let y = 0; y < height; y += 3) {
		const f = y / height;
		const half = width * (0.006 + 0.07 * f);
		// Bands of glitter, fixed rather than random so the path does not flicker from frame to frame.
		const band = 0.55 + 0.45 * Math.sin(y * 0.9 + Math.sin(y * 0.13) * 3);
		const alpha = strength * band * (1 - f * 0.65);
		const gradient = ctx.createLinearGradient(x - half, 0, x + half, 0);
		gradient.addColorStop(0, 'rgba(' + color + ',0)');
		gradient.addColorStop(0.5, 'rgba(' + color + ',' + alpha.toFixed(3) + ')');
		gradient.addColorStop(1, 'rgba(' + color + ',0)');
		ctx.fillStyle = gradient;
		ctx.fillRect(x - half, y, half * 2, 2);
	}
}

function drawDot (ctx, x, y, r, rgb, alpha, glow) {
	if (glow) {
		const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
		halo.addColorStop(0, 'rgba(' + rgb + ',' + (alpha * 0.35).toFixed(3) + ')');
		halo.addColorStop(1, 'rgba(' + rgb + ',0)');
		ctx.fillStyle = halo;
		ctx.beginPath();
		ctx.arc(x, y, r * 4, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.fillStyle = 'rgba(' + rgb + ',' + alpha.toFixed(3) + ')';
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.fill();
}

// The moon: its dark side faint, its lit side toward the sun, as much of it lit as SunCalc says.
function drawMoon (ctx, at, radius, side, fraction, day, night, tint) {
	const halo = ctx.createRadialGradient(at.x, at.y, radius, at.x, at.y, radius * 7);
	halo.addColorStop(0, 'rgba(210,225,255,' + (0.22 * fraction * night).toFixed(3) + ')');
	halo.addColorStop(1, 'rgba(210,225,255,0)');
	ctx.fillStyle = halo;
	ctx.beginPath();
	ctx.arc(at.x, at.y, radius * 7, 0, Math.PI * 2);
	ctx.fill();

	ctx.save();
	ctx.translate(at.x, at.y);
	ctx.fillStyle = 'rgba(70,82,104,' + (0.35 * night).toFixed(3) + ')';
	ctx.beginPath();
	ctx.arc(0, 0, radius, 0, Math.PI * 2);
	ctx.fill();
	if (side && fraction > 0.005) {
		ctx.rotate(Math.atan2(side.y, side.x));
		const terminator = radius * Math.abs(2 * fraction - 1);
		ctx.beginPath();
		ctx.arc(0, 0, radius, -Math.PI / 2, Math.PI / 2);
		if (fraction >= 0.5) {
			ctx.ellipse(0, 0, terminator, radius, 0, Math.PI / 2, Math.PI * 1.5, false);
		}
		else {
			ctx.ellipse(0, 0, terminator, radius, 0, Math.PI / 2, -Math.PI / 2, true);
		}
		ctx.closePath();
		ctx.fillStyle = 'rgba(' + tint.join(',') + ',' + (0.55 + 0.45 * night - 0.1 * day).toFixed(3) + ')';
		ctx.fill();
	}
	ctx.restore();
}

const PLANET_COLORS = {Mercury: '232,220,200', Venus: '255,250,235', Mars: '255,170,120', Jupiter: '255,238,210', Saturn: '250,228,170'};

function drawHeavens (now, moment, state, starsAt) {
	const ctx = heavens.getContext('2d');
	ctx.clearRect(0, 0, view.width, view.horizonY);
	const light = sky.moonlight(state.moon);
	const limit = sky.limitingMagnitude(state.sun.altitude, light);
	const day = sky.ramp(state.sun.altitude, -6, 6);
	const night = 1 - day;
	const seconds = now / 1000;
	drawn = [];

	starsAt.forEach(function (place, i) {
		if (place.altitude < 0) {
			return;
		}
		const star = stars[i];
		const shows = sky.visibility(star[2], place.altitude, limit);
		if (shows <= 0.02) {
			return;
		}
		const at = sky.project(view, place.altitude, place.azimuth);
		if (!sky.onScreen(view, at, 4)) {
			return;
		}
		const tw = twinkles[i];
		const amount = 0.08 + 0.3 * (1 - sky.ramp(place.altitude, 5, 50));
		const flicker = 1 - amount * (0.5 + 0.5 * Math.sin(seconds * tw.speed + tw.phase));
		const r = sky.starRadius(star[2]);
		drawDot(ctx, at.x, at.y, r, tw.rgb, Math.min(1, shows * flicker * (0.45 + 0.55 * sky.clamp(1.8 - star[2] * 0.35, 0, 1))), star[2] < 1.3);
		drawn.push({x: at.x, y: at.y, r: r, rank: 3, lines: sky.starLines(star)});
	});

	state.planets.forEach(function (planet) {
		if (planet.altitude < 0) {
			return;
		}
		const shows = sky.visibility(planet.magnitude, planet.altitude, limit);
		if (shows <= 0.02) {
			return;
		}
		const at = sky.project(view, planet.altitude, planet.azimuth);
		if (!sky.onScreen(view, at, 4)) {
			return;
		}
		const r = Math.min(3.4, sky.starRadius(planet.magnitude) * 1.1);
		drawDot(ctx, at.x, at.y, r, PLANET_COLORS[planet.name], shows, true);
		drawn.push({x: at.x, y: at.y, r: r, rank: 2, lines: sky.planetLines(planet)});
	});

	const moon = state.moon;
	const moonAt = sky.project(view, moon.altitude, moon.azimuth);
	const moonRadius = sky.clamp(view.height * 0.012, 7, 20);
	if (moon.altitude > -1 && sky.onScreen(view, moonAt, moonRadius * 2)) {
		drawMoon(ctx, moonAt, moonRadius, sky.litSide(view, moon, state.sun), moon.fraction, day, night, sky.moonTint(moon.altitude));
		drawn.push({x: moonAt.x, y: moonAt.y, r: moonRadius, rank: 1, moon: true});
	}
	const sunAt = sky.project(view, state.sun.altitude, state.sun.azimuth);
	if (state.sun.altitude > -0.5 && sky.onScreen(view, sunAt, 0)) {
		drawn.push({x: sunAt.x, y: sunAt.y, r: 18, rank: 0, sun: true});
	}
	return {sunAt: sunAt, moonAt: moonAt, light: light, night: night};
}

function draw (now) {
	const moment = sky.momentOf(pace, start, elapsed(now));
	const a = sky.sceneAt(moment.from, place, SunCalc);
	scene = moment.f ? sky.blend(a, sky.sceneAt(moment.to, place, SunCalc), moment.f) : a;
	scene.at = moment.at;
	const starsAt = sky.starPlaces(vectors, moment.stars, place);
	const out = drawHeavens(now, moment, scene, starsAt);
	const lit = sky.look(scene.sun.altitude, out.light);
	const moonUp = scene.moon.altitude > 0;
	drawLayers(lit, sky.glowAt(view, scene.sun.altitude, scene.sun.azimuth), out.moonAt, moonUp);

	const sunX = Math.round(out.sunAt.x);
	drawPath(sunPath, sunX, lit.sunPath * 0.9, '253,215,120', sunX + ':' + lit.sunPath.toFixed(2));
	const moonStrength = moonUp ? out.light * out.night * 0.8 : 0;
	const moonX = Math.round(out.moonAt.x);
	drawPath(moonPath, moonX, moonStrength, '220,232,255', moonX + ':' + moonStrength.toFixed(2));

	const text = sky.caption(pace, moment, undefined);
	if (captionEl.textContent !== text) {
		captionEl.textContent = text;
	}
	if (pointer) {
		showLabel(pointer.x, pointer.y);
	}
}

function tick (now) {
	frame = 0;
	if (paused) {
		return;
	}
	if (pace !== 'now' || now - lastDraw >= NOW_FRAME_MS) {
		lastDraw = now;
		draw(now);
	}
	frame = requestAnimationFrame(tick);
}

function schedule () {
	if (!frame && !paused) {
		frame = requestAnimationFrame(tick);
	}
}

// --- the label ------------------------------------------------------------------------------------

function linesFor (thing) {
	if (thing.sun) {
		return sky.sunLines(SunCalc.getTimes(noonOf(scene.at), place.latitude, place.longitude), clock);
	}
	if (thing.moon) {
		const days = [-1, 0, 1].map(function (n) {
			return SunCalc.getMoonTimes(new Date(scene.at.valueOf() + n * 86400000), place.latitude, place.longitude);
		});
		return sky.moonLines(SunCalc.getMoonIllumination(scene.at), sky.moonPassage(scene.at, days), clock);
	}
	return thing.lines;
}

function noonOf (date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

function showLabel (x, y) {
	const thing = sky.pick(drawn.slice().sort((a, b) => a.rank - b.rank), x, y);
	if (!thing) {
		label.classList.remove('shown');
		return;
	}
	const lines = linesFor(thing);
	// The name is a block of its own, so the lines under it are joined, not the name to them.
	const html = '<b>' + escapeText(lines[0]) + '</b>' + lines.slice(1).map(escapeText).join('<br>');
	if (label.innerHTML !== html) {
		label.innerHTML = html;
	}
	const box = label.getBoundingClientRect();
	const left = Math.min(view.width - box.width - 8, Math.max(8, thing.x + thing.r + 10));
	const top = Math.min(view.height - box.height - 8, Math.max(8, thing.y - box.height / 2));
	label.style.left = left + 'px';
	label.style.top = top + 'px';
	label.classList.add('shown');
}

function escapeText (text) {
	return String(text).replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'})[c]);
}

// PixOS hands the desktop's pointer moves in (isTrusted false); a screensaver never gets one, as any
// input ends it. The label goes when the pointer stops coming, since a pointer that moved onto a
// window above sends nothing more.
document.addEventListener('pointermove', function (event) {
	pointer = {x: event.clientX, y: event.clientY};
	if (view && scene) {
		showLabel(pointer.x, pointer.y);
	}
	clearTimeout(labelTimer);
	labelTimer = setTimeout(function () {
		pointer = null;
		label.classList.remove('shown');
	}, LABEL_MS);
});

// --- PixOS ----------------------------------------------------------------------------------------

window.pixosPause = function () {
	if (paused) {
		return;
	}
	paused = true;
	pausedAt = performance.now();
	if (frame) {
		cancelAnimationFrame(frame);
		frame = 0;
	}
};

window.pixosResume = function () {
	if (!paused) {
		return;
	}
	paused = false;
	// Now is now again; a time-lapse carries on from where it stopped.
	if (pace !== 'now') {
		pausedFor += performance.now() - pausedAt;
	}
	lastDraw = -Infinity;
	schedule();
};

function follow (next) {
	const read = sky.readLocation(next) || sky.DEFAULT_LOCATION;
	if (read.latitude === place.latitude && read.longitude === place.longitude && view) {
		return;
	}
	place = read;
	if (view) {
		resize();
	}
}

function watchLocation () {
	try {
		if (window.parent !== window && typeof window.parent.watchLocation === 'function') {
			window.parent.watchLocation(window, follow);
		}
	}
	catch (crossOrigin) {
		// Not PixOS: Riga.
	}
}

async function boot () {
	watchLocation();
	try {
		const response = await fetch('data/stars.json');
		stars = (await response.json()).stars;
	}
	catch (err) {
		console.warn('Sky: the stars could not be read', err);
		stars = [];
	}
	vectors = sky.starVectors(stars);
	twinkles = stars.map(function (star, i) {
		// Fixed per star, so a reload twinkles the same way.
		const seed = Math.sin(i * 12.9898) * 43758.5453;
		const fraction = seed - Math.floor(seed);
		return {phase: fraction * Math.PI * 2, speed: 1.3 + fraction * 2.2, rgb: sky.starColor(star[3]).join(',')};
	});
	resize();
	window.addEventListener('resize', resize);
	schedule();
}

boot();
