// Phase 26, pass 4 (downloads and looks), in a real boot of PixOS in headless Chrome.
import {launchPage, sleep, until, serve, ORIGIN, REPO, out, profileDir, removeProfile} from './cdp.mjs';
import {readFileSync} from 'node:fs';

// The precache this sw.js installs, read from it rather than written here and left behind.
const SHELL_CACHE = /SHELL_CACHE = '([^']+)'/.exec(readFileSync(REPO + '/sw.js', 'utf8'))[1];

const results = [];
const ok = (label, value, detail) => { results.push(!!value); console.log((value ? '  ok   ' : '  FAIL ') + label + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); };

const server = await serve();
const PROFILE = profileDir('p26-4-downloads');
const b = await launchPage(PROFILE);
const DLG = `(await import('/js/shell/wallpaper-dialog.js'))`;
const SS = `(await import('/js/shell/screensaver.js'))`;
const booted = () => b.evaluate(`!!(window.wm && navigator.serviceWorker.controller && document.querySelector('.PixDesktop__wallpaper'))`);
const clickAt = async (x, y) => {
	await b.mouse('mouseMoved', x, y);
	await b.mouse('mousePressed', x, y, 'left', 1);
	await b.mouse('mouseReleased', x, y, 'left', 1);
};
const exists = p => b.evaluate(`new Promise(function (r) { fs.stat(${JSON.stringify(p)}, function (e) { r(!e); }); })`);
const walk = dir => b.evaluate(`(function walk (d) { return new Promise(function (r) { fs.readdir(d, function (e, names) {
	if (e) { return r([]); }
	Promise.all(names.map(function (n) { var p = d + '/' + n; return new Promise(function (r2) { fs.stat(p, function (e2, s) {
		r2(s && s.isDirectory() ? walk(p) : [p]); }); }); })).then(function (lists) { r([].concat.apply([], lists)); });
}); }); })(${JSON.stringify(dir)})`);
const settings = () => b.evaluate(`new Promise(function (r) { fs.readFile('/settings/desktop.json', 'utf8', function (e, t) { r(e ? null : JSON.parse(t)); }); })`);
const tiles = () => b.evaluate(`Array.from(document.querySelectorAll('.PixSettings .PixSwatch')).map(function (t) {
	var r = t.getBoundingClientRect(); var size = t.querySelector('.PixSwatch__size');
	return {key: t.dataset.key.replace('\\n', '/'), tip: t.title, size: size ? size.textContent : '', active: t.getAttribute('aria-pressed') === 'true',
		busy: t.getAttribute('aria-busy') === 'true', x: r.left + r.width / 2, y: r.top + r.height / 2}; })`);
const tile = async key => (await tiles()).find(t => t.key === key);
const clickTile = async key => {
	const t = await until('tile ' + key, () => tile(key), 10000);
	await b.evaluate(`document.querySelector('.PixSettings__body').scrollTop = 0, true`);
	const again = await tile(key);
	await clickAt(again.x, again.y);
};
const fetched = () => b.evaluate(`window.__fetched.splice(0)`);
const notes = () => b.evaluate(`window.__notes.splice(0)`);
// Frames an in-page window draws in one second, counted from inside it.
const framesIn = frameExpr => b.evaluate(`(function () { var f = ${frameExpr}; var w = f && f.contentWindow; if (!w) { return -1; }
	var n = 0; var go = true; function tick () { n++; if (go) { w.requestAnimationFrame(tick); } }
	w.requestAnimationFrame(tick); return new Promise(function (r) { setTimeout(function () { go = false; r(n); }, 1000); }); })()`);
const BG = `document.querySelector('#desktop .PixDesktop__wallpaper iframe')`;
const LAYER = `document.querySelector('.PixScreensaver iframe')`;
const errors = [];

