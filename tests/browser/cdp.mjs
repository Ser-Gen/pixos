// What every browser harness here stands on: a static server for the repo, a throwaway Chrome
// profile, and a few lines of the Chrome DevTools Protocol over Node's own WebSocket. No
// dependencies, like the rest of tests/. See tests/browser/README.md.
//
// Two clients, because the harnesses were written over two phases and both shapes are in use:
//   launch({profile})         one browser, any number of pages (`browser.page(url)`), each with
//                             eval/until/key/mouse/click/screenshot and the errors it threw
//   launchPage(profile)       one page, `evaluate`/`mouse`/`send`/`screenshot`, with `until(what,
//                             test, ms)` beside it -- the phase 26 harnesses
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPO = path.resolve(new URL('../..', import.meta.url).pathname);
// Screenshots and anything else a harness leaves behind. Not part of the project.
export const OUT = path.join(REPO, 'tests/browser/out');
export const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Where PixOS is served. Every harness starts its own server here, from the repo root.
export const PORT = Number(process.env.PIXOS_PORT) || 8123;
export const ORIGIN = 'http://localhost:' + PORT;

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Every server and Chrome started here, killed however the harness ends -- an exception, Ctrl+C, or a
// pipe closed under it -- so that none is left holding a port for the next run.
const children = new Set();
function own (child) {
	children.add(child);
	child.once('exit', () => children.delete(child));
	return child;
}
process.once('exit', () => children.forEach(child => child.kill('SIGKILL')));
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGPIPE']) {
	process.once(signal, () => process.exit(130));
}

export function out (name) {
	fs.mkdirSync(OUT, {recursive: true});
	return path.join(OUT, name);
}

// A fresh profile in the system's temp folder: a fresh profile is a fresh PixOS.
export function profileDir (name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'pixos-' + name + '-'));
}

export function removeProfile (profile) {
	try {
		fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 300});
	}
	catch (err) {
		console.log('profile left at ' + profile);
	}
}

// `python3 -m http.server`, as the README says to serve PixOS. `root` is the folder served, so a
// harness can serve the repo's parent and open PixOS from a folder. Resolves once it answers.
// `stop` and `start` again are for the harness that takes the network away.
export async function serve ({root = REPO, port = PORT} = {}) {
	let child = null;
	const origin = 'http://localhost:' + port;
	const server = {
		origin,
		async start () {
			// Something already answering there would be tested in its place, and say nothing.
			if (await fetch(origin + '/', {method: 'HEAD'}).then(() => true, () => false)) {
				throw new Error('port ' + port + ' is already served by something else; set PIXOS_PORT');
			}
			child = own(spawn('python3', ['-m', 'http.server', String(port), '--directory', root], {stdio: 'ignore'}));
			for (let i = 0; i < 100; i++) {
				if (await fetch(origin + '/', {method: 'HEAD'}).then(() => true, () => false)) {
					return server;
				}
				await sleep(100);
			}
			throw new Error('the server on ' + port + ' never answered (is the port taken?)');
		},
		async stop () {
			if (child) {
				child.kill();
				await new Promise(resolve => child.once('exit', resolve));
				child = null;
			}
		}
	};
	return server.start();
}

// **Chrome picks its own debugging port** (`0`) and writes it into the profile, where it is read back.
// A fixed port once found a Chrome somebody else had left listening on it -- a visible one, with their
// own profile -- and the harness drove that browser instead of its own, opening tabs in it.
async function startChrome (profile, width, height) {
	const chrome = own(spawn(CHROME, [
		'--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
		'--window-size=' + width + ',' + height, '--no-first-run', '--no-default-browser-check', 'about:blank'
	], {stdio: 'ignore'}));
	const file = path.join(profile, 'DevToolsActivePort');
	for (let i = 0; i < 150; i++) {
		const port = fs.existsSync(file) ? parseInt(fs.readFileSync(file, 'utf8'), 10) : 0;
		if (port) {
			return {chrome, port};
		}
		await sleep(100);
	}
	chrome.kill('SIGKILL');
	throw new Error('Chrome never said which port it listens on (is ' + CHROME + ' there?)');
}

// --- one browser, many pages ------------------------------------------------------------------------

export async function launch ({profile, width = 1280, height = 800}) {
	const {chrome, port} = await startChrome(profile, width, height);
	let version = null;
	for (let i = 0; i < 100 && !version; i++) {
		version = await fetch('http://127.0.0.1:' + port + '/json/version').then(r => r.json()).catch(() => null);
		if (!version) {
			await sleep(100);
		}
	}
	const ws = new WebSocket(version.webSocketDebuggerUrl);
	await new Promise(resolve => ws.addEventListener('open', resolve));
	let id = 0;
	const waiting = new Map();
	const handlers = [];
	ws.addEventListener('message', event => {
		const msg = JSON.parse(event.data);
		if (msg.id && waiting.has(msg.id)) {
			const {resolve, reject} = waiting.get(msg.id);
			waiting.delete(msg.id);
			return msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
		}
		handlers.forEach(fn => fn(msg));
	});
	const send = (method, params, sessionId) => new Promise((resolve, reject) => {
		const n = ++id;
		waiting.set(n, {resolve, reject});
		ws.send(JSON.stringify({id: n, method, params: params || {}, sessionId}));
	});
	const browser = {
		send,
		on: fn => handlers.push(fn),
		async page (url) {
			const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
			const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
			const page = makePage(browser, sessionId, targetId);
			await page.send('Page.enable');
			await page.send('Runtime.enable');
			if (url) {
				await page.goto(url);
			}
			return page;
		},
		close () {
			try { ws.close(); } catch (err) { /* gone */ }
			chrome.kill('SIGKILL');
		}
	};
	return browser;
}

