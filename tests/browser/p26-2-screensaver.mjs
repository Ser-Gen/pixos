// Phase 26, pass 2, in a real boot of PixOS in headless Chrome.
import {launchPage, sleep, until, serve, ORIGIN, REPO, out, profileDir, removeProfile} from './cdp.mjs';

const results = [];
const ok = (label, value) => { results.push([value ? 'ok  ' : 'FAIL', label]); console.log((value ? '  ok   ' : '  FAIL ') + label); };
const SKIP_LONG = process.argv.includes('--quick');

const server = await serve();
const PROFILE = profileDir('p26-2-screensaver');
const b = await launchPage(PROFILE);
const SS = `(await import('/js/shell/screensaver.js'))`;
const running = () => b.evaluate(`(async () => ${SS}.isRunning())()`);
const layerThere = () => b.evaluate(`!!document.querySelector('.PixScreensaver')`);
const key = async (type, k, code, vk, modifiers) => b.send('Input.dispatchKeyEvent', {type, key: k, code, windowsVirtualKeyCode: vk, modifiers: modifiers || 0});
const press = async (k, code, vk, modifiers) => { await key('keyDown', k, code, vk, modifiers); await key('keyUp', k, code, vk, modifiers); };
const chord = () => press('L', 'KeyL', 76, 2 | 8);   // Ctrl+Shift+L
const clickAt = async (x, y, button) => { await b.mouse('mouseMoved', x, y); await b.mouse('mousePressed', x, y, button || 'left', 1); await b.mouse('mouseReleased', x, y, button || 'left', 1); };
const menuItem = label => b.evaluate(`(function () {
	var item = Array.from(document.querySelectorAll('#overlays .PixMenu *')).find(function (el) { return el.children.length <= 2 && el.textContent.trim().indexOf(${JSON.stringify(label)}) === 0; });
	if (!item) { return null; }
	var r = item.getBoundingClientRect();
	return {x: r.left + 10, y: r.top + r.height / 2};
})()`);
const tileAt = title => b.evaluate(`(function () {
	var tile = Array.from(document.querySelectorAll('.PixSettings .PixSwatch')).find(function (el) { return el.title === ${JSON.stringify(title)}; });
	if (!tile) { return null; }
	var r = tile.getBoundingClientRect();
	return {x: r.left + r.width / 2, y: r.top + r.height / 2, active: tile.classList.contains('PixSwatch--active')};
})()`);
const settingsFile = () => b.evaluate(`new Promise(function (r) { fs.readFile('/settings/desktop.json', 'utf8', function (e, t) { try { r(e ? null : JSON.parse(t)); } catch (err) { r(null); } }); })`);

