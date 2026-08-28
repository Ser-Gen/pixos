// Desktop widgets: the same numbers the tray shows, at the size you can actually read
// them, on the surface you see when the windows are out of the way.
//
// A widget is {label, render(element, state), mount(element)}. `render` runs on every
// system-stats tick; `mount` runs once when the widget is placed, which is where a widget
// whose content comes from a file does its reading. Either may be omitted -- the About
// widget has no tick, the clock has nothing to load.
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

.PixWidget--about {
	cursor: pointer;
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

export function listAvailable () {
	return Object.keys(registry).map(function (id) {
		return {id: id, label: registry[id].label};
	});
}

export var DEFAULT_WIDGETS = ['clock', 'about', 'storage', 'battery'];

// Re-mounts from scratch: the list is short and changing it is a deliberate act, so
// there is nothing here worth the complexity of diffing.
export function mount (host, enabled) {
	ensureStyle();

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

export function setVisible (visible) {
	if (!container) {
		return;
	}
	container.style.opacity = visible ? '1' : '0';
	// Faded out is not the same as gone: without this the About card keeps taking clicks
	// in the top-right corner of the desktop while it is invisible.
	container.style.pointerEvents = visible ? '' : 'none';
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
	render: function (element, state) {
		block(element, stats.formatDate(state.now), stats.formatClock(state.now));
	}
});

register('storage', {
	label: 'Storage',
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
	}
});

register('battery', {
	label: 'Battery',
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
	className: 'PixWidget--about',
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

	// The card itself opens the file, so the widget is a way *into* it and not just a
	// read-only summary of something you then have to hunt down.
	element.title = 'Open ' + result.path;
	element.onclick = function (e) {
		if (e.target.closest('a')) {
			return;
		}
		if (window.openFile) {
			window.openFile(result.path);
		}
	};
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
