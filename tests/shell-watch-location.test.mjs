// `window.watchLocation`: where this machine is, handed to a page that draws the sky (phase 26, the Sky
// pass). Lifted out of index.html between its markers and run with the real js/shell/location.js over
// a filesystem made of a map. What it has to get right, none of which throws when wrong:
//
//   * **A page is told at once, and on every change.** The Sky page draws its first frame from it.
//   * **A page whose frame is gone stops listening.** A background is unloaded 30 s after it is
//     covered and mounted again, and every old subscription would otherwise stay.
//   * **The file changing is a change.** Another tab's write arrives as a file event, not a call.
//   * **Only the owner writes** -- the same rule as every settings file.

import fs from 'node:fs';
import {check, report} from './assert.mjs';
import {createLocation, LOCATION_FILE} from '../js/shell/location.js';

const shell = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = shell.indexOf('\t// --- watchLocation');
const end = shell.indexOf('\t// --- end of watchLocation', start);
if (start === -1 || end === -1) {
	console.error('shell-watch-location.test.mjs: could not find the watchLocation region in index.html');
	process.exit(1);
}
const code = shell.slice(start, end);
check('the region is inside fsOnInit, after the filesystem is wrapped',
	shell.indexOf('fsEvents.watchFs(window.fs)') < start && shell.lastIndexOf('function fsOnInit', start) > -1, true);
check('and before the desktop reads it at boot', shell.indexOf('await shellLocation.load();') > end, true);

function world () {
	const w = {files: new Map(), writes: [], owner: true, subscribers: [], asked: 0};
	w.window = {
		fs: {
			readFile (path, encoding, cb) {
				return w.files.has(path) ? cb(null, w.files.get(path)) : cb(Object.assign(new Error('ENOENT'), {code: 'ENOENT'}));
			},
			writeFile (path, data, cb) {
				w.writes.push(path);
				w.files.set(path, String(data));
				cb(null);
			}
		}
	};
	const tabs = {isOwner: () => w.owner};
	const navigator = {geolocation: {getCurrentPosition (ok) { w.asked++; ok({coords: {latitude: 1.234, longitude: 5.678}}); }}};
	const fsEvents = {subscribe (fn) { w.subscribers.push(fn); return () => {}; }};
	const Buffer = {from: text => text};
	const frameIsAlive = win => !!(win && win.frameElement && win.frameElement.isConnected);
	w.location = new Function('window', 'createLocation', 'LOCATION_FILE', 'tabs', 'navigator', 'fsEvents', 'frameIsAlive', 'Buffer',
		'var shellLocation;\n' + code + '\nreturn shellLocation;')(w.window, createLocation, LOCATION_FILE, tabs, navigator, fsEvents, frameIsAlive, Buffer);
	w.changed = paths => w.subscribers.forEach(fn => fn({touches: p => paths.indexOf(p) > -1}));
	return w;
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const frame = alive => ({frameElement: {isConnected: alive}});

{
	const w = world();
	check('the shell can say where it is', w.window.getLocation(), {latitude: 56.9496, longitude: 24.1052});
	const page = frame(true);
	const seen = [];
	w.window.watchLocation(page, where => seen.push(where));
	check('a page is told at once', seen, [{latitude: 56.9496, longitude: 24.1052}]);
	await w.location.set({latitude: 59.437, longitude: 24.7536});
	check('and when it is set', seen.length, 2);
	check('which the owner writes', w.writes, [LOCATION_FILE]);

	w.files.set(LOCATION_FILE, '{"latitude": 51.5, "longitude": -0.12}');
	w.changed(['/home/notes.txt']);
	await settle();
	check('another file changing is nothing', seen.length, 2);
	w.changed([LOCATION_FILE]);
	await settle();
	check('the file changing -- another tab wrote it -- is read and passed on', seen[2], {latitude: 51.5, longitude: -0.12});

	page.frameElement.isConnected = false;
	await w.location.set({latitude: 1, longitude: 2});
	await w.location.set({latitude: 3, longitude: 4});
	check('a page whose frame is gone hears nothing more', seen.length, 3);
}
{
	const w = world();
	let told = 0;
	w.window.watchLocation(frame(false), () => told++);
	await w.location.set({latitude: 1, longitude: 2});
	check('one already gone is never told, not even the first time', told, 0);
}
{
	const w = world();
	const seen = [];
	w.window.watchLocation(where => seen.push(where.latitude));
	await w.location.set({latitude: 7, longitude: 8});
	check('the window may be left out, as with watchFiles', seen, [56.9496, 7]);
	const stop = w.window.watchLocation(null);
	check('a handler that is not one is a no-op that can be stopped', typeof stop, 'function');
	stop();
}
{
	const w = world();
	w.owner = false;
	await w.location.set({latitude: 1, longitude: 2});
	check('a tab that does not own the session writes nothing, and still shows it', [w.writes.length, w.window.getLocation()],
		[0, {latitude: 1, longitude: 2}]);
	check('and the browser\'s geolocation is the one handed in', await w.location.locate(), {latitude: 1.23, longitude: 5.68});
}

process.exit(report('shell-watch-location') ? 1 : 0);
