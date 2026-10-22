// PixOS served from a folder (http://host/<repo folder>/) rather than from the root: the worker's scope is
// that folder, so anything the browser *navigates* to has to be addressed inside it. Slideshow (preinstalled)
// and Riverscape chosen in the Settings gallery (downloaded first) both load as the background, and no
// /__browserfs__ request reaches the server. See "Anything the browser navigates to" in docs/not-so-simple.md.
import path from 'node:path';
import {launch, sleep, serve, REPO, out, profileDir, removeProfile} from './cdp.mjs';

const results = [];
function check (name, got, want) {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	results.push(ok);
	console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
}

const FOLDER = '/' + path.basename(REPO) + '/';
const server = await serve({root: path.dirname(REPO), port: 8124});
const profile = profileDir('served-from-folder');
const browser = await launch({profile});
try {
	const a = await browser.page();
	// Every response that failed, and whether the worker or the server gave it.
	const failed = [];
	await a.send('Network.enable');
	browser.on(msg => {
		if (msg.sessionId === a.sessionId && msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
			const r = msg.params.response;
			failed.push(r.status + (r.fromServiceWorker ? ' worker ' : ' server ') + r.url.replace(server.origin, ''));
		}
	});
	await a.goto(server.origin + FOLDER);
	await a.until("!!document.querySelector('.PixTaskbar__start') && typeof window.setWallpaperPage === 'function' && !!document.querySelector('.PixDesktop__wallpaper')", 60000);
	await sleep(1500);
	check('the shell is in its folder, under the worker', await a.eval('[location.pathname, !!navigator.serviceWorker.controller]'), [FOLDER, true]);

	const frame = "(() => { const f = document.querySelector('.PixDesktop__wallpaper iframe'); if (!f || !f.contentWindow) { return null; } "
		+ "try { const nav = f.contentWindow.performance.getEntriesByType('navigation')[0]; return nav && nav.responseStatus ? {path: f.contentWindow.location.pathname, status: nav.responseStatus} : null; } catch (e) { return {blocked: String(e)}; } })()";
	const loaded = part => a.until(`(${frame}) && (${frame}).path.includes(${JSON.stringify(part)}) ? ${frame} : null`, 120000);

	await a.eval("window.setWallpaperPage('/apps/screensavers/Slideshow.xscr')");
	check('Slideshow, preinstalled, loads inside the folder', await loaded('Slideshow'),
		{path: FOLDER + '__browserfs__/apps/screensavers/Slideshow.xscr/index.html', status: 200});

	await a.eval("document.querySelector('.PixTaskbar__start').click()");
	await a.until("!!document.querySelector('.PixStart__action')");
	await a.eval("[...document.querySelectorAll('.PixStart__action')].find(b => b.textContent.trim() === 'Wallpaper...').click()");
	await a.until("[...document.querySelectorAll('.PixSwatch')].some(b => /Riverscape/.test(b.textContent))", 20000);
	await a.eval("[...document.querySelectorAll('.PixSwatch')].find(b => /Riverscape/.test(b.textContent)).click()");
	check('Riverscape, chosen in the gallery, is downloaded and loads inside the folder', await loaded('riverscape'),
		{path: FOLDER + '__browserfs__/apps/screensavers/Habitats.xscr/scenes/riverscape/wallpaper.html', status: 200});
	await sleep(3000);
	// Slideshow has no looks.json, and the worker's 404 is how the page learns it has no looks.
	check('the one failure is Slideshow\'s looks.json, answered by the worker; nothing reached the server', failed,
		['404 worker /__browserfs__/apps/screensavers/Slideshow.xscr/looks.json']);
	check('no errors', a.errors, []);
	await a.screenshot(out('served-from-folder.png'));
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
const failures = results.filter(ok => !ok).length;
console.log('\nserved-from-folder: ' + (results.length - failures) + ' of ' + results.length + ' passed');
process.exit(failures ? 1 : 0);
