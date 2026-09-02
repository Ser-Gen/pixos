// The formatters behind the tray and the widgets. The pollers themselves need a browser;
// these are the parts that decide what the numbers actually read as.

import {check, report} from './assert.mjs';

// node has a real read-only `navigator` with neither storage.estimate nor getBattery,
// which is the same shape as a browser that does not support them.
globalThis.document = {hidden: false, addEventListener () {}, baseURI: 'http://localhost:8000/'};

// The probe. Deliberately a real request: while the shell believes it is offline, nothing
// else will tell it otherwise if the browser does not fire the `online` event.
const probes = [];
let answerProbe = null;
globalThis.fetch = url => new Promise((resolve, reject) => {
	probes.push(url);
	answerProbe = ok => (ok ? resolve({ok: true}) : reject(new Error('offline')));
});
const intervals = new Map();
let nextInterval = 1;
globalThis.setInterval = (fn, ms) => {
	const id = nextInterval++;
	intervals.set(id, fn);
	return id;
};
globalThis.clearInterval = id => intervals.delete(id);
const runIntervals = () => Array.from(intervals.values()).forEach(fn => fn());
// The online/offline listeners are registered on `window` at module scope.
const netListeners = {};
globalThis.window = {addEventListener (type, fn) { netListeners[type] = fn; }};

// The service worker is the second source: it is the only thing that knows whether a
// request actually failed, as opposed to whether the machine believes it has a link.
const sent = [];
const swListeners = {};
let replyToWorkerQuery = null;
globalThis.MessageChannel = class {
	constructor () {
		this.port1 = {};
		this.port2 = {port1: this.port1};
	}
};
Object.defineProperty(globalThis, 'navigator', {
	value: {
		onLine: true,
		serviceWorker: {
			controller: {
				postMessage (message, transfer) {
					sent.push(message);
					const port = transfer && transfer[0];
					replyToWorkerQuery = data => port.port1.onmessage({data: data});
				}
			},
			addEventListener (type, fn) { swListeners[type] = fn; }
		}
	},
	configurable: true,
	writable: true
});

const stats = await import('../js/shell/system-stats.js');

// --- online / offline ---------------------------------------------------------------
//
// Event-driven, not polled. A poll can only ever report the change later than the event
// that caused it, and the tray showing "offline" a minute after the fact is worse than
// not showing it at all.

check('the state starts from navigator.onLine', stats.get().online, true);
check('and both events are listened for',
	Object.keys(netListeners).sort(), ['offline', 'online']);

navigator.onLine = false;
netListeners.offline();
check('going offline is picked up', stats.get().online, false);

navigator.onLine = true;
netListeners.online();
check('and coming back', stats.get().online, true);

// The page that boots from the cache never saw the broadcast that said the network was
// gone -- it did not exist yet -- so it asks. This is the case the tray was getting wrong:
// reloading under DevTools offline emulation can still read navigator.onLine === true.
check('the worker is asked at startup', sent, [{type: 'pixos:network?'}]);

replyToWorkerQuery({type: 'pixos:network', online: false});
check('a worker that says a request failed outranks navigator.onLine',
	stats.get().online, false);
check('and navigator still claims otherwise', navigator.onLine, true);

swListeners.message({data: {type: 'pixos:network', online: true}});
check('a later broadcast that a request succeeded clears it', stats.get().online, true);

swListeners.message({data: {type: 'pixos:network', online: false}});
check('and the broadcast works in the other direction too', stats.get().online, false);
navigator.onLine = true;
netListeners.online();
check("the browser saying the link is back clears the worker's verdict, rather than "
	+ 'waiting for a request to succeed', stats.get().online, true);

swListeners.message({data: {type: 'something-else'}});
check('an unrelated message from the worker is ignored', stats.get().online, true);

// --- getting back online when nothing announces it ----------------------------------------
//
// Switching DevTools throttling back to "no throttling" does not reliably fire `online`, so
// the tray sat on OFFLINE until something happened to be downloaded. While the answer is
// "offline", the shell now asks again rather than waiting to be told.

probes.length = 0;
swListeners.message({data: {type: 'pixos:network', online: false}});
check('going offline starts asking', intervals.size, 1);

runIntervals();
check('and it asks with a marker the cache cannot answer',
	/__pixos-probe=/.test(probes[0]), true);
check('for a real file on this origin', /favicon\.png/.test(probes[0]), true);

answerProbe(false);
await Promise.resolve();
check('a probe that fails changes nothing', stats.get().online, false);
check('and it keeps asking', intervals.size, 1);

runIntervals();
answerProbe(true);
await Promise.resolve();
await Promise.resolve();
check('a probe that succeeds is proof the network is back', stats.get().online, true);
check('and the asking stops', intervals.size, 0);

// The case that was actually reported: navigator.onLine never said anything, and no event
// arrived. A request that came back outranks both.
swListeners.message({data: {type: 'pixos:network', online: false}});
navigator.onLine = false;
check('offline again', stats.get().online, false);
swListeners.message({data: {type: 'pixos:network', online: true}});
check('a request that succeeded outranks navigator.onLine still reading false',
	stats.get().online, true);
navigator.onLine = true;

// --- durability -------------------------------------------------------------------------
//
// Everything PixOS holds is in IndexedDB, which the browser may evict under pressure. What
// gets reported is what was actually granted, never what was asked for: the three engines
// answer differently and a promise nobody verified is worse than no promise at all.

check('nothing is claimed before the browser has been asked', stats.getPersistence(), 'unknown');

navigator.storage = {
	persisted: async () => false,
	persist: async () => true,
	estimate: async () => ({usage: 1, quota: 2})
};
check('a granted request reads as persistent', await stats.requestPersistence(), 'persistent');

navigator.storage.persisted = async () => false;
navigator.storage.persist = async () => false;
check('a refused one says best-effort rather than pretending',
	await stats.requestPersistence(), 'best-effort');

navigator.storage.persisted = async () => true;
let asked = 0;
navigator.storage.persist = async () => { asked++; return true; };
check('a browser that already persists is not asked again',
	[await stats.requestPersistence(), asked], ['persistent', 0]);

navigator.storage.persisted = async () => { throw new Error('Safari'); };
check('a browser that throws is reported as unsupported, not as a failure',
	await stats.requestPersistence(), 'unsupported');

delete navigator.storage;
check('and so is one with no API at all', await stats.requestPersistence(), 'unsupported');

check('bytes stay bytes', stats.formatBytes(512), '512 B');
check('kilobytes round', stats.formatBytes(2048), '2.0 KB');
check('a large value drops the decimal', stats.formatBytes(15 * 1024 * 1024), '15 MB');
check('gigabytes keep one decimal while small', stats.formatBytes(4.25 * 1024 ** 3), '4.3 GB');
check('zero is a real measurement, not a blank', stats.formatBytes(0), '0 B');
check('undefined is a blank', stats.formatBytes(undefined), '—');

check('minutes only', stats.formatDuration(90 * 60), '1h 30m');
check('under an hour drops the hours', stats.formatDuration(20 * 60), '20m');
// dischargingTime is Infinity until the browser has an estimate, and often stays there.
check('an unknown duration is null, not "Infinity"', stats.formatDuration(Infinity), null);
check('a zero duration is null too', stats.formatDuration(0), null);

const noon = new Date(2026, 7, 27, 9, 5);
check('the clock is zero-padded', stats.formatClock(noon), '09:05');

check('nothing is measured before the first poll', stats.get().storage, null);

process.exit(report('system-stats') ? 1 : 0);
