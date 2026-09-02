// One poller for everything that reports on the machine.
//
// The taskbar tray and the desktop widgets show the same three numbers at different
// densities, so they share a source rather than each running their own timers. Nothing
// polls while the tab is hidden.

var listeners = [];
var clockTimer = null;
var storageTimer = null;
var batteryRef = null;

var STORAGE_INTERVAL = 60000;

var state = {
	now: new Date(),
	// null means "not measured yet"; supported:false means "this browser cannot".
	storage: null,
	battery: null,
	// What actually reaches the network, which is not what any single API will tell you.
	//
	// navigator.onLine reports whether the machine has *a* link, not whether anything is
	// reachable over it, and it is wrong in both directions here: under DevTools offline
	// emulation it can still read `true` on a reload (the emulation is applied to the
	// frame after the document starts), and switching the emulation off again does not
	// reliably fire the `online` event -- so the events are a useful hint and nothing
	// more. What is not a hint is a request: one that failed proves there is no network,
	// one that succeeded proves there is. The service worker reports both, and a probe
	// asks the question directly while the answer is "no".
	online: navigator.onLine !== false
};

var PROBE_INTERVAL = 10000;

var browserOnline = navigator.onLine !== false;
var requestsOnline = true;
var probeTimer = null;

function applyNetwork () {
	var next = browserOnline && requestsOnline;
	if (next !== state.online) {
		state.online = next;
		emit();
	}
	// Nothing else will say the network is back if the browser does not fire the event,
	// so while the answer is "no" it gets asked again.
	if (state.online === false) {
		startProbing();
	}
	else {
		stopProbing();
	}
}

// A request came back, one way or the other. This outranks navigator.onLine in both
// directions: a request that arrived is proof of a network whatever the browser believes,
// which is the case where the tray used to stay stuck on OFFLINE until something else
// happened to be downloaded.
function observed (reachable) {
	requestsOnline = reachable;
	if (reachable) {
		browserOnline = true;
	}
	applyNetwork();
}

['online', 'offline'].forEach(function (event) {
	window.addEventListener(event, function () {
		browserOnline = navigator.onLine !== false;
		// Optimistic: the link is reportedly back, so stop believing the last failure and
		// let the probe confirm or contradict it.
		if (browserOnline) {
			requestsOnline = true;
		}
		applyNetwork();
	});
});

// Deliberately a request that cannot be answered from the cache -- the service worker
// recognises the marker and refuses to fall back for it. A probe the cache could satisfy
// would report "online" forever.
function probe () {
	var url = new URL('favicon.png', document.baseURI);
	url.search = '__pixos-probe=' + Date.now();
	fetch(url.href, {cache: 'no-store'}).then(function () {
		observed(true);
	}).catch(function () {
		observed(false);
	});
}

function startProbing () {
	if (probeTimer || document.hidden) {
		return;
	}
	probeTimer = setInterval(probe, PROBE_INTERVAL);
}

function stopProbing () {
	clearInterval(probeTimer);
	probeTimer = null;
}

// The page that loaded from the cache missed the broadcast saying so -- it did not exist
// yet -- so it asks once, as soon as there is a worker controlling it to ask.
function askWorker () {
	var worker = navigator.serviceWorker && navigator.serviceWorker.controller;
	if (!worker) {
		return;
	}
	try {
		var channel = new MessageChannel();
		channel.port1.onmessage = function (event) {
			observed(!(event.data && event.data.online === false));
		};
		worker.postMessage({type: 'pixos:network?'}, [channel.port2]);
	}
	catch (err) {
		// A worker that will not answer leaves navigator.onLine as the only source, which
		// is where this started.
	}
}

if (navigator.serviceWorker) {
	navigator.serviceWorker.addEventListener('message', function (event) {
		if (event.data && event.data.type === 'pixos:network') {
			observed(event.data.online !== false);
		}
	});
	navigator.serviceWorker.addEventListener('controllerchange', askWorker);
	askWorker();
}

export function get () {
	return state;
}

export function subscribe (listener) {
	listeners.push(listener);
	start();
	listener(state);
	return function () {
		listeners = listeners.filter(function (item) {
			return item !== listener;
		});
		if (!listeners.length) {
			stop();
		}
	};
}

function emit () {
	listeners.slice().forEach(function (listener) {
		try {
			listener(state);
		}
		catch (err) {
			console.error('system-stats listener failed', err);
		}
	});
}

function start () {
	if (clockTimer || document.hidden) {
		return;
	}
	tickClock();
	refreshStorage();
	watchBattery();
	if (state.online === false) {
		startProbing();
	}
}

