// Phase 26 pass 6, end to end against a real boot in headless Chrome: the dialog's three rows, a PIN
// set, a hot corner starting it locked, the pad, a reload coming back locked, a press on the
// bottom-left corner opening Start, a never corner holding off idle detection, two tabs locking and
// unlocking together, and a background held still on battery.
import {launch, sleep, serve, ORIGIN, out, profileDir, removeProfile} from './cdp.mjs';

const results = [];
function check (name, got, want) {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	results.push(ok);
	console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
}

const server = await serve();
const profile = profileDir('p26-6-corners-pin');
const browser = await launch({profile});
try {
	const a = await browser.page(ORIGIN + '/');
	const ready = "!!document.querySelector('.PixTaskbar__start') && typeof window.setScreensaverPage === 'function' && !!document.querySelector('.PixDesktop__wallpaper')";
	await a.until(ready, 60000);
	await sleep(1500);

	check('a fresh system: no lock written, no corners drawn',
		await a.eval("[localStorage.getItem('pixos:screensaver-lock'), document.querySelectorAll('.PixHotCorner').length]"), [null, 0]);

	const openDialog = async page => {
		await page.eval("document.querySelector('.PixTaskbar__start').click()");
		await page.until("!!document.querySelector('.PixStart__action')");
		await page.eval("[...document.querySelectorAll('.PixStart__action')].find(b => b.textContent.trim() === 'Screensaver...').click()");
		await page.until("!!document.querySelector('.PixSettings')");
		// The dialog draws itself again when the catalog's list arrives.
		await sleep(800);
	};
	const labels = "[...document.querySelectorAll('.PixDialog__label')].map(l => l.textContent)";

	await openDialog(a);
	check('with no screensaver chosen, no corners and no PIN; the battery row is there',
		await a.eval(labels + ".filter(t => ['Hot corners', 'PIN to wake', 'On battery'].includes(t))"), ['On battery']);
	await a.eval("[...document.querySelectorAll('.PixSwatch')].find(b => b.title === 'Blank').click()");
	await a.until("!!document.querySelector('.PixDialog__corners')");
	check('Blank chosen: the corners, the PIN and the battery rows',
		await a.eval(labels + ".filter(t => ['Hot corners', 'PIN to wake', 'On battery'].includes(t))"), ['Hot corners', 'PIN to wake', 'On battery']);
	check('the corners laid out as corners', await a.eval("[...document.querySelectorAll('.PixDialog__corners select')].map(s => s.getAttribute('aria-label'))"),
		['Top left corner', 'Top right corner', 'Bottom left corner', 'Bottom right corner']);
	check('headless Chrome is plugged in, and the row says so', await a.eval("[...document.querySelectorAll('.PixDialog__note')].map(n => n.textContent).find(t => /Plugged|browser does not say/.test(t))"),
		'Plugged in now: it moves.');

	const setPin = async (page, first, again) => {
		await page.eval(`(() => {
			const one = document.querySelector('input[aria-label="PIN"], input[aria-label="New PIN"]');
			const two = document.querySelector('input[aria-label="Again"]');
			one.value = ${JSON.stringify(first)}; two.value = ${JSON.stringify(again)};
			[...one.parentNode.querySelectorAll('button')].find(b => b.textContent === 'Set' || b.textContent === 'Change').click();
		})()`);
	};
	const pinStatus = "(() => { const s = document.querySelector('input[aria-label=\"Again\"]').closest('.PixDialog__section').querySelector('[role=status]'); return s && s.textContent; })()";
	await setPin(a, '2468', '2486');
	check('two PINs that differ are refused', await a.eval(pinStatus), 'The two do not match. Type the same PIN twice.');
	await setPin(a, '246', '246');
	check('three digits are refused', await a.eval(pinStatus), 'A PIN is four to eight digits.');
	await setPin(a, '2468', '2468');
	await a.until(pinStatus + " === 'A PIN is set.'");
	await a.eval("document.querySelector('.PixDialog__corners').scrollIntoView()");
	await a.screenshot(out('pass6-dialog.png'));
	check('set: the row says so and offers Change and Remove',
		await a.eval("[...document.querySelector('input[aria-label=\"Again\"]').parentNode.querySelectorAll('button')].map(b => b.textContent)"), ['Change', 'Remove']);
	const settings = "new Promise(r => window.fs.readFile('/settings/desktop.json', 'utf8', (e, t) => { try { r(e ? null : JSON.parse(t)); } catch (err) { r(null); } }))";
	const saved = await a.until(`${settings}.then(s => s && s.screensaver && s.screensaver.pin ? s.screensaver : null)`);
	check('written as a salt and a hash, never the PIN', [saved.pin.salt.length, saved.pin.hash.length, JSON.stringify(saved).includes('2468')], [32, 64, false]);

	const corner = async (page, name, value) => {
		await page.eval(`(() => { const s = document.querySelector('select[aria-label="${name} corner"]'); s.value = '${value}'; s.dispatchEvent(new Event('change')); })()`);
	};
	await corner(a, 'Top left', 'start');
	await a.until("!!document.querySelector('#overlays .PixHotCorner[data-corner=\"topLeft\"]')");
	check('a corner set is drawn in the overlays, three pixels',
		await a.eval("(() => { const r = document.querySelector('.PixHotCorner[data-corner=\"topLeft\"]').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()"), [0, 0, 3, 3]);
	check('and written down', (await a.eval(settings)).screensaver.corners.topLeft, 'start');
	await a.eval("document.querySelector('.PixDialog__close').click()");

	// The corner: passing through starts nothing, resting there starts it, locked.
	await a.mouse('mouseMoved', 640, 400);
	await a.mouse('mouseMoved', 1, 1);
	await sleep(120);
	await a.mouse('mouseMoved', 640, 400);
	await sleep(400);
	check('passing through the corner starts nothing', await a.eval("!!document.querySelector('.PixScreensaver')"), false);
	await a.mouse('mouseMoved', 1, 1);
	await sleep(500);
	check('resting there starts it', await a.eval("!!document.querySelector('.PixScreensaver')"), true);
	check('locked, and written down for the other tabs', await a.eval("!!localStorage.getItem('pixos:screensaver-lock')"), true);
	check('the corners go while it runs', await a.eval("document.querySelectorAll('.PixHotCorner').length"), 0);

	await sleep(1200);
	await a.key('a', {text: 'a', code: 'KeyA', windowsVirtualKeyCode: 65});
	await a.until("!!document.querySelector('.PixScreensaver__pad')");
	check('a key asks for the PIN, the field ready', await a.eval("document.activeElement === document.querySelector('.PixScreensaver__pad input')"), true);
	await a.type('1111');
	await a.key('Enter', {text: '\r', windowsVirtualKeyCode: 13});
	await a.until("document.querySelector('.PixScreensaver__padNote').textContent !== ''");
	check('a wrong PIN is refused', await a.eval("[document.querySelector('.PixScreensaver__padNote').textContent, document.querySelector('.PixScreensaver__pad input').value]"),
		['That is not the PIN.', '']);
	await a.screenshot(out('pass6-pad.png'));
	await a.type('2468');
	await a.key('Enter', {text: '\r', windowsVirtualKeyCode: 13});
	await a.until("!document.querySelector('.PixScreensaver')");
	check('the right one ends it and the lock is gone', await a.eval("[localStorage.getItem('pixos:screensaver-lock'), document.querySelectorAll('.PixHotCorner').length]"), [null, 1]);

	// Start screensaver's key, then a reload.
	await a.mouse('mouseMoved', 640, 400);
	await a.key('L', {code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 12});
	await a.until("!!document.querySelector('.PixScreensaver')");
	check('its key starts it locked too', await a.eval("!!localStorage.getItem('pixos:screensaver-lock')"), true);
	await a.send('Page.reload');
	await sleep(500);
	await a.until(ready, 60000);
	check('reloaded, it comes back locked', await a.until("!!document.querySelector('.PixScreensaver')"), true);
	await sleep(1200);
	await a.key('a', {text: 'a', code: 'KeyA', windowsVirtualKeyCode: 65});
	await a.until("!!document.querySelector('.PixScreensaver__pad')");
	await a.type('2468');
	await a.key('Enter', {text: '\r', windowsVirtualKeyCode: 13});
	await a.until("!document.querySelector('.PixScreensaver')");
	check('and opens with the PIN', await a.eval("localStorage.getItem('pixos:screensaver-lock')"), null);

	// A press on a corner is passed on to what is under it: a button of the test's own, in the shell,
	// under the overlays, in the bottom-left pixel.
	await openDialog(a);
	await corner(a, 'Bottom left', 'start');
	await a.until("!!document.querySelector('.PixHotCorner[data-corner=\"bottomLeft\"]')");
	await a.eval("document.querySelector('.PixDialog__close').click()");
	await a.eval(`(() => {
		const b = document.createElement('button');
		b.id = 'under-corner';
		b.style.cssText = 'position:fixed;left:0;bottom:0;width:20px;height:20px;z-index:250;';
		window.__pressed = {clicks: 0, downs: 0};
		b.onclick = () => window.__pressed.clicks++;
		b.onmousedown = () => window.__pressed.downs++;
		// In the shell, whose fixed position makes it a stacking context: under #overlays at 300.
		document.getElementById('shell').append(b);
	})()`);
	const bottom = await a.eval('innerHeight - 1');
	check('the corner is over it', await a.eval("document.elementFromPoint(0, innerHeight - 1).className"), 'PixHotCorner');
	await a.mouse('mouseMoved', 640, 400);
	await a.mouse('mouseMoved', 0, bottom);
	await a.click(0, bottom);
	await sleep(600);
	check('a click in the corner is passed on once, with no mousedown, and starts nothing',
		await a.eval("[window.__pressed.clicks, window.__pressed.downs, !!document.querySelector('.PixScreensaver')]"), [1, 0, false]);
	check('the corner is out of the way', await a.eval("document.elementFromPoint(0, innerHeight - 1).id"), 'under-corner');
	await sleep(2500);
	check('and stays so, starting nothing, however long the pointer rests there',
		await a.eval("[document.elementFromPoint(0, innerHeight - 1).id, !!document.querySelector('.PixScreensaver')]"), ['under-corner', false]);
	// Along the taskbar: a move over a window's frame never reaches the shell.
	await a.mouse('mouseMoved', 40, bottom - 10);
	await sleep(100);
	check('the pointer seen away from it, it is back', await a.eval("document.elementFromPoint(0, innerHeight - 1).className"), 'PixHotCorner');
	await a.eval("document.getElementById('under-corner').remove()");
	await a.mouse('mouseMoved', 640, 400);
	await sleep(300);

	// A never corner holds off idle detection.
	await openDialog(a);
	await corner(a, 'Top right', 'never');
	await a.until("!!document.querySelector('.PixHotCorner[data-corner=\"topRight\"]')");
	await a.eval("document.querySelector('.PixDialog__close').click()");
	await browser.send('Browser.grantPermissions', {origin: ORIGIN, permissions: ['idleDetection']});
	await a.send('Emulation.setIdleOverride', {isUserActive: true, isScreenUnlocked: true});
	await a.send('Page.reload');
	await sleep(500);
	await a.until(ready, 60000);
	await sleep(1500);
	await a.send('Emulation.setIdleOverride', {isUserActive: false, isScreenUnlocked: true});
	check('idle detection saying idle starts it (the control)', await a.until("!!document.querySelector('.PixScreensaver')", 5000), true);
	await sleep(1200);
	await a.send('Emulation.setIdleOverride', {isUserActive: true, isScreenUnlocked: true});
	await a.key('a', {text: 'a', code: 'KeyA', windowsVirtualKeyCode: 65});
	await a.until("!!document.querySelector('.PixScreensaver__pad')");
	await a.type('2468');
	await a.key('Enter', {text: '\r', windowsVirtualKeyCode: 13});
	await a.until("!document.querySelector('.PixScreensaver')");
	await sleep(400);
	const right = await a.eval('innerWidth - 1');
	await a.mouse('mouseMoved', 640, 400);
	await a.mouse('mouseMoved', right, 1);
	await sleep(300);
	await a.send('Emulation.setIdleOverride', {isUserActive: false, isScreenUnlocked: true});
	await sleep(2000);
	check('with the pointer resting in a never corner, idle does not start it', await a.eval("!!document.querySelector('.PixScreensaver')"), false);
	await a.send('Emulation.clearIdleOverride');

	// Two tabs.
	await a.mouse('mouseMoved', 640, 400);
	const b = await browser.page(ORIGIN + '/');
	await b.until(ready, 60000);
	await sleep(1500);
	await a.key('L', {code: 'KeyL', windowsVirtualKeyCode: 76, modifiers: 12});
	await a.until("!!document.querySelector('.PixScreensaver')");
	check('locked in one tab, the other shows it locked at once', await b.until("!!document.querySelector('.PixScreensaver')", 5000), true);
	await sleep(1200);
	await b.key('a', {text: 'a', code: 'KeyA', windowsVirtualKeyCode: 65});
	await b.until("!!document.querySelector('.PixScreensaver__pad')");
	await b.type('2468');
	await b.key('Enter', {text: '\r', windowsVirtualKeyCode: 13});
	await b.until("!document.querySelector('.PixScreensaver')");
	check('unlocked in the other, the first opens too', await a.until("!document.querySelector('.PixScreensaver')", 5000), true);
	check('the second tab had no errors', b.errors, []);
	await browser.send('Target.closeTarget', {targetId: b.targetId});
	await a.send('Page.bringToFront');

	// Battery: a fake BatteryManager and a count of animation frames, from before the page's own scripts.
	await a.send('Page.addScriptToEvaluateOnNewDocument', {source: `
		if (window === window.top) {
			const listeners = {};
			window.__battery = {charging: false, level: 0.5, chargingTime: Infinity, dischargingTime: Infinity,
				addEventListener (type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
				fire (type) { (listeners[type] || []).forEach(fn => fn()); }};
			navigator.getBattery = () => Promise.resolve(window.__battery);
			window.__frames = 0;
			const raf = window.requestAnimationFrame.bind(window);
			window.requestAnimationFrame = cb => { window.__frames++; return raf(cb); };
		}`});
	await a.send('Page.reload');
	await sleep(500);
	await a.until(ready, 60000);
	await a.send('Page.bringToFront');
	await a.eval("window.setWallpaper({type: 'shader', value: 'aurora'})");
	// Whatever the session brought back covers the desktop; a peek shows it.
	const showDesktop = () => a.eval(`(() => {
		const shell = document.getElementById('shell');
		if (!shell.classList.contains('PixShell--empty') && !shell.classList.contains('PixShell--peek')) {
			document.querySelector('.PixTaskbar__peek').click();
		}
		return shell.classList.contains('PixShell--empty') || shell.classList.contains('PixShell--peek');
	})()`);
	check('the desktop can be seen', await showDesktop(), true);
	const rate = async () => {
		const before = await a.eval('window.__frames');
		await sleep(1000);
		return (await a.eval('window.__frames')) - before;
	};
	await sleep(500);
	const moving = await rate();
	check('on battery, Aurora moves at first', moving > 20, true);
	await sleep(8000);
	const held = await rate();
	check('and holds still after eight seconds', held < 3, true);
	await openDialog(a);
	check('the dialog says why', await a.eval("[...document.querySelectorAll('.PixDialog__note')].map(n => n.textContent).find(t => /On battery now/.test(t))"),
		'On battery now: it moves for a few seconds each time it is seen, then holds still.');
	await a.eval("[...document.querySelectorAll('.PixDialog__check input')][0].click()");
	await sleep(300);
	await a.eval("document.querySelector('.PixDialog__close').click()");
	await showDesktop();
	const unheld = await rate();
	check('turned off, it moves on battery', unheld > 20, true);
	check('and that is written down', (await a.eval(settings)).stillOnBattery, false);
	await openDialog(a);
	await a.eval("[...document.querySelectorAll('.PixDialog__check input')][0].click()");
	await sleep(300);
	await a.eval("document.querySelector('.PixDialog__close').click()");
	await showDesktop();
	await sleep(9000);
	check('turned on again, it holds', (await rate()) < 3, true);
	await a.eval("window.__battery.charging = true; window.__battery.fire('chargingchange')");
	await sleep(1500);
	check('plugged in, it moves again', (await rate()) > 20, true);
	await a.screenshot(out('pass6-desktop.png'));

	check('no errors in the first tab', a.errors, []);
	console.log('frames a second: moving ' + moving + ', held ' + held + ', turned off ' + unheld);
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
console.log('\npass6 e2e: ' + (results.length - failed) + ' of ' + results.length + ' passed');
process.exit(failed ? 1 : 0);
