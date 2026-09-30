// The Sky screensaver's picture, as numbers: where on the screen a thing in the sky goes, how dark the
// sky is for where the sun is, which stars show through it, what a pointed-at thing is called, and
// what moment each look shows. Pure -- no DOM, no clock of its own; SunCalc is handed in -- so
// tests/sky.test.mjs runs it in node. main.js draws it. Phase 26, the Sky pass;
// docs/screensavers-plan.md.
//
// **The screen is a compass panorama facing the equator**: south in the middle for anywhere north of
// it, sunrise on the left and sunset on the right. It is exactly wide enough for the year's widest
// day -- at Riga the June sun rises at 41° and sets at 319°, so the view runs from 35° to 325° --
// which puts December's short, low arc in the middle and June's long, high one edge to edge. The
// moon, the planets and the stars are on the same map, so a full moon sits opposite the sun. South of
// the equator the view faces north, and sunrise is on the right. Where the sun can pass either side of
// the zenith (the tropics) or never sets (inside the polar circles), the view is the whole horizon.
//
// **How dark the sky is follows the sun's real depth**, in the three twilights: civil to -6°, nautical
// to -12°, astronomical to -18°. Riga's June sun gets no lower than -9°, so a June night stays blue.

import * as astro from './astro.js';

// Riga. Also js/shell/location.js's default; tests/sky.test.mjs ties the two.
export const DEFAULT_LOCATION = {latitude: 56.9496, longitude: 24.1052};

// The line between the sky and the sea, as a share of the height -- the original pen's.
export const HORIZON = 0.5;

// The sun at the year's widest day: its declination then, and the altitude a sunrise is timed at.
const SOLSTICE = 23.44;
const SUNRISE_ALTITUDE = -0.833;
// Room beyond the widest sunrise, so the June sun does not rise on the very edge.
const MARGIN = 6;

const RAD = Math.PI / 180;

export function clamp (value, low, high) {
	return Math.min(high, Math.max(low, value));
}

// 0 at `from`, 1 at `to`, straight between, either way round.
export function ramp (value, from, to) {
	return clamp((value - from) / (to - from), 0, 1);
}

// A location as it came from the shell, or null when it is not one.
export function readLocation (value) {
	if (!value || typeof value !== 'object') {
		return null;
	}
	const latitude = value.latitude;
	const longitude = value.longitude;
	if (typeof latitude !== 'number' || typeof longitude !== 'number' || !isFinite(latitude) || !isFinite(longitude)
		|| Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
		return null;
	}
	return {latitude: latitude, longitude: longitude};
}

// --- the view -------------------------------------------------------------------------------------

// Half the width of the view, in degrees of azimuth either side of the direction it faces.
export function halfSpan (latitude) {
	const phi = Math.abs(latitude) * RAD;
	if (Math.abs(latitude) < SOLSTICE + 1) {
		return 180;
	}
	const h0 = SUNRISE_ALTITUDE * RAD;
	const cosine = (Math.sin(SOLSTICE * RAD) - Math.sin(phi) * Math.sin(h0)) / (Math.cos(phi) * Math.cos(h0));
	if (cosine >= 1) {
		return 180;
	}
	// The widest sunrise, as a bearing from the pole the view has its back to.
	const rise = Math.acos(cosine) / RAD;
	return Math.min(180, 180 - rise + MARGIN);
}

// The view for a place and a screen: where it faces, how wide it is, where the horizon is, and how
// many pixels a degree is across and up. Up is never fewer than across, and is more on a screen too
// tall for its width, so the zenith is never below the top.
export function makeView (latitude, width, height) {
	const half = halfSpan(latitude);
	const horizonY = height * HORIZON;
	const across = width / (2 * half);
	return {
		facing: latitude >= 0 ? 180 : 0,
		half: half,
		width: width,
		height: height,
		horizonY: horizonY,
		across: across,
		up: Math.max(across, horizonY / 90)
	};
}

// Where an altitude and azimuth fall on the screen, in CSS pixels. Anything behind the view (more
// than `half` from where it faces) falls off the left or the right edge.
export function project (view, altitude, azimuth) {
	return {
		x: view.width / 2 + astro.wrap180(azimuth - view.facing) * view.across,
		y: view.horizonY - altitude * view.up
	};
}