function stop () {
	clearTimeout(clockTimer);
	clearInterval(storageTimer);
	clockTimer = null;
	storageTimer = null;
	stopProbing();
}

// Re-armed rather than set on an interval, so the display flips within a few
// milliseconds of the real second instead of drifting further from it all session.
function tickClock () {
	state.now = new Date();
	emit();
	clockTimer = setTimeout(tickClock, 1000 - (Date.now() % 1000));
}

// estimate() reports what the origin uses across IndexedDB (where BrowserFS lives), the
// cache storage and the rest -- which is the honest answer to "how much space is taken",
// even though it is not the same as the size of the virtual filesystem alone. A figure
// for that would mean walking every directory, which is far too slow to put on a timer:
// the Disk Treemap app already does it properly, on demand.
async function refreshStorage () {
	clearInterval(storageTimer);
	if (!navigator.storage || typeof navigator.storage.estimate !== 'function') {
		state.storage = {supported: false};
		emit();
		return;
	}
	await readStorage();
	storageTimer = setInterval(readStorage, STORAGE_INTERVAL);
}

async function readStorage () {
	try {
		var estimate = await navigator.storage.estimate();
		state.storage = {
			supported: true,
			usage: estimate.usage || 0,
			quota: estimate.quota || 0,
			persisted: persistence
		};
	}
	catch (err) {
		state.storage = {supported: false};
	}
	emit();
}

// Whether the browser has promised not to throw the filesystem away.
//
// Everything in PixOS lives in IndexedDB, which is evictable by default: under storage
// pressure the browser may delete the origin's data, and the first anyone knows about it
// is an empty desktop. `persist()` asks it not to. The three browsers answer differently
// and none of them the same way -- Chromium grants it silently on engagement, Firefox
// prompts, Safari has no equivalent -- so what is reported is what was actually granted:
// 'persistent', 'best-effort', or 'unsupported'. A durability promise nobody verified is
// worse than no promise, because it is the one people rely on.
var persistence = 'unknown';

export function getPersistence () {
	return persistence;
}

// Asked once per boot rather than recorded: the answer can change (a Firefox prompt
// answered later, engagement crossing Chromium's threshold), and `persisted()` is a cheap
// read of a flag rather than a request.
export async function requestPersistence () {
	if (!navigator.storage || typeof navigator.storage.persisted !== 'function') {
		persistence = 'unsupported';
		return persistence;
	}
	try {
		var already = await navigator.storage.persisted();
		if (!already && typeof navigator.storage.persist === 'function') {
			already = await navigator.storage.persist();
		}
		persistence = already ? 'persistent' : 'best-effort';
	}
	catch (err) {
		// Safari throws rather than returning false in some versions.
		persistence = 'unsupported';
	}
	if (state.storage && state.storage.supported) {
		state.storage = Object.assign({}, state.storage, {persisted: persistence});
		emit();
	}
	return persistence;
}

// Chromium only: Firefox removed the Battery Status API and Safari never shipped it.
// Everything downstream has to treat an absent battery as normal, not as an error.
function watchBattery () {
	if (batteryRef !== null) {
		return;
	}
	if (typeof navigator.getBattery !== 'function') {
		batteryRef = false;
		state.battery = {supported: false};
		emit();
		return;
	}
	batteryRef = false;
	navigator.getBattery().then(function (battery) {
		batteryRef = battery;
		var update = function () {
			state.battery = {
				supported: true,
				level: battery.level,
				charging: battery.charging,
				chargingTime: battery.chargingTime,
				dischargingTime: battery.dischargingTime
			};
			emit();
		};
		['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach(function (event) {
			battery.addEventListener(event, update);
		});
		update();
	}).catch(function () {
		state.battery = {supported: false};
		emit();
	});
}

document.addEventListener('visibilitychange', function () {
	if (document.hidden) {
		stop();
	}
	else if (listeners.length) {
		start();
	}
});

export function formatBytes (bytes) {
	if (!bytes && bytes !== 0) {
		return '—';
	}
	var units = ['B', 'KB', 'MB', 'GB', 'TB'];
	var value = bytes;
	var unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return (value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)) + ' ' + units[unit];
}

export function formatClock (date) {
	return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

export function formatDate (date) {
	return date.toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short'});
}

// dischargingTime is Infinity until the browser has an estimate, and often stays there.
export function formatDuration (seconds) {
	if (!isFinite(seconds) || seconds <= 0) {
		return null;
	}
	var hours = Math.floor(seconds / 3600);
	var minutes = Math.round((seconds % 3600) / 60);
	return hours ? hours + 'h ' + minutes + 'm' : minutes + 'm';
}
