// Phase 26, pass 3 (Explorer), in a real boot of PixOS in headless Chrome.
import {launchPage, sleep, until, serve, ORIGIN, REPO, out, profileDir, removeProfile} from './cdp.mjs';

const results = [];
const ok = (label, value) => { results.push([value ? 'ok  ' : 'FAIL', label]); console.log((value ? '  ok   ' : '  FAIL ') + label); };

const server = await serve();
const PROFILE = profileDir('p26-3-explorer');
const b = await launchPage(PROFILE);
const SS = `(await import('/js/shell/screensaver.js'))`;
const running = () => b.evaluate(`(async () => ${SS}.isRunning())()`);
const layerThere = () => b.evaluate(`!!document.querySelector('.PixScreensaver')`);
const key = async (type, k, code, vk, modifiers) => b.send('Input.dispatchKeyEvent', {type, key: k, code, windowsVirtualKeyCode: vk, modifiers: modifiers || 0});
const press = async (k, code, vk, modifiers) => { await key('keyDown', k, code, vk, modifiers); await key('keyUp', k, code, vk, modifiers); };
const clickAt = async (x, y, button, count) => {
	await b.mouse('mouseMoved', x, y);
	await b.mouse('mousePressed', x, y, button || 'left', count || 1);
	await b.mouse('mouseReleased', x, y, button || 'left', count || 1);
};
const dblclickAt = async (x, y) => { await clickAt(x, y, 'left', 1); await clickAt(x, y, 'left', 2); };
const settingsFile = () => b.evaluate(`new Promise(function (r) { fs.readFile('/settings/desktop.json', 'utf8', function (e, t) { r(e ? null : JSON.parse(t)); }); })`);
const put = (target, url) => b.evaluate(`fetch(${JSON.stringify(url)}).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
	return new Promise(function (resolve) { fs.writeFile(${JSON.stringify(target)}, Buffer.from(buf), function (e) { resolve(!e); }); });
})`);
const mkdir = dir => b.evaluate(`new Promise(function (r) { fs.mkdir(${JSON.stringify(dir)}, function () { r(true); }); })`);

// Explorer windows, by the folder they were opened on; `n` is which one.
const EXP = n => `(function () { var ws = wm.listWindows().filter(function (x) { return x.appId === 'explorer'; }); var w = ws[${n || 0}]; return w && wm.getFrame(w.id); })()`;
const inExp = (n, body) => b.evaluate(`(function () { var f = ${EXP(n)}; var d = f.contentDocument; var fr = f.getBoundingClientRect(); ${body} })()`);
const rowAt = (n, p) => inExp(n, `var row = d.querySelector('.Explorer__row[data-path=' + JSON.stringify(${JSON.stringify(p)}) + ']');
	if (!row) { return null; } var r = row.children[1].getBoundingClientRect();
	return {x: fr.left + r.left + 30, y: fr.top + r.top + r.height / 2, mark: (row.children[1].innerHTML.match(/Explorer__kind--(\\w+)/) || [])[1], type: row.children[2].textContent, selected: row.classList.contains('Explorer__row--selected')};`);
const menuLabels = n => inExp(n, `var m = d.querySelector('.ContextMenu'); if (!m) { return null; }
	return Array.from(m.querySelectorAll('.ContextMenu__list > .ContextMenu__item, .ContextMenu__list > .ContextMenu__separator')).map(function (li) {
		return li.classList.contains('ContextMenu__separator') ? '---' : li.firstChild.textContent; });`);
const menuItem = (n, label) => inExp(n, `var m = d.querySelector('.ContextMenu'); if (!m) { return null; }
	var li = Array.from(m.querySelectorAll('.ContextMenu__item')).find(function (x) { return x.firstChild.textContent === ${JSON.stringify(label)}; });
	if (!li) { return null; } var r = li.getBoundingClientRect(); return {x: fr.left + r.left + 12, y: fr.top + r.top + r.height / 2};`);
const idlePermission = () => b.evaluate(`navigator.permissions.query({name: 'idle-detection'}).then(function (s) { return s.state; }, function () { return 'unknown'; })`);

