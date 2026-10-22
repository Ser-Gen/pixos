// Phase 27 pass 1, end to end against a real boot in headless Chrome: the Settings window from Start,
// its three pages and the sidebar's keys, a background chosen on its page, Explorer's route redrawing
// it, Escape, Cmd+comma, the Location page typed and then Follow me with the permission granted, a
// reload finding the place again, a reload with the permission gone asking nothing, and a phone width.
import {launch, sleep, serve, ORIGIN, out, profileDir, removeProfile} from './cdp.mjs';

const results = [];
function check (name, got, want) {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	results.push(ok);
	console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
}

const server = await serve();
const profile = profileDir('p27-1-settings');
const browser = await launch({profile});
try {
	const a = await browser.page(ORIGIN + '/');
	const ready = "!!document.querySelector('.PixTaskbar__start') && typeof window.setWallpaperPage === 'function' && !!document.querySelector('.PixDesktop__wallpaper')";
	await a.until(ready, 60000);
	await sleep(1500);

	const readJson = file => `new Promise(r => window.fs.readFile('${file}', 'utf8', (e, t) => r(e ? null : JSON.parse(t))))`;
	const startAction = async label => {
		await a.eval("document.querySelector('.PixTaskbar__start').click()");
		await a.until("!!document.querySelector('.PixStart__action')");
		return a.eval(`(() => { const b = [...document.querySelectorAll('.PixStart__action')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (b) { b.click(); } return !!b; })()`);
	};
	const state = "(() => { const w = document.querySelector('.PixSettings'); if (!w) { return null; } return {pages: [...w.querySelectorAll('.PixSettings__page')].map(b => b.textContent), "
		+ "selected: (w.querySelector('.PixSettings__page[aria-selected=\"true\"]') || {}).textContent, heading: w.querySelector('.PixSettings__heading').textContent, "
		+ "focus: document.activeElement === w ? 'window' : document.activeElement.className}; })()";

	check('Start offers Settings, and the old two beside it', await a.eval("document.querySelector('.PixTaskbar__start').click(), new Promise(r => setTimeout(() => r([...document.querySelectorAll('.PixStart__action')].map(b => b.textContent.trim()).filter(t => /Settings|Wallpaper|Screensaver/.test(t))), 300))"),
		['Settings...', 'Wallpaper...', 'Screensaver...']);
	await a.eval("document.querySelector('.PixStart__action') && [...document.querySelectorAll('.PixStart__action')].find(b => b.textContent.trim() === 'Settings...').click()");
	await a.until("!!document.querySelector('.PixSettings')");
	await sleep(800);
	check('Settings opens on its first page, the tab focused', await a.eval(state),
		{pages: ['Background', 'Screensaver', 'Location'], selected: 'Background', heading: 'Background', focus: 'PixSettings__page'});
	check('the Background page is the gallery it was', await a.eval("[...document.querySelectorAll('.PixSettings__body .PixDialog__label')].map(l => l.textContent)"),
		['Gradients', 'Solid colours', 'Animated', 'On battery', 'A file from the filesystem']);
	await a.screenshot(out('p27-1-background.png'));

	await a.eval("(b => { b.focus(); b.click(); })([...document.querySelectorAll('.PixSwatch')].find(b => b.title === '#20262e'))");
	const wall = await a.until(`${readJson('/settings/desktop.json')}.then(s => s && s.wallpaper && s.wallpaper.value === '#20262e' ? s.wallpaper : null)`);
	check('a colour chosen there is the background, and written', [wall.type, wall.value], ['color', '#20262e']);
	check('the window stays, marked on that tile, the focus kept on it',
		await a.eval("[!!document.querySelector('.PixSettings'), document.querySelector('.PixSwatch--active').title, document.activeElement.title]"), [true, '#20262e', '#20262e']);

	await a.eval("window.setWallpaperPage('/apps/screensavers/Slideshow.xscr')");
	await a.until("(document.querySelector('.PixSwatch--active') || {}).title === 'Slideshow'");
	check('Explorer\'s Set as wallpaper is drawn on the open page', await a.eval("!!document.querySelector('input[aria-label=\"Folder of pictures\"]')"), true);

	await a.eval("document.querySelector('.PixSettings__page[aria-selected=\"true\"]').focus()");
	await a.key('ArrowDown', {code: 'ArrowDown', windowsVirtualKeyCode: 40});
	await sleep(300);
	check('ArrowDown goes to the next page, the focus with it', await a.eval(state),
		{pages: ['Background', 'Screensaver', 'Location'], selected: 'Screensaver', heading: 'Screensaver', focus: 'PixSettings__page'});
	await a.key('End', {code: 'End', windowsVirtualKeyCode: 35});
	await sleep(200);
	check('End goes to the last', (await a.eval(state)).selected, 'Location');
	await a.key('ArrowDown', {code: 'ArrowDown', windowsVirtualKeyCode: 40});
	await sleep(200);
	check('and past it, round to the first', (await a.eval(state)).selected, 'Background');

	await a.key('Escape', {code: 'Escape', windowsVirtualKeyCode: 27});
	await sleep(200);
	check('Escape closes it', await a.eval("!!document.querySelector('.PixSettings')"), false);

	// Cmd+comma: Meta is 4 in CDP's modifiers, and Chrome on a Mac sends ⌘, to the page in headless.
	const comma = () => a.key(',', {code: 'Comma', windowsVirtualKeyCode: 188, modifiers: 4});
	await comma();
	await a.until("!!document.querySelector('.PixSettings')");
	check('Cmd+, opens it, where it was left', (await a.eval(state)).selected, 'Background');
	await comma();
	await sleep(200);
	check('and closes it', await a.eval("!!document.querySelector('.PixSettings')"), false);

	check('Screensaver... in Start opens that page', await startAction('Screensaver...'), true);
	await a.until("!!document.querySelector('.PixSettings')");
	check('there', (await a.eval(state)).selected, 'Screensaver');
	await a.eval("[...document.querySelectorAll('.PixSwatch')].find(b => b.title === 'Blank').click()");
	await a.until("!!document.querySelector('.PixDialog__corners')");
	check('the Screensaver page works as the tab did: Blank chosen, the corners and the PIN drawn',
		await a.eval("[...document.querySelectorAll('.PixSettings__body .PixDialog__label')].map(l => l.textContent).filter(t => ['Hot corners', 'PIN to wake'].includes(t))"),
		['Hot corners', 'PIN to wake']);

	// The Location page.
	await a.eval("[...document.querySelectorAll('.PixSettings__page')].find(b => b.textContent === 'Location').click()");
	await sleep(300);
	const notes = "[...document.querySelectorAll('.PixSettings__body .PixDialog__note')].filter(n => !n.hidden).map(n => n.textContent)";
	check('Location: Riga stands in, and the box is offered', await a.eval(`[${notes}.some(t => /Riga stands in/.test(t)), document.querySelector('.PixSettings__body input[type=checkbox]').disabled]`),
		[true, false]);
	check('headless Chrome would ask, so the page says turning it on asks now', await a.eval(`${notes}.some(t => /asks once now/.test(t))`), true);
	await a.screenshot(out('p27-1-location.png'));
	await a.eval(`(() => {
		const [lat, lon] = document.querySelectorAll('.PixSettings__body input[type=text]');
		lat.value = '48,8566'; lon.value = '2.3522';
		[...document.querySelectorAll('.PixSettings__body button')].find(b => b.textContent === 'Set').click();
	})()`);
	const typed = await a.until(`${readJson('/settings/location.json')}.then(s => s && s.latitude === 48.8566 ? s : null)`);
	check('a typed place is written, with no follow', typed, {latitude: 48.8566, longitude: 2.3522});
	check('and the page no longer says Riga', await a.eval(`${notes}.some(t => /Riga stands in/.test(t))`), false);

	// Follow me, with the permission granted and the browser somewhere else.
	await browser.send('Browser.grantPermissions', {origin: ORIGIN, permissions: ['geolocation']});
	await a.send('Emulation.setGeolocationOverride', {latitude: 59.436962, longitude: 24.753574, accuracy: 30});
	await a.eval("document.querySelector('.PixSettings__body input[type=checkbox]').click()");
	const followed = await a.until(`${readJson('/settings/location.json')}.then(s => s && s.follow ? s : null)`);
	check('ticked: found there and then, two decimals, written following', followed, {latitude: 59.44, longitude: 24.75, follow: true});
	await sleep(300);
	check('the page says it is found at every start', await a.eval(`[document.querySelector('.PixSettings__body input[type=checkbox]').checked, ${notes}.includes('Found again each time PixOS starts.')]`),
		[true, true]);
	check('and Sky would see it', await a.eval('window.getLocation()'), {latitude: 59.44, longitude: 24.75});

	// A reload somewhere else: found again, at boot.
	await a.send('Emulation.setGeolocationOverride', {latitude: 54.687157, longitude: 25.279652, accuracy: 30});
	await a.send('Page.reload');
	await sleep(1000);
	await a.until(ready, 60000);
	const refound = await a.until(`${readJson('/settings/location.json')}.then(s => s && s.latitude === 54.69 ? s : null)`, 20000);
	check('a reload finds it again, still following', refound, {latitude: 54.69, longitude: 25.28, follow: true});
	check('and the shell has it', await a.eval('window.getLocation()'), {latitude: 54.69, longitude: 25.28});

	// The permission gone: the next boot asks nothing and changes nothing.
	await browser.send('Browser.resetPermissions', {});
	await a.send('Emulation.setGeolocationOverride', {latitude: 40.4168, longitude: -3.7038, accuracy: 30});
	await a.send('Page.reload');
	await sleep(1000);
	await a.until(ready, 60000);
	await sleep(3000);
	check('with the permission gone a reload keeps the place it had', await a.eval(readJson('/settings/location.json')),
		{latitude: 54.69, longitude: 25.28, follow: true});
	await comma();
	await a.until("!!document.querySelector('.PixSettings')");
	await a.eval("[...document.querySelectorAll('.PixSettings__page')].find(b => b.textContent === 'Location').click()");
	await sleep(500);
	check('and the page says why: the browser would ask, and a start never does', await a.eval(`${notes}.some(t => /never asks at start/.test(t))`), true);
	await a.eval("document.querySelector('.PixSettings__body input[type=checkbox]').click()");
	const off = await a.until(`${readJson('/settings/location.json')}.then(s => s && !s.follow ? s : null)`);
	check('unticked: the place stays and follow is gone from the file', off, {latitude: 54.69, longitude: 25.28});

	// A phone's width.
	await a.send('Emulation.setDeviceMetricsOverride', {width: 390, height: 780, deviceScaleFactor: 1, mobile: false});
	await sleep(500);
	const narrow = await a.eval(`(() => { const w = document.querySelector('.PixSettings').getBoundingClientRect(); const nav = document.querySelector('.PixSettings__nav');
		return {left: w.left, right: Math.round(w.right), row: getComputedStyle(nav).flexDirection, title: getComputedStyle(document.querySelector('.PixSettings__title')).display,
			bodyScroll: document.querySelector('.PixSettings__body').scrollWidth <= document.querySelector('.PixSettings__body').clientWidth}; })()`);
	check('at 390px: 16px either side, the pages a row, nothing wider than the page', narrow, {left: 16, right: 374, row: 'row', title: 'none', bodyScroll: true});
	await a.screenshot(out('p27-1-narrow.png'));
	await a.send('Emulation.clearDeviceMetricsOverride');

	check('no errors', a.errors, []);
}
catch (err) {
	console.log('  FAIL ' + err.stack);
	results.push(false);
}
finally {
	browser.close();
	await sleep(1000);
	removeProfile(profile);
	await server.stop();
}
const failed = results.filter(ok => !ok).length;
console.log('\np27-1 e2e: ' + (results.length - failed) + ' of ' + results.length + ' passed');
process.exit(failed ? 1 : 0);
