// What the page can see about the machine it is running on, turned into rows.
//
// Pure, and the environment is an argument rather than a read of `navigator`: the whole
// point of this app is what happens when something is *missing*, and a browser that has
// everything is the one case you can test by opening it. Every value the app can fail to
// obtain arrives here as null, and every null becomes a row that says why rather than a
// blank one or no row at all.
//
// Nothing here reaches the network. See NOTICE below -- it is shown in the app, because
// this is precisely the surface a fingerprinting script reads, and a page that quietly
// collects it while looking useful is the thing worth not being.

export var NOTICE = 'Everything on this page was read by this page, from your own browser. '
	+ 'It is also exactly what a fingerprinting script reads, which is why it is worth '
	+ 'seeing once. Nothing here is sent anywhere: PixOS has no backend to send it to.';

export function formatBytes (bytes) {
	if (typeof bytes !== 'number' || !isFinite(bytes)) {
		return null;
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

export function formatDuration (seconds) {
	if (typeof seconds !== 'number' || !isFinite(seconds) || seconds <= 0) {
		return null;
	}
	var minutes = Math.round(seconds / 60);
	if (minutes < 60) {
		return minutes + ' min';
	}
	return Math.floor(minutes / 60) + ' h ' + (minutes % 60) + ' min';
}

// A row is {label, value, note}. `value === null` is the missing case and the note then
// has to carry the reason -- "Unavailable" on its own is the blank row with extra steps.
function row (label, value, note) {
	return {label: label, value: value === undefined ? null : value, note: note || ''};
}

function section (title, rows, note) {
	return {
		title: title,
		note: note || '',
		rows: rows.filter(Boolean)
	};
}

function browserName (env) {
	if (env.brands && env.brands.length) {
		// Chromium sends a deliberately silly brand ("Not/A)Brand") to break bad sniffing.
		var real = env.brands.filter(function (entry) {
			return entry && entry.brand && !/not.?a.?brand/i.test(entry.brand);
		});
		var list = (real.length ? real : env.brands).map(function (entry) {
			return entry.brand + ' ' + entry.version;
		});
		return list.join(', ');
	}
	return env.userAgent || null;
}

export function collect (env) {
	var e = env || {};
	var screen = e.screen || {};
	var viewport = e.viewport || {};
	var storage = e.storage || {};
	var battery = e.battery || {};
	var connection = e.connection || null;
	var worker = e.serviceWorker || {};

	return [
		section('Browser', [
			row('Browser', browserName(e), e.brands && e.brands.length
				? 'From navigator.userAgentData, which is what the browser volunteers.'
				: 'From the user agent string; browsers freeze and fake parts of it.'),
			row('User agent', e.userAgent, 'Not reported by this browser.'),
			row('Language', e.language, 'Not reported.'),
			row('Also accepts', (e.languages && e.languages.length) ? e.languages.join(', ') : null,
				'navigator.languages is missing here.'),
			row('Time zone', e.timeZone, 'Intl could not resolve one.'),
			row('Secure context', boolText(e.secureContext, 'Yes', 'No — some APIs will refuse'),
				'The browser does not say.'),
			row('Cross-origin isolated', boolText(e.crossOriginIsolated, 'Yes', 'No'),
				'The browser does not say. PixOS asks for it — its service worker sends '
				+ 'COOP: same-origin with COEP: credentialless — so this is normally Yes, '
				+ 'and No on the very first load before the worker takes over, or in a '
				+ 'browser that does not implement credentialless.')
		]),

		section('Machine', [
			row('Platform', e.platform || e.uaPlatform, 'Not reported.'),
			row('CPU cores', typeof e.cores === 'number' ? String(e.cores) : null,
				'navigator.hardwareConcurrency is missing — Safari has never reported it.'),
			row('Memory', typeof e.memoryGB === 'number' ? e.memoryGB + ' GB or more' : null,
				'navigator.deviceMemory is Chromium-only, and rounded when it is there.'),
			row('Touch points', typeof e.maxTouchPoints === 'number' ? String(e.maxTouchPoints) : null,
				'Not reported.'),
			row('Battery', batteryText(battery),
				'navigator.getBattery is Chromium-only; Firefox and Safari removed it.'),
			row('Charge state', battery.supported && battery.charging !== undefined
				? (battery.charging
					? 'Charging' + suffix(formatDuration(battery.chargingTime), ' · ', ' to full')
					: 'On battery' + suffix(formatDuration(battery.dischargingTime), ' · ', ' remaining'))
				: null,
				'No battery API here.')
		]),

		section('Display', [
			row('Screen', size(screen.width, screen.height), 'Not reported.'),
			row('Available', size(screen.availWidth, screen.availHeight),
				'Not reported. This is the screen minus the OS bars.'),
			row('This window', size(viewport.width, viewport.height), 'Not measurable.'),
			row('Device pixel ratio', typeof e.dpr === 'number' ? String(e.dpr) : null,
				'Not reported; assume 1.'),
			row('Colour depth', typeof screen.colorDepth === 'number' ? screen.colorDepth + ' bit' : null,
				'Not reported.'),
			row('Colour scheme', e.colorScheme, 'matchMedia is unavailable.'),
			row('Reduced motion', e.reducedMotion, 'matchMedia is unavailable.')
		]),

		section('Network', [
			row('Status', e.online === undefined ? null : (e.online ? 'Online' : 'Offline'),
				'navigator.onLine is missing.'),
			row('Connection', connection && connection.effectiveType ? connection.effectiveType : null,
				'navigator.connection is Chromium-only.'),
			row('Downlink', connection && typeof connection.downlink === 'number'
				? connection.downlink + ' Mbit/s' : null, 'Not reported.'),
			row('Round trip', connection && typeof connection.rtt === 'number'
				? connection.rtt + ' ms' : null, 'Not reported.'),
			row('Data saver', connection && connection.saveData !== undefined
				? (connection.saveData ? 'On' : 'Off') : null, 'Not reported.')
		], 'PixOS trusts a request that actually failed over navigator.onLine, which is '
			+ 'wrong in both directions. This row is the browser’s opinion, not the '
			+ 'shell’s.'),

		section('Storage', [
			row('Used', storage.supported ? formatBytes(storage.usage) : null,
				'navigator.storage.estimate is unavailable, so nothing can say how much '
				+ 'space PixOS is using.'),
			row('Quota', storage.supported ? formatBytes(storage.quota) : null, 'Unavailable.'),
			row('Share of quota', storage.supported && storage.quota
				? Math.round((storage.usage / storage.quota) * 100) + '%' : null, 'Unavailable.'),
			row('Durability', durabilityText(storage.persisted),
				'This browser does not say whether it will keep the data. Safari, for one, '
				+ 'has no equivalent.'),
			row('Service worker', worker.supported
				? (worker.controlled ? 'Running, serving this page' : 'Supported, not controlling this page')
				: null,
				'Service workers are unavailable — PixOS cannot serve its own filesystem '
				+ 'without one, so this page is unlikely to be here at all.')
		], 'Everything you keep in PixOS is in this origin’s storage, and nowhere else.'),

		section('What PixOS needs', capabilities(e),
			'Feature-detected here, now. A missing one does not break the whole system — '
			+ 'it takes out the one thing named beside it.')
	];
}

function suffix (value, before, after) {
	return value ? before + value + after : '';
}

function size (width, height) {
	return (typeof width === 'number' && typeof height === 'number')
		? width + ' × ' + height
		: null;
}

function boolText (value, yes, no) {
	if (value === undefined || value === null) {
		return null;
	}
	return value ? yes : no;
}

function batteryText (battery) {
	if (!battery || !battery.supported || typeof battery.level !== 'number') {
		return null;
	}
	return Math.round(battery.level * 100) + '%';
}

function durabilityText (persisted) {
	if (persisted === 'persistent') {
		return 'Persistent — the browser has promised to keep it';
	}
	if (persisted === 'best-effort') {
		return 'Best effort — it may be evicted under pressure';
	}
	return null;
}

// The list is the argument for this app existing: these are the APIs PixOS is built on,
// and each row says what stops working rather than only whether a name is defined.
export var CAPABILITIES = [
	{key: 'serviceWorker', label: 'Service workers',
		cost: 'The virtual filesystem is served through one. Without it no app can open a file.'},
	{key: 'indexedDB', label: 'IndexedDB',
		cost: 'BrowserFS keeps your files in it. Without it nothing you save survives a reload.'},
	{key: 'storagePersist', label: 'Persistent storage',
		cost: 'Without it the browser may evict everything PixOS holds to reclaim space.'},
	{key: 'broadcastChannel', label: 'BroadcastChannel',
		cost: 'One tab owns the session. Without it two open tabs would both write it and the last one would win.'},
	{key: 'webAssembly', label: 'WebAssembly',
		cost: '7-Zip and FFmpeg are WebAssembly builds.'},
	{key: 'fileSystemAccess', label: 'File System Access',
		cost: 'Mounting a folder from the real disk. Chromium only.'},
	{key: 'clipboardWrite', label: 'Clipboard write',
		cost: 'Copy path falls back to a dialog you can copy out of by hand.'},
	{key: 'fullscreen', label: 'Fullscreen',
		cost: 'The fullscreen mode where Ctrl/Cmd+W can be the shell’s.'},
	{key: 'keyboardLock', label: 'Keyboard lock',
		cost: 'Without it Ctrl/Cmd+W closes the browser tab even in fullscreen. Chromium only.'},
	{key: 'webGL', label: 'WebGL',
		cost: 'The animated wallpaper. The picture and gradient wallpapers do not need it.'},
	{key: 'displayMedia', label: 'Screen capture',
		cost: 'Explorer’s screen recording.'},
	{key: 'sharedArrayBuffer', label: 'SharedArrayBuffer',
		cost: 'Multi-threaded WebAssembly. It follows cross-origin isolation above, and it '
			+ 'is why the archive engine is the single-threaded build — that one works here '
			+ 'whatever this row says.'}
];

export function capabilities (env) {
	var features = (env && env.features) || {};
	return CAPABILITIES.map(function (entry) {
		var has = features[entry.key];
		return {
			label: entry.label,
			value: has === undefined ? null : (has ? 'Available' : 'Missing'),
			note: entry.cost,
			// Missing is not the same as unknown, and this is the one place the difference
			// is worth showing: an unchecked capability is a bug in the probe, not a
			// browser that lacks it.
			state: has === undefined ? 'unknown' : (has ? 'ok' : 'missing')
		};
	});
}
