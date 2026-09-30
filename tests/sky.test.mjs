// The Sky screensaver's two pure modules (phase 26, the Sky pass): apps/screensavers/Sky.xscr/js/astro.js,
// where the planets and the stars are, held against JPL Horizons; and js/sky.js, where on the screen a
// thing goes, how dark the sky is for the sun's depth, what shows through it, what a pointed-at thing
// is called, and the moment each look shows. main.js, which draws it, is the browser checklist.

// Before any Date is made: the looks keep the computer's clock time, and Riga's has a summer.
process.env.TZ = 'Europe/Riga';

import {check, report} from './assert.mjs';
import fs from 'node:fs';

const dir = new URL('../apps/screensavers/Sky.xscr/', import.meta.url);
const astro = await import(new URL('js/astro.js', dir));
const sky = await import(new URL('js/sky.js', dir));
const SunCalc = await import(new URL('lib/suncalc.js', dir));
const shellLocation = await import('../js/shell/location.js');

const RIGA = {latitude: 56.9496, longitude: 24.1052};
const near = (a, b, within) => Math.abs(a - b) <= within;

// --- the planets and the sky's turning, against Horizons -------------------------------------------

// JPL Horizons, fetched 2026-09-25: observer at 24.1052 E, 56.9496 N, 0 m; quantities 4 (apparent
// azimuth and elevation, refracted), 7 (local apparent sidereal time, here in degrees) and 9 (visual
// magnitude). [planet, UT, azimuth, elevation, sidereal time, magnitude].
const HORIZONS = [
	['Mercury', '2026-01-15T18:00:00Z', 277.724, -32.602, 49.306, -1.085],
	['Mercury', '2026-06-21T20:00:00Z', 304.714, 3.676, 234.135, 0.953],
	['Mercury', '2026-09-25T18:00:00Z', 270.591, -11.855, 298.675, -0.187],
	['Mercury', '2026-12-21T16:00:00Z', 257.371, -20.127, 354.344, -0.871],
	['Mercury', '2027-03-10T04:00:00Z', 111.013, -1.966, 251.718, 0.409],
	['Venus', '2026-01-15T18:00:00Z', 273.669, -27.753, 49.306, -3.908],
	['Venus', '2026-06-21T20:00:00Z', 290.241, 10.525, 234.135, -4.026],
	['Venus', '2026-09-25T18:00:00Z', 255.344, -13.943, 298.675, -4.803],
	['Venus', '2026-12-21T16:00:00Z', 300.611, -32.341, 354.344, -4.679],
	['Venus', '2027-03-10T04:00:00Z', 123.196, 0.465, 251.718, -4.028],
	['Mars', '2026-01-15T18:00:00Z', 276.616, -30.424, 49.306, 1.089],
	['Mars', '2026-06-21T20:00:00Z', 1.357, -13.776, 234.135, 1.337],
	['Mars', '2026-09-25T18:00:00Z', 357.861, -11.036, 298.675, 1.168],
	['Mars', '2026-12-21T16:00:00Z', 14.131, -20.271, 354.344, 0.08],
	['Mars', '2027-03-10T04:00:00Z', 290.911, 7.289, 251.718, -0.93],
	['Jupiter', '2026-01-15T18:00:00Z', 101.14, 33.89, 49.306, -2.671],
	['Jupiter', '2026-06-21T20:00:00Z', 300.801, 5.582, 234.135, -1.826],
	['Jupiter', '2026-09-25T18:00:00Z', 337.531, -14.211, 298.675, -1.856],
	['Jupiter', '2026-12-21T16:00:00Z', 25.332, -16.047, 354.344, -2.339],
	['Jupiter', '2027-03-10T04:00:00Z', 295.514, 3.286, 251.718, -2.48],
	['Saturn', '2026-01-15T18:00:00Z', 234.352, 17.306, 49.306, 1.026],
	['Saturn', '2026-06-21T20:00:00Z', 44.267, -20.814, 234.135, 0.81],
	['Saturn', '2026-09-25T18:00:00Z', 102.816, 10.947, 298.675, 0.372],
	['Saturn', '2026-12-21T16:00:00Z', 163.244, 32.851, 354.344, 0.697],
	['Saturn', '2027-03-10T04:00:00Z', 60.466, -13.162, 251.718, 0.772]
];