// Whether a point is inside the picture, with `pad` pixels to spare.
export function onScreen (view, point, pad) {
	return point.x >= -pad && point.x <= view.width + pad && point.y >= -pad && point.y <= view.horizonY + pad;
}

// --- the light ------------------------------------------------------------------------------------

// The original pen drew everything from one number: how far down the screen the mouse was, 0 at the
// top to 1 at the bottom, a half on the horizon. This is that number, from where the sun really is:
// high noon toward 0, the sun on the horizon at a half, and the end of astronomical twilight at 1.
// Above the horizon it moves fastest near it, where the light changes most; Riga's December noon
// (9.7°) comes out golden, its June noon (56.5°) nearly white.
export function depth (sunAltitude) {
	if (sunAltitude >= 0) {
		return 0.5 * (1 - Math.sqrt(Math.min(sunAltitude, 60) / 60));
	}
	return 0.5 + 0.5 * ramp(-sunAltitude, 0, 18);
}

// How strongly each layer of the picture shows, for the sun at `sunAltitude` and the moon's light
// (0 for none, 1 for a full moon high up). The layers are the pen's; see index.html.
export function look (sunAltitude, moonlight) {
	const t = depth(sunAltitude);
	const down = Math.max(0, -sunAltitude);
	// The pen went on reddening all the way down, so its whole night was red. Real twilight is red
	// only just after sunset, keeps an orange band on the horizon a little longer, and is deep blue by
	// the middle of nautical twilight -- which is as dark as a June night in Riga gets.
	const red = 1 - ramp(down, 0.5, 7);
	const band = 1 - ramp(down, 2, 12);
	const blueHour = ramp(down, 3, 8) * (1 - ramp(down, 12, 18));
	const fullNight = ramp(down, 10, 18);
	const moon = clamp(moonlight || 0, 0, 1);
	return {
		sky: clamp(1 - t, 0, 0.99),
		sunDay: clamp(1 - t, 0, 1) * (1 - ramp(down, 0, 6)),
		sunSet: clamp(t - 0.2, 0, 1) * red,
		sun: (t <= 0.5 ? Math.min(t / 0.5, 0.5) : Math.min((1 - t) / 0.5 + 0.2, 0.5)) * (1 - ramp(down, 4, 12)),
		horizon: (t <= 0.5 ? Math.min(t / 0.5, 0.99) : clamp((1 - t) / 0.5 + 0.2, 0, 1)) * band,
		horizonNight: Math.max(blueHour * 0.6, fullNight * (0.3 + 0.4 * moon)),
		darknessSky: ramp(down, 8, 18) * (0.92 - 0.12 * moon),
		night: ramp(down, 3, 10) * 0.8,
		darknessSea: clamp((t - 0.5) / 0.5, 0, 1) * (0.9 - 0.25 * moon),
		seaDistance: clamp(t + 0.6, 0, 1),
		sunPath: t <= 0.5 ? clamp(t / 0.5 - 0.1, 0, 1) : clamp((1 - t) / 0.5 - 0.1, 0, 1) * red
	};
}

// Where the sun's glow is centred: the sun itself above the horizon, and below it sinking four times
// faster than the sun does, or the bright core of the pen's gradient would still show above the sea
// at -5°, when all that is left of the sun is the colour it leaves.
export function glowAt (view, sunAltitude, sunAzimuth) {
	const at = project(view, sunAltitude, sunAzimuth);
	if (sunAltitude < 0) {
		at.y = view.horizonY - sunAltitude * view.up * 4;
	}
	return at;
}

// The faintest magnitude that shows through the sky: nothing by day, Venus in the first minutes after
// sunset, the brightest stars by the end of civil twilight, all of the catalogue's by the end of
// nautical. A bright moon high up washes out the faintest.
export function limitingMagnitude (sunAltitude, moonlight) {
	const depthBelow = -sunAltitude;
	let limit;
	if (depthBelow <= 0) {
		limit = -5;
	}
	else if (depthBelow < 2) {
		limit = -5 + depthBelow * 1.5;
	}
	else if (depthBelow < 6) {
		limit = -2 + (depthBelow - 2) * 0.875;
	}
	else {
		limit = 1.5 + Math.min(depthBelow - 6, 9) * 0.5;
	}
	return limit - 1.5 * clamp(moonlight || 0, 0, 1);
}