try {
	await b.send('Page.navigate', {url: ORIGIN + '/'});
	await until('boot', () => b.evaluate(`!!(window.wm && navigator.serviceWorker.controller && document.querySelector('.PixDesktop__wallpaper'))`), 60000);
	await b.send('Page.reload');
	await sleep(1500);
	await until('boot again', () => b.evaluate(`!!(window.wm && navigator.serviceWorker.controller && document.querySelector('.PixDesktop__wallpaper'))`), 60000);
	await sleep(2000);
	await b.evaluate(`(function(){ wm.listWindows().forEach(function (w) { wm.closeWindow(w.id); }); return true; })()`);

	// Two screensavers of the user's own in /home: a page, and a folder holding one. And a plain page.
	ok('a page put in /home', await put('/home/Trail.xscr.html', '/docs/checks/Trail.xscr.html'));
	await mkdir('/home/Rain.xscr');
	ok('and a folder one', await put('/home/Rain.xscr/index.html', '/docs/checks/Trail.xscr.html'));
	ok('and a plain page and a picture', (await put('/home/page.html', '/docs/checks/Trail.xscr.html')) && (await put('/home/icon.svg', '/apps/explorer/favicon.svg')));
	ok('the new Explorer was copied in', await b.evaluate(`new Promise(function (r) { fs.readFile('/apps/explorer/js/format.js', 'utf8', function (e, t) { r(!e && t.indexOf('function isScreensaver') > -1); }); })`));

	await b.evaluate(`openPath('/home').then(function () { return true; })`);
	await until('Explorer in /home', () => rowAt(0, '/home/Trail.xscr.html'), 20000);
	await sleep(800);

	// --- the mark -------------------------------------------------------------------------------
	const trail = await rowAt(0, '/home/Trail.xscr.html');
	const rain = await rowAt(0, '/home/Rain.xscr');
	const plain = await rowAt(0, '/home/page.html');
	ok('the page is drawn with the screensaver mark, typed Screensaver', trail.mark === 'scr' && trail.type === 'Screensaver');
	ok('so is the folder', rain.mark === 'scr' && rain.type === 'Screensaver');
	ok('a plain page is a document, typed html', plain.mark === 'doc' && plain.type === 'html');
	const markBox = await inExp(0, `var k = d.querySelector('.Explorer__row[data-path="/home/Rain.xscr"] .Explorer__kind'); var r = k.getBoundingClientRect();
		var after = getComputedStyle(k, '::after'); return {w: r.width, h: r.height, stand: after.borderTopWidth + ' ' + after.borderTopStyle + ' ' + after.borderTopColor, frame: getComputedStyle(k).borderTopColor};`);
	console.log('        mark: ' + JSON.stringify(markBox));
	ok('the mark is a landscape screen with a stand in the frame\'s colour', markBox.w === 11 && markBox.h === 8 && /^1px solid/.test(markBox.stand) && markBox.stand.endsWith(markBox.frame));
	await b.screenshot(out('explorer-marks.png'));

	// --- double-click previews ------------------------------------------------------------------
	await dblclickAt(trail.x, trail.y);
	await sleep(700);
	ok('a double-click on the page previews it', await running());
	ok('in the layer, from the file', await b.evaluate(`(function () { var f = document.querySelector('.PixScreensaver iframe'); return !!f && new URL(f.src).pathname === '/__browserfs__/home/Trail.xscr.html'; })()`));
	ok('nothing opened a window for it', await b.evaluate(`wm.listWindows().length === 1`));
	ok('the layer has the focus', await b.evaluate(`document.activeElement === document.querySelector('.PixScreensaver')`));
	await sleep(1400);
	await b.screenshot(out('explorer-preview.png'));
	await b.mouse('mouseMoved', trail.x + 3, trail.y + 1);
	await sleep(150);
	await b.mouse('mouseMoved', trail.x + 90, trail.y + 60);
	await sleep(600);
	ok('a real move ends it', !(await running()) && !(await layerThere()));
	ok('and Explorer has the focus back', await b.evaluate(`document.activeElement === ${EXP(0)}`));

	// --- Enter on the folder previews it, and its release does not end it -------------------------
	await clickAt(rain.x, rain.y);
	await sleep(300);
	ok('the folder selected by a click', (await rowAt(0, '/home/Rain.xscr')).selected);
	await press('Enter', 'Enter', 13);
	await sleep(700);
	ok('Enter previews the folder one', await running());
	ok('from its index.html', await b.evaluate(`(function () { var f = document.querySelector('.PixScreensaver iframe'); return !!f && /\\/home\\/Rain\\.xscr\\/index\\.html$/.test(f.getAttribute('src') || f.src); })()`));
	await sleep(600);
	ok('the release of Enter did not end it', await running());
	await press('a', 'KeyA', 65);
	await sleep(600);
	ok('a key does', !(await running()));
	ok('and Explorer did not go into the folder', !!(await rowAt(0, '/home/Trail.xscr.html')));

	// --- the folder's menu, and Show contents -----------------------------------------------------
	await clickAt(rain.x, rain.y, 'right');
	await sleep(400);
	const dirMenu = await menuLabels(0);
	console.log('        folder menu: ' + JSON.stringify(dirMenu));
	ok('the folder\'s menu starts Preview, Show contents', dirMenu && dirMenu[0] === 'Preview' && dirMenu[1] === 'Show contents');
	ok('and has the shell\'s three together', dirMenu && dirMenu.join('|').indexOf('---|Add to bookmarks|Set as wallpaper|Set as screensaver') > -1);
	await b.screenshot(out('explorer-menu-folder.png'));
	const show = await menuItem(0, 'Show contents');
	await clickAt(show.x, show.y);
	await until('Explorer inside the folder', () => rowAt(0, '/home/Rain.xscr/index.html'), 5000).catch(() => null);
	ok('Show contents goes in', !!(await rowAt(0, '/home/Rain.xscr/index.html')));
	ok('where its index.html is a plain page', (await rowAt(0, '/home/Rain.xscr/index.html') || {}).mark === 'doc');
	ok('and nothing is previewed', !(await running()));
	await press('ArrowUp', 'ArrowUp', 38, 1);   // Alt+Up, if Explorer takes it; otherwise the rail's Up
	await sleep(300);
	if (!(await rowAt(0, '/home/Trail.xscr.html'))) {
		await inExp(0, `d.querySelector('.Explorer__up, [aria-label="Up"]').click(); return true;`);
	}
	await until('back in /home', () => rowAt(0, '/home/Trail.xscr.html'), 5000);

	// --- Set as screensaver, in a real click on Explorer's menu -----------------------------------
	ok('idle detection not asked yet', (await idlePermission()) === 'prompt');
	const trail2 = await rowAt(0, '/home/Trail.xscr.html');
	await clickAt(trail2.x, trail2.y, 'right');
	await sleep(400);
	const fileMenu = await menuLabels(0);
	console.log('        page menu: ' + JSON.stringify(fileMenu));
	ok('the page\'s menu starts Preview, Open with...', fileMenu && fileMenu[0] === 'Preview' && fileMenu[1] === 'Open with...');
	ok('and ends with the shell\'s three', fileMenu && fileMenu.slice(-4).join('|') === '---|Add to bookmarks|Set as wallpaper|Set as screensaver');
	await b.screenshot(out('explorer-menu-page.png'));
	const setSaver = await menuItem(0, 'Set as screensaver');
	await clickAt(setSaver.x, setSaver.y);
	await sleep(1000);
	const saverNow = await b.evaluate(`(async () => ${SS}.getSettings())()`);
	ok('Set as screensaver sets it', saverNow.show && saverNow.show.type === 'page' && saverNow.show.value === '/home/Trail.xscr.html');
	ok('and writes it down', ((await settingsFile()) || {}).screensaver.show.value === '/home/Trail.xscr.html');
	const perm = await idlePermission();
	console.log('        idle detection after the click in Explorer: ' + perm);
	ok('the permission was asked in that click -- headless Chrome answers it with a denial, not a refusal to ask', perm === 'denied');
	const note = await b.evaluate(`(function () { var n = Array.from(document.querySelectorAll('.PixNote')).pop(); return n ? {text: n.textContent, buttons: Array.from(n.querySelectorAll('.PixNote__actions button')).map(function (x) { return x.textContent; })} : null; })()`);
	console.log('        note: ' + JSON.stringify(note));
	ok('a note says so, and when it starts', !!note && /Trail is the screensaver/.test(note.text) && /after 5 minutes/.test(note.text));
	ok('with Preview and Screensaver...', !!note && JSON.stringify(note.buttons) === JSON.stringify(['Preview', 'Screensaver...']));
	await b.screenshot(out('explorer-note.png'));
	const previewButton = await b.evaluate(`(function () { var n = Array.from(document.querySelectorAll('.PixNote')).pop(); var btn = Array.from(n.querySelectorAll('button')).find(function (x) { return x.textContent === 'Preview'; }); var r = btn.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; })()`);
	await clickAt(previewButton.x, previewButton.y);
	await sleep(700);
	ok('its Preview shows it', await running());
	await press('Escape', 'Escape', 27);
	await sleep(600);
	ok('and Escape ends it', !(await running()));

	// --- Set as wallpaper, for the folder and for a picture --------------------------------------
	const rain2 = await rowAt(0, '/home/Rain.xscr');
	await clickAt(rain2.x, rain2.y, 'right');
	await sleep(400);
	const setWall = await menuItem(0, 'Set as wallpaper');
	await clickAt(setWall.x, setWall.y);
	await sleep(1000);
	const wallNow = await b.evaluate(`(async () => (await import('/js/shell/desktop.js')).getWallpaper())()`);
	ok('Set as wallpaper on the folder makes it the background', wallNow && wallNow.type === 'page' && wallNow.value === '/home/Rain.xscr');
	ok('written down', ((await settingsFile()) || {}).wallpaper.value === '/home/Rain.xscr');
	ok('and the screensaver is still the page', (await b.evaluate(`(async () => ${SS}.getSettings().show.value)()`)) === '/home/Trail.xscr.html');
	const icon = await rowAt(0, '/home/icon.svg');
	await clickAt(icon.x, icon.y, 'right');
	await sleep(400);
	const imageMenu = await menuLabels(0);
	ok('a picture\'s menu has Set as wallpaper and no Set as screensaver', imageMenu.includes('Set as wallpaper') && !imageMenu.includes('Set as screensaver') && imageMenu[0] === 'Open');
	const setImage = await menuItem(0, 'Set as wallpaper');
	await clickAt(setImage.x, setImage.y);
	await sleep(800);
	const wallImage = await b.evaluate(`(async () => (await import('/js/shell/desktop.js')).getWallpaper())()`);
	ok('which still sets it, covering', wallImage && wallImage.type === 'image' && wallImage.value === '/home/icon.svg' && wallImage.options.fit === 'cover');
	const plainMenu = await (async () => { const p = await rowAt(0, '/home/page.html'); await clickAt(p.x, p.y, 'right'); await sleep(400); return menuLabels(0); })();
	ok('a plain page is opened, and set as nothing', plainMenu[0] === 'Open' && !plainMenu.some(l => /^Set as/.test(l)));
	await press('Escape', 'Escape', 27);

	// --- the slideshow keeps its folder ------------------------------------------------------------
	await b.evaluate(`(async () => { var d = await import('/js/shell/wallpaper-dialog.js'); await ${SS}.setSettings({show: d.slideshowConfig('/home/pictures')}); return true; })()`);
	await b.evaluate(`openPath('/apps/screensavers').then(function () { return true; })`);
	await until('a second Explorer in /apps/screensavers', () => rowAt(1, '/apps/screensavers/Slideshow.xscr'), 20000);
	await sleep(600);
	const slide = await rowAt(1, '/apps/screensavers/Slideshow.xscr');
	ok('the slideshow PixOS ships has the mark too', slide.mark === 'scr' && slide.type === 'Screensaver');
	await clickAt(slide.x, slide.y, 'right');
	await sleep(400);
	const setSlide = await menuItem(1, 'Set as screensaver');
	await clickAt(setSlide.x, setSlide.y);
	await sleep(800);
	const kept = await b.evaluate(`(async () => { var d = await import('/js/shell/wallpaper-dialog.js'); return d.slideshowFolder(${SS}.getSettings().show); })()`);
	ok('Set as screensaver on the slideshow that is the screensaver keeps its folder (' + kept + ')', kept === '/home/pictures');

	// --- an open dialog shows a choice made from Explorer -----------------------------------------
	await b.evaluate(`(async () => (await import('/js/shell/wallpaper-dialog.js')).open('background'))().then(function () { return true; }, function () { return true; })`);
	await sleep(500);
	await b.evaluate(`window.setWallpaperPage('/home/Trail.xscr.html').then(function () { return true; })`);
	await sleep(500);
	const active = await b.evaluate(`Array.from(document.querySelectorAll('.PixSettings .PixSwatch--active')).map(function (t) { return t.title; })`);
	ok('the dialog open on Background marks what Explorer just set (' + active.join(', ') + ')', JSON.stringify(active) === JSON.stringify(['Trail']));
	await b.screenshot(out('dialog-after-explorer.png'));
	await press('Escape', 'Escape', 27);

	// --- the grid view draws the mark too -----------------------------------------------------------
	await inExp(0, `var g = d.querySelector('[aria-label="Grid"], .Explorer__viewGrid, [title^="Grid"]'); if (g) { g.click(); } return !!g;`);
	await sleep(400);
	const cardMark = await inExp(0, `var c = d.querySelector('.Explorer__card[data-path="/home/Rain.xscr"] .Explorer__kind'); return c ? c.className : null;`);
	ok('a card has the mark (' + cardMark + ')', /Explorer__kind--scr/.test(cardMark || ''));
	await b.screenshot(out('explorer-grid.png'));

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