const misses = {up: [], down: [], sidereal: [], magnitude: []};
for (const [name, at, azimuth, elevation, sidereal, magnitude] of HORIZONS) {
	const date = new Date(at);
	const planet = astro.planets(date).find(p => p.name === name);
	const seen = astro.altAz(astro.apply(astro.horizonMatrix(date, RIGA.latitude, RIGA.longitude), planet.direction));
	// Across is measured along the sky, which is narrower than the azimuth the higher it is.
	const across = Math.abs(astro.wrap180(seen.azimuth - azimuth)) * Math.cos(elevation * Math.PI / 180);
	const off = Math.max(across, Math.abs(seen.altitude - elevation));
	// Above the horizon is what is drawn: a tenth of a degree, under a pixel. Below it Horizons stops
	// refracting where SunCalc's formula does not, and nothing there is drawn.
	(elevation > 0 ? misses.up : misses.down).push(elevation > 0 ? off > 0.1 : off > 0.25);
	misses.sidereal.push(!near(astro.wrap180(astro.siderealTime(date, RIGA.longitude) - sidereal), 0, 0.01));
	misses.magnitude.push(!near(planet.magnitude, magnitude, 0.3));
}
check('every planet above the horizon is within a tenth of a degree of Horizons', misses.up.filter(Boolean).length, 0);
check('there are some: ten of the twenty-five', misses.up.length, 10);
check('and below it within a quarter', misses.down.filter(Boolean).length, 0);
check('the sidereal time is within a hundredth of a degree', misses.sidereal.filter(Boolean).length, 0);
check('and each planet\'s brightness within 0.3 of a magnitude', misses.magnitude.filter(Boolean).length, 0);

// Saturn's rings are nearly edge-on in 2026, so the rows above cannot see them; open, they add most of
// a magnitude. Horizons again, same observer: [UT, magnitude].
const saturnOpen = [['2032-06-15T20:00:00Z', -0.065], ['2033-01-10T20:00:00Z', -0.363]].map(([at, magnitude]) =>
	near(astro.planets(new Date(at)).find(p => p.name === 'Saturn').magnitude, magnitude, 0.3));
check('and Saturn with its rings open', saturnOpen, [true, true]);

check('the sidereal time at J2000 is USNO\'s, plus the longitude', near(astro.siderealTime(new Date(Date.UTC(2000, 0, 1, 12)), 10), 290.46061837, 1e-9), true);
check('precession is nothing at J2000', astro.precession(new Date(Date.UTC(2000, 0, 1, 12))).flat().map(v => Math.round(v * 1e9) / 1e9),
	[1, 0, 0, 0, 1, 0, 0, 0, 1]);
const precessed = astro.apply(astro.precession(new Date(Date.UTC(2026, 0, 1))), astro.equatorial(0, 0));
check('and in 26 years moves a point on the equator 0.33° in right ascension and 0.36° along the sky',
	[near(Math.atan2(precessed[1], precessed[0]) * 180 / Math.PI, 0.333, 0.002), near(Math.acos(precessed[0]) * 180 / Math.PI, 0.363, 0.002)], [true, true]);
check('Kepler\'s equation, solved', near(astro.eccentricAnomaly(30, 0.2) - (0.2 * 180 / Math.PI) * Math.sin(astro.eccentricAnomaly(30, 0.2) * Math.PI / 180), 30, 1e-6), true);
check('refraction is SunCalc\'s: about half a degree on the horizon, none overhead',
	[near(astro.refraction(0), 0.484, 0.005), near(astro.refraction(90), 0, 0.001)], [true, true]);

// --- the stars ------------------------------------------------------------------------------------