// How much dimmer the air makes a star at `altitude`: 0.25 magnitudes an airmass (a clear sky), with
// Kasten and Young's airmass -- about 1.2 at 10°, 2.3 at 5°, gone at the horizon.
export function extinction (altitude) {
	if (altitude <= -1) {
		return Infinity;
	}
	const airmass = 1 / (Math.sin(Math.max(altitude, 0) * RAD) + 0.50572 * Math.pow(Math.max(altitude, 0) + 6.07995, -1.6364));
	return 0.25 * (airmass - 1);
}

// How much of a star shows, 0 to 1: it fades in over the magnitude above the limit.
export function visibility (magnitude, altitude, limit) {
	return clamp(limit - (magnitude + extinction(altitude)), 0, 1);
}

// The light the moon throws on the sky, 0 to 1: how much of it is lit, and how high it is.
export function moonlight (moon) {
	if (!moon || moon.altitude <= 0) {
		return 0;
	}
	return moon.fraction * Math.sqrt(Math.sin(Math.min(moon.altitude, 60) * RAD) / Math.sin(60 * RAD));
}

// The moon's colour: warmer near the horizon, where the air it is seen through takes out the blue,
// as it does the sun's.
export function moonTint (altitude) {
	const f = ramp(altitude, 0, 15);
	return [255 + (246 - 255) * f, 196 + (244 - 196) * f, 140 + (232 - 140) * f].map(Math.round);
}

