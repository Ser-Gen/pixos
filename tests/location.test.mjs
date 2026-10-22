// Where this machine is (phase 26, the Sky pass): js/shell/location.js, with the file and the browser's
// geolocation made of plain objects. What it has to get right: Riga until something is set, a broken
// file read as Riga rather than as a crash, a change applied here even in a tab that may not write it,
// every subscriber told once per change and only then, and the browser's answer kept to a kilometre.

import {check, report} from './assert.mjs';

const loc = await import('../js/shell/location.js');
const RIGA = {latitude: 56.9496, longitude: 24.1052};

check('the file', loc.LOCATION_FILE, '/settings/location.json');
check('Riga by default', loc.DEFAULT_LOCATION, RIGA);

check('a stored location is read', loc.readLocation({latitude: -33.8688, longitude: 151.2093}), {latitude: -33.8688, longitude: 151.2093});
check('the poles and the date line are places', [loc.readLocation({latitude: 90, longitude: 180}), loc.readLocation({latitude: -90, longitude: -180})],
	[{latitude: 90, longitude: 180}, {latitude: -90, longitude: -180}]);
check('anything else is not', [loc.readLocation(null), loc.readLocation('56,24'), loc.readLocation({latitude: '56', longitude: 24}),
	loc.readLocation({latitude: 90.1, longitude: 0}), loc.readLocation({latitude: 0, longitude: 180.5}), loc.readLocation({latitude: Infinity, longitude: 0}),
	loc.readLocation({latitude: 0})], [null, null, null, null, null, null, null]);

check('a typed coordinate', [loc.parseCoordinate('56.9496', 90), loc.parseCoordinate(' -24.1 ', 180), loc.parseCoordinate('+7', 90), loc.parseCoordinate('.5', 90)],
	[56.9496, -24.1, 7, 0.5]);
check('with a decimal comma', loc.parseCoordinate('56,9496', 90), 56.9496);
check('up to its limit and no further', [loc.parseCoordinate('90', 90), loc.parseCoordinate('90.0001', 90), loc.parseCoordinate('-180', 180),
	loc.parseCoordinate('181', 180)], [90, null, -180, null]);
check('not a number is not a coordinate', ['', '  ', 'north', '56.9.4', '1e2', '1e1', '56°', null, undefined].map(t => loc.parseCoordinate(t, 90)),
	[null, null, null, null, null, null, null, null, null]);
check('rounding', [loc.roundTo(56.94961234, 4), loc.roundTo(24.105, 2), loc.roundTo(-0.005, 2)], [56.9496, 24.11, -0]);

function world (file, options) {
	const w = {file: file, writes: [], owner: true, told: [], position: null, error: null, asked: [], permission: 'granted', queried: []};
	w.location = loc.createLocation({
		readText: path => w.file === undefined ? Promise.reject(Object.assign(new Error('ENOENT'), {code: 'ENOENT'})) : Promise.resolve(w.file),
		writeText: (path, text) => {
			if (options && options.refuse) {
				return Promise.reject(new Error('QuotaExceededError'));
			}
			w.writes.push([path, text]);
			w.file = text;
			return Promise.resolve();
		},
		canWrite: () => w.owner,
		geolocation: options && options.noGeolocation ? null : {
			getCurrentPosition (ok, fail, settings) {
				w.asked.push(settings);
				return w.error ? fail(w.error) : ok(w.position);
			}
		},
		permissions: options && options.noPermissions ? null : {
			query (descriptor) {
				w.queried.push(descriptor);
				return w.permission === 'throws' ? Promise.reject(new TypeError('not a permission')) : Promise.resolve({state: w.permission});
			}
		},
		timeout: 5000
	});
	return w;
}