const stars = JSON.parse(fs.readFileSync(new URL('data/stars.json', dir), 'utf8')).stars;
const polaris = stars.find(s => s[4] === 'Polaris');
const vectors = sky.starVectors(stars);
const polarisAt = sky.starPlaces([vectors[stars.indexOf(polaris)]], new Date('2026-09-25T20:00:00Z'), RIGA)[0];
check('Polaris stands at about the latitude, due north', [near(polarisAt.altitude, RIGA.latitude, 1), near(astro.wrap180(polarisAt.azimuth), 0, 1.5)], [true, true]);
const orion = vectors[stars.findIndex(s => s[4] === 'Betelgeuse')];
const risen = sky.starPlaces([orion], new Date('2026-12-21T20:00:00Z'), RIGA)[0];
check('and on a December evening Betelgeuse is up in the south-east', [risen.altitude > 20, risen.azimuth > 100 && risen.azimuth < 180], [true, true]);

// --- the view -------------------------------------------------------------------------------------

check('Riga\'s view runs from 35° to 325°, the widest sunrise with room to spare', near(sky.halfSpan(RIGA.latitude), 144.7, 0.1), true);
check('the same far south of the equator', sky.halfSpan(-RIGA.latitude), sky.halfSpan(RIGA.latitude));
check('the whole horizon in the tropics, where the sun passes either side, and inside the polar circles',
	[sky.halfSpan(0), sky.halfSpan(20), sky.halfSpan(-23), sky.halfSpan(70), sky.halfSpan(-80)], [180, 180, 180, 180, 180]);
check('and a little under at 30°', sky.halfSpan(30) < 180, true);

const view = sky.makeView(RIGA.latitude, 1280, 800);
check('north of the equator it faces south', view.facing, 180);
check('south of it, north', sky.makeView(-33.9, 1280, 800).facing, 0);
check('the horizon is half way down, the pen\'s', view.horizonY, 400);
const wide = sky.makeView(RIGA.latitude, 1920, 1080);
check('a degree up is a degree across on a wide screen', wide.up, wide.across);
const tall = sky.makeView(RIGA.latitude, 400, 900);
check('on a tall one, more, so the zenith is at the top', [tall.up > tall.across, near(sky.project(tall, 90, 180).y, 0, 1e-9)], [true, true]);

const at = (alt, az) => sky.project(view, alt, az);
check('south is the middle', at(0, 180).x, 640);
check('the horizon is the horizon', at(0, 180).y, 400);
check('east is left and west is right', [at(0, 90).x < 640, at(0, 270).x > 640], [true, true]);
const june = SunCalc.getTimes(new Date('2026-06-21T10:00:00Z'), RIGA.latitude, RIGA.longitude);
const december = SunCalc.getTimes(new Date('2026-12-21T10:00:00Z'), RIGA.latitude, RIGA.longitude);
const sunAt = date => {
	const p = SunCalc.getPosition(date, RIGA.latitude, RIGA.longitude);
	return at(p.altitude, p.azimuth);
};
check('the June sun rises just inside the left edge and sets just inside the right',
	[sunAt(june.sunrise).x > 0 && sunAt(june.sunrise).x < 40, sunAt(june.sunset).x > 1240 && sunAt(june.sunset).x < 1280], [true, true]);
check('December\'s rises a third of the way in', near(sunAt(december.sunrise).x / 1280, 0.34, 0.03), true);
check('and climbs a sixth as high as June\'s', near((400 - sunAt(december.solarNoon).y) / (400 - sunAt(june.solarNoon).y), 9.7 / 56.5, 0.01), true);
check('north, behind the view, falls off an edge', [at(10, 0).x < 0 || at(10, 0).x > 1280, at(10, 20).x < 0], [true, true]);
check('south of the equator sunrise is on the right', sky.project(sky.makeView(-33.9, 1280, 800), 0, 90).x > 640, true);
check('on screen, with room', [sky.onScreen(view, {x: -3, y: 10}, 4), sky.onScreen(view, {x: -5, y: 10}, 4), sky.onScreen(view, {x: 10, y: 403}, 4)],
	[true, false, true]);
check('and the sea is not the sky', sky.onScreen(view, {x: 10, y: 500}, 4), false);

// --- the light ------------------------------------------------------------------------------------

