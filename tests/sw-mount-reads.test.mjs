// A file on a mount, read by the worker through a shell.
//
// The worker has only IndexedDB, so a file under a mount is read by asking a PixOS window to
// read it. It asked one guessed window: the top-level one focused last, among the pages it
// controls. A file opened in a browser tab and focused after the shell was asked instead and
// never answered; after a hard reload the shell was not controlled at all and an app frame was
// asked. Every file under the mount then opened as an empty window, and nothing outside it did.
//
// What is checked: which windows count as a shell, the order they are asked in, that asking
// stops at the first answer, and the shell's half -- a page the worker does not control reloads
// into it once, and does not boot on its way out.

import fs from 'node:fs';
import {check, report} from './assert.mjs';

const root = new URL('../', import.meta.url);
const sw = fs.readFileSync(new URL('sw.js', root), 'utf8');
const shell = fs.readFileSync(new URL('index.html', root), 'utf8');

// A port left open keeps node running, and so does a question nobody gives up on. Either is a
// failure, not a test run that never ends; this does not itself keep node running.
setTimeout(function () {
	console.error('sw-mount-reads.test.mjs: still running after 10 s -- a port was left open, or a question never ended');
	process.exit(1);
}, 10000).unref();

function region (source, name, from, to) {
	const start = source.indexOf(from);
	const end = source.indexOf(to, start);
	if (start === -1 || end === -1) {
		console.error('sw-mount-reads.test.mjs: could not find "' + from + '" in ' + name);
		process.exit(1);
	}
	return source.slice(start, end);
}

const {isShellUrl, askShells, ASK_TIMEOUT_MS} = new Function(
	region(sw, 'sw.js', '// --- asking a shell for a file on a mount', '// --- end of asking a shell')
	+ '\n; return {isShellUrl: isShellUrl, askShells: askShells, ASK_TIMEOUT_MS: ASK_TIMEOUT_MS};'
)();

// --- which windows are a shell --------------------------------------------------------------

const ROOT = 'http://localhost:8000/';
check('the scope itself is the shell', isShellUrl(ROOT, ROOT), true);
check('so is index.html in it', isShellUrl(ROOT + 'index.html', ROOT), true);
check('with a query', isShellUrl(ROOT + '?clean=1', ROOT), true);
check('or a hash', isShellUrl(ROOT + 'index.html#x', ROOT), true);
check('a file opened in a browser tab is not', isShellUrl(ROOT + '__browserfs__/home/about.md', ROOT), false);
check('nor is an app frame', isShellUrl(ROOT + '__browserfs__/apps/markdown-viewer/index.html', ROOT), false);
check('nor a page somewhere else in the repo', isShellUrl(ROOT + 'docs/checks/hidden-frame.html', ROOT), false);

// Served from a folder, as GitHub Pages does.
const SUB = 'https://example.github.io/pixos/';
check('under a folder, its root is the shell', isShellUrl(SUB, SUB), true);
check('and its index.html', isShellUrl(SUB + 'index.html', SUB), true);
check('the site above it is not', isShellUrl('https://example.github.io/', SUB), false);
check('nor is a sibling folder', isShellUrl('https://example.github.io/other/index.html', SUB), false);
check('nor an app under it', isShellUrl(SUB + '__browserfs__/apps/explorer/index.html', SUB), false);

// --- asking --------------------------------------------------------------------------------

// A window as the worker sees it. `answer` is what it replies, `null` for a window with nobody
// listening -- a file tab, an app frame, a frozen tab.
function win (url, answer, log) {
	return {
		url: url,
		postMessage: function (msg, ports) {
			log.push(url);
			if (!ports || ports.length !== 1) {
				throw new Error('asked with no port to answer on');
			}
			if (answer) {
				ports[0].postMessage(typeof answer === 'function' ? answer(msg) : answer);
			}
		}
	};
}

const MSG = {type: 'readFile', path: '/mnt/Disk/hello.md'};
const FILE = {buffer: 'the bytes'};

async function ask (windows, timeoutMs) {
	try {
		return {ok: await askShells(windows, ROOT, MSG, timeoutMs || 200)};
	} catch (err) {
		return {error: err.message};
	}
}

{
	const log = [];
	const result = await ask([
		win(ROOT + '__browserfs__/home/about.md', null, log),
		win(ROOT + '__browserfs__/apps/markdown-viewer/index.html', null, log),
		win(ROOT, FILE, log)
	]);
	check('a file tab focused after the shell does not get the question', result, {ok: FILE});
	check('nor does an app frame; only the shell is asked', log, [ROOT]);
}