function makePage (browser, sessionId, targetId) {
	const errors = [];
	browser.on(msg => {
		if (msg.sessionId !== sessionId) {
			return;
		}
		if (msg.method === 'Runtime.exceptionThrown') {
			errors.push(msg.params.exceptionDetails.exception ? msg.params.exceptionDetails.exception.description : msg.params.exceptionDetails.text);
		}
		if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
			errors.push(msg.params.args.map(a => a.value || a.description).join(' '));
		}
	});
	const page = {
		sessionId, targetId, errors,
		send: (method, params) => browser.send(method, params, sessionId),
		async goto (url) {
			await page.send('Page.navigate', {url});
		},
		async eval (expression) {
			const result = await page.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
			if (result.exceptionDetails) {
				throw new Error('eval failed: ' + (result.exceptionDetails.exception ? result.exceptionDetails.exception.description : result.exceptionDetails.text));
			}
			return result.result.value;
		},
		async until (expression, ms = 20000) {
			const end = Date.now() + ms;
			for (;;) {
				const value = await page.eval(expression).catch(() => null);
				if (value) {
					return value;
				}
				if (Date.now() > end) {
					throw new Error('timed out waiting for ' + expression);
				}
				await sleep(100);
			}
		},
		mouse (type, x, y, extra) {
			return page.send('Input.dispatchMouseEvent', Object.assign({type, x, y, button: 'none'}, extra));
		},
		async click (x, y) {
			await page.mouse('mousePressed', x, y, {button: 'left', clickCount: 1});
			await page.mouse('mouseReleased', x, y, {button: 'left', clickCount: 1});
		},
		async key (key, extra) {
			const base = Object.assign({key, code: extra && extra.code || key}, extra);
			await page.send('Input.dispatchKeyEvent', Object.assign({type: base.text ? 'keyDown' : 'rawKeyDown'}, base));
			await page.send('Input.dispatchKeyEvent', Object.assign({}, base, {type: 'keyUp', text: undefined}));
		},
		type (text) {
			return page.send('Input.insertText', {text});
		},
		async screenshot (file) {
			const {data} = await page.send('Page.captureScreenshot', {format: 'png'});
			fs.writeFileSync(file, Buffer.from(data, 'base64'));
		}
	};
	return page;
}

// --- one page ---------------------------------------------------------------------------------------

export async function launchPage (profile) {
	const {chrome, port} = await startChrome(profile, 1280, 800);
	let targets = null;
	for (let i = 0; i < 50 && !(targets && targets.some(t => t.type === 'page')); i++) {
		targets = await fetch('http://127.0.0.1:' + port + '/json').then(r => r.json()).catch(() => null);
		if (!(targets && targets.some(t => t.type === 'page'))) {
			await sleep(200);
		}
	}
	const page = targets.find(t => t.type === 'page');
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise(resolve => ws.addEventListener('open', resolve));
	let id = 0;
	const waiting = new Map();
	const events = [];
	ws.addEventListener('message', m => {
		const msg = JSON.parse(m.data);
		if (msg.id && waiting.has(msg.id)) {
			waiting.get(msg.id)(msg);
			waiting.delete(msg.id);
		}
		else if (msg.method) {
			events.push(msg);
		}
	});
	const send = (method, params) => new Promise(resolve => {
		const n = ++id;
		waiting.set(n, resolve);
		ws.send(JSON.stringify({id: n, method, params: params || {}}));
	});
	const evaluate = async expression => {
		const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
		if (r.result && r.result.exceptionDetails) {
			throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
		}
		return r.result && r.result.result ? r.result.result.value : r;
	};
	const mouse = (type, x, y, button, clickCount) => send('Input.dispatchMouseEvent', {
		type, x, y, button: button || 'none', clickCount: clickCount || 0,
		buttons: type === 'mousePressed' ? (button === 'right' ? 2 : 1) : 0
	});
	const screenshot = async file => {
		const r = await send('Page.captureScreenshot', {format: 'png'});
		fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
	};
	const close = () => {
		try { ws.close(); } catch (e) { /* gone */ }
		chrome.kill();
	};
	await send('Runtime.enable');
	await send('Page.enable');
	return {send, evaluate, mouse, screenshot, close, events};
}

export async function until (what, test, ms) {
	const end = Date.now() + (ms || 20000);
	while (Date.now() < end) {
		try {
			const value = await test();
			if (value) {
				return value;
			}
		}
		catch (e) { /* not yet */ }
		await sleep(250);
	}
	throw new Error('timed out waiting for ' + what);
}
