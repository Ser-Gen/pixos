// Desktop widgets: the same numbers the tray shows, at the size you can actually read
// them, on the surface you see when the windows are out of the way.
//
// A widget is {label, render(element, state), mount(element), open}. `render` runs on
// every system-stats tick; `mount` runs once when the widget is placed, which is where a
// widget whose content comes from a file does its reading. Either may be omitted -- the
// About widget has no tick, the clock has nothing to load.
//
// `open: {title, run}` is what makes a widget a door rather than a number you cannot act
// on. The container owns everything about it -- the cursor, the hover state, the tooltip,
// ending a peek, and reporting a failure -- because the About card used to own all of
// that by hand and was the only widget that did, which is how the other three stayed
// dead ends for as long as they did.
//
// Registering one is all it takes to make it available; which ones are shown lives in
// /settings/desktop.json.

import * as stats from './system-stats.js';
import * as about from './about.js';

var STYLE_ID = 'pixos-widgets-style';

var CSS = `
.PixWidgets {
	position: absolute;
	top: 22px;
	right: 22px;
	display: flex;
	flex-direction: column;
	gap: 12px;
	width: 220px;
	font-family: Arial, Helvetica, sans-serif;
	transition: opacity 200ms ease;
}

.PixWidget {
	padding: 14px 16px;
	background: rgba(18, 21, 26, .5);
	border: 1px solid rgba(255, 255, 255, .09);
	color: #e6e9ee;
	backdrop-filter: blur(3px);
}

.PixWidget__label {
	font-size: 10px;
	text-transform: uppercase;
	letter-spacing: .09em;
	color: #98a0ac;
	margin-bottom: 8px;
}

.PixWidget__value {
	font-size: 30px;
	line-height: 1.1;
	font-variant-numeric: tabular-nums;
}

.PixWidget__value--small {
	font-size: 20px;
}

.PixWidget__sub {
	margin-top: 6px;
	font-size: 12px;
	color: #98a0ac;
}

.PixWidget__durability {
	margin-top: 8px;
	font-size: 11px;
	cursor: help;
}

.PixWidget__durability--warn {
	color: #ffb648;
}

.PixWidget__bar {
	position: relative;
	height: 6px;
	margin-top: 10px;
	background: rgba(255, 255, 255, .14);
	overflow: hidden;
}

.PixWidget__barFill {
	position: absolute;
	inset: 0 auto 0 0;
	background: #6fb3ff;
	transition: width 400ms ease;
}

.PixWidget__barFill--warn {
	background: #ffb648;
}

.PixWidget__barFill--critical {
	background: #ff6b5e;
}

.PixWidget--open {
	cursor: pointer;
	transition: background 120ms ease, border-color 120ms ease;
}

.PixWidget--open:hover {
	background: rgba(24, 28, 34, .62);
	border-color: rgba(255, 255, 255, .2);
}

.PixWidget__name {
	font-size: 17px;
	line-height: 1.25;
}

.PixWidget__links {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-top: 11px;
}

.PixWidget__links a {
	padding: 3px 9px;
	font-size: 11px;
	color: #e6e9ee;
	text-decoration: none;
	border: 1px solid rgba(255, 255, 255, .16);
	border-radius: 999px;
}

.PixWidget__links a:hover {
	color: #6fb3ff;
	border-color: #6fb3ff;
}
`;

var registry = {};
var container = null;
var unsubscribe = null;
var mounted = [];
var onOpen = function () {};

function ensureStyle () {
	if (document.getElementById(STYLE_ID)) {
		return;
	}
	var style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.append(style);
}

export function register (id, widget) {
	registry[id] = Object.assign({id: id}, widget);
}

// The taskbar tray shows the same three readings in miniature, and asks for the widget
// behind one so a click there lands in the same place. The destination belongs to the
// reading, not to the surface it is drawn on -- two copies of "the clock opens the
// calendar" is how they would come to disagree.
export function get (id) {
	return registry[id] || null;
}

export function listAvailable () {
	return Object.keys(registry).map(function (id) {
		return {id: id, label: registry[id].label};
	});
}

export var DEFAULT_WIDGETS = ['clock', 'about', 'storage', 'battery'];