check('the pen\'s number: a half on the horizon, 1 at the end of astronomical twilight and below',
	[sky.depth(0), sky.depth(-18), sky.depth(-40)], [0.5, 1, 1]);
check('the higher the sun the smaller, and June\'s noon smaller than December\'s',
	[sky.depth(56.5) < sky.depth(32), sky.depth(32) < sky.depth(9.7), sky.depth(9.7) < sky.depth(1)], [true, true, true]);
check('it keeps going down through the twilights', [sky.depth(-3) < sky.depth(-6), sky.depth(-6) < sky.depth(-12)], [true, true]);
check('evenly below the horizon, and fastest just above it: December\'s noon golden, June\'s nearly white',
	[sky.depth(-9), near(sky.depth(9.7), 0.299, 0.001), near(sky.depth(56.5), 0.015, 0.001)], [0.75, true, true]);

const noon = sky.look(50, 0);
const sunset = sky.look(0, 0);
const whiteNight = sky.look(-9.1, 0);
const darkest = sky.look(-20, 0);
const moonlit = sky.look(-20, 1);
check('by day the blue sky and the sun\'s glare, and no dark', [noon.sky > 0.8, noon.sunDay > 0.8, noon.darknessSky, noon.night, noon.horizonNight],
	[true, true, 0, 0, 0]);
check('at sunset the red and the orange band', [sunset.sunSet > 0.25, sunset.horizon > 0.9], [true, true]);
check('Riga\'s June night: no red left, barely dark, and blue', [whiteNight.sunSet, whiteNight.darknessSky <= 0.11, whiteNight.horizonNight > 0.5, whiteNight.night > 0.6],
	[0, true, true, true]);
check('the sun\'s glare goes as it sets, gone by the end of civil twilight', [sky.look(-3, 0).sunDay < sky.look(0, 0).sunDay, sky.look(-6, 0).sunDay],
	[true, 0]);
check('the end of astronomical twilight is dark', [darkest.darknessSky > 0.9, darkest.sunDay, darkest.sun, darkest.horizon], [true, 0, 0, 0]);
check('and a full moon lightens it and the sea', [moonlit.darknessSky < darkest.darknessSky, moonlit.horizonNight > darkest.horizonNight,
	moonlit.darknessSea < darkest.darknessSea], [true, true, true]);
check('the sun\'s path on the sea: there under a low sun, gone under a high one, as in the pen, and by night',
	[sky.look(15, 0).sunPath > 0.3, noon.sunPath, darkest.sunPath], [true, 0, 0]);

check('the glow is the sun above the horizon', sky.glowAt(view, 20, 180), sky.project(view, 20, 180));
check('and sinks four times as fast below it', sky.glowAt(view, -5, 200).y - 400, 4 * (sky.project(view, -5, 200).y - 400));

check('nothing shows by day', sky.limitingMagnitude(10, 0), -5);
check('Venus in the first minutes after sunset', sky.limitingMagnitude(-2, 0) > -4.4, true);
check('the brightest stars by the end of civil twilight', near(sky.limitingMagnitude(-6, 0), 1.5, 1e-9), true);
check('the whole catalogue by the end of nautical', sky.limitingMagnitude(-12, 0) >= 4.5, true);
check('and never fainter than the dark allows', sky.limitingMagnitude(-40, 0), sky.limitingMagnitude(-15, 0));
check('a full moon high up washes out a magnitude and a half', near(sky.limitingMagnitude(-30, 0) - sky.limitingMagnitude(-30, 1), 1.5, 1e-9), true);
check('the air: nothing overhead, more toward the horizon, all of it below', [near(sky.extinction(90), 0, 1e-3),
	sky.extinction(10) < sky.extinction(5), sky.extinction(5) < sky.extinction(1), sky.extinction(-2)], [true, true, true, Infinity]);
check('the air dims a star low down', sky.visibility(3, 3, 4.5) < sky.visibility(3, 60, 4.5), true);
check('a star fades in over the magnitude above the limit', [sky.visibility(3, 90, 5), sky.visibility(3, 90, 3.5), sky.visibility(3, 90, 2)].map(v => Math.round(v * 100) / 100),
	[1, 0.5, 0]);
