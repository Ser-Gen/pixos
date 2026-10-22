// A real folder on disk, dropped on the shell (the one way to get its handle with no picker),
// mounted, and a file in it opened -- in the three situations that lost it:
//   plain   nothing else going on
//   tab     a file tab of the same origin focused after the shell
//   hard    a hard reload just before (the shell now reloads itself into the worker)
//   stay    a hard reload with that one reload already spent, so the shell stays uncontrolled
import {launchPage, sleep, until, serve, ORIGIN, REPO, out, profileDir, removeProfile} from './cdp.mjs';
import fsNode from 'node:fs';
import {spawnSync} from 'node:child_process';

// With no mode named, each of the four in turn, each in a process and a profile of its own.
const MODES = ['plain', 'tab', 'hard', 'stay'];
if (!process.argv[2]) {
	const failed = MODES.filter(mode => spawnSync(process.execPath, [new URL(import.meta.url).pathname, mode], {stdio: 'inherit'}).status !== 0);
	console.log(failed.length ? '\nFAILED: ' + failed.join(', ') : '\nall four modes passed');
	process.exit(failed.length ? 1 : 0);
}
const MODE = process.argv[2];
const DISK = profileDir('disk-' + MODE);
fsNode.rmSync(DISK, {recursive: true, force: true});
fsNode.mkdirSync(DISK);
fsNode.writeFileSync(DISK + '/hello.md', '# Heading from the real disk\n\nbody text');
fsNode.writeFileSync(DISK + '/hello.txt', 'plain text from the real disk');

const server = await serve();
const PROFILE = profileDir('mount-native-folder');
const b = await launchPage(PROFILE);
const shellUp = () => b.evaluate(`!!(window.wm && window.mountManager && document.querySelector('.PixDesktop__wallpaper'))`);
const booted = () => b.evaluate(`!!(window.wm && window.mountManager && navigator.serviceWorker.controller && document.querySelector('.PixDesktop__wallpaper'))`);
const results = [];
const ok = (label, value) => { results.push(value); console.log((value ? '  ok   ' : '  FAIL ') + label); };

try {
	await b.send('Page.addScriptToEvaluateOnNewDocument', {source: `if (window === top) { window.__start = {controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller), sw: sessionStorage.getItem('pixos-sw-reload'), coi: sessionStorage.getItem('pixos-coi-reload'), t: Math.round(performance.timeOrigin)}; }`});
	await b.send('Page.navigate', {url: ORIGIN + '/'});
	await until('boot', booted, 60000);
	await b.send('Page.reload');
	await sleep(1500);
	await until('boot again', booted, 60000);
	await sleep(2000);

	if (MODE === 'tab') {
		await b.send('Target.createTarget', {url: ORIGIN + '/__browserfs__/home/about.md'});
		await sleep(3000);
	}
	if (MODE === 'hard' || MODE === 'stay') {
		if (MODE === 'stay') {
			await b.evaluate(`(sessionStorage.setItem('pixos-sw-reload', '1'), true)`);
		}
		await b.evaluate(`(window.__old = true)`);
		console.log('  before the hard reload: ' + await b.evaluate(`JSON.stringify({start: window.__start, sw: sessionStorage.getItem('pixos-sw-reload')})`));
		await b.send('Page.reload', {ignoreCache: true});
		await until('the old page to go', () => b.evaluate(`!window.__old`), 30000);
		await until('boot after a hard reload', MODE === 'hard' ? booted : shellUp, 60000);
		await sleep(3000);
	}
	console.log('  at the start of this page: ' + await b.evaluate(`JSON.stringify(window.__start)`));
	console.log('  this page: ' + await b.evaluate(`JSON.stringify({nav: performance.getEntriesByType('navigation')[0].type, timeOrigin: Math.round(performance.timeOrigin), now: Date.now(), flags: [sessionStorage.getItem('pixos-sw-reload'), sessionStorage.getItem('pixos-coi-reload')]})`));
	const controlled = await b.evaluate('!!navigator.serviceWorker.controller');
	console.log('  controlled: ' + controlled + ', isolated: ' + await b.evaluate('window.crossOriginIsolated'));
	if (MODE === 'hard') {
		ok('after a hard reload the shell put itself back under the worker', controlled);
		ok('and is isolated again', await b.evaluate('window.crossOriginIsolated'));
	}
	if (MODE === 'stay') {
		ok('with the reload spent, it stays uncontrolled (the case being checked)', !controlled);
	}
	await b.evaluate(`(function(){ wm.listWindows().forEach(function (w) { wm.closeWindow(w.id); }); return true; })()`);

	await b.evaluate(`(function () {
		window.__diskHandle = null;
		window.addEventListener('dragover', function (e) { e.preventDefault(); }, true);
		window.addEventListener('drop', function (e) {
			e.preventDefault(); e.stopImmediatePropagation();
			var item = Array.from(e.dataTransfer.items).find(function (i) { return i.kind === 'file'; });
			item.getAsFileSystemHandle().then(function (h) { window.__diskHandle = h; });
		}, true);
		return true;
	})()`);
	const data = {items: [], files: [DISK], dragOperationsMask: 1};
	await b.send('Input.dispatchDragEvent', {type: 'dragEnter', x: 600, y: 300, data});
	await b.send('Input.dispatchDragEvent', {type: 'dragOver', x: 600, y: 300, data});
	await b.send('Input.dispatchDragEvent', {type: 'drop', x: 600, y: 300, data});
	await until('the handle', () => b.evaluate(`!!window.__diskHandle && window.__diskHandle.kind === 'directory'`), 5000);
	ok('a real folder is mounted', 'ok' === await b.evaluate(`new Promise(function (r) { mountManager.mountNativeDir(window.__diskHandle, '/mnt/Disk', 'Disk', function (e) { r(e ? 'ERR ' + e.message : 'ok'); }); })`));
	await sleep(500);

	await b.evaluate(`(function () { openFile('/mnt/Disk/hello.md'); return true; })()`);
	await sleep(1000);
	const shown = await until('the viewer to draw the file', () => b.evaluate(`(function () {
		var w = wm.listWindows()[0]; var f = w && wm.getFrame(w.id); var d = f && f.contentDocument;
		var text = d && d.body ? d.body.innerText.replace(/\\s+/g, ' ') : '';
		return /Heading from the real disk/.test(text) ? text.slice(0, 120) : null;
	})()`), 12000).catch(() => null);
	console.log('  viewer: ' + JSON.stringify(shown || await b.evaluate(`(function () { var w = wm.listWindows()[0]; var f = w && wm.getFrame(w.id); return f && f.contentDocument && f.contentDocument.body.innerText.replace(/\\s+/g, ' ').slice(0, 120); })()`)));
	ok('the file under the mount opens in its app', !!shown);

	// A second file, fetched from inside the app's frame: the route every app's own reads take.
	const inFrame = await b.evaluate(`(function () { var w = wm.listWindows()[0]; var f = wm.getFrame(w.id);
		return f.contentWindow.fetch('/__browserfs__/mnt/Disk/hello.txt').then(function (r) { return r.text().then(function (t) { return r.status + ' ' + t; }); }); })()`);
	console.log('  frame fetch: ' + inFrame);
	ok('an app frame reads another file from it', inFrame === '200 plain text from the real disk');
} catch (e) {
	ok('ERROR ' + e.message, false);
} finally {
	console.log(MODE + ': ' + results.filter(Boolean).length + ' of ' + results.length);
	b.close();
	await server.stop();
	removeProfile(PROFILE);
	removeProfile(DISK);
}
process.exit(results.length && results.every(Boolean) ? 0 : 1);