// Re-mounts from scratch: the list is short and changing it is a deliberate act, so
// there is nothing here worth the complexity of diffing.
//
// `cfg.onOpen` runs before a widget's own `open.run`, and is how the desktop ends a peek.
export function mount (host, enabled, cfg) {
	ensureStyle();
	onOpen = (cfg && cfg.onOpen) || onOpen;

	if (unsubscribe) {
		unsubscribe();
		unsubscribe = null;
	}
	if (container) {
		container.remove();
	}

	container = document.createElement('div');
	container.className = 'PixWidgets';

	mounted = (enabled || DEFAULT_WIDGETS)
		.filter(function (id) {
			return registry[id];
		})
		.map(function (id) {
			var element = document.createElement('div');
			element.className = 'PixWidget' + (registry[id].className ? ' ' + registry[id].className : '');
			container.append(element);
			return {widget: registry[id], element: element};
		});

	host.append(container);

	mounted.forEach(function (entry) {
		bindOpen(entry.element, entry.widget);
	});

	// Once, at placement. A widget that reads a file does it here rather than on every
	// tick, and a failure in one must not take the others down with it.
	mounted.forEach(function (entry) {
		if (!entry.widget.mount) {
			return;
		}
		try {
			entry.widget.mount(entry.element);
		}
		catch (err) {
			console.error('widget "' + entry.widget.id + '" failed to mount', err);
		}
	});

	var ticking = mounted.filter(function (entry) {
		return typeof entry.widget.render === 'function';
	});

	if (ticking.length) {
		unsubscribe = stats.subscribe(function (state) {
			ticking.forEach(function (entry) {
				try {
					entry.widget.render(entry.element, state);
				}
				catch (err) {
					console.error('widget "' + entry.widget.id + '" failed to render', err);
				}
			});
		});
	}

	return container;
}

function bindOpen (element, widget) {
	if (!widget.open || typeof widget.open.run !== 'function') {
		return;
	}
	element.classList.add('PixWidget--open');
	// The tooltip is the only place a widget can say where it leads before you press it.
	element.title = widget.open.title || '';
	element.onclick = openHandler(widget);
}

// What a click on a widget means, apart from the element it arrived on -- which is what
// makes it testable without a browser.
export function openHandler (widget) {
	return function (e) {
		// A link inside a card is its own destination: the About card's links go where
		// they point rather than to the file that lists them.
		if (e && e.target && e.target.closest && e.target.closest('a')) {
			return;
		}
		runOpen(widget);
	};
}

function runOpen (widget) {
	// The peek is over the moment a window is needed. The WM's `opened` event ends it too,
	// but only once a window actually exists: an open that has to install an app first, or
	// that fails outright, would otherwise leave you peeking at a desktop and wondering
	// whether the click registered.
	try {
		onOpen();
	}
	catch (err) {
		console.error('ending the peek for widget "' + widget.id + '" failed', err);
	}
	// A widget is a shortcut, and a shortcut that fails silently is worse than one that
	// was never offered -- the failure surface is the same one the rest of the shell uses.
	Promise.resolve().then(widget.open.run).catch(function (err) {
		console.error('widget "' + widget.id + '" could not open', err);
		if (typeof window.notify !== 'function') {
			return;
		}
		var context = 'Could not open this from the ' + (widget.label || widget.id) + ' widget';
		var described = typeof window.describeError === 'function'
			? window.describeError(context, err)
			: {title: context, message: String((err && err.message) || err)};
		window.notify({
			level: 'error',
			title: described.title,
			message: described.message,
			source: 'PixOS'
		});
	});
}

export function setVisible (visible) {
	if (!container) {
		return;
	}
	container.style.opacity = visible ? '1' : '0';
	// Faded out is not the same as gone: without this the About card keeps taking clicks
	// in the top-right corner of the desktop while it is invisible.
	container.style.pointerEvents = visible ? '' : 'none';
}

var DURABILITY = {
	persistent: {text: 'Storage is persistent', title: 'The browser has promised not to evict '
		+ 'this origin\u2019s data to reclaim space. Your files stay until you delete them.'},
	'best-effort': {text: 'Best effort only', title: 'The browser did not grant persistent '
		+ 'storage, so it may evict everything PixOS holds if the device runs short of '
		+ 'space. Export anything you cannot lose.'},
	unsupported: {text: 'Durability unknown', title: 'This browser does not report whether '
		+ 'it will keep the data. Safari, for one, has no equivalent.'},
	unknown: {text: 'Checking\u2026', title: 'Asking the browser whether it will keep this '
		+ 'origin\u2019s data.'}
};

function durability (element, level) {
	var info = DURABILITY[level] || DURABILITY.unknown;
	var node = document.createElement('div');
	node.className = 'PixWidget__sub PixWidget__durability'
		+ (level === 'best-effort' ? ' PixWidget__durability--warn' : '');
	node.textContent = info.text;
	node.title = info.title;
	element.append(node);
}

function block (element, label, value, sub, valueClass) {
	element.innerHTML = '';

	var labelNode = document.createElement('div');
	labelNode.className = 'PixWidget__label';
	labelNode.textContent = label;

	var valueNode = document.createElement('div');
	valueNode.className = 'PixWidget__value' + (valueClass ? ' ' + valueClass : '');
	valueNode.textContent = value;

	element.append(labelNode, valueNode);

	if (sub) {
		var subNode = document.createElement('div');
		subNode.className = 'PixWidget__sub';
		subNode.textContent = sub;
		element.append(subNode);
	}
	return element;
}