// A star's colour from its B-V index: blue-white at -0.3, white near 0.3, orange past 1.4.
export function starColor (bv) {
	const b = clamp(bv === null || bv === undefined ? 0.6 : bv, -0.4, 2);
	const stops = [[-0.4, [155, 176, 255]], [0, [202, 216, 255]], [0.3, [248, 247, 255]], [0.6, [255, 244, 234]],
		[1, [255, 222, 180]], [1.4, [255, 204, 111]], [2, [255, 180, 90]]];
	for (let i = 1; i < stops.length; i++) {
		if (b <= stops[i][0]) {
			const f = (b - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
			return stops[i - 1][1].map((c, k) => Math.round(c + (stops[i][1][k] - c) * f));
		}
	}
	return stops[stops.length - 1][1];
}

// A star's radius in CSS pixels from its magnitude: Sirius about 2.4, a fourth-magnitude star under
// one, where the alpha does the rest.
export function starRadius (magnitude) {
	return 0.55 + 1.9 * Math.pow(10, -0.2 * (magnitude + 1.46));
}

// --- what is pointed at ---------------------------------------------------------------------------

// SunCalc's phase, 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter.
export function phaseName (phase) {
	const p = astro.wrap360(phase * 360) / 360;
	if (p < 0.02 || p >= 0.98) {
		return 'New moon';
	}
	if (p < 0.23) {
		return 'Waxing crescent';
	}
	if (p < 0.27) {
		return 'First quarter';
	}
	if (p < 0.48) {
		return 'Waxing gibbous';
	}
	if (p < 0.52) {
		return 'Full moon';
	}
	if (p < 0.73) {
		return 'Waning gibbous';
	}
	if (p < 0.77) {
		return 'Last quarter';
	}
	return 'Waning crescent';
}

export function formatDuration (ms) {
	const minutes = Math.round(ms / 60000);
	return Math.floor(minutes / 60) + ' h ' + String(minutes % 60).padStart(2, '0') + ' min';
}

// "−2.3", with a real minus sign.
export function formatMagnitude (magnitude) {
	const text = magnitude.toFixed(1);
	return text.charAt(0) === '-' ? '−' + text.slice(1) : text;
}

// The lines a label shows for the sun, from SunCalc's times for its day. `time` writes a Date as a
// clock time.
export function sunLines (times, time) {
	if (times.alwaysUp) {
		return ['Sun', 'Up all day'];
	}
	if (!times.sunrise || !times.sunset) {
		return ['Sun'];
	}
	return ['Sun', 'Rises ' + time(times.sunrise) + ', sets ' + time(times.sunset),
		formatDuration(times.sunset - times.sunrise) + ' of daylight'];
}

// The rise before `at` and the set after it, from SunCalc's moon times for the days around it: each
// of its answers covers one UTC day, and a moon up at `at` rose on one and may set on the next.
export function moonPassage (at, daysOfTimes) {
	let rose = null;
	let sets = null;
	daysOfTimes.forEach(function (times) {
		if (times.rise && times.rise <= at && (!rose || times.rise > rose)) {
			rose = times.rise;
		}
		if (times.set && times.set > at && (!sets || times.set < sets)) {
			sets = times.set;
		}
	});
	return {rose: rose, sets: sets};
}

export function moonLines (illumination, passage, time) {
	const lines = ['Moon', phaseName(illumination.phase) + ', ' + Math.round(illumination.fraction * 100) + '% lit'];
	const parts = [];
	if (passage.rose) {
		parts.push('rose ' + time(passage.rose));
	}
	if (passage.sets) {
		parts.push('sets ' + time(passage.sets));
	}
	if (parts.length) {
		lines.push(parts.join(', ').replace(/^./, c => c.toUpperCase()));
	}
	return lines;
}

// A star from data/stars.json: [ra, dec, mag, bv, name, designation].
export function starLines (star) {
	return star[4]
		? [star[4], star[5] + ', magnitude ' + formatMagnitude(star[2])]
		: [star[5], 'Magnitude ' + formatMagnitude(star[2])];
}

export function planetLines (planet) {
	return [planet.name, 'Planet, magnitude ' + formatMagnitude(planet.magnitude)];
}

// --- the moment each look shows -------------------------------------------------------------------

export const PACES = ['now', 'day', 'year'];

// A day in two minutes.
export const DAY_SPEED = 24 * 60 / 2;

// A day of the year a second.
export const YEAR_DAY_MS = 1000;

const MINUTE = 60000;
const DAY = 86400000;
const SIDEREAL_DAY = 86164091;

// The pace a look's address asks for, `index.html?pace=day`; anything else is now.
export function readPace (search) {
	const match = /[?&]pace=([a-z]+)/.exec(search || '');
	return match && PACES.indexOf(match[1]) > -1 ? match[1] : 'now';
}

// The moment to start from, `index.html?at=2026-06-21T22:00:00Z`, for a checklist to look at a given
// time; null for the clock's.
export function readStart (search) {
	const match = /[?&]at=([^&#]+)/.exec(search || '');
	if (!match) {
		return null;
	}
	const at = new Date(decodeURIComponent(match[1]));
	return isNaN(at.valueOf()) ? null : at;
}

// Local midnight before `date`, in the computer's time zone.
function midnight (date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// What a look shows `elapsed` milliseconds after it started at `start`:
// - now: the moment itself;
// - day: today, 720 times as fast, from the clock time it started at round to the next midnight and
//   on again -- the day it started on, looping;
// - year: the clock time it started at, on each day of the year from then, a day a second. A day
//   is `from` and `to`, the same clock time on two days (23 or 25 hours apart across a clock change),
//   and `f` how far between them: the sun, the moon and the planets are drawn between the two, and the
//   stars at `stars`, the moment between them that has turned the sky as far.
export function momentOf (pace, start, elapsed) {
	if (pace === 'day') {
		const day = midnight(start);
		const offset = ((start - day) + elapsed * DAY_SPEED) % DAY;
		const at = new Date(day.valueOf() + offset);
		return {at: at, from: at, to: at, f: 0, stars: at};
	}
	if (pace === 'year') {
		const days = elapsed / YEAR_DAY_MS;
		const whole = Math.floor(days) % 365;
		const f = days - Math.floor(days);
		const on = function (n) {
			return new Date(start.getFullYear(), start.getMonth(), start.getDate() + n, start.getHours(), start.getMinutes(), start.getSeconds());
		};
		const from = on(whole);
		const to = on(whole + 1);
		return {at: f < 0.5 ? from : to, from: from, to: to, f: f, stars: new Date(from.valueOf() + f * (to - from - SIDEREAL_DAY))};
	}
	const at = new Date(start.valueOf() + elapsed);
	return {at: at, from: at, to: at, f: 0, stars: at};
}

// What a looping look writes in the corner: the time of the day it is showing, or the date.
export function caption (pace, moment, locale) {
	if (pace === 'day') {
		return moment.at.toLocaleTimeString(locale, {hour: '2-digit', minute: '2-digit'});
	}
	if (pace === 'year') {
		return moment.at.toLocaleDateString(locale, {day: 'numeric', month: 'long'});
	}
	return '';
}

// --- the scene ------------------------------------------------------------------------------------

// Everything in the sky at `date` from `location`, but the stars: the sun and the moon from SunCalc,
// the planets from astro.js.
export function sceneAt (date, location, suncalc) {
	const lat = location.latitude;
	const lng = location.longitude;
	const sun = suncalc.getPosition(date, lat, lng);
	const moon = suncalc.getMoonPosition(date, lat, lng);
	const lit = suncalc.getMoonIllumination(date);
	const matrix = astro.horizonMatrix(date, lat, lng);
	return {
		sun: {altitude: sun.altitude, azimuth: sun.azimuth},
		moon: {altitude: moon.altitude, azimuth: moon.azimuth, fraction: lit.fraction, phase: lit.phase},
		planets: astro.planets(date).map(function (planet) {
			const seen = astro.altAz(astro.apply(matrix, planet.direction));
			return {name: planet.name, altitude: seen.altitude, azimuth: seen.azimuth, magnitude: planet.magnitude};
		})
	};
}

function between (a, b, f) {
	return a + (b - a) * f;
}

function betweenAngles (a, b, f) {
	return astro.wrap360(a + astro.wrap180(b - a) * f);
}

function betweenPlaces (a, b, f) {
	return {altitude: between(a.altitude, b.altitude, f), azimuth: betweenAngles(a.azimuth, b.azimuth, f)};
}

// A scene `f` of the way from `a` to `b`, azimuths the short way round.
export function blend (a, b, f) {
	if (!f) {
		return a;
	}
	const moon = betweenPlaces(a.moon, b.moon, f);
	moon.fraction = between(a.moon.fraction, b.moon.fraction, f);
	moon.phase = f < 0.5 ? a.moon.phase : b.moon.phase;
	return {
		sun: betweenPlaces(a.sun, b.sun, f),
		moon: moon,
		planets: a.planets.map(function (planet, i) {
			const place = betweenPlaces(planet, b.planets[i], f);
			place.name = planet.name;
			place.magnitude = between(planet.magnitude, b.planets[i].magnitude, f);
			return place;
		})
	};
}

// Each star's J2000 unit vector, worked out once.
export function starVectors (stars) {
	return stars.map(function (star) {
		return astro.equatorial(star[0], star[1]);
	});
}

// Where the stars are at `date`: an altitude and azimuth for each, in the order given.
export function starPlaces (vectors, date, location) {
	const matrix = astro.horizonMatrix(date, location.latitude, location.longitude);
	return vectors.map(function (v) {
		return astro.altAz(astro.apply(matrix, v));
	});
}

// Which way the moon's lit side faces on the screen, as a unit vector in screen pixels: toward the
// sun along the great circle through both, put on the screen by projecting a point a little way
// along it. Null when the two are in the same place (a new moon, which shows nothing to light).
export function litSide (view, moon, sun) {
	const step = astro.toward(moon, sun, 1);
	if (!step) {
		return null;
	}
	const a = project(view, moon.altitude, moon.azimuth);
	const b = project(view, step.altitude, step.azimuth);
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const length = Math.hypot(dx, dy);
	return length ? {x: dx / length, y: dy / length} : null;
}

// What the pointer at (x, y) is over, of the things drawn: the nearest within reach of it, a thing's
// own size plus a few pixels. `drawn` is [{x, y, r, lines}].
export function pick (drawn, x, y) {
	let best = null;
	let bestDistance = Infinity;
	drawn.forEach(function (thing) {
		const distance = Math.hypot(thing.x - x, thing.y - y);
		if (distance <= Math.max(10, thing.r + 6) && distance < bestDistance) {
			best = thing;
			bestDistance = distance;
		}
	});
	return best;
}
