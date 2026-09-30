// What the sky needs that SunCalc does not give: where the stars and the planets are, seen from one
// place at one moment. Pure -- no DOM, no clock -- so tests/sky.test.mjs runs it in node and holds it
// against JPL Horizons. Phase 26, the Sky pass; docs/screensavers-plan.md.
//
// Every angle in and out is in degrees. Azimuth is SunCalc 2's: clockwise from north, east 90.
//
// A star's place is its J2000 direction from the catalogue, precessed to the date (26 years move it
// about 0.36° -- a few pixels, and the sun and moon from SunCalc are of date) and turned into the
// observer's horizon by the sidereal time. Nutation and aberration are under a hundredth of that and
// are left out. The planets come from JPL's Keplerian elements for 1800-2050 (Table 1 of
// https://ssd.jpl.nasa.gov/planets/approx_pos.html, public domain), which are fitted rather than
// perturbed: good to well under a pixel here, and checked against Horizons in the test.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J2000_MS = Date.UTC(2000, 0, 1, 12);

// The obliquity of the ecliptic at J2000, as JPL's page gives it for turning its ecliptic into RA and Dec.
const OBLIQUITY = 23.43928;

export function daysSinceJ2000 (date) {
	return (date.valueOf() - J2000_MS) / DAY_MS;
}

export function wrap360 (degrees) {
	return ((degrees % 360) + 360) % 360;
}

// -180 up to 180.
export function wrap180 (degrees) {
	const wrapped = wrap360(degrees);
	return wrapped > 180 ? wrapped - 360 : wrapped;
}

// The right ascension on the meridian at `longitude` (east positive): Greenwich mean sidereal time,
// USNO's linear form, plus the longitude.
export function siderealTime (date, longitude) {
	return wrap360(280.46061837 + 360.98564736629 * daysSinceJ2000(date) + longitude);
}

function multiply (a, b) {
	const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
	for (let i = 0; i < 3; i++) {
		for (let j = 0; j < 3; j++) {
			out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
		}
	}
	return out;
}

// A turn of `degrees` about the z axis, counter-clockwise seen from +z.
function turnZ (degrees) {
	const c = Math.cos(degrees * RAD);
	const s = Math.sin(degrees * RAD);
	return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

export function apply (m, v) {
	return [
		m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
		m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
		m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
	];
}

// A unit vector toward right ascension `ra` and declination `dec`.
export function equatorial (ra, dec) {
	const c = Math.cos(dec * RAD);
	return [c * Math.cos(ra * RAD), c * Math.sin(ra * RAD), Math.sin(dec * RAD)];
}

// J2000 to the mean equator and equinox of `date`: Meeus, Astronomical Algorithms, 21.2 and 21.3.
// Add zeta to the right ascension, tilt by theta, add z.
export function precession (date) {
	const t = daysSinceJ2000(date) / 36525;
	const zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t * t * t) / 3600;
	const z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t * t * t) / 3600;
	const theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t * t * t) / 3600;
	const c = Math.cos(theta * RAD);
	const s = Math.sin(theta * RAD);
	return multiply(turnZ(z), multiply([[c, 0, -s], [0, 1, 0], [s, 0, c]], turnZ(zeta)));
}

// From J2000 equatorial to the observer's horizon at `date`, as rows north, east, up: precession,
// then the sky turned by the sidereal time, then tipped by the latitude.
export function horizonMatrix (date, latitude, longitude) {
	const lst = siderealTime(date, longitude);
	const c = Math.cos(latitude * RAD);
	const s = Math.sin(latitude * RAD);
	const tip = [[-s, 0, c], [0, 1, 0], [c, 0, s]];
	return multiply(tip, multiply(turnZ(-lst), precession(date)));
}

// SunCalc's refraction (Meeus 16.4), in degrees for an altitude in degrees, so a star on the horizon
// is lifted exactly as far as the sun beside it.
export function refraction (altitude) {
	const h = Math.max(0, altitude) * RAD;
	return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179)) / RAD;
}

// A horizon vector (north, east, up) as the altitude and azimuth it is seen at, refraction included.
export function altAz (v) {
	const up = Math.max(-1, Math.min(1, v[2]));
	const geometric = Math.asin(up) / RAD;
	return {altitude: geometric + refraction(geometric), azimuth: wrap360(Math.atan2(v[1], v[0]) / RAD)};
}

// The unit horizon vector of an altitude and azimuth (refraction not undone: this is for directions
// on the screen, not for the sky).
export function horizonVector (altitude, azimuth) {
	const c = Math.cos(altitude * RAD);
	return [c * Math.cos(azimuth * RAD), c * Math.sin(azimuth * RAD), Math.sin(altitude * RAD)];
}

// The point `step` degrees from `from` along the great circle toward `to`, both {altitude, azimuth}.
// The moon's lit side faces the sun along that circle; on a screen that is not a sphere, the way to
// draw it is to put this point on the screen too and look from the moon toward it.
export function toward (from, to, step) {
	const a = horizonVector(from.altitude, from.azimuth);
	const b = horizonVector(to.altitude, to.azimuth);
	const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	const t = [b[0] - dot * a[0], b[1] - dot * a[1], b[2] - dot * a[2]];
	const length = Math.hypot(t[0], t[1], t[2]);
	if (length < 1e-9) {
		return null;
	}
	const c = Math.cos(step * RAD);
	const s = Math.sin(step * RAD) / length;
	const p = [c * a[0] + s * t[0], c * a[1] + s * t[1], c * a[2] + s * t[2]];
	return {altitude: Math.asin(Math.max(-1, Math.min(1, p[2]))) / RAD, azimuth: wrap360(Math.atan2(p[1], p[0]) / RAD)};
}

