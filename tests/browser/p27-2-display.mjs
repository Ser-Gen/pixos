// Phase 27 pass 2, end to end against a real boot in headless Chrome: the taskbar's Display button and
// its quick panel, a slider dragged and let go, Reset, the way to the page; on the page, the interface
// scale at 125% with the taskbar, the window area, Golden Layout's header, a window's frame, a context
// menu, the Start menu and the panel all where they should be; reduce motion holding Aurora still and
// taking the shell's transitions away, following the system's setting under *As the system says*; and a
// reload keeping all of it.
import {launch, sleep, serve, limit, ORIGIN, out, profileDir, removeProfile} from './cdp.mjs';

limit(240000, 'p27-2-display');

const results = [];
function check (name, got, want) {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	results.push(ok);
	console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
}
const near = (a, b) => Math.abs(a - b) <= 1.5;

const server = await serve();
const profile = profileDir('p27-2-display');
const browser = await launch({profile});
let page = null;
try {
	const a = page = await browser.page(ORIGIN + '/');
	const ready = "!!document.querySelector('.PixTray__display') && typeof window.setWallpaper === 'function' && !!document.querySelector('.PixDesktop__wallpaper')";
	await a.until(ready, 60000);
	await sleep(1500);
	await a.eval("wm.listWindows().forEach(w => wm.closeWindow(w.id)), true");

	// A file read while it is being written is empty, and JSON.parse throwing inside BrowserFS's callback
	// would leave the promise unsettled for ever: read as nothing, and the caller tries again.
	const readJson = file => `new Promise(r => window.fs.readFile('${file}', 'utf8', (e, t) => { try { r(e ? null : JSON.parse(t)); } catch (err) { r(null); } }))`;
	const rect = selector => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) { return null; } const r = e.getBoundingClientRect(); return {left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height}; })()`;
	const slide = (selector, value, letGo) => `(() => { const r = document.querySelector(${JSON.stringify(selector)}); r.value = '${value}'; r.dispatchEvent(new Event('input', {bubbles: true}));`
		+ (letGo ? ` r.dispatchEvent(new Event('change', {bubbles: true}));` : '') + ' return true; })()';
	const filter = "document.getElementById('shell').style.filter";

	console.log('\nthe quick panel');
	check('untouched, no filter at all and the scale is 1', await a.eval(`[${filter}, getComputedStyle(document.documentElement).getPropertyValue('--pixos-scale').trim()]`), ['', '1']);
	await a.eval("document.querySelector('.PixTray__display').click(), true");
	await a.until("!!document.querySelector('.PixQuick')");
	const button = await a.eval(rect('.PixTray__display'));
	let panel = await a.eval(rect('.PixQuick'));
	check('the Display button opens the panel above it, right edges together', [near(panel.right, button.right), near(panel.bottom, button.top - 4)], [true, true]);
	check('three sliders, the focus on the first', await a.eval("[[...document.querySelectorAll('.PixQuick input[type=range]')].map(r => r.dataset.key), document.activeElement.dataset.key]"),
		[['brightness', 'contrast', 'saturation'], 'brightness']);
	await a.eval(slide('.PixQuick input[data-key=brightness]', 60, false));
	check('dragged: drawn at once, nothing written', [await a.eval(filter), await a.eval(readJson('/settings/system.json'))], ['brightness(0.6)', null]);
	await a.eval(slide('.PixQuick input[data-key=brightness]', 60, true));
	const saved = await a.until(`${readJson('/settings/system.json')}.then(s => s && s.brightness === 60 ? s : null)`);
	check('let go: written', [saved.brightness, saved.contrast, saved.saturation], [60, 100, 100]);
	await a.eval(slide('.PixQuick input[data-key=saturation]', 0, true));
	await sleep(300);
	check('saturation at 0 joins it', await a.eval(filter), 'brightness(0.6) saturate(0)');
	await a.screenshot(out('p27-2-dim-grey.png'));
	await a.eval("[...document.querySelectorAll('.PixQuick .PixButton')].find(b => b.textContent === 'Reset').click(), true");
	await a.until(`${readJson('/settings/system.json')}.then(s => s && s.brightness === 100 && s.saturation === 100)`);
	check('Reset: no filter again, the sliders back', [await a.eval(filter), await a.eval("[...document.querySelectorAll('.PixQuick input[type=range]')].map(r => r.value)")],
		['', ['100', '100', '100']]);
	await a.key('Escape', {code: 'Escape', windowsVirtualKeyCode: 27});
	await sleep(200);
	check('Escape closes it, the focus back on its button', await a.eval("[!!document.querySelector('.PixQuick'), document.activeElement.className.includes('PixTray__display')]"), [false, true]);
	await a.eval("document.querySelector('.PixTray__display').click(), true");
	await a.until("!!document.querySelector('.PixQuick')");
	await a.click(400, 300);
	await sleep(200);
	check('a press on the desktop closes it', await a.eval("!!document.querySelector('.PixQuick')"), false);
	await a.eval("document.querySelector('.PixTray__display').click(), true");
	await a.until("!!document.querySelector('.PixQuick')");
	await a.eval("[...document.querySelectorAll('.PixQuick .PixButton')].find(b => b.textContent === 'Display settings…').click(), true");
	await a.until("!!document.querySelector('.PixSettings')");
	check('its way to the page: Settings at Display, the panel gone', await a.eval("[document.querySelector('.PixSettings__heading').textContent, !!document.querySelector('.PixQuick')]"),
		['Display', false]);
	check('Display comes first in the sidebar', await a.eval("document.querySelector('.PixSettings__page').textContent"), 'Display');

	console.log('\nthe interface scale at 125%');
	await a.eval("(r => { r.checked = true; r.dispatchEvent(new Event('change', {bubbles: true})); })(document.querySelector('.PixSettings input[data-key=\"scale-125\"]')), true");
	await a.until(`${readJson('/settings/system.json')}.then(s => s && s.scale === 125)`);
	await sleep(400);
	check('set and written; the scale is 1.25', await a.eval("getComputedStyle(document.documentElement).getPropertyValue('--pixos-scale').trim()"), '1.25');
	const settingsBox = await a.eval(rect('.PixSettings'));
	const viewport = await a.eval('({w: innerWidth, h: innerHeight})');
	check('the Settings window is still inside the screen, and centred', [settingsBox.left >= 0, settingsBox.right <= viewport.w, settingsBox.top >= 0, settingsBox.bottom <= viewport.h,
		near((settingsBox.left + settingsBox.right) / 2, viewport.w / 2)], [true, true, true, true, true]);
	await a.screenshot(out('p27-2-scale-settings.png'));
	await a.key('Escape', {code: 'Escape', windowsVirtualKeyCode: 27});
	await sleep(200);
	const bar = await a.eval(rect('.PixTaskbar'));
	const root = await a.eval(rect('#root'));
	check('the taskbar is 38 px drawn 1.25 times, still at the bottom, still the full width', [near(bar.height, 47.5), near(bar.bottom, viewport.h), near(bar.width, viewport.w)],
		[true, true, true]);
	check('the window area ends where the taskbar starts', near(root.bottom, bar.top), true);

	await a.eval("openApp('explorer').then(() => true)");
	await a.until("wm.listWindows().some(w => w.appId === 'explorer')", 15000);
	await sleep(2500);
	const placed = await a.eval(`(() => {
		const w = wm.listWindows().find(x => x.appId === 'explorer');
		const r = x => [Math.round(x.left), Math.round(x.top), Math.round(x.width), Math.round(x.height)];
		return {frame: r(wm.getFrame(w.id).getBoundingClientRect()), placeholder: r(wm.windows.get(w.id).container.getElement()[0].getBoundingClientRect()),
			header: Math.round(document.querySelector('.lm_header').getBoundingClientRect().height),
			tab: Math.round(document.querySelector('.lm_header .lm_tab').getBoundingClientRect().bottom)};
	})()`);
	check('Golden Layout\'s header is 25 px, its tab inside it', [placed.header, placed.tab <= placed.header + 1], [25, true]);
	check('the window\'s frame sits on its placeholder, below the header', [placed.frame, placed.frame[1]], [placed.placeholder, 25]);
	check('and ends where the taskbar starts', near(placed.frame[1] + placed.frame[3], bar.top), true);
	await a.screenshot(out('p27-2-scale-window.png'));
	await a.eval("wm.listWindows().forEach(w => wm.closeWindow(w.id)), true");
	await sleep(500);

	await a.mouse('mousePressed', 600, 300, {button: 'right', clickCount: 1});
	await a.mouse('mouseReleased', 600, 300, {button: 'right', clickCount: 1});
	await a.until("!!document.querySelector('.PixMenu')");
	await sleep(200);
	let menu = await a.eval(rect('.PixMenu'));
	// Lifted when it would run past the bottom, which a menu 1.25 times as tall may.
	check('a context menu opens where the pointer is, not 1.25 times further', [near(menu.left, 600), near(menu.top, Math.min(300, viewport.h - menu.height - 6))],
		[true, true]);
	await a.key('Escape', {code: 'Escape', windowsVirtualKeyCode: 27});
	await sleep(200);
	await a.mouse('mousePressed', viewport.w - 20, viewport.h - 80, {button: 'right', clickCount: 1});
	await a.mouse('mouseReleased', viewport.w - 20, viewport.h - 80, {button: 'right', clickCount: 1});
	await a.until("!!document.querySelector('.PixMenu')");
	await sleep(200);
	menu = await a.eval(rect('.PixMenu'));
	check('and near the corner it is kept on the screen', [menu.right <= viewport.w - 5, menu.bottom <= viewport.h - 5, menu.left > 0], [true, true, true]);
	await a.screenshot(out('p27-2-scale-menu.png'));
	await a.key('Escape', {code: 'Escape', windowsVirtualKeyCode: 27});
	await a.click(300, 200);
	await sleep(200);

	await a.eval("document.querySelector('.PixTaskbar__start').click(), true");
	await a.until("!!document.querySelector('.PixStart')");
	const start = await a.eval(rect('.PixTaskbar__start'));
	const startMenu = await a.eval(rect('.PixStart'));
	check('the Start menu stands on its button', [near(startMenu.left, Math.max(6, start.left)), near(startMenu.bottom, start.top - 4)], [true, true]);
	await a.key('Escape', {code: 'Escape', windowsVirtualKeyCode: 27});
	await sleep(200);
	await a.eval("document.querySelector('.PixTray__display').click(), true");
	await a.until("!!document.querySelector('.PixQuick')");
	panel = await a.eval(rect('.PixQuick'));
	const scaledButton = await a.eval(rect('.PixTray__display'));
	check('and so does the quick panel', [near(panel.right, scaledButton.right), near(panel.bottom, scaledButton.top - 4)], [true, true]);
	await a.key('Escape', {code: 'Escape', windowsVirtualKeyCode: 27});

	console.log('\nreduce motion');
	await a.eval("window.setWallpaper({type: 'shader', value: 'aurora'}).then(() => true)");
	await a.until("!!document.querySelector('.PixDesktop__wallpaper canvas')", 15000);
	await sleep(1500);
	const shot = async () => (await a.send('Page.captureScreenshot', {format: 'png', clip: {x: 40, y: 60, width: 240, height: 240, scale: 1}})).data;
	const moving = async () => { const one = await shot(); await sleep(700); return one !== await shot(); };
	check('Aurora moves', await moving(), true);
	check('the shell\'s transitions are there', await a.eval("getComputedStyle(document.getElementById('root')).transitionDuration"), '0.18s');
	await a.eval("document.querySelector('.PixTray__display').click(), true");
	await a.until("!!document.querySelector('.PixQuick')");
	await a.eval("[...document.querySelectorAll('.PixQuick .PixButton')].find(b => b.textContent === 'Display settings…').click(), true");
	await a.until("!!document.querySelector('.PixSettings input[data-key=\"motion-on\"]')");
	await a.eval("(r => { r.checked = true; r.dispatchEvent(new Event('change', {bubbles: true})); })(document.querySelector('.PixSettings input[data-key=\"motion-on\"]')), true");
	await a.until(`${readJson('/settings/system.json')}.then(s => s && s.reduceMotion === 'on')`);
	await a.key('Escape', {code: 'Escape', windowsVirtualKeyCode: 27});
	check('on: the class is set, the shell\'s transitions gone', await a.eval("[document.documentElement.classList.contains('PixReduceMotion'), getComputedStyle(document.getElementById('root')).transitionDuration]"),
		[true, '0s']);
	await sleep(9500);
	check('and after eight seconds Aurora holds still', await moving(), false);

	await a.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]});
	await a.eval("document.querySelector('.PixTray__display').click(), true");
	await a.until("!!document.querySelector('.PixQuick')");
	await a.eval("[...document.querySelectorAll('.PixQuick .PixButton')].find(b => b.textContent === 'Display settings…').click(), true");
	await a.until("!!document.querySelector('.PixSettings input[data-key=\"motion-system\"]')");
	await a.eval("(r => { r.checked = true; r.dispatchEvent(new Event('change', {bubbles: true})); })(document.querySelector('.PixSettings input[data-key=\"motion-system\"]')), true");
	await a.until(`${readJson('/settings/system.json')}.then(s => s && s.reduceMotion === 'system')`);
	await sleep(300);
	check('as the system says, with the system asking: still on, and the page says why',
		await a.eval("[document.documentElement.classList.contains('PixReduceMotion'), [...document.querySelectorAll('.PixSettings .PixDialog__note')].some(n => n.textContent.startsWith('The system asks for less motion, so it is on.'))]"),
		[true, true]);
	await a.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'no-preference'}]});
	await sleep(300);
	check('the system changing its mind turns it off, and the page follows',
		await a.eval("[document.documentElement.classList.contains('PixReduceMotion'), [...document.querySelectorAll('.PixSettings .PixDialog__note')].some(n => n.textContent.startsWith('The system does not ask for less motion'))]"),
		[false, true]);
	await sleep(800);
	check('and Aurora moves again', await moving(), true);
	await a.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]});
	await a.eval("(r => { r.checked = true; r.dispatchEvent(new Event('change', {bubbles: true})); })(document.querySelector('.PixSettings input[data-key=\"motion-off\"]')), true");
	await a.until(`${readJson('/settings/system.json')}.then(s => s && s.reduceMotion === 'off')`);
	await sleep(300);
	check('off is off with the system asking', await a.eval("document.documentElement.classList.contains('PixReduceMotion')"), false);
	await a.send('Emulation.setEmulatedMedia', {features: []});

	console.log('\na reload');
	const step = text => console.log('  ... ' + text);
	await a.eval("document.querySelector('.PixTray__display').click(), true").catch(() => null);
	await a.until("!!document.querySelector('.PixQuick')");
	step('the panel is open');
	await a.eval(slide('.PixQuick input[data-key=contrast]', 120, true));
	step('contrast let go at 120');
	await a.eval("document.querySelector('.PixSettings input[data-key=\"motion-on\"]') && (r => { r.checked = true; r.dispatchEvent(new Event('change', {bubbles: true})); })(document.querySelector('.PixSettings input[data-key=\"motion-on\"]')), true");
	step('reduce motion chosen on');
	await a.until(`${readJson('/settings/system.json')}.then(s => s && s.contrast === 120 && s.reduceMotion === 'on')`);
	step('both written');
	await a.send('Page.reload');
	step('reloading');
	await sleep(1500);
	await a.until(ready, 60000);
	step('booted');
	await sleep(1500);
	check('after a reload: the filter, the scale, reduce motion and the header, as they were', await a.eval(`[${filter}, getComputedStyle(document.documentElement).getPropertyValue('--pixos-scale').trim(), document.documentElement.classList.contains('PixReduceMotion'), wm.headerHeight]`),
		['contrast(1.2)', '1.25', true, 25]);
	check('nothing thrown on the page', a.errors.filter(e => !/Preloading .* failed/.test(e)), []);
	if (a.errors.length) {
		console.log('  (preload notes, not counted: ' + a.errors.length + ')');
	}
} catch (e) {
	results.push(false);
	console.log('  ERROR ' + e.message);
	// What the page was showing when it stopped.
	const pages = await browser.send('Target.getTargets').catch(() => null);
	console.log('  targets: ' + JSON.stringify(pages && pages.targetInfos.filter(t => t.type === 'page').map(t => t.url)));
	if (page) {
		console.log('  state: ' + JSON.stringify(await page.eval(`(async () => ({
			file: await new Promise(r => window.fs.readFile('/settings/system.json', 'utf8', (e, t) => r(e ? String(e) : t))),
			settings: !!document.querySelector('.PixSettings'), heading: (document.querySelector('.PixSettings__heading') || {}).textContent,
			radios: [...document.querySelectorAll('.PixSettings input[type=radio]')].filter(r => r.checked).map(r => r.dataset.key),
			notes: [...document.querySelectorAll('.PixSettings .PixDialog__note')].filter(n => !n.hidden).map(n => n.textContent.slice(0, 60)),
			reduced: document.documentElement.classList.contains('PixReduceMotion'), focus: document.activeElement && document.activeElement.className
		}))()`, 10000).catch(err => err.message)));
		console.log('  errors: ' + JSON.stringify(page.errors));
	}
} finally {
	console.log('p27-2-display: ' + results.filter(Boolean).length + ' of ' + results.length);
	browser.close();
	await server.stop();
	removeProfile(profile);
}
process.exit(results.length && results.every(Boolean) ? 0 : 1);
