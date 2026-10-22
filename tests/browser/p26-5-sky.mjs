// Phase 26, the Sky pass, in a real boot of PixOS in headless Chrome.
import {launchPage, sleep, until, serve, ORIGIN, REPO, out, profileDir, removeProfile} from './cdp.mjs';
import {readFileSync} from 'node:fs';

// The precache this sw.js installs, read from it rather than written here and left behind.
const SHELL_CACHE = /SHELL_CACHE = '([^']+)'/.exec(readFileSync(REPO + '/sw.js', 'utf8'))[1];

const results = [];
const ok = (label, value, detail) => { results.push(!!value); console.log((value ? '  ok   ' : '  FAIL ') + label + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); };

const sky = await import(REPO + '/apps/screensavers/Sky.xscr/js/sky.js');
const SunCalc = await import(REPO + '/apps/screensavers/Sky.xscr/lib/suncalc.js');
const starsDoc = JSON.parse(await (await import('node:fs')).promises.readFile(REPO + '/apps/screensavers/Sky.xscr/data/stars.json', 'utf8'));

const server = await serve();
const PROFILE = profileDir('p26-5-sky');
const b = await launchPage(PROFILE);
const DLG = `(await import('/js/shell/wallpaper-dialog.js'))`;
const SS = `(await import('/js/shell/screensaver.js'))`;
const booted = () => b.evaluate(`!!(window.wm && navigator.serviceWorker.controller && document.querySelector('.PixDesktop__wallpaper') && window.watchLocation)`);
const clickAt = async (x, y) => {
	await b.mouse('mouseMoved', x, y);
	await b.mouse('mousePressed', x, y, 'left', 1);
	await b.mouse('mouseReleased', x, y, 'left', 1);
};
const exists = p => b.evaluate(`new Promise(function (r) { fs.stat(${JSON.stringify(p)}, function (e) { r(!e); }); })`);
const readText = p => b.evaluate(`new Promise(function (r) { fs.readFile(${JSON.stringify(p)}, 'utf8', function (e, t) { r(e ? null : t); }); })`);
const walk = dir => b.evaluate(`(function walk (d) { return new Promise(function (r) { fs.readdir(d, function (e, names) {
	if (e) { return r([]); }
	Promise.all(names.map(function (n) { var p = d + '/' + n; return new Promise(function (r2) { fs.stat(p, function (e2, s) {
		r2(s && s.isDirectory() ? walk(p) : [p]); }); }); })).then(function (lists) { r([].concat.apply([], lists)); });
}); }); })(${JSON.stringify(dir)})`);
const settings = () => b.evaluate(`new Promise(function (r) { fs.readFile('/settings/desktop.json', 'utf8', function (e, t) { r(e ? null : JSON.parse(t)); }); })`);
const tiles = () => b.evaluate(`Array.from(document.querySelectorAll('.PixSettings .PixSwatch')).map(function (t) {
	var r = t.getBoundingClientRect(); var size = t.querySelector('.PixSwatch__size');
	return {key: t.dataset.key.replace('\\n', '/'), tip: t.title, size: size ? size.textContent : '', active: t.getAttribute('aria-pressed') === 'true',
		x: r.left + r.width / 2, y: r.top + r.height / 2}; })`);
const tile = async key => (await tiles()).find(t => t.key === key);
const clickTile = async key => {
	await until('tile ' + key, () => tile(key), 10000);
	await b.evaluate(`document.querySelector('.PixSettings__body').scrollTop = 0, true`);
	const again = await tile(key);
	await clickAt(again.x, again.y);
};
// The dialog's controls by what they say, scrolled into view first.
const control = async (selector, text) => {
	const box = await b.evaluate(`(function () { var el = Array.from(document.querySelectorAll('.PixSettings ${selector}')).find(function (e) {
		return ${text ? `e.textContent.trim() === ${JSON.stringify(text)}` : 'true'}; });
		if (!el) { return null; } el.scrollIntoView({block: 'center'}); var r = el.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; })()`);
	return box;
};
const field = label => `document.querySelector('.PixSettings input[aria-label="${label}"]')`;
const status = () => b.evaluate(`(function () { var s = document.querySelector('.PixSettings [role="status"]'); return s && !s.hidden ? s.textContent : ''; })()`);
const BG = `document.querySelector('#desktop .PixDesktop__wallpaper iframe')`;
const LAYER = `document.querySelector('.PixScreensaver iframe')`;
const skyReady = frame => b.evaluate(`!!(${frame} && ${frame}.contentWindow && typeof ${frame}.contentWindow.pixosPause === 'function' && /Sky\\.xscr/.test(${frame}.src))`);
// Whether the page drew something new in `ms`: its canvas twinkles on every frame it draws.
const drawsIn = (frame, ms) => b.evaluate(`(function () { var c = ${frame}.contentDocument.getElementById('heavens'); var a = c.toDataURL();
	return new Promise(function (r) { setTimeout(function () { r(c.toDataURL() !== a); }, ${ms}); }); })()`);
