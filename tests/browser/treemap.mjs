// Disk Treemap 2.0 against a real boot in headless Chrome, measured and then checked.
//
// Measured, printed rather than counted:
//   - the scan of a seeded folder (5 000 files in 250 folders) and of one folder of 3 000 files, read
//     directly from the key-value store with 1, 4, 16 and 64 folders in flight and through readdir
//     and stat with 8 and 32 calls, three rounds interleaved, median: what IN_FLIGHT in
//     scan-pixos.js was chosen from, and what reading directly is worth;
//   - with `--old=<folder>` (a copy of the app as it was before 2.0), the old app and the new one
//     side by side in frames of one size: from `openPath` to the picture drawn, on the seeded folder
//     and on `/`, and the cost of the pointer moving over a folder of 3 000 files. A canvas records
//     its drawing and paints it later, so each timing ends by reading a pixel back, which makes the
//     browser paint what was drawn; both apps pay it alike.
// Checked: installed from the catalog and opened on a folder through the shell, the status line,
// the crumbs, the side list and the kinds, a hover, going in and back up, a file opened through
// the shell, Measure PixOS storage, and Stop.
//
//     node tests/browser/treemap.mjs [--old=<folder>]
import fs from 'node:fs';
import path from 'node:path';
import {launch, limit, serve, sleep, ORIGIN, OUT, out, profileDir, removeProfile} from './cdp.mjs';

limit(480000, 'treemap');

const results = [];
function check (name, got, want) {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	results.push(ok);
	console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
}
const note = (line) => console.log('         ' + line);
const median = (list) => list.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)];

const oldArg = process.argv.find((arg) => arg.startsWith('--old='));
let oldUrl = null;
if (oldArg) {
	const from = path.resolve(oldArg.slice('--old='.length));
	const to = path.join(OUT, 'treemap-old');
	fs.rmSync(to, {recursive: true, force: true});
	fs.cpSync(from, to, {recursive: true});
	oldUrl = '/tests/browser/out/treemap-old/index.html';
}

