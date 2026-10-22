// Phase 27 pass 2, the measurements the plan puts before any of Display is built
// (docs/settings-plan.md, "A filter on an ancestor changes layout" and "Interface scale"):
//   1. docs/checks/zoom-and-filter.html: what CSS zoom and a filter do to where a box is drawn
//   2. a real boot with Aurora as the background: the shell's frame rate with no filter, with a filter
//      on #shell, and with a backdrop-filter layer on top -- on the empty desktop, where Aurora draws,
//      and with a window open
//   3. whether a window's frame still sits on its placeholder under the filter
//   4. Golden Layout given a taller header at run time (headerHeight + updateSize), and whether the
//      layout's saved config carries it
// It prints what it measured; the checks it can make are counted, the timings are only printed.
import {launch, sleep, serve, ORIGIN, out, profileDir, removeProfile} from './cdp.mjs';

const results = [];
function check (name, got, want) {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	results.push(ok);
	console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
}

const FILTER = 'brightness(0.8) contrast(1.1) saturate(1.2)';
// The shell's own animation frames over `ms`: how many, and the gaps between them.
const frames = ms => `new Promise(resolve => {
	const times = [];
	const end = performance.now() + ${ms};
	const tick = t => { times.push(t); if (t < end) { requestAnimationFrame(tick); } else { finish(); } };
	const finish = () => {
		const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
		const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
		resolve({fps: Math.round(1000 / mean * 10) / 10, p95: Math.round(gaps[Math.floor(gaps.length * 0.95)] * 10) / 10, max: Math.round(gaps[gaps.length - 1] * 10) / 10});
	};
	requestAnimationFrame(tick);
})`;
const setFilter = mode => `(() => {
	const shell = document.getElementById('shell');
	shell.style.filter = ${JSON.stringify(mode === 'filter' ? FILTER : '')};
	let veil = document.getElementById('measure-veil');
	if (${JSON.stringify(mode)} === 'backdrop' && !veil) {
		veil = document.createElement('div');
		veil.id = 'measure-veil';
		veil.style.cssText = 'position: fixed; inset: 0; z-index: 1000; pointer-events: none; backdrop-filter: ${FILTER}';
		document.body.append(veil);
	}
	if (${JSON.stringify(mode)} !== 'backdrop' && veil) { veil.remove(); }
	return true;
})()`;

const server = await serve();
const profile = profileDir('p27-2-display-measure');
const browser = await launch({profile});
try {
	console.log('\n1. zoom and filter on a plain page (docs/checks/zoom-and-filter.html)');
	const plain = await browser.page(ORIGIN + '/docs/checks/zoom-and-filter.html');
	const rows = await plain.until('window.checkResult', 15000);
	rows.forEach(r => console.log('  ' + r.check + ': expected ' + r.expected + ', measured ' + r.measured));
	await plain.send('Page.close').catch(() => null);

	console.log('\n2. a real boot, Aurora as the background');
	const a = await browser.page(ORIGIN + '/');
	await a.until("!!document.querySelector('.PixTaskbar__start') && typeof window.setWallpaper === 'function' && !!document.querySelector('.PixDesktop__wallpaper')", 60000);
	await sleep(1500);
	console.log('  GPU: ' + await a.eval("(() => { const g = document.createElement('canvas').getContext('webgl'); const i = g && g.getExtension('WEBGL_debug_renderer_info'); return i ? g.getParameter(i.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()"));
	// A fresh profile may open a window of its own, and a covered background is paused.
	await a.eval("wm.listWindows().forEach(w => wm.closeWindow(w.id)), true");
	await a.eval("window.setWallpaper({type: 'shader', value: 'aurora'}).then(() => true)");
	await a.until("!!document.querySelector('.PixDesktop__wallpaper canvas')", 15000);
	await sleep(2000);
	for (const mode of ['none', 'filter', 'backdrop']) {
		await a.eval(setFilter(mode));
		await sleep(500);
		console.log('  empty desktop, Aurora drawing, ' + mode + ': ' + JSON.stringify(await a.eval(frames(4000))));
	}
	await a.eval(setFilter('filter'));
	await sleep(300);
	await a.screenshot(out('p27-2-measure-filter.png'));
	await a.eval(setFilter('none'));

	await a.eval("openApp('explorer').then(() => true)");
	await a.until("wm.listWindows().some(w => w.appId === 'explorer')", 15000);
	await sleep(2500);
	const placed = `(() => {
		const w = wm.listWindows().find(x => x.appId === 'explorer');
		const frame = wm.getFrame(w.id).getBoundingClientRect();
		const holder = wm.windows.get(w.id).container.getElement()[0].getBoundingClientRect();
		const r = x => [Math.round(x.left), Math.round(x.top), Math.round(x.width), Math.round(x.height)];
		return {frame: r(frame), placeholder: r(holder), header: Math.round(document.querySelector('.lm_header').getBoundingClientRect().height)};
	})()`;
	const before = await a.eval(placed);
	for (const mode of ['none', 'filter', 'backdrop']) {
		await a.eval(setFilter(mode));
		await sleep(500);
		console.log('  one window open (background paused), ' + mode + ': ' + JSON.stringify(await a.eval(frames(3000))));
	}

	console.log('\n3. a window under the filter');
	await a.eval(setFilter('filter'));
	await a.eval("window.dispatchEvent(new Event('resize'))");
	await sleep(500);
	const filtered = await a.eval(placed);
	console.log('  without: ' + JSON.stringify(before) + '\n  with:    ' + JSON.stringify(filtered));
	check('the frame sits on its placeholder without the filter', before.frame, before.placeholder);
	check('and with the filter on #shell', filtered.frame, filtered.placeholder);
	check('the filter moved nothing', filtered.frame, before.frame);
	await a.eval(setFilter('none'));

	console.log('\n4. Golden Layout given a taller header at run time');
	await a.eval("(() => { wm.workspaces.forEach(w => { w.layout.config.dimensions.headerHeight = 25; w.layout.updateSize(); }); return true; })()");
	await sleep(500);
	await a.eval("wm.syncGeometry(), true");
	await sleep(300);
	const taller = await a.eval(placed);
	console.log('  ' + JSON.stringify(taller));
	check('the header is 25 px', taller.header, 25);
	check('the frame still sits on its placeholder', taller.frame, taller.placeholder);
	check('which starts 5 px lower than before', taller.placeholder[1] - before.placeholder[1], 5);
	check('the saved config carries the height', await a.eval("[...wm.workspaces.values()][0].layout.toConfig().dimensions.headerHeight"), 25);
	await a.screenshot(out('p27-2-measure-header.png'));
	console.log('  errors on the page: ' + (a.errors.length ? a.errors.join('\n    ') : 'none'));
} catch (e) {
	results.push(false);
	console.log('  ERROR ' + e.message);
} finally {
	console.log('p27-2-display-measure: ' + results.filter(Boolean).length + ' of ' + results.length);
	browser.close();
	await server.stop();
	removeProfile(profile);
}
process.exit(results.length && results.every(Boolean) ? 0 : 1);