check('the moon\'s light: none when down, most when full and high', [sky.moonlight({altitude: -3, fraction: 1}),
	near(sky.moonlight({altitude: 60, fraction: 1}), 1, 1e-9), sky.moonlight({altitude: 60, fraction: 0.5}) < 0.6], [0, true, true]);
check('the moon is warm on the horizon and white high up', [sky.moonTint(0), sky.moonTint(30)], [[255, 196, 140], [246, 244, 232]]);

check('a star\'s colour follows its B-V', [sky.starColor(-0.3)[2] > sky.starColor(-0.3)[0], sky.starColor(1.8)[0] > sky.starColor(1.8)[2]], [true, true]);
check('one with none is a pale yellow-white', sky.starColor(null), sky.starColor(0.6));
check('the brighter the bigger: Sirius about 2.4 pixels, a fourth-magnitude star under one',
	[near(sky.starRadius(-1.46), 2.45, 0.01), sky.starRadius(4) < 1, near(sky.starRadius(1), 1.162, 0.001)], [true, true, true]);

// --- the moon's lit side --------------------------------------------------------------------------

// Worked out here from the sun, along the great circle between them. SunCalc says it another way --
// the bright limb's position angle less the parallactic angle, from the zenith toward the east -- and
// the two have to agree, stretched across the way the panorama stretches a thing high in the sky.
let worstLimb = 0;
let limbs = 0;
for (let hour = 0; hour < 30 * 24; hour += 5) {
	const date = new Date(Date.UTC(2026, 9, 1) + hour * 3600000);
	const moon = SunCalc.getMoonPosition(date, RIGA.latitude, RIGA.longitude);
	const sun = SunCalc.getPosition(date, RIGA.latitude, RIGA.longitude);
	const lit = SunCalc.getMoonIllumination(date);
	if (moon.altitude < 5 || moon.altitude > 50 || lit.fraction < 0.05 || lit.fraction > 0.95) {
		continue;
	}
	const side = sky.litSide(view, moon, sun);
	const theta = (lit.angle - moon.parallacticAngle) * Math.PI / 180;
	let x = -Math.sin(theta) / Math.cos(moon.altitude * Math.PI / 180);
	let y = -Math.cos(theta);
	const length = Math.hypot(x, y);
	worstLimb = Math.max(worstLimb, Math.acos(Math.min(1, (x * side.x + y * side.y) / length)) * 180 / Math.PI);
	limbs++;
}
check('the lit side agrees with SunCalc\'s bright limb within 3°, over a month', [limbs > 20, worstLimb < 3], [true, true]);
check('a moon on top of the sun has no lit side to draw', sky.litSide(view, {altitude: 10, azimuth: 200}, {altitude: 10, azimuth: 200}), null);
const step = astro.toward({altitude: 0, azimuth: 90}, {altitude: 0, azimuth: 180}, 10);
check('a step along the great circle toward the other point', [near(step.altitude, 0, 1e-9), near(step.azimuth, 100, 1e-9)], [true, true]);
check('and none toward the same point', astro.toward({altitude: 20, azimuth: 30}, {altitude: 20, azimuth: 30}, 1), null);

// --- what is pointed at ---------------------------------------------------------------------------

check('the phases by name', [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.99].map(sky.phaseName), ['New moon', 'Waxing crescent', 'First quarter',
	'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent', 'New moon']);
check('a length of day', [sky.formatDuration(12 * 3600000), sky.formatDuration(17.9 * 3600000)], ['12 h 00 min', '17 h 54 min']);
check('a magnitude with a real minus sign', [sky.formatMagnitude(-1.46), sky.formatMagnitude(0.5)], ['−1.5', '0.5']);

const time = date => date.toISOString().slice(11, 16);
check('the sun: when it rises and sets, and how long the day is', sky.sunLines(june, time),
	['Sun', 'Rises 01:29, sets 19:21', '17 h 53 min of daylight']);
check('above the polar circle in June, up all day', sky.sunLines({alwaysUp: true, sunrise: null, sunset: null}, time), ['Sun', 'Up all day']);
check('with no times at all, just its name', sky.sunLines({sunrise: null, sunset: null}, time), ['Sun']);