// --- the planets -----------------------------------------------------------------------------------

// JPL's Table 1: a (au), e, I, L, longitude of perihelion, longitude of the node -- then each one's
// rate per Julian century. With respect to the mean ecliptic and equinox of J2000, fitted to 1800-2050.
export const ELEMENTS = {
	Mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
		[0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
	Venus: [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
		[0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
	Earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
		[0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
	Mars: [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
		[0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
	Jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
		[-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
	Saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
		[-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]]
};

export const PLANETS = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];

// Kepler's equation, M = E - e sin E, by JPL's iteration, in degrees.
export function eccentricAnomaly (meanAnomaly, e) {
	const eStar = e / RAD;
	let E = meanAnomaly + eStar * Math.sin(meanAnomaly * RAD);
	for (let i = 0; i < 20; i++) {
		const dE = (meanAnomaly - (E - eStar * Math.sin(E * RAD))) / (1 - e * Math.cos(E * RAD));
		E += dE;
		if (Math.abs(dE) <= 1e-6) {
			break;
		}
	}
	return E;
}

// Where a body of ELEMENTS is, around the sun, in au on the J2000 ecliptic.
export function heliocentric (name, date) {
	const t = daysSinceJ2000(date) / 36525;
	const [base, rate] = ELEMENTS[name];
	const [a, e, I, L, perihelion, node] = base.map((value, i) => value + rate[i] * t);
	const omega = perihelion - node;
	const E = eccentricAnomaly(wrap180(L - perihelion), e);
	const x = a * (Math.cos(E * RAD) - e);
	const y = a * Math.sqrt(1 - e * e) * Math.sin(E * RAD);
	const co = Math.cos(omega * RAD), so = Math.sin(omega * RAD);
	const cn = Math.cos(node * RAD), sn = Math.sin(node * RAD);
	const ci = Math.cos(I * RAD), si = Math.sin(I * RAD);
	return [
		(co * cn - so * sn * ci) * x + (-so * cn - co * sn * ci) * y,
		(co * sn + so * cn * ci) * x + (-so * sn + co * cn * ci) * y,
		(so * si) * x + (co * si) * y
	];
}

function eclipticToEquatorial (v) {
	const c = Math.cos(OBLIQUITY * RAD);
	const s = Math.sin(OBLIQUITY * RAD);
	return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]];
}

// Saturn's north pole (IAU, J2000), for how far its rings are open toward us.
const SATURN_POLE = equatorial(40.589, 83.537);

// How bright a planet looks: the 1984 Astronomical Almanac's formulas, as Meeus gives them in chapter
// 41 -- r and delta in au, the phase angle i in degrees. Saturn's rings add brightness as they open
// toward the Earth; the smaller term for the sun's side of them is left out.
export function magnitude (name, r, delta, i, ringTilt) {
	const distance = 5 * Math.log10(r * delta);
	switch (name) {
	case 'Mercury':
		return -0.42 + distance + 0.0380 * i - 0.000273 * i * i + 0.000002 * i * i * i;
	case 'Venus':
		return -4.40 + distance + 0.0009 * i + 0.000239 * i * i - 0.00000065 * i * i * i;
	case 'Mars':
		return -1.52 + distance + 0.016 * i;
	case 'Jupiter':
		return -9.40 + distance + 0.005 * i;
	case 'Saturn': {
		const b = Math.abs(Math.sin((ringTilt || 0) * RAD));
		return -8.88 + distance - 2.60 * b + 1.25 * b * b;
	}
	default:
		return NaN;
	}
}

// The five bright planets at `date`: each one's J2000 direction from the Earth (to go through
// horizonMatrix like a star), its magnitude, and its distances.
export function planets (date) {
	const earth = heliocentric('Earth', date);
	const R = Math.hypot(earth[0], earth[1], earth[2]);
	return PLANETS.map(function (name) {
		const at = heliocentric(name, date);
		const g = eclipticToEquatorial([at[0] - earth[0], at[1] - earth[1], at[2] - earth[2]]);
		const r = Math.hypot(at[0], at[1], at[2]);
		const delta = Math.hypot(g[0], g[1], g[2]);
		const i = Math.acos(Math.max(-1, Math.min(1, (r * r + delta * delta - R * R) / (2 * r * delta)))) / RAD;
		const direction = [g[0] / delta, g[1] / delta, g[2] / delta];
		let ringTilt = 0;
		if (name === 'Saturn') {
			const back = -(direction[0] * SATURN_POLE[0] + direction[1] * SATURN_POLE[1] + direction[2] * SATURN_POLE[2]);
			ringTilt = Math.asin(back) / RAD;
		}
		return {name: name, direction: direction, magnitude: magnitude(name, r, delta, i, ringTilt), r: r, delta: delta, phaseAngle: i};
	});
}