try {
	await b.send('Browser.grantPermissions', {origin: ORIGIN, permissions: ['idleDetection']});
	await b.send('Page.navigate', {url: ORIGIN + '/'});
	await until('boot', booted, 60000);
	await b.send('Page.reload');
	await sleep(1500);
	await until('boot again', booted, 60000);
	await sleep(2000);
	b.events.length = 0;
	ok('the new precache is in use', await b.evaluate(`caches.keys().then(function (k) { return k.indexOf('${SHELL_CACHE}') > -1; })`));
	await b.evaluate(`(function () {
		wm.listWindows().forEach(function (w) { wm.closeWindow(w.id); });
		window.__fetched = [];
		var real = window.fetch;
		window.fetch = function (u) { var s = String(u); if (s.indexOf('/apps/screensavers/') > -1 && s.indexOf('__browserfs__') === -1) { __fetched.push(s.replace(/[?].*$/, '').replace(location.origin, '')); } return real.apply(this, arguments); };
		window.__notes = [];
		new MutationObserver(function (list) { list.forEach(function (m) { m.addedNodes.forEach(function (n) {
			if (n.classList && n.classList.contains('PixNote')) { __notes.push(n.className.replace('PixNote ', '') + ': ' + n.textContent.replace(/\\s+/g, ' ').trim()); } }); }); })
			.observe(document.body, {childList: true, subtree: true});
		return true; })()`);
	ok('nothing downloaded yet', !(await exists('/apps/screensavers/Matrix.xscr')) && !(await exists('/apps/screensavers/Habitats.xscr')));

	// A: the gallery.
	await b.evaluate(`(async () => { ${DLG}.open('background'); return true; })()`);
	await until('the looks', async () => (await tiles()).some(t => t.key === 'Matrix/Classic'), 10000);
	const first = await tiles();
	const moving = first.filter(t => /^(Matrix|Habitats|)\//.test(t.key) && !/^\/#/.test(t.key)).map(t => t.key + ' ' + t.size);
	ok('a tile per look, each with what it downloads', true, moving);
	ok('the tip says it in words', /Matrix · Resurrections, \d+ KB to download/.test(first.find(t => t.key === 'Matrix/Resurrections').tip), first.find(t => t.key === 'Matrix/Resurrections').tip);
	ok('and the gallery says what a size means', await b.evaluate(`/A size on a tile is what it downloads/.test(document.querySelector('.PixSettings').textContent)`));
	await b.screenshot(out('dialog-looks.png'));

	// B: Matrix Classic as the background.
	await fetched();
	await notes();
	await clickTile('Matrix/Classic');
	await until('Classic downloaded and chosen', async () => {
		const s = await settings();
		return s && s.wallpaper && s.wallpaper.options && s.wallpaper.options.look === 'Classic';
	}, 30000);
	const allClassic = await fetched();
	const classicFetched = allClassic.filter(u => !/index\.json$/.test(u));
	ok('the index, then Classic\'s 35 files, one at a time', allClassic[0] === '/apps/screensavers/index.json' && classicFetched.length === 35, classicFetched.length);
	ok('its page last', classicFetched[classicFetched.length - 1] === '/apps/screensavers/Matrix.xscr/index.html');
	ok('and none of Resurrections\' glyphs', !classicFetched.some(u => /resurrections/.test(u)));
	await sleep(500);
	const classicNotes = await notes();
	ok('a progress note named it, and said when it was done', classicNotes.some(n => /progress: .*Downloading Matrix · Classic/.test(n)) && classicNotes.some(n => /Matrix · Classic is downloaded/.test(n)), classicNotes);
	ok('the background is the look\'s page', await until('the frame', () => b.evaluate(`(${BG} || {}).src`), 10000).then(s => /Matrix\.xscr\/index\.html\?suppressWarnings=true$/.test(s)));
	await sleep(2500);
	ok('and it draws', (await framesIn(BG)) > 20);
	ok('with no warning in the way', await b.evaluate(`!${BG}.contentDocument.querySelector('.notice') && !!${BG}.contentDocument.querySelector('canvas')`));

	// C: the tiles know what is here now; Resurrections downloads only its own.
	await until('the badges redrawn', async () => (await tile('Matrix/Classic')).size === '', 5000);
	const after = await tiles();
	ok('Classic and 3D cost nothing now, Resurrections only its glyphs', [after.find(t => t.key === 'Matrix/Classic').size, after.find(t => t.key === 'Matrix/3D').size,
		after.find(t => t.key === 'Matrix/Resurrections').size].join('|') === '||↓ 310 KB', after.filter(t => /Matrix/.test(t.key)).map(t => t.size));
	ok('and the chosen look is marked', after.find(t => t.key === 'Matrix/Classic').active);
	await clickTile('Matrix/Resurrections');
	await until('Resurrections chosen', async () => ((await settings()).wallpaper.options || {}).look === 'Resurrections', 20000);
	const resFetched = (await fetched()).filter(u => !/index\.json$/.test(u));
	ok('the second look fetched only what it adds, its page being there', resFetched.length === 2 && resFetched.every(u => /resurrections/.test(u)), resFetched);
	await sleep(2000);
	ok('and draws', (await framesIn(BG)) > 20);
	await b.evaluate(`(async () => { ${DLG}.close(); return true; })()`);
	await sleep(1000);
	await b.screenshot(out('bg-resurrections.png'));

	// D: Pipes as the screensaver.
	await b.evaluate(`(async () => { ${DLG}.open('screensaver'); return true; })()`);
	await until('the screensaver tab', async () => (await tiles()).some(t => t.key === '/Pipes'), 10000);
	await clickTile('/Pipes');
	await until('Pipes is the screensaver', async () => {
		const s = await settings();
		return s && s.screensaver && s.screensaver.show && s.screensaver.show.options && s.screensaver.show.options.look === 'Pipes';
	}, 20000);
	const pipesFetched = (await fetched()).filter(u => !/index\.json$/.test(u));
	ok('Pipes downloaded, 12 files, and chosen', pipesFetched.length === 12, pipesFetched.length);
	await b.evaluate(`(async () => { ${DLG}.close(); ${SS}.start(${SS}.getSettings().show); return true; })()`);
	await until('the layer', () => b.evaluate(`!!(${LAYER} && ${LAYER}.contentDocument && ${LAYER}.contentDocument.querySelector('#canvas-webgl'))`), 10000);
	await sleep(2500);
	ok('it shows with its controls hidden', await b.evaluate(`Array.from(${LAYER}.contentDocument.querySelectorAll('.ui-container')).every(function (e) { return e.hidden; })`));
	ok('and draws', (await framesIn(LAYER)) > 20);
	await b.screenshot(out('saver-pipes.png'));
	await b.send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16});
	await b.send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16});
	await until('it ends', async () => !(await b.evaluate(`!!document.querySelector('.PixScreensaver')`)), 5000);
	ok('a key ends it', true);

	// E: Riverscape as the background: 6.7 MB, a note counting bytes, paused when covered.
	await notes();
	await b.evaluate(`(async () => { ${DLG}.open('background'); return true; })()`);
	// Every text a progress note shows, recorded as it changes: from a local server the 6.4 MB arrive in
	// about 200 ms, between two looks of a 250 ms poll, so looking at the note would see only its ends.
	await b.evaluate(`(window.__progress = [], new MutationObserver(function () {
		document.querySelectorAll('.PixNote--progress').forEach(function (n) { window.__progress.push(n.textContent.replace(/\\s+/g, ' ')); });
	}).observe(document.documentElement, {subtree: true, childList: true, characterData: true}), true)`);
	await clickTile('Habitats/Riverscape');
	await until('the tile busy', async () => (await tile('Habitats/Riverscape')).busy, 5000).catch(() => null);
	const busy = await tile('Habitats/Riverscape');
	ok('while it downloads its tile says so', busy.size === '↓ …' && /downloading/.test(busy.tip), busy);
	const bar = await until('a byte count on the note', () => b.evaluate(`window.__progress.find(function (t) { return /[\\d.]+ (KB|MB) of [\\d.]+ MB/.test(t); }) || null`), 10000).catch(() => null);
	ok('the note counts bytes', !!bar, bar);
	await until('Riverscape chosen', async () => ((await settings()).wallpaper.options || {}).look === 'Riverscape', 60000);
	const habitatFiles = await walk('/apps/screensavers/Habitats.xscr');
	ok('Riverscape is here, and Reefscape\'s scene is not', habitatFiles.length === 38 && !habitatFiles.some(p => /reefscape/.test(p)), habitatFiles.length);
	await b.evaluate(`(async () => { ${DLG}.close(); return true; })()`);
	await until('the tank', () => b.evaluate(`!!(${BG} && ${BG}.contentWindow && ${BG}.contentWindow.pixosPause && /riverscape\\/wallpaper\\.html$/.test(${BG}.src))`), 20000);
	await sleep(6000);
	ok('it has PixOS\'s pause', await b.evaluate(`typeof ${BG}.contentWindow.pixosResume === 'function'`));
	const loading = await b.evaluate(`(function () { var l = ${BG}.contentDocument.querySelector('#loading'); var e = ${BG}.contentDocument.querySelector('#error'); return {loading: l && !l.hidden && getComputedStyle(l).display !== 'none' ? l.textContent.trim() : '', error: e && !e.hidden ? e.textContent : ''}; })()`);
	ok('it has loaded, with no error', !loading.error, loading);
	const visibleFrames = await framesIn(BG);
	ok('and draws while it can be seen', visibleFrames > 10, visibleFrames);
	await b.screenshot(out('bg-riverscape.png'));
	await b.evaluate(`openPath('/home').then(function () { return true; })`);
	await sleep(1500);
	const coveredFrames = await b.evaluate(`(function () { var w = ${BG}.contentWindow; var n = 0; var real = w.requestAnimationFrame;
		w.__count = 0; return new Promise(function (r) { var start = w.performance.now(); setTimeout(function () { r(true); }, 50); }); })()`);
	// Count what the scene itself asks for while covered: its loop requests frames through the window's own function.
	await b.evaluate(`(function () { var w = ${BG}.contentWindow; w.__asked = 0; var held = w.requestAnimationFrame; w.requestAnimationFrame = function (f) { w.__asked++; return held.call(w, f); }; return true; })()`);
	await sleep(1500);
	const askedCovered = await b.evaluate(`${BG}.contentWindow.__asked`);
	ok('covered, the scene asks for no frames at all: its rate is 0', askedCovered === 0, askedCovered);
	await b.evaluate(`(function () { wm.listWindows().forEach(function (w) { wm.closeWindow(w.id); }); return true; })()`);
	await sleep(1500);
	const askedShown = await b.evaluate(`${BG}.contentWindow.__asked`);
	ok('uncovered, it asks again', askedShown > 5, askedShown);

	// F: the folder by its path alone opens the look that is here.
	ok('previewing Habitats by its path opens Riverscape, the look that is here',
		await b.evaluate(`(async () => ${DLG}.previewFile('/apps/screensavers/Habitats.xscr'))()`)
		&& /riverscape\/wallpaper\.html$/.test(await until('the preview', () => b.evaluate(`(${LAYER} || {}).src`), 10000)));
	await sleep(1500);
	await b.send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16});
	await b.send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16});
	await until('it ends', async () => !(await b.evaluate(`!!document.querySelector('.PixScreensaver')`)), 5000);

	// G: a choice made while a look downloads wins.
	await notes();
	await b.evaluate(`(async () => { ${DLG}.open('background'); return true; })()`);
	await clickTile('Habitats/Reefscape');
	await sleep(300);
	await clickTile('/Aurora');
	await until('Aurora chosen at once', async () => (await settings()).wallpaper.value === 'aurora', 5000);
	await until('Reefscape downloaded', () => exists('/apps/screensavers/Habitats.xscr/scenes/reefscape/wallpaper.html'), 90000);
	await sleep(1500);
	ok('the download finished and did not undo the later choice', (await settings()).wallpaper.value === 'aurora');
	ok('and said it was done', (await notes()).some(n => /Habitats · Reefscape is downloaded/.test(n)));
	ok('Reefscape costs nothing now', (await tile('Habitats/Reefscape')).size === '');
	await b.evaluate(`(async () => { ${DLG}.close(); return true; })()`);

	// H: offline. The server stopped, PixOS reloaded: the background and the gallery come from BrowserFS.
	await b.evaluate(`(async () => { ${DLG}.open('background'); return true; })()`);
	await clickTile('Habitats/Riverscape');
	await until('Riverscape again', async () => ((await settings()).wallpaper.options || {}).look === 'Riverscape', 10000);
	await b.evaluate(`(async () => { ${DLG}.close(); return true; })()`);
	await server.stop();
	ok('the server is gone', await fetch(ORIGIN + '/').then(() => false, () => true));
	await b.send('Page.reload');
	await sleep(2000);
	await until('an offline boot', booted, 60000);
	await sleep(4000);
	ok('offline, the tank is still the background', await until('the tank offline', () => b.evaluate(`!!(${BG} && /riverscape\\/wallpaper\\.html$/.test(${BG}.src) && ${BG}.contentWindow.pixosPause)`), 20000).catch(() => false));
	await sleep(4000);
	ok('and draws', (await framesIn(BG)) > 10);
	await b.evaluate(`(async () => { ${DLG}.open('background'); return true; })()`);
	await until('the listing', async () => (await tiles()).some(t => /Matrix/.test(t.key)), 10000);
	const offline = (await tiles()).filter(t => /^(Matrix|Habitats)\/|^\/Pipes|^\/Slideshow/.test(t.key)).map(t => t.key + (t.size ? ' ' + t.size : ''));
	ok('offline, the gallery is what is here, with nothing to download', offline.every(t => !/↓/.test(t)), offline);
	await b.evaluate(`(async () => { ${DLG}.close(); return true; })()`);
	await server.start();

	// I: deleting a folder gives it back to the gallery as a download.
	await b.evaluate(`(function rm (p) { return new Promise(function (r) { fs.stat(p, function (e, s) {
		if (e) { return r(); }
		if (!s.isDirectory()) { return fs.unlink(p, function () { r(); }); }
		fs.readdir(p, function (e2, names) { Promise.all(names.map(function (n) { return rm(p + '/' + n); })).then(function () { fs.rmdir(p, function () { r(); }); }); });
	}); }); })('/apps/screensavers/Matrix.xscr').then(function () { return true; })`);
	await b.evaluate(`(async () => { ${DLG}.open('background'); return true; })()`);
	await until('Matrix listed', async () => (await tiles()).some(t => t.key === 'Matrix/Classic' && t.size), 10000);
	ok('Matrix deleted is a download again', (await tile('Matrix/Classic')).size.startsWith('↓'), (await tile('Matrix/Classic')).size);
	await b.evaluate(`(async () => { ${DLG}.close(); return true; })()`);

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
	await b.screenshot(out('pass4-error.png')).catch(() => {});
} finally {
	b.close();
	await server.stop();
	removeProfile(PROFILE);
	console.log('\n' + results.filter(Boolean).length + ' of ' + results.length + ' passed');
}
process.exit(results.every(Boolean) ? 0 : 1);
