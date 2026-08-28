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
	battery: null
};

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
}

function stop () {
	clearTimeout(clockTimer);
	clearInterval(storageTimer);
	clockTimer = null;
	storageTimer = null;
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
			quota: estimate.quota || 0
		};
	}
	catch (err) {
		state.storage = {supported: false};
	}
	emit();
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