{
	const w = world(undefined);
	check('before anything is read, Riga', w.location.get(), RIGA);
	const got = await w.location.load();
	check('no file is Riga', [got, w.location.isSet()], [RIGA, false]);
}
{
	const w = world('{"latitude": 59.437, "longitude": 24.7536}\n');
	w.location.subscribe(where => w.told.push(where));
	check('a subscriber is told at once', w.told, [RIGA]);
	await w.location.load();
	check('and again when the file is read', w.told, [RIGA, {latitude: 59.437, longitude: 24.7536}]);
	check('which is a location that is set', w.location.isSet(), true);
	await w.location.load();
	check('but not when it reads the same again', w.told.length, 2);
	w.file = '{"latitude": 59.437, "longitude"';
	await w.location.load();
	check('a broken file is Riga, not a crash', [w.location.get(), w.location.isSet(), w.told.length], [RIGA, false, 3]);
	w.file = '{"latitude": 123, "longitude": 0}';
	await w.location.load();
	check('and so is one that is not a place', [w.location.get(), w.told.length], [RIGA, 3]);
}
{
	const w = world(undefined);
	const unsubscribe = w.location.subscribe(where => w.told.push(where));
	const set = await w.location.set({latitude: 35.689487, longitude: 139.691706});
	check('a location is set to four decimals', set, {latitude: 35.6895, longitude: 139.6917});
	check('told, and written as JSON', [w.told.length, w.writes], [2, [['/settings/location.json', '{\n  "latitude": 35.6895,\n  "longitude": 139.6917\n}\n']]]);
	unsubscribe();
	await w.location.set(RIGA);
	check('an unsubscribed listener is not told', w.told.length, 2);
	let refused = null;
	await w.location.set({latitude: 100, longitude: 0}).catch(err => { refused = err.message; });
	check('a place that is not one is refused, and nothing changes', [/Not a location/.test(refused), w.location.get(), w.writes.length], [true, RIGA, 2]);
}
{
	const w = world(undefined);
	w.owner = false;
	w.location.subscribe(where => w.told.push(where));
	await w.location.set({latitude: 51.5, longitude: -0.12});
	check('a tab that does not own the session applies it and writes nothing', [w.location.get(), w.told.length, w.writes.length],
		[{latitude: 51.5, longitude: -0.12}, 2, 0]);
}
{
	const w = world(undefined, {refuse: true});
	let failed = null;
	await w.location.set({latitude: 51.5, longitude: -0.12}).catch(err => { failed = err.message; });
	check('a refused write says so, and the location is still shown here', [failed, w.location.get()],
		['QuotaExceededError', {latitude: 51.5, longitude: -0.12}]);
}
{
	const w = world(undefined);
	const warn = console.warn;
	const warned = [];
	console.warn = (...args) => warned.push(args[0]);
	let thrown = null;
	try {
		w.location.subscribe(() => { throw new Error('a listener blew up (expected)'); });
	}
	catch (err) {
		thrown = err;
	}
	w.location.subscribe(where => w.told.push(where));
	await w.location.set({latitude: 1, longitude: 2});
	console.warn = warn;
	check('a listener that throws when first told does not throw out of subscribe', thrown, null);
	check('nor stop the next one being told of a change', w.told, [RIGA, {latitude: 1, longitude: 2}]);
	check('it is only warned about', warned, ['A location listener failed', 'A location listener failed']);
}

// --- the browser's answer ---------------------------------------------------------------------------

{
	const w = world(undefined);
	w.position = {coords: {latitude: 56.94961234, longitude: 24.10523456, accuracy: 20}};
	const found = await w.location.locate();
	check('kept to two decimals, about a kilometre', found, {latitude: 56.95, longitude: 24.11});
	check('asked once, not precisely, with the timeout', w.asked, [{enableHighAccuracy: false, maximumAge: 600000, timeout: 5000}]);
	check('and not set: the dialog shows it, then sets it', [w.location.get(), w.writes.length], [RIGA, 0]);
}
const refusal = async (error, options) => {
	const w = world(undefined, options);
	w.error = error;
	return w.location.locate().then(() => 'resolved', err => err.message);
};
check('refused by the user', /not allowed/.test(await refusal({code: 1})), true);
check('unavailable', /could not work out/.test(await refusal({code: 2})), true);
check('too slow', /took too long/.test(await refusal({code: 3})), true);
check('a browser without it', /cannot say where it is/.test(await refusal(null, {noGeolocation: true})), true);
{
	const w = world(undefined);
	w.position = {coords: {latitude: NaN, longitude: 0}};
	check('an answer that is not a place is a failure', /could not work out/.test(await w.location.locate().then(() => '', e => e.message)), true);
}

// --- Follow me (phase 27) ---------------------------------------------------------------------------

check('a file follows only when it says true', [loc.readFollow({follow: true}), loc.readFollow({follow: 'true'}), loc.readFollow({}),
	loc.readFollow(null)], [true, false, false, false]);