try {
	await b.send('Page.navigate', {url: ORIGIN + '/'});
	await until('boot', () => b.evaluate(`!!(window.wm && navigator.serviceWorker.controller && document.querySelector('.PixDesktop__wallpaper'))`), 60000);
	await b.send('Page.reload');
	await sleep(1500);
	await until('boot again', () => b.evaluate(`!!(window.wm && navigator.serviceWorker.controller && document.querySelector('.PixDesktop__wallpaper'))`), 60000);
	await sleep(2000);
	await b.evaluate(`(function(){ wm.listWindows().forEach(function (w) { wm.closeWindow(w.id); }); return true; })()`);

	ok('the slideshow is copied in at boot', await b.evaluate(`new Promise(function (r) { fs.exists('/apps/screensavers/Slideshow.xscr/index.html', r); })`));
	ok('and is not taken for an app', await b.evaluate(`!(window.apps || []).some(function (a) { return /screensaver/i.test(a.id || ''); })`));
	ok('a fresh system has no screensaver', await b.evaluate(`(async () => ${SS}.getSettings().show === null)()`));
	ok('Chrome has idle detection, not asked yet', JSON.stringify(await b.evaluate(`(async () => ${SS}.idleStatus())()`)) === JSON.stringify({mode: 'fallback', permission: 'prompt'}));

	// --- the key with nothing chosen ------------------------------------------------------------
	await chord();
	await sleep(400);
	ok('the key with nothing chosen opens the dialog on the Screensaver tab',
		await b.evaluate(`!!document.querySelector('.PixSettings .PixSettings__page[data-page="screensaver"][aria-selected="true"]')`));
	await until('the gallery to list the slideshow', () => tileAt('Slideshow'), 5000);
	const titles = await b.evaluate(`Array.from(document.querySelectorAll('.PixSettings .PixSwatch')).map(function (t) { return t.title; })`);
	// Since pass 4 the looks still to download sit between the shaders and the slideshow.
	ok('its gallery: None, Blank, the shaders, the downloads, the slideshow — ' + titles.join(', '),
		JSON.stringify(titles.slice(0, 5)) === JSON.stringify(['None', 'Blank', 'Aurora', 'Drift', 'Grid'])
		&& titles[titles.length - 1] === 'Slideshow' && titles.slice(5, -1).every(t => / to download$/.test(t)));
	ok('None is marked', (await tileAt('None')).active);
	await b.screenshot(out('dialog-screensaver-off.png'));

	// --- turning it on, in a real click --------------------------------------------------------
	const aurora = await tileAt('Aurora');
	await clickAt(aurora.x, aurora.y);
	await sleep(800);
	ok('choosing Aurora marks it', (await tileAt('Aurora')).active);
	const saved = await settingsFile();
	ok('and writes it beside the wallpaper', !!(saved && saved.screensaver && saved.screensaver.show && saved.screensaver.show.value === 'aurora' && saved.screensaver.minutes === 5 && saved.wallpaper !== undefined || (saved && saved.screensaver && saved.screensaver.show.value === 'aurora')));
	console.log('        idle after the click: ' + JSON.stringify(await b.evaluate(`(async () => ${SS}.idleStatus())()`)));
	ok('the dialog now says how idle is counted', await b.evaluate(`/idle|PixOS counts|whole computer/i.test(document.querySelector('.PixSettings').textContent)`));
	await b.screenshot(out('dialog-screensaver-on.png'));

	// Background tab: the same gallery, plus colours.
	await b.evaluate(`document.querySelector('.PixSettings__page[data-page="background"]').click()`);
	await sleep(300);
	const bgTitles = await b.evaluate(`Array.from(document.querySelectorAll('.PixSettings .PixSwatch')).map(function (t) { return t.title; })`);
	ok('the Background tab has the colours and the same moving gallery',
		['Midnight', '#1a1a2e', 'Aurora', 'Drift', 'Grid', 'Slideshow'].every(t => bgTitles.includes(t)) && !bgTitles.includes('None'));
	await b.screenshot(out('dialog-background.png'));
	await press('Escape', 'Escape', 27);
	await sleep(200);
	ok('Escape closes the dialog', !(await b.evaluate(`!!document.querySelector('.PixSettings')`)));

	// --- idle detection, allowed ----------------------------------------------------------------
	const granted = await b.send('Browser.grantPermissions', {origin: ORIGIN, permissions: ['idleDetection']});
	console.log('        grant: ' + JSON.stringify(granted.error || 'ok'));
	await until('the detector to take over', async () => (await b.evaluate(`(async () => ${SS}.idleStatus().mode)()`)) === 'detector', 8000).catch(() => null);
	ok('allowed, the detector takes over', (await b.evaluate(`(async () => ${SS}.idleStatus().mode)()`)) === 'detector');
	await b.send('Emulation.setIdleOverride', {isUserActive: false, isScreenUnlocked: true});
	await until('the screensaver to start', running, 12000).catch(() => null);
	ok('the machine idle: it starts', await running());
	ok('its layer is over everything, the taskbar too', await b.evaluate(`(function () { var l = document.querySelector('.PixScreensaver'); var r = l.getBoundingClientRect(); var hit = document.elementFromPoint(640, innerHeight - 10); return r.width === innerWidth && r.height === innerHeight && getComputedStyle(l).zIndex === '400' && l.contains(hit); })()`));
	ok('Aurora draws on it', await b.evaluate(`!!document.querySelector('.PixScreensaver canvas')`));
	ok('it has the focus', await b.evaluate(`document.activeElement === document.querySelector('.PixScreensaver')`));
	await sleep(1200);
	await b.screenshot(out('screensaver-aurora.png'));
	await b.send('Emulation.setIdleOverride', {isUserActive: true, isScreenUnlocked: true});
	await press('Shift', 'ShiftLeft', 16);
	await sleep(500);
	ok('a key ends it', !(await running()) && !(await layerThere()));

	await b.send('Emulation.setIdleOverride', {isUserActive: false, isScreenUnlocked: false});
	await sleep(6000);
	ok('idle but the screen locked: it does not start', !(await running()));
	await b.send('Emulation.setIdleOverride', {isUserActive: true, isScreenUnlocked: true});

	// --- with a window in front: the waking input goes nowhere ---------------------------------
	await b.evaluate(`openApp('explorer').then(function () { return true; })`);
	const EXP = `(function () { var w = wm.listWindows().find(function (x) { return x.appId === 'explorer'; }); return w && wm.getFrame(w.id); })()`;
	await until('Explorer', () => b.evaluate(`!!(${EXP} && ${EXP}.contentDocument && ${EXP}.contentDocument.querySelector('.explorer, body'))`), 20000);
	await sleep(1500);
	await b.evaluate(`(function () { var d = ${EXP}.contentDocument; window.__got = []; ['keydown', 'mousedown', 'pointerdown', 'click', 'mouseup'].forEach(function (t) { d.addEventListener(t, function (e) { window.__got.push(t + (e.key ? ':' + e.key : '')); }, true); }); return true; })()`);
	const rect = await b.evaluate(`(function () { var r = ${EXP}.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; })()`);
	await clickAt(rect.x, rect.y);
	await sleep(300);
	ok('Explorer has the focus', await b.evaluate(`document.activeElement === ${EXP}`));
	await b.evaluate(`window.__got.length = 0`);
	await chord();
	await sleep(500);
	ok('the key starts it from inside an app', await running());
	await press('K', 'KeyK', 75, 2);          // Ctrl+K: the palette's chord
	await sleep(600);
	ok('Ctrl+K ends it', !(await running()) && !(await layerThere()));
	ok('and does not open the palette', !(await b.evaluate(`!!document.querySelector('.PixPalette, [class*="Palette"]:not(style)')`)));
	const gotKeys = await b.evaluate(`window.__got.slice()`);
	ok('Explorer saw no key of it (' + gotKeys.join(' ') + ')', !gotKeys.some(g => /^keydown:(k|K|Control)$/.test(g)));
	ok('and has the focus back', await b.evaluate(`document.activeElement === ${EXP}`));

	await chord();
	await sleep(1200);
	await b.evaluate(`window.__got.length = 0`);
	await clickAt(rect.x, rect.y);
	await sleep(600);
	ok('a click on a window ends it', !(await running()) && !(await layerThere()));
	const gotClicks = await b.evaluate(`window.__got.slice()`);
	ok('and the window gets none of it (' + gotClicks.join(' ') + ')', gotClicks.length === 0);

	await chord();
	await sleep(300);
	await b.mouse('mouseMoved', rect.x + 200, rect.y + 100);
	await sleep(200);
	ok('a move in the first second does not end it', await running());
	await sleep(1200);
	await b.mouse('mouseMoved', rect.x + 201, rect.y + 101);
	await sleep(100);
	ok('a bump after it does not either', await running());
	await b.mouse('mouseMoved', rect.x + 260, rect.y + 160);
	await sleep(500);
	ok('a real move does', !(await running()));

	// A right-click opens no menu.
	await chord();
	await sleep(1200);
	await clickAt(300, 300, 'right');
	await sleep(500);
	ok('a right-click ends it and opens no menu', !(await running()) && !(await b.evaluate(`!!document.querySelector('#overlays .PixMenu')`)));

	// --- what holds it off, as the browser reports it -------------------------------------------
	await b.evaluate(`(function () {
		var d = ${EXP}.contentDocument;
		var rate = 8000, n = rate;
		var buf = new ArrayBuffer(44 + n); var v = new DataView(buf);
		var w = function (o, s) { for (var i = 0; i < s.length; i++) { v.setUint8(o + i, s.charCodeAt(i)); } };
		w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
		v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
		for (var i = 0; i < n; i++) { v.setUint8(44 + i, 128); }
		var a = d.createElement('audio'); a.id = 'probe-audio'; a.muted = true; a.loop = true; a.src = URL.createObjectURL(new Blob([buf], {type: 'audio/wav'}));
		d.body.append(a); return a.play().then(function () { return true; }, function (e) { return String(e); });
	})()`);
	await sleep(500);
	ok('a sound playing in a window is seen', await b.evaluate(`(async () => ${SS}.mediaPlaying(document))()`));
	await b.send('Emulation.setIdleOverride', {isUserActive: false, isScreenUnlocked: true});
	await sleep(7000);
	ok('and holds it off while the machine is idle', !(await running()));
	await b.evaluate(`${EXP}.contentDocument.getElementById('probe-audio').pause()`);
	ok('paused, it is not seen', !(await b.evaluate(`(async () => ${SS}.mediaPlaying(document))()`)));
	await b.send('Emulation.setIdleOverride', {isUserActive: true, isScreenUnlocked: true});

	// A page from another origin in a window, with the focus in it.
	await b.evaluate(`openUrl('${ORIGIN.replace('localhost', '127.0.0.1')}/docs/checks/Trail.xscr.html', 'Other origin').then(function () { return true; })`);
	await sleep(3000);
	const other = await b.evaluate(`(function () { var w = wm.listWindows().find(function (x) { return x.title === 'Other origin'; }); var f = w && wm.getFrame(w.id); var r = f.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; })()`);
	await clickAt(other.x, other.y);
	await sleep(400);
	ok('the focus in a page from another origin is seen as opaque', await b.evaluate(`(async () => ${SS}.opaqueFocus(document))()`));
	await clickAt(rect.x - 5, rect.y);
	await b.evaluate(`(function () { var w = wm.listWindows().find(function (x) { return x.title === 'Other origin'; }); wm.closeWindow(w.id); return true; })()`);
	await clickAt(rect.x, rect.y);
	await sleep(300);
	ok('and in Explorer, not', !(await b.evaluate(`(async () => ${SS}.opaqueFocus(document))()`)));

	// --- the slideshow ---------------------------------------------------------------------------
	await b.evaluate(`(async function () {
		await new Promise(function (r) { fs.mkdir('/home/pictures', function () { r(); }); });
		var colours = ['#c0392b', '#2980b9', '#27ae60'];
		for (var i = 0; i < colours.length; i++) {
			var c = document.createElement('canvas'); c.width = 640; c.height = 400;
			var x = c.getContext('2d'); x.fillStyle = colours[i]; x.fillRect(0, 0, 640, 400); x.fillStyle = '#fff'; x.font = '80px sans-serif'; x.fillText('Picture ' + (i + 1), 90, 230);
			var blob = await new Promise(function (r) { c.toBlob(r, 'image/png'); });
			var bytes = Buffer.from(await blob.arrayBuffer());
			await new Promise(function (r, j) { fs.writeFile('/home/pictures/p' + (i + 1) + '.png', bytes, function (e) { e ? j(e) : r(); }); });
		}
		return true;
	})()`);
	const slideshow = {type: 'page', value: '/apps/screensavers/Slideshow.xscr', options: {entry: 'index.html?folder=' + encodeURIComponent('/home/pictures')}};
	await b.evaluate(`(async () => { await ${SS}.setSettings({show: ${JSON.stringify(slideshow)}}); return true; })()`);
	await chord();
	const SF = `document.querySelector('.PixScreensaver iframe')`;
	await until('a picture', () => b.evaluate(`!!(${SF} && ${SF}.contentDocument && ${SF}.contentDocument.querySelector('figure img.picture'))`), 10000).catch(() => null);
	ok('the slideshow shows a picture from the folder', await b.evaluate(`!!(${SF} && ${SF}.contentDocument.querySelector('figure img.picture'))`));
	const firstSrc = await b.evaluate(`${SF}.contentDocument.querySelector('figure:last-of-type img.picture').src`);
	await sleep(2500);
	await b.screenshot(out('screensaver-slideshow.png'));
	await sleep(9000);
	const nextSrc = await b.evaluate(`${SF}.contentDocument.querySelector('figure:last-of-type img.picture').src`);
	ok('and moves on to the next', firstSrc !== nextSrc);
	await press('Shift', 'ShiftLeft', 16);
	await sleep(500);

	// The slideshow as the background, covered: its own pause.
	await b.evaluate(`window.setWallpaper(${JSON.stringify(slideshow)}).then(function () { return true; })`);
	const BF = `document.querySelector('.PixDesktop__wallpaper iframe')`;
	await b.evaluate(`(function () { wm.listWindows().forEach(function (w) { wm.closeWindow(w.id); }); return true; })()`);
	await until('a background picture', () => b.evaluate(`!!(${BF} && ${BF}.contentDocument.querySelector('figure img.picture'))`), 10000).catch(() => null);
	await b.evaluate(`openApp('explorer').then(function () { return true; })`);
	await sleep(1000);
	const coveredSrc = await b.evaluate(`${BF}.contentDocument.querySelector('figure:last-of-type img.picture').src`);
	await sleep(12000);
	ok('covered, the background slideshow waits on the same picture', coveredSrc === await b.evaluate(`${BF}.contentDocument.querySelector('figure:last-of-type img.picture').src`));
	await b.evaluate(`(function () { wm.listWindows().forEach(function (w) { wm.closeWindow(w.id); }); return true; })()`);
	await sleep(10500);
	ok('uncovered, it moves on', coveredSrc !== await b.evaluate(`${BF}.contentDocument.querySelector('figure:last-of-type img.picture').src`));

	// An empty folder says so.
	await b.evaluate(`new Promise(function (r) { fs.mkdir('/home/empty', function () { r(true); }); })`);
	await b.evaluate(`window.setWallpaper({type: 'page', value: '/apps/screensavers/Slideshow.xscr', options: {entry: 'index.html?folder=%2Fhome%2Fempty'}}).then(function () { return true; })`);
	await until('the empty note', () => b.evaluate(`${BF} && !${BF}.contentDocument.getElementById('say').hidden`), 8000).catch(() => null);
	console.log('        empty: ' + await b.evaluate(`${BF}.contentDocument.getElementById('say').textContent`));
	ok('an empty folder says so', await b.evaluate(`/No pictures in \\/home\\/empty/.test(${BF}.contentDocument.getElementById('say').textContent)`));

	// --- the shortcuts sheet, and a reload ---------------------------------------------------------
	await press('/', 'Slash', 191, 2);
	await sleep(400);
	ok('the shortcuts sheet lists it', await b.evaluate(`/Start the screensaver/.test(document.body.textContent)`));
	await press('Escape', 'Escape', 27);

	await b.evaluate(`(async () => { await ${SS}.setSettings({show: {type: 'shader', value: 'drift'}, minutes: 1}); return true; })()`);
	await b.send('Browser.resetPermissions', {});
	await b.send('Page.reload');
	await sleep(1500);
	await until('boot after reload', () => b.evaluate(`!!(window.wm && document.querySelector('.PixDesktop__wallpaper'))`), 60000);
	await sleep(1500);
	const after = await b.evaluate(`(async () => ${SS}.getSettings())()`);
	ok('the choice survives a reload', after.show && after.show.value === 'drift' && after.minutes === 1);
	ok('and with the permission taken back, the fallback counts', (await b.evaluate(`(async () => ${SS}.idleStatus().mode)()`)) === 'fallback');

	if (!SKIP_LONG) {
		await b.evaluate(`(function(){ wm.listWindows().forEach(function (w) { wm.closeWindow(w.id); }); return true; })()`);
		const t0 = Date.now();
		await sleep(50000);
		ok('fifty seconds of nothing: not yet', !(await running()));
		await until('a minute of nothing', running, 20000).catch(() => null);
		ok('a minute of nothing, counted by PixOS alone: it starts (' + Math.round((Date.now() - t0) / 1000) + ' s)', await running());
		ok('and the background under it is paused', await b.evaluate(`(function () { var d = document.querySelector('.PixDesktop__wallpaper canvas'); return true; })()`));
	}

	const bad = b.events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
	console.log('        console errors: ' + bad.map(e => JSON.stringify(e.params.exceptionDetails ? e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description : e.params.args.map(a => a.value || a.description)).slice(0, 200)).join('\n        '));
	ok('no errors in the console', bad.length === 0);
}
catch (err) {
	console.error(err);
	ok('ran to the end', false);
}
finally {
	b.close();
	await server.stop();
	removeProfile(PROFILE);
	console.log('\n' + results.filter(r => r[0] === 'ok  ').length + ' of ' + results.length + ' passed');
}
process.exit(results.every(r => r[0] === 'ok  ') ? 0 : 1);