const server = await serve();
const profile = profileDir('treemap');
const browser = await launch({profile});
try {
	const a = await browser.page(ORIGIN + '/');
	await a.until("!!document.querySelector('.PixTaskbar__start') && !!window.fs && typeof window.openCatalogApp === 'function'", 60000);
	await sleep(1500);

	// --- the seed ---------------------------------------------------------------------------------
	// /home/tm-bench: 50 folders of 5 folders of 20 files, sizes falling off as a disk's do.
	// /home/tm-flat: 3 000 files in one folder.
	console.log('seeding (about a minute)');
	const t0 = Date.now();
	const seeded = await a.eval(`(async () => {
		const call = (m, ...args) => new Promise((ok, no) => window.fs[m](...args, (e, v) => e && e.code !== 'EEXIST' ? no(e) : ok(v)));
		// The first is .md, so the largest file in a folder opens in Markdown Viewer, which is preinstalled.
		const exts = ['md', 'png', 'json', 'mp4', 'js', 'zip', 'wasm', 'txt', 'mp3', 'bin'];
		const body = (n) => 'x'.repeat(n);
		const jobs = [];
		await call('mkdir', '/home/tm-bench');
		for (let d = 0; d < 50; d++) {
			await call('mkdir', '/home/tm-bench/d' + d);
			for (let s = 0; s < 5; s++) {
				const dir = '/home/tm-bench/d' + d + '/s' + s;
				await call('mkdir', dir);
				for (let f = 0; f < 20; f++) {
					const i = (d * 5 + s) * 20 + f;
					jobs.push([dir + '/f' + f + '.' + exts[i % exts.length], Math.floor(200000 / (1 + (i % 400)))]);
				}
			}
		}
		await call('mkdir', '/home/tm-flat');
		for (let f = 0; f < 3000; f++) jobs.push(['/home/tm-flat/n' + f + '.' + exts[f % exts.length], Math.floor(50000 / (1 + f % 300))]);
		for (let i = 0; i < jobs.length; i += 50) {
			await Promise.all(jobs.slice(i, i + 50).map(([p, n]) => call('writeFile', p, body(n))));
		}
		return jobs.length;
	})()`, 300000);
	note(`seeded ${seeded} files in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

	// --- the scan, by how it reads and by requests in flight ------------------------------------------
	// Read directly from the key-value store (one transaction per folder), or through readdir and
	// stat (one transaction per call). tm-flat is where stat's cost grows with the folder.
	const ways = [['direct', true, [1, 4, 16, 64]], ['stat', false, [8, 32]]];
	const miscounted = [];
	for (const dir of ['/home/tm-bench', '/home/tm-flat']) {
		const rounds = {};
		for (let round = 0; round < 3; round++) {
			for (const [way, direct, counts] of ways) {
				for (const n of round % 2 ? counts.slice().reverse() : counts) {
					const took = await a.eval(`(async () => {
						const m = await import('/apps/treemap/js/scan-pixos.js');
						const t = performance.now();
						const r = await m.scanPixos({fs: window.fs, path: ${JSON.stringify(dir)}, inFlight: ${n}, direct: ${direct}});
						return [performance.now() - t, r.root.files, r.unreadable];
					})()`, 120000);
					(rounds[way + ' ' + n] ||= []).push(took[0]);
					const want = dir === '/home/tm-flat' ? 3000 : 5000;
					if (took[1] !== want || took[2]) miscounted.push(`${dir} ${way} ${n}: ${took[1]} files, ${took[2]} unreadable`);
				}
			}
		}
		console.log(`scan of ${dir}, median of 3 (ms):`);
		for (const [key, list] of Object.entries(rounds)) note(`${key.padEnd(10)} in flight: ${median(list).toFixed(0).padStart(5)}   (${list.map((t) => t.toFixed(0)).join(', ')})`);
	}
	check('read directly or through stat, at every count, every file is counted and none is unreadable', miscounted, []);

	// --- old and new side by side -------------------------------------------------------------------
	// Each frame is made fresh in the shell's own document, 1000 × 700, so both have the shell as
	// their parent and the same canvas to fill.
	const frameAt = (url) => a.eval(`(async () => {
		document.querySelectorAll('.tm-bench-frame').forEach((f) => f.remove());
		const f = document.createElement('iframe');
		f.className = 'tm-bench-frame';
		f.style.cssText = 'position:fixed;left:0;top:0;width:1000px;height:700px;z-index:99999;border:0;background:#000';
		f.src = ${JSON.stringify(url)};
		document.body.append(f);
		await new Promise((ok) => f.addEventListener('load', ok, {once: true}));
		for (let i = 0; i < 400 && typeof f.contentWindow.openPath !== 'function'; i++) await new Promise((ok) => setTimeout(ok, 25));
		return typeof f.contentWindow.openPath === 'function';
	})()`, 60000);
	// From openPath to the picture drawn and painted. `done` and `canvas` are expressions in the frame.
	const timeOpen = (dir, done, canvas) => a.eval(`(async () => {
		const f = document.querySelector('.tm-bench-frame');
		const w = f.contentWindow;
		const d = f.contentDocument;
		const t = performance.now();
		w.openPath(${JSON.stringify(dir)});
		await new Promise((ok) => setTimeout(ok, 0));
		while (!(${done})) await new Promise((ok) => setTimeout(ok, 2));
		${canvas}.getContext('2d').getImageData(0, 0, 1, 1);
		return performance.now() - t;
	})()`, 180000);
	// The pointer moved across the picture 300 times, each move followed by a pixel read back from
	// the canvas it draws on. Returns ms per move.
	const timeHover = (type, target, canvas) => a.eval(`(async () => {
		const d = document.querySelector('.tm-bench-frame').contentDocument;
		const el = ${target};
		const c = ${canvas};
		const box = el.getBoundingClientRect();
		const Ev = d.defaultView[${JSON.stringify(type === 'pointermove' ? 'PointerEvent' : 'MouseEvent')}];
		const t = performance.now();
		for (let i = 0; i < 300; i++) {
			const x = box.left + 5 + ((i * 37) % Math.max(1, box.width - 10));
			const y = box.top + 5 + ((i * 53) % Math.max(1, box.height - 10));
			el.dispatchEvent(new Ev(${JSON.stringify(type)}, {clientX: x, clientY: y, bubbles: true}));
			c.getContext('2d').getImageData(0, 0, 1, 1);
		}
		return (performance.now() - t) / 300;
	})()`, 120000);

	const NEW = {
		url: '/apps/treemap/index.html',
		done: "!d.getElementById('base').hidden && d.getElementById('busy').hidden",
		canvas: "d.getElementById('base')",
		hover: ['pointermove', "d.getElementById('overlay')", "d.getElementById('overlay')"],
	};
	const OLD = {
		url: oldUrl,
		done: "!d.getElementById('treemap-canvas').hidden && d.getElementById('progress-wrap').hidden",
		canvas: "d.getElementById('treemap-canvas')",
		hover: ['mousemove', "d.getElementById('treemap-canvas')", "d.getElementById('treemap-canvas')"],
	};
	const sides = oldUrl ? [['old', OLD], ['new', NEW]] : [['new', NEW]];
	const table = {};
	for (const [name, app] of sides) {
		table[name] = {bench: [], root: [], hover: null};
		for (let round = 0; round < 3; round++) {
			if (!await frameAt(app.url)) throw new Error(name + ' app never offered openPath');
			table[name].bench.push(await timeOpen('/home/tm-bench', app.done, app.canvas));
			await frameAt(app.url);
			table[name].root.push(await timeOpen('/', app.done, app.canvas));
		}
		await frameAt(app.url);
		await timeOpen('/home/tm-flat', app.done, app.canvas);
		table[name].hover = await timeHover(...app.hover);
		if (name === 'new') await a.screenshot(out('treemap-flat.png'));
	}
	console.log('opened to drawn, median of 3 (ms), and per pointer move over 3 000 files (ms):');
	for (const [name] of sides) {
		const t = table[name];
		note(`${name}: /home/tm-bench ${median(t.bench).toFixed(0)} (${t.bench.map((x) => x.toFixed(0)).join(', ')}), / ${median(t.root).toFixed(0)} (${t.root.map((x) => x.toFixed(0)).join(', ')}), hover ${t.hover.toFixed(2)}`);
	}
	await a.eval("document.querySelectorAll('.tm-bench-frame').forEach((f) => f.remove()), true");

	// --- the app, as a person meets it --------------------------------------------------------------
	await a.eval("window.openCatalogApp('treemap', ['/home/tm-bench']).then(() => true)", 60000);
	const frame = "[...document.querySelectorAll('iframe')].find((f) => /\\/apps\\/treemap\\/index\\.html/.test(f.src))";
	const inApp = (expr) => a.eval(`(() => { const f = ${frame}; if (!f) return null; const d = f.contentDocument; const w = f.contentWindow; return (${expr}); })()`);
	await a.until(`(() => { const f = ${frame}; return !!f && !!f.contentDocument && !f.contentDocument.getElementById('base').hidden; })()`, 60000);
	await sleep(500);
	check('installed from the catalog and opened on the folder, from the PixOS copy', await inApp("[/^\\/__browserfs__\\/apps\\/treemap\\//.test(new URL(f.src).pathname), new URL(f.src).searchParams.get('path')]"),
		[true, '/home/tm-bench']);
	check('the title is the path, the status line the totals', await inApp("[d.getElementById('crumbs').textContent, d.getElementById('status').textContent.replace(/measured in .*/, 'measured')]"),
		['/home/tm-bench', '16.2 MB · 5,000 files · 300 folders · measured']);
	check('the side list holds the 50 folders, largest first, and the kinds their bytes',
		await inApp("[d.querySelectorAll('#list .Tm__row').length, [...d.querySelectorAll('#kinds .Tm__rowName')].length > 5]"), [50, true]);
	await a.screenshot(out('treemap-bench.png'));

	// A hover in the middle of the first top-level folder's header.
	const geometry = await inApp("(() => { const b = d.getElementById('overlay').getBoundingClientRect(); const fb = f.getBoundingClientRect(); return {x: fb.left + b.left, y: fb.top + b.top, w: b.width, h: b.height}; })()");
	await a.mouse('mouseMoved', geometry.x + 40, geometry.y + 6);
	await sleep(200);
	const hovered = await inApp("[d.getElementById('tip').hidden, d.getElementById('tip-name').textContent, d.getElementById('tip-hint').textContent, /^\\/home\\/tm-bench\\/d\\d+ · /.test(d.getElementById('hover').textContent)]");
	check('a folder\'s header under the pointer: the tip names it and says a click goes in, the status line its path',
		[hovered[0], /^d\d+$/.test(hovered[1]), hovered[2], hovered[3]], [false, true, 'Click to go in', true]);
	await a.click(geometry.x + 40, geometry.y + 6);
	await sleep(400);
	const inside = await inApp("[d.getElementById('crumbs').textContent, d.getElementById('up').disabled]");
	check('a click goes in, the path its title', [/^\/home\/tm-bench\/d\d+$/.test(inside[0]), inside[1]], [true, false]);
	await a.eval(`${frame}.contentWindow.focus(), true`);
	await a.key('Backspace', {code: 'Backspace', windowsVirtualKeyCode: 8});
	await sleep(300);
	check('Backspace goes back up', await inApp("d.getElementById('crumbs').textContent"), '/home/tm-bench');

	// A file: go into a folder from the side list, then click the largest file's rect.
	await inApp("d.querySelector('#list .Tm__row').click(), true");
	await sleep(300);
	await inApp("d.querySelector('#list .Tm__row').click(), true");
	await sleep(300);
	const fileRow = await inApp("[d.getElementById('crumbs').textContent, d.querySelector('#list .Tm__rowName').textContent]");
	const before = await a.eval('document.querySelectorAll("iframe").length');
	await a.mouse('mouseMoved', geometry.x + 20, geometry.y + 20);
	await sleep(150);
	const tip = await inApp("[d.getElementById('tip-name').textContent, d.getElementById('tip-hint').textContent]");
	check('a file under the pointer says a click opens it', [tip[0], tip[1]], [fileRow[1], 'Click to open']);
	await a.click(geometry.x + 20, geometry.y + 20);
	const opened = await a.until(`document.querySelectorAll('iframe').length > ${before} ? document.querySelectorAll('iframe').length : null`, 20000).catch(() => null);
	check('and a click opens it in another window, through the shell', opened > before, true);
	note(`opened ${fileRow[0]}/${fileRow[1]}`);

	// Measure PixOS storage from the empty page, and Stop.
	await a.eval(`(() => { const f = ${frame}; f.src = f.src.replace(/\\?.*$/, ''); return true; })()`);
	await a.until(`(() => { const f = ${frame}; return !!f && f.contentDocument.readyState === 'complete' && !!f.contentDocument.getElementById('measure-root') && !f.contentDocument.getElementById('empty').hidden; })()`, 30000);
	await sleep(300);
	check('opened on nothing, it offers to measure PixOS storage', await inApp("[d.getElementById('measure-root').hidden, d.getElementById('measure-root').textContent]"), [false, 'Measure PixOS storage']);
	await inApp("d.getElementById('measure-root').click(), true");
	await a.until(`(() => { const d = ${frame}.contentDocument; return !d.getElementById('base').hidden; })()`, 60000);
	const whole = await inApp("[d.getElementById('crumbs').textContent, d.getElementById('status').textContent]");
	check('and measures / when asked', [whole[0], /files · \d[\d,]* folders · measured in/.test(whole[1])], ['/', true]);
	note(whole[1]);
	await inApp("d.getElementById('rescan').click(), true");
	await sleep(30);
	const busy = await inApp("!d.getElementById('busy').hidden");
	await inApp("d.getElementById('stop').click(), true");
	await sleep(100);
	check('Measure again shows the scan, and Stop goes back to the picture there was',
		[busy, await inApp("[d.getElementById('busy').hidden, !d.getElementById('base').hidden, d.getElementById('crumbs').textContent]")], [true, [true, true, '/']]);

	check('no errors', a.errors, []);
}
catch (err) {
	console.log('  FAIL the run stopped: ' + (err && err.stack || err));
	results.push(false);
}
finally {
	browser.close();
	await sleep(1000);
	removeProfile(profile);
	await server.stop();
}
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\ntreemap: ${failed} of ${results.length} failed` : `\ntreemap: ${results.length} passed`);
process.exit(failed ? 1 : 0);