const errors = [];

try {
	await b.send('Browser.grantPermissions', {origin: ORIGIN, permissions: ['idleDetection', 'geolocation']});
	await b.send('Emulation.setGeolocationOverride', {latitude: 59.43696, longitude: 24.75357, accuracy: 10});
	await b.send('Page.navigate', {url: ORIGIN + '/'});
	await until('boot', booted, 60000);
	await b.send('Page.reload');
	await sleep(1500);
	await until('boot again', booted, 60000);
	await sleep(2000);
	b.events.length = 0;
	ok('the new precache is in use', await b.evaluate(`caches.keys().then(function (k) { return k.indexOf('${SHELL_CACHE}') > -1; })`));
	ok('where this is: Riga, with nothing set', await b.evaluate(`JSON.stringify(getLocation())`) === '{"latitude":56.9496,"longitude":24.1052}');
	ok('and no file written for it', !(await exists('/settings/location.json')));
	await b.evaluate(`(function () {
		wm.listWindows().forEach(function (w) { wm.closeWindow(w.id); });
		window.__fetched = [];
		var real = window.fetch;
		window.fetch = function (u) { var s = String(u); if (s.indexOf('/apps/screensavers/') > -1 && s.indexOf('__browserfs__') === -1) { __fetched.push(s.replace(/[?].*$/, '').replace(location.origin, '')); } return real.apply(this, arguments); };
		// Every call a page gets from watchLocation, to see the shell tell it.
		window.__told = [];
		var watch = window.watchLocation;
		window.watchLocation = function (win, handler) { return watch(win, function (where) { __told.push(JSON.stringify(where)); handler(where); }); };
		return true; })()`);

	// A: the gallery.
	await b.evaluate(`(async () => { ${DLG}.open('background'); return true; })()`);
	await until('the looks', async () => (await tiles()).some(t => t.key === 'Sky/Now'), 10000);
	const first = (await tiles()).filter(t => /^Sky\//.test(t.key));
	ok('Sky\'s three looks, each with what it downloads', first.map(t => t.key + ' ' + t.size).join(', ') === 'Sky/Now ↓ 102 KB, Sky/One day ↓ 102 KB, Sky/One year ↓ 102 KB',
		first.map(t => t.key + ' ' + t.size));
	ok('named in the tip', /^Sky · One day, 102 KB to download$/.test(first.find(t => t.key === 'Sky/One day').tip), first.find(t => t.key === 'Sky/One day').tip);
	ok('no location row before Sky is chosen', !(await b.evaluate(`!!${field('Latitude')}`)));

	// B: Now as the background.
	await clickTile('Sky/Now');
	await until('Sky chosen', async () => ((await settings()).wallpaper.options || {}).look === 'Now', 30000);
	const fetched = await b.evaluate(`window.__fetched.filter(function (u) { return !/index\\.json$/.test(u); })`);
	ok('downloaded: ten files, the page last', fetched.length === 10 && /Sky\.xscr\/index\.html$/.test(fetched[fetched.length - 1]), fetched);
	ok('all of them here', (await walk('/apps/screensavers/Sky.xscr')).length === 10);
	await until('the page', () => skyReady(BG), 20000);
	await sleep(1500);
	ok('it has PixOS\'s pause', await b.evaluate(`typeof ${BG}.contentWindow.pixosResume === 'function'`));
	ok('the shell told it where it is, once, as it started', await b.evaluate(`JSON.stringify(__told)`) === JSON.stringify(['{"latitude":56.9496,"longitude":24.1052}']),
		await b.evaluate(`__told`));
	ok('its stars were read', await b.evaluate(`${BG}.contentWindow.performance.getEntriesByType('resource').some(function (e) { return /data\\/stars\\.json$/.test(e.name); })`));
	ok('and it draws', await drawsIn(BG, 400));
	await until('the row', () => b.evaluate(`!!${field('Latitude')}`), 5000);
	ok('the location row is drawn under the gallery, with Riga in it',
		(await b.evaluate(`[${field('Latitude')}.value, ${field('Longitude')}.value].join()`)) === '56.9496,24.1052');
	const tilesNow = (await tiles()).filter(t => /^Sky\//.test(t.key));
	ok('and the other looks download nothing more', tilesNow.every(t => !t.size), tilesNow.map(t => t.size));
	await b.screenshot(out('sky-dialog.png'));

	// C: typing a location, a wrong one first.
	await b.evaluate(`(function () { ${field('Latitude')}.value = '95'; return true; })()`);
	let at = await control('button', 'Set');
	await clickAt(at.x, at.y);
	await sleep(300);
	ok('a latitude past the pole is refused, and says why', /Latitude is a number from -90 to 90/.test(await status()), await status());
	ok('and marks the field', await b.evaluate(`${field('Latitude')}.getAttribute('aria-invalid')`) === 'true');
	ok('nothing is written', !(await exists('/settings/location.json')));
	await b.evaluate(`(function () { ${field('Latitude')}.value = '-33,8688'; ${field('Longitude')}.value = '151.2093'; return true; })()`);
	at = await control('button', 'Set');
	await clickAt(at.x, at.y);
	await until('written', () => exists('/settings/location.json'), 5000);
	ok('Sydney, with a decimal comma, is written', JSON.parse(await readText('/settings/location.json')).latitude === -33.8688, await readText('/settings/location.json'));
	ok('the error is gone', (await status()) === '');
	await until('told', () => b.evaluate(`__told.length === 2`), 5000);
	ok('and the page is told', await b.evaluate(`__told[1]`) === '{"latitude":-33.8688,"longitude":151.2093}');

	// D: Use my location, the browser's answer overridden to Tallinn.
	at = await control('button', 'Use my location');
	await clickAt(at.x, at.y);
	await until('found', async () => /59\.44/.test(await readText('/settings/location.json') || ''), 10000);
	ok('found, kept to two decimals, shown and written', (await b.evaluate(`[${field('Latitude')}.value, ${field('Longitude')}.value].join()`)) === '59.44,24.75',
		await readText('/settings/location.json'));
	ok('the page is told that too', await b.evaluate(`__told[__told.length - 1]`) === '{"latitude":59.44,"longitude":24.75}');
	await b.evaluate(`(async () => { ${DLG}.close(); return true; })()`);

	// E: a known moment -- tonight's full moon over Riga -- to point at things.
	await b.evaluate(`(async () => { ${DLG}.open('background'); return true; })()`);
	// The dialog draws at once and again when the catalog's list arrives; typing goes after both.
	await until('the looks', async () => (await tiles()).some(t => t.key === 'Sky/Now'), 10000);
	await sleep(500);
	await until('the row', () => b.evaluate(`!!${field('Latitude')}`), 5000);
	await b.evaluate(`(function () { ${field('Latitude')}.value = '56.9496'; ${field('Longitude')}.value = '24.1052'; return true; })()`);
	at = await control('button', 'Set');
	await clickAt(at.x, at.y);
	await until('Riga again', async () => /56\.9496/.test(await readText('/settings/location.json') || ''), 5000);
	await b.evaluate(`(async () => { ${DLG}.close(); return true; })()`);
	const MOMENT = '2026-09-25T20:15:00Z';
	await b.evaluate(`setWallpaper({type: 'page', value: '/apps/screensavers/Sky.xscr', options: {look: 'Now', entry: 'index.html?at=${MOMENT}'}}).then(function () { return true; })`);
	await until('the moment', () => b.evaluate(`!!(${BG} && /at=2026/.test(${BG}.src) && ${BG}.contentWindow && ${BG}.contentWindow.pixosPause)`), 10000);
	await sleep(2000);
	const rect = await b.evaluate(`(function () { var r = ${BG}.getBoundingClientRect(); return {left: r.left, top: r.top, width: r.width, height: r.height}; })()`);
	const view = sky.makeView(56.9496, rect.width, rect.height);
	const date = new Date(MOMENT);
	const moon = SunCalc.getMoonPosition(date, 56.9496, 24.1052);
	const moonAt = sky.project(view, moon.altitude, moon.azimuth);
	const free = (x, y) => b.evaluate(`(function () { var e = document.elementFromPoint(${rect.left + x}, ${rect.top + y}); return !!e && !!e.closest('#desktop') && !e.closest('.PixWidget, .PixDesktop__widgets, [class*="Widget"]'); })()`);
	const hover = async (x, y) => {
		await b.mouse('mouseMoved', rect.left + x - 30, rect.top + y - 30);
		await sleep(50);
		await b.mouse('mouseMoved', rect.left + x, rect.top + y);
		await sleep(300);
		return b.evaluate(`(function () { var l = ${BG}.contentDocument.getElementById('label'); return l.classList.contains('shown') ? l.innerText.replace(/\\n/g, ' | ') : ''; })()`);
	};
	ok('the moon is where the test expects it, on screen and free of widgets', sky.onScreen(view, moonAt, 0) && await free(moonAt.x, moonAt.y), moonAt);
	const moonLabel = await hover(moonAt.x, moonAt.y);
	ok('pointing at the moon names it, its phase and its rise and set', /^Moon \| (Full moon|Waxing gibbous), 9\d% lit \| Rose \d\d:\d\d, sets \d\d:\d\d$/.test(moonLabel), moonLabel);
	await b.screenshot(out('sky-moon-label.png'));
	const places = sky.starPlaces(sky.starVectors(starsDoc.stars), date, {latitude: 56.9496, longitude: 24.1052});
	let starLabel = '';
	let tried = [];
	for (let i = 0; i < starsDoc.stars.length && !starLabel; i++) {
		const star = starsDoc.stars[i];
		const p = sky.project(view, places[i].altitude, places[i].azimuth);
		if (!star[4] || star[2] > 1.5 || places[i].altitude < 15 || !sky.onScreen(view, p, -20) || Math.hypot(p.x - moonAt.x, p.y - moonAt.y) < 60 || !(await free(p.x, p.y))) {
			continue;
		}
		tried.push(star[4]);
		const text = await hover(p.x, p.y);
		if (text) {
			starLabel = text + '  (' + star[4] + ')';
		}
	}
	ok('pointing at a bright star names it from the catalogue', /^(\S[^|]*) \| [α-ω]\S* \S+, magnitude -?[\d.]+ {2}\(\1\)$/.test(starLabel.replace('−', '-')), starLabel || tried);
	await b.screenshot(out('sky-star-label.png'));
	await sleep(2800);
	ok('the label goes when the pointer stops coming', await b.evaluate(`!${BG}.contentDocument.getElementById('label').classList.contains('shown')`));

	// F: covered, it stops drawing; uncovered, it draws again.
	await b.evaluate(`(function () { var w = ${BG}.contentWindow; w.__calls = []; ['pixosPause', 'pixosResume'].forEach(function (n) {
		var real = w[n]; w[n] = function () { w.__calls.push(n); return real.apply(this, arguments); }; }); return true; })()`);
	await b.evaluate(`openPath('/home').then(function () { return true; })`);
	await sleep(1500);
	ok('covered, PixOS pauses it', (await b.evaluate(`${BG}.contentWindow.__calls.join()`)) === 'pixosPause', await b.evaluate(`${BG}.contentWindow.__calls`));
	ok('and it draws nothing', !(await drawsIn(BG, 600)));
	await b.evaluate(`(function () { wm.listWindows().forEach(function (w) { wm.closeWindow(w.id); }); return true; })()`);
	await sleep(1200);
	ok('uncovered, it is resumed and draws', (await b.evaluate(`${BG}.contentWindow.__calls.join()`)) === 'pixosPause,pixosResume' && await drawsIn(BG, 400));

	// G: One year as the background: a date in the corner, a day a second.
	await b.evaluate(`(async () => { ${DLG}.open('background'); return true; })()`);
	await clickTile('Sky/One year');
	await until('One year', async () => ((await settings()).wallpaper.options || {}).look === 'One year', 10000);
	await b.evaluate(`(async () => { ${DLG}.close(); return true; })()`);
	await until('the year', () => b.evaluate(`!!(${BG} && /pace=year/.test(${BG}.src) && ${BG}.contentWindow && ${BG}.contentWindow.pixosPause)`), 10000);
	await sleep(800);
	const day1 = await b.evaluate(`${BG}.contentDocument.getElementById('caption').textContent`);
	await sleep(2100);
	const day2 = await b.evaluate(`${BG}.contentDocument.getElementById('caption').textContent`);
	ok('One year writes the date, and it moves on a day a second', /^\d{1,2} \p{L}+$/u.test(day1) && day1 !== day2, [day1, day2]);

	// H: One day as the screensaver: the time in the corner, twelve minutes a second.
	await b.evaluate(`(async () => { ${DLG}.open('screensaver'); return true; })()`);
	await until('the screensaver tab', async () => (await tiles()).some(t => t.key === 'Sky/One day'), 10000);
	await clickTile('Sky/One day');
	await until('One day is the screensaver', async () => {
		const s = await settings();
		return s && s.screensaver && s.screensaver.show && s.screensaver.show.options && s.screensaver.show.options.look === 'One day';
	}, 10000);
	ok('the row is drawn on the screensaver tab too', await b.evaluate(`!!${field('Latitude')}`));
	await b.evaluate(`(async () => { ${DLG}.close(); ${SS}.start(${SS}.getSettings().show); return true; })()`);
	await until('the layer', () => skyReady(LAYER), 10000);
	await sleep(1200);
	const t1 = await b.evaluate(`${LAYER}.contentDocument.getElementById('caption').textContent`);
	await sleep(1500);
	const t2 = await b.evaluate(`${LAYER}.contentDocument.getElementById('caption').textContent`);
	ok('One day writes the time, and it runs twelve minutes a second', /^\d\d:\d\d$/.test(t1) && t1 !== t2, [t1, t2]);
	await b.screenshot(out('sky-saver-day.png'));
	await b.send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16});
	await b.send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16});
	await until('it ends', async () => !(await b.evaluate(`!!document.querySelector('.PixScreensaver')`)), 5000);
	ok('a key ends it', true);

	// I: a reload keeps the location, read before the background is mounted.
	await b.send('Page.reload');
	await sleep(1500);
	await until('boot after reload', booted, 60000);
	ok('after a reload, still Riga as set -- from the file this time', await b.evaluate(`JSON.stringify(getLocation())`) === '{"latitude":56.9496,"longitude":24.1052}');

	// J: Sydney, facing north, at a known moment, for the eye.
	await b.evaluate(`(function () { wm.listWindows().forEach(function (w) { wm.closeWindow(w.id); }); return true; })()`);
	await b.evaluate(`(async () => { ${DLG}.open('background'); return true; })()`);
	await clickTile('Sky/Now');
	await sleep(800);
	await until('the row', () => b.evaluate(`!!${field('Latitude')}`), 5000);
	await b.evaluate(`(function () { ${field('Latitude')}.value = '-33.8688'; ${field('Longitude')}.value = '151.2093'; return true; })()`);
	at = await control('button', 'Set');
	await clickAt(at.x, at.y);
	await until('Sydney', async () => /-33\.8688/.test(await readText('/settings/location.json') || ''), 5000);
	await b.evaluate(`(async () => { ${DLG}.close(); return true; })()`);
	await b.evaluate(`setWallpaper({type: 'page', value: '/apps/screensavers/Sky.xscr', options: {look: 'Now', entry: 'index.html?at=2026-09-25T08:30:00Z'}}).then(function () { return true; })`);
	await until('Sydney evening', () => b.evaluate(`!!(${BG} && /at=2026-09-25T08/.test(${BG}.src) && ${BG}.contentWindow && ${BG}.contentWindow.pixosPause)`), 10000);
	await sleep(2000);
	await b.mouse('mouseMoved', 5, 5);
	await sleep(3000);
	await b.screenshot(out('sky-sydney.png'));

	for (const e of b.events) {
		if (e.method === 'Runtime.exceptionThrown') {
			errors.push('exception: ' + JSON.stringify(e.params.exceptionDetails).slice(0, 300));
		}
		if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
			errors.push('console.error: ' + e.params.args.map(a => a.value || a.description).join(' ').slice(0, 300));
		}
	}
	ok('no errors on the console', errors.length === 0, errors);
} catch (e) {
	ok('ran to the end: ' + e.message, false);
	await b.screenshot(out('sky-error.png')).catch(() => {});
} finally {
	b.close();
	await server.stop();
	removeProfile(PROFILE);
	console.log('\n' + results.filter(Boolean).length + ' of ' + results.length + ' passed');
}
process.exit(results.every(Boolean) ? 0 : 1);