{
	const log = [];
	const got = [];
	const result = await ask([win(ROOT, function (msg) { got.push(msg); return FILE; }, log)]);
	check('the shell is asked the question as it was put', got, [MSG]);
	check('and its answer is the answer', result, {ok: FILE});
}

{
	const log = [];
	const result = await ask([
		win(ROOT + 'index.html', {error: 'ENOENT: no such file'}, log),
		win(ROOT, FILE, log)
	]);
	check('a second PixOS without the mount says no, and the next shell is asked', result, {ok: FILE});
	check('in the order they came, best first', log, [ROOT + 'index.html', ROOT]);
}

{
	const log = [];
	await ask([win(ROOT, FILE, log), win(ROOT + 'index.html', FILE, log)]);
	check('the first answer ends it: a file is read once, not once per tab', log, [ROOT]);
}

{
	const log = [];
	const started = Date.now();
	const result = await ask([win(ROOT, null, log), win(ROOT + '?x', FILE, log)], 60);
	check('a shell that never answers is given up on, and the next is asked', result, {ok: FILE});
	check('after the timeout, not before', Date.now() - started >= 55, true);
}

{
	const log = [];
	const result = await ask([
		win(ROOT, {error: 'EACCES'}, log),
		win(ROOT + 'index.html', {error: 'ENOENT: no such file'}, log)
	]);
	check('when every shell says no, the last no is the answer', result, {error: 'ENOENT: no such file'});
}

{
	const log = [];
	const result = await ask([win(ROOT + '__browserfs__/apps/explorer/index.html', FILE, log)]);
	check('with no shell at all it fails at once', result, {error: 'No PixOS window to ask'});
	check('and asks nobody, not even a frame that would answer', log, []);
}

check('a shell gets five seconds, as before', ASK_TIMEOUT_MS, 5000);

// The call site: every window, controlled or not, and the scope the worker was registered for.
const askClient = region(sw, 'sw.js', 'function askClient(msg)', 'var request = event.request;');
check('the worker lists uncontrolled windows too', /matchAll\(\{type: 'window', includeUncontrolled: true\}\)/.test(askClient), true);
check('and asks them through askShells, with its own scope', /askShells\(clients, self\.registration\.scope, msg, ASK_TIMEOUT_MS\)/.test(askClient), true);
check('the old guess is gone', sw.includes("frameType === 'top-level'"), false);

// --- the shell's half ----------------------------------------------------------------------

const ensureControlled = region(shell, 'index.html', 'function ensureControlled()', 'if (ensureControlled())');

function page (opts) {
	const store = Object.assign({}, opts.flags || {});
	const out = {reloads: 0, store: store};
	const run = new Function('navigator', 'sessionStorage', 'location', 'reg', ensureControlled + '\n; return ensureControlled();');
	out.returned = run(
		{serviceWorker: {controller: opts.controlled ? {} : null}},
		{
			getItem: function (k) { return k in store ? store[k] : null; },
			setItem: function (k, v) { store[k] = String(v); },
			removeItem: function (k) { delete store[k]; }
		},
		{reload: function () { out.reloads++; }},
		{active: opts.active ? {} : null}
	);
	return out;
}

{
	const p = page({controlled: false, active: true});
	check('a shell the active worker does not control reloads', p.reloads, 1);
	check('says so, so it does not boot', p.returned, true);
	check('and remembers it did', p.store['pixos-sw-reload'], '1');
}
{
	const p = page({controlled: false, active: true, flags: {'pixos-sw-reload': '1'}});
	check('but only once: a browser that bypasses the worker every time does not loop', p.reloads, 0);
	check('and that shell boots as it is', p.returned, false);
}
{
	const p = page({controlled: false, active: false});
	check('the first visit, with no active worker yet, waits for it to claim the page', [p.reloads, p.returned], [0, false]);
}
{
	const p = page({controlled: true, active: true, flags: {'pixos-sw-reload': '1', 'pixos-coi-reload': '1'}});
	check('a controlled shell boots', [p.reloads, p.returned], [0, false]);
	check('and forgets the reload, so the next hard reload is put right too', 'pixos-sw-reload' in p.store, false);
	check('leaving the isolation reload\'s own flag alone', p.store['pixos-coi-reload'], '1');
}

const registered = region(shell, 'index.html', 'function ensureControlled()', 'BrowserFS.configure({');
check('a shell on its way out returns before BrowserFS is configured',
	/if \(ensureControlled\(\)\) \{\s*return;\s*\}\s*ensureCrossOriginIsolated\(\);/.test(registered), true);

report('sw-mount-reads');