function bar (element, ratio, severity) {
	var wrapper = document.createElement('div');
	wrapper.className = 'PixWidget__bar';
	var fill = document.createElement('div');
	fill.className = 'PixWidget__barFill'
		+ (severity > 0.9 ? ' PixWidget__barFill--critical' : severity > 0.75 ? ' PixWidget__barFill--warn' : '');
	fill.style.width = (Math.max(0, Math.min(1, ratio)) * 100) + '%';
	wrapper.append(fill);
	element.append(wrapper);
}

register('clock', {
	label: 'Clock',
	// Today's date, at the size you can read it, is a question about the month around it
	// often enough that the card was the most obvious dead end of the four.
	open: {
		title: 'Open the calendar',
		run: function () {
			return window.openCatalogApp('calendar');
		}
	},
	render: function (element, state) {
		block(element, stats.formatDate(state.now), stats.formatClock(state.now));
	}
});

register('storage', {
	label: 'Storage',
	// This card reports how much is gone; treemap is the only thing in the system that
	// answers the question that immediately follows.
	open: {
		title: 'Show what is using the space',
		run: function () {
			return window.openCatalogApp('treemap', ['/']);
		}
	},
	render: function (element, state) {
		if (!state.storage) {
			block(element, 'Storage', '…');
			return;
		}
		if (!state.storage.supported) {
			block(element, 'Storage', 'Unavailable', 'This browser does not report storage usage', 'PixWidget__value--small');
			return;
		}
		var ratio = state.storage.quota ? state.storage.usage / state.storage.quota : 0;
		block(element, 'Storage', stats.formatBytes(state.storage.usage),
			'of ' + stats.formatBytes(state.storage.quota) + ' available');
		bar(element, ratio, ratio);
		// What was actually granted, not what was asked for. A browser that evicts this
		// origin under pressure takes the whole filesystem with it, and the difference
		// between "promised" and "best effort" is the difference between a system you can
		// keep things in and one you cannot.
		durability(element, state.storage.persisted);
	}
});

register('battery', {
	label: 'Battery',
	// The battery is one reading of many the browser will answer for, and this is the
	// card you are looking at when you start wondering what else it knows.
	open: {
		title: 'What this browser reports about the machine',
		run: function () {
			return window.openCatalogApp('system-info');
		}
	},
	render: function (element, state) {
		if (!state.battery) {
			block(element, 'Battery', '…');
			return;
		}
		// Chromium only. Rather than a permanently blank card, say why it is empty.
		if (!state.battery.supported) {
			block(element, 'Battery', 'Unavailable', 'Only Chromium-based browsers report battery level', 'PixWidget__value--small');
			return;
		}
		var level = state.battery.level;
		var remaining = state.battery.charging
			? stats.formatDuration(state.battery.chargingTime)
			: stats.formatDuration(state.battery.dischargingTime);
		block(element, 'Battery', Math.round(level * 100) + '%',
			state.battery.charging
				? (remaining ? 'Charging · ' + remaining + ' to full' : 'Charging')
				: (remaining ? remaining + ' remaining' : 'On battery'));
		bar(element, level, 1 - level);
	}
});

// Your face on the wallpaper rather than a file you have to go and find. Everything it
// shows comes from the frontmatter of /home/about.md, so editing the file is the whole
// configuration story -- there is no widget setting anywhere.
register('about', {
	label: 'About me',
	// The card that solved this first, now saying it the same way the others do.
	open: {
		title: 'Open ' + about.ABOUT_PATH,
		run: function () {
			return window.openFile(about.ABOUT_PATH);
		}
	},
	mount: function (element) {
		block(element, 'About', '…', null, 'PixWidget__name');
		about.read().then(function (result) {
			drawAbout(element, result);
		});
	}
});

function drawAbout (element, result) {
	var profile = result.profile;

	if (result.error || (!profile.name && !profile.tagline)) {
		block(element, 'About', 'Not set up yet',
			result.error
				? 'Create ' + result.path + ' to fill this in'
				: 'Add name: and tagline: to the top of ' + result.path,
			'PixWidget__name');
	}
	else {
		block(element, 'About', profile.name || 'You', profile.tagline, 'PixWidget__name');
	}

	if (profile.links.length) {
		var row = document.createElement('div');
		row.className = 'PixWidget__links';
		profile.links.forEach(function (link) {
			row.append(aboutLink(link));
		});
		element.append(row);
	}

}

function aboutLink (link) {
	var node = document.createElement('a');
	node.textContent = link.title;
	node.href = link.url;
	if (/^(https?:|mailto:)/i.test(link.url)) {
		node.target = '_blank';
		node.rel = 'noopener noreferrer';
		return node;
	}
	// A filesystem path opens in PixOS instead of navigating the shell away from itself.
	node.addEventListener('click', function (e) {
		e.preventDefault();
		e.stopPropagation();
		if (window.openPath) {
			window.openPath(link.url);
		}
	});
	return node;
}
