// `window.watchStorage`: the shell's storage figure, handed to an app (phase 24, Explorer's foot).
//
// Lifted out of index.html beside `frameIsAlive`, and run against a stand-in for
// js/shell/system-stats.js. Three things it has to get right, none of which throws when wrong:
//
//   * **Only a change is passed on.** system-stats emits every second for the clock, and an app that
//     redrew its gauge sixty times a minute would be doing nothing sixty times a minute.
//   * **A closed window stops listening.** The listener outlives the iframe otherwise, and every
//     Explorer ever opened keeps a subscription -- and the poller that serves it -- alive.
//   * **`subscribe` calls back before it returns.** The first call cannot reach `stop` yet.

import fs from 'node:fs';
import {check, report} from './assert.mjs';

const shell = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = shell.indexOf('\twindow.watchStorage = function');
const end = shell.indexOf('\t// For a writer that changed what a folder contains', start);
if (start === -1 || end === -1) {
	console.error('shell-watch-storage.test.mjs: could not find watchStorage and frameIsAlive in index.html');
	process.exit(1);
}
const code = shell.slice(start, end);

function world (initial) {
	const w = {state: {now: 0, storage: initial === undefined ? null : initial}, listeners: [], stopped: 0};
	w.stats = {
		subscribe (listener) {
			w.listeners.push(listener);
			listener(w.state);
			return function () {
				w.stopped++;
				w.listeners = w.listeners.filter(l => l !== listener);
			};
		}
	};
	w.emit = change => {
		Object.assign(w.state, change || {});
		w.listeners.slice().forEach(l => l(w.state));
	};
	const win = {};
	new Function('window', 'stats', code)(win, w.stats);
	w.watchStorage = win.watchStorage;
	return w;
}

const frame = alive => ({frameElement: {isConnected: alive}});

{
	const w = world({supported: true, usage: 10, quota: 100});
	const seen = [];
	const app = frame(true);
	w.watchStorage(app, storage => seen.push(storage));
	check('the figure already known is handed over straight away', seen, [{supported: true, usage: 10, quota: 100}]);

	w.emit({now: 1});
	w.emit({now: 2});
	check('a tick of the clock is not a change', seen.length, 1);

	w.emit({storage: {supported: true, usage: 40, quota: 100}});
	check('a new figure is', seen.map(s => s.usage), [10, 40]);

	seen[1].usage = 999;
	w.emit({now: 3});
	check('what an app does to its copy is not the shell\'s figure', w.state.storage.usage, 40);

	app.frameElement.isConnected = false;
	w.emit({storage: {supported: true, usage: 50, quota: 100}});
	check('once the window is gone, nothing more is handed to it', seen.length, 2);
	check('and it stops listening', [w.stopped, w.listeners.length], [1, 0]);
}

{
	// Not measured yet is an answer too: the gauge stays hidden until there is one.
	const w = world(null);
	const seen = [];
	w.watchStorage(frame(true), storage => seen.push(storage));
	w.emit({storage: {supported: false}});
	check('"not measured yet", then "cannot", each handed over once', seen, [null, {supported: false}]);
}

{
	// A frame already gone when it asks -- `subscribe` calls back before `stop` exists.
	const w = world({supported: true, usage: 1, quota: 2});
	const seen = [];
	let failed = null;
	try {
		w.watchStorage(frame(false), storage => seen.push(storage));
	}
	catch (err) {
		failed = err.message;
	}
	check('a window gone before its first answer does not throw', failed, null);
	check('is handed nothing', seen, []);
	check('and does not stay subscribed', [w.stopped, w.listeners.length], [1, 0]);
}

{
	const w = world({supported: true, usage: 1, quota: 2});
	const seen = [];
	const stop = w.watchStorage(storage => seen.push(storage));
	check('a handler alone, with no window, is served too', seen.length, 1);
	stop();
	check('and can stop itself', w.listeners.length, 0);
	check('something that is not a handler gets a stop that does nothing',
		[typeof w.watchStorage(frame(true), 'no'), w.listeners.length], ['function', 0]);
}

report('shell-watch-storage');
