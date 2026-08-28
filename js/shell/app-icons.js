// App icons, and what to draw when there isn't one.
//
// Only a couple of apps ship a favicon, so the fallback is the common case, not the
// exception: a monogram tile whose colour is derived from the app id. Deterministic, so
// an app keeps the same colour forever, and offline, so nothing is ever fetched.

var STYLE_ID = 'pixos-app-icon-style';

var CSS = `
.PixIcon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: none;
	border-radius: 4px;
	overflow: hidden;
	font-family: Arial, Helvetica, sans-serif;
	font-weight: bold;
	color: #fff;
	text-transform: uppercase;
	user-select: none;
}

.PixIcon img {
	width: 100%;
	height: 100%;
	object-fit: contain;
	display: block;
}
`;

function ensureStyle () {
	if (document.getElementById(STYLE_ID)) {
		return;
	}
	var style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.append(style);
}

// FNV-1a. Any stable hash would do; this one is short and has no surprises for ASCII ids.
function hashString (value) {
	var hash = 2166136261;
	var text = String(value || '');
	for (var i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

// Hue varies, saturation and lightness do not: the tiles stay legible against each other
// and against white text, which a free-for-all over the whole colour space would not.
export function colorFor (appId) {
	return 'hsl(' + (hashString(appId) % 360) + ', 42%, 44%)';
}

export function monogramFor (name, appId) {
	var words = String(name || appId || '?')
		.replace(/[-_.]+/g, ' ')
		.split(/\s+/)
		.filter(Boolean);
	if (!words.length) {
		return '?';
	}
	if (words.length === 1) {
		return words[0].slice(0, 1);
	}
	return words[0].slice(0, 1) + words[1].slice(0, 1);
}

// Two places an icon can live, tried in order: the installed copy in BrowserFS, then the
// original on the server. The second matters more than it looks -- an app installed
// before it gained an icon has no copy of the file until the user takes the update, and
// falling back to the catalog means the icon shows up anyway.
export function urlCandidates (app) {
	if (!app || !app.icon) {
		return [];
	}
	var icon = String(app.icon);
	if (/^(data:|blob:|https?:)/.test(icon)) {
		return [icon];
	}
	var absolute = icon.charAt(0) === '/' ? icon : '/' + icon;
	if (absolute.indexOf('/__browserfs__') === 0) {
		return [absolute];
	}
	return ['/__browserfs__' + absolute, absolute];
}

export function urlFor (app) {
	return urlCandidates(app)[0] || null;
}

// A missing or unreadable icon file falls back to the monogram rather than leaving a
// broken image in the taskbar -- which is the whole point of drawing the monogram first
// and only replacing it once the image has actually loaded.
export function render (app, size) {
	ensureStyle();

	var element = document.createElement('span');
	element.className = 'PixIcon';
	element.style.width = size + 'px';
	element.style.height = size + 'px';
	element.style.fontSize = Math.max(8, Math.round(size * 0.44)) + 'px';
	element.style.background = colorFor(app && app.id);
	element.textContent = monogramFor(app && app.name, app && app.id);

	var candidates = urlCandidates(app);
	if (candidates.length) {
		var image = document.createElement('img');
		var attempt = 0;
		image.alt = '';
		image.onload = function () {
			element.textContent = '';
			element.style.background = 'transparent';
			element.append(image);
		};
		// Exhausting every candidate simply leaves the monogram in place.
		image.onerror = function () {
			attempt++;
			if (attempt < candidates.length) {
				image.src = candidates[attempt];
			}
		};
		image.src = candidates[0];
	}

	return element;
}