const d = iso => new Date(iso);
const passage = sky.moonPassage(d('2026-10-02T02:00:00Z'), [
	{rise: d('2026-09-30T16:00:00Z'), set: d('2026-09-30T05:00:00Z')},
	{rise: d('2026-10-01T16:40:00Z'), set: d('2026-10-01T06:10:00Z')},
	{rise: d('2026-10-02T17:20:00Z'), set: d('2026-10-02T07:20:00Z')},
	{rise: d('2026-10-03T18:00:00Z'), set: d('2026-10-03T08:30:00Z')}
]);
check('the moon rose the evening before and sets the next morning, across the UTC days', passage,
	{rose: d('2026-10-01T16:40:00Z'), sets: d('2026-10-02T07:20:00Z')});
check('and says so', sky.moonLines({phase: 0.62, fraction: 0.83}, passage, time), ['Moon', 'Waning gibbous, 83% lit', 'Rose 16:40, sets 07:20']);
check('a moon with no rise or set in the three days, just its phase', sky.moonLines({phase: 0.5, fraction: 1}, {rose: null, sets: null}, time),
	['Moon', 'Full moon, 100% lit']);
check('a star with a name, and its designation', sky.starLines(stars.find(s => s[4] === 'Betelgeuse')), ['Betelgeuse', 'α Orionis, magnitude 0.5']);
check('one without, by its designation', sky.starLines([0, 0, 3.2, 0, '', 'δ Velorum']), ['δ Velorum', 'Magnitude 3.2']);
check('a planet', sky.planetLines({name: 'Jupiter', magnitude: -2.34}), ['Jupiter', 'Planet, magnitude −2.3']);

const drawn = [{x: 100, y: 100, r: 1, lines: ['a']}, {x: 108, y: 100, r: 1, lines: ['b']}, {x: 300, y: 300, r: 12, lines: ['moon']}];
check('the pointer is over the nearest thing within reach', sky.pick(drawn, 103, 100).lines, ['a']);
check('ten pixels at least, however small the thing', sky.pick(drawn, 100, 109.5).lines, ['a']);
check('a big thing\'s own size and six more', [sky.pick(drawn, 317, 300).lines, sky.pick(drawn, 319, 300)], [['moon'], null]);

// --- the moment each look shows -------------------------------------------------------------------

check('a look\'s pace from its address', [sky.readPace('?pace=day'), sky.readPace('?x=1&pace=year'), sky.readPace('?pace=week'), sky.readPace('')],
	['day', 'year', 'now', 'now']);
check('a moment to start at', [sky.readStart('?at=2026-06-21T22%3A00%3A00Z').toISOString(), sky.readStart('?at=soon') === null, sky.readStart('?pace=day')],
	['2026-06-21T22:00:00.000Z', true, null]);

const start = new Date(2026, 8, 25, 14, 30);
check('now is the start and the time since', sky.momentOf('now', start, 5000).at.valueOf(), start.valueOf() + 5000);
const day = sky.momentOf('day', start, 1000);
check('a day in two minutes: a second is twelve minutes', [day.at.getHours(), day.at.getMinutes()], [14, 42]);
check('and past midnight it is the same day again', sky.momentOf('day', start, 60000).at.getDate(), 25);
check('the whole loop is two minutes', sky.momentOf('day', start, 120000).at.valueOf(), start.valueOf());
const year = sky.momentOf('year', start, 2500);
check('a year at this hour: two and a half seconds is between the 27th and the 28th, at 14:30',
	[year.from.getDate(), year.to.getDate(), year.from.getHours(), year.from.getMinutes(), year.f], [27, 28, 14, 30, 0.5]);
check('the stars half way to the sky\'s turn a day later, not half a day', near(year.stars - year.from, (86400000 - 86164091) / 2, 1), true);
const autumn = sky.momentOf('year', new Date(2026, 9, 24, 14, 30), 0.5 * sky.YEAR_DAY_MS);
check('across the clocks going back, the clock time is kept and the stars still turn the day\'s share',
	[autumn.to.getHours(), autumn.to - autumn.from, near(autumn.stars - autumn.from, (25 * 3600000 - 86164091) / 2, 1)], [14, 25 * 3600000, true]);