check('what is written: follow only while it is on', [loc.locationDoc(RIGA, false), loc.locationDoc(RIGA, true)],
	[RIGA, {latitude: 56.9496, longitude: 24.1052, follow: true}]);
{
	const w = world(undefined);
	await w.location.load();
	check('nothing set does not follow', w.location.isFollowing(), false);
	check('so a boot finds nothing, and asks nothing', [await w.location.refind(), w.queried.length, w.asked.length], [{skipped: 'off'}, 0, 0]);

	w.position = {coords: {latitude: 59.43696, longitude: 24.75353}};
	const on = await w.location.follow(true);
	check('turning it on finds the place there and then', [on, w.asked.length], [{latitude: 59.44, longitude: 24.75}, 1]);
	check('and writes it with follow', [w.location.isFollowing(), JSON.parse(w.file)], [true, {latitude: 59.44, longitude: 24.75, follow: true}]);

	w.position = {coords: {latitude: 54.68, longitude: 25.28}};
	const fresh = world(w.file);
	fresh.position = w.position;
	await fresh.location.load();
	check('a boot reads it back as following', [fresh.location.isFollowing(), fresh.location.get()], [true, {latitude: 59.44, longitude: 24.75}]);
	fresh.location.subscribe(where => fresh.told.push(where));
	const again = await fresh.location.refind();
	check('and finds the place again, having asked only whether it may', [again, fresh.queried, fresh.asked.length],
		[{found: {latitude: 54.68, longitude: 25.28}}, [{name: 'geolocation'}], 1]);
	check('which is told to every page, and written still following', [fresh.told.length, JSON.parse(fresh.file)],
		[2, {latitude: 54.68, longitude: 25.28, follow: true}]);

	for (const state of ['prompt', 'denied']) {
		const b = world(w.file);
		b.permission = state;
		await b.location.load();
		check('a boot that would have to ask does not: ' + state, [await b.location.refind(), b.asked.length, b.writes.length],
			[{skipped: state}, 0, 0]);
	}
	const odd = world(w.file);
	odd.permission = 'throws';
	await odd.location.load();
	check('a browser that will not say is not asked', [await odd.location.refind(), odd.asked.length], [{skipped: 'unsupported'}, 0]);
	const none = world(w.file, {noPermissions: true});
	await none.location.load();
	check('nor one with no permissions to ask', [await none.location.refind(), none.asked.length], [{skipped: 'unsupported'}, 0]);

	const warn = console.warn;
	console.warn = () => {};
	const failing = world(w.file);
	failing.error = {code: 2};
	await failing.location.load();
	const failed = await failing.location.refind();
	console.warn = warn;
	check('a boot whose finding fails keeps the place it had, and does not throw', [failed, failing.location.get(), failing.writes.length],
		[{skipped: 'failed'}, {latitude: 59.44, longitude: 24.75}, 0]);

	const typed = await w.location.set({latitude: 48.8566, longitude: 2.3522}, {follow: false});
	check('typing a place turns it off, and the file says so by leaving it out', [typed, w.location.isFollowing(), JSON.parse(w.file)],
		[{latitude: 48.8566, longitude: 2.3522}, false, {latitude: 48.8566, longitude: 2.3522}]);
	await w.location.follow(true);
	await w.location.set({latitude: 1, longitude: 2});
	check('a set that says nothing about it leaves it as it was', [w.location.isFollowing(), JSON.parse(w.file).follow], [true, true]);
	await w.location.set({latitude: 1, longitude: 2}, {});
	check('nor does one whose options leave it out', w.location.isFollowing(), true);
	const writes = w.writes.length;
	const off = await w.location.follow(false);
	check('turned off, the place stays and the file loses follow', [off, w.location.isFollowing(), JSON.parse(w.file), w.writes.length],
		[{latitude: 1, longitude: 2}, false, {latitude: 1, longitude: 2}, writes + 1]);
	await w.location.follow(false);
	check('turning off what is off writes nothing', w.writes.length, writes + 1);

	w.error = {code: 1};
	const refused = await w.location.follow(true).then(() => 'on', err => err.message);
	check('turned on and refused by the browser: it says why, and stays off', [/not allowed/.test(refused), w.location.isFollowing()], [true, false]);
}
{
	// Turned off while a boot's finding was still on its way: what it finds is not set.
	const w = world('{"latitude": 1, "longitude": 2, "follow": true}');
	await w.location.load();
	let answer = null;
	const real = w.location.locate;
	w.location.locate = () => new Promise(resolve => { answer = resolve; });
	const finding = w.location.refind();
	await new Promise(resolve => setTimeout(resolve, 0));
	await w.location.follow(false);
	answer({latitude: 50, longitude: 50});
	check('a place found after it was turned off is not set', [await finding, w.location.get()], [{skipped: 'off'}, {latitude: 1, longitude: 2}]);
	w.location.locate = real;
}
{
	const w = world('{"latitude": 1, "longitude": 2, "follow": true}');
	await w.location.load();
	w.file = '{"latitude": 1, "longitude": 2}';
	await w.location.load();
	check('another tab turning it off is read', w.location.isFollowing(), false);
	w.file = '{"latitude": 999, "longitude": 2, "follow": true}';
	await w.location.load();
	check('a file that is not a place does not follow', w.location.isFollowing(), false);
	await w.location.set({latitude: 1, longitude: 2}, {follow: true});
	w.file = undefined;
	await w.location.load();
	check('nor does no file', w.location.isFollowing(), false);
}
{
	const w = world(undefined);
	w.location = loc.createLocation({readText: () => Promise.reject(new Error('ENOENT')), writeText: () => Promise.resolve(), canWrite: () => true,
		geolocation: {getCurrentPosition () {}}, permissions: {query: () => Promise.resolve({})}});
	check('a permission answered with no state is unsupported', await w.location.permission(), 'unsupported');
}
{
	const w = world(undefined, {noGeolocation: true});
	check('no geolocation: the permission is unsupported, whatever the browser would say', await w.location.permission(), 'unsupported');
}

process.exit(report('location') ? 1 : 0);