check('and after a year it starts again', sky.momentOf('year', start, 365 * sky.YEAR_DAY_MS).from.valueOf(), start.valueOf());
check('the day look writes the time, the year look the date, now nothing',
	[sky.caption('day', day, 'en-GB'), sky.caption('year', year, 'en-GB'), sky.caption('now', day, 'en-GB')], ['14:42', '28 September', '']);

// --- the scene ------------------------------------------------------------------------------------

const scene = sky.sceneAt(june.solarNoon, RIGA, SunCalc);
check('June noon at Riga: the sun 56.5° up in the south', [near(scene.sun.altitude, 56.5, 0.1), near(scene.sun.azimuth, 180, 1)], [true, true]);
check('with the five planets', scene.planets.map(p => p.name), ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']);
const january = sky.sceneAt(new Date('2026-01-15T18:00:00Z'), RIGA, SunCalc).planets.find(p => p.name === 'Jupiter');
check('where Horizons has them: Jupiter on a January evening', [near(january.altitude, 33.89, 0.1), near(january.azimuth, 101.14, 0.1),
	near(january.magnitude, -2.671, 0.3)], [true, true, true]);
const a = {sun: {altitude: 0, azimuth: 359}, moon: {altitude: 10, azimuth: 10, fraction: 0.2, phase: 0.1},
	planets: [{name: 'Venus', altitude: 5, azimuth: 350, magnitude: -4}]};
const b = {sun: {altitude: 10, azimuth: 1}, moon: {altitude: 20, azimuth: 30, fraction: 0.4, phase: 0.14},
	planets: [{name: 'Venus', altitude: 7, azimuth: 10, magnitude: -4.2}]};
const half = sky.blend(a, b, 0.5);
check('between two scenes, the short way round north', [half.sun.azimuth, half.planets[0].azimuth], [0, 0]);
check('and everything else half way', [half.sun.altitude, half.moon.altitude, half.moon.fraction, half.planets[0].magnitude].map(v => Math.round(v * 1e6) / 1e6),
	[5, 15, 0.3, -4.1]);
check('with none of the way, the first scene itself', sky.blend(a, b, 0), a);

// --- where -------------------------------------------------------------------------------------------

check('Riga, and the same Riga as the shell\'s', [sky.DEFAULT_LOCATION, sky.DEFAULT_LOCATION], [RIGA, shellLocation.DEFAULT_LOCATION]);
check('a location from the shell is taken', sky.readLocation({latitude: -33.9, longitude: 151.2}), {latitude: -33.9, longitude: 151.2});
check('anything else is not', [sky.readLocation(null), sky.readLocation({latitude: '56', longitude: 24}), sky.readLocation({latitude: 91, longitude: 0}),
	sky.readLocation({latitude: 0, longitude: -181}), sky.readLocation({latitude: NaN, longitude: 0})], [null, null, null, null, null]);

// --- the page -------------------------------------------------------------------------------------

// Without its comment, which says what was taken out.
const page = fs.readFileSync(new URL('index.html', dir), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const main = fs.readFileSync(new URL('js/main.js', dir), 'utf8');
check('the page loads its own code as a module', /<script type="module" src="js\/main\.js"><\/script>/.test(page), true);
check('and nothing of the pen\'s that was broken', [/stars\.jpg/.test(page), /-webkit-/.test(page), /class="star"/.test(page), /startDraggingDivision/.test(page)],
	[false, false, false, false]);
check('it can be paused and resumed', [/window\.pixosPause = function/.test(main), /window\.pixosResume = function/.test(main)], [true, true]);
check('it asks PixOS where it is, and stays Riga when there is no PixOS', [/window\.parent\.watchLocation\(window, follow\)/.test(main),
	/readLocation\(next\) \|\| sky\.DEFAULT_LOCATION/.test(main)], [true, true]);

process.exit(report('sky') ? 1 : 0);
