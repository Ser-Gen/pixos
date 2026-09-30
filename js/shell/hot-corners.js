// Hot corners: the pointer resting in a corner of the tab starts the screensaver, or keeps it from
// starting. Phase 26, pass 6; docs/screensavers-plan.md.
//
// **A corner is a few pixels of its own**, in #overlays above the windows. The shell never sees the
// pointer inside a web page opened as a window, and a corner is nearly always over a window, so a
// corner that watched the shell's pointer would work only over the desktop.
//
// **It waits DWELL_MS before it starts anything.** In a browser that is not full screen, a corner of
// the page is not a corner of the screen: the pointer passes through the top two on its way to the
// tabs and the address bar, and leaving the page is a `pointerleave` that cancels the wait.
//
// **A press on a corner is passed on to what is under it**, so that a corner costs nothing but its
// wait: it cancels the wait, gets out of the way and clicks what is beneath it. **It stays out of the
// way until the pointer is seen somewhere else**, not for a time: Chrome tells an element that comes
// back under a resting pointer that the pointer has just arrived, and the screensaver would start for
// someone who had only clicked there. Seen means a move in the shell's own document; a pointer that
// leaves over a window is not seen, and the corner waits for it to come back over the shell. Today
// that is mostly the taskbar's own background -- *Start* and the strip that shows the desktop both
// sit a few pixels in from the bottom corners -- but a corner goes over whatever is drawn there. Its
// `pointerdown` is cancelled, which keeps the browser from making the `mousedown` that follows it:
// the start menu closes on a `mousedown` outside itself, and a button clicked that way would open it
// only to have it close. What is beneath may be a window's frame, which is not clicked: a click in
// the last three pixels of an app is lost.
//
// Drawn only while a screensaver is chosen, and not while it runs.

export var CORNERS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
// 'start' starts the screensaver; 'never' keeps it from starting while the pointer is there.
export var ACTIONS = ['start', 'never'];
export var DWELL_MS = 300;
export var SIZE = 3;

var STYLE_ID = 'pixos-hot-corners-style';

var CSS = `
.PixHotCorner {
	position: absolute;
	width: ${SIZE}px;
	height: ${SIZE}px;
	z-index: 1;
}
.PixHotCorner[data-corner="topLeft"] { top: 0; left: 0; }
.PixHotCorner[data-corner="topRight"] { top: 0; right: 0; }
.PixHotCorner[data-corner="bottomLeft"] { bottom: 0; left: 0; }
.PixHotCorner[data-corner="bottomRight"] { bottom: 0; right: 0; }
`;

// What /settings/desktop.json holds under `screensaver.corners`: each corner's action, or null.
export function normalizeCorners (value) {
	var input = value && typeof value === 'object' ? value : {};
	var corners = {};
	CORNERS.forEach(function (corner) {
		corners[corner] = ACTIONS.indexOf(input[corner]) > -1 ? input[corner] : null;
	});
	return corners;
}

export function anyCorner (corners) {
	return CORNERS.some(function (corner) {
		return !!(corners && corners[corner]);
	});
}

var doc = null;
var host = null;
var onStart = function () {};
var onHold = function () {};
var setTimer = null;
var clearTimer = null;

var corners = normalizeCorners(null);
var enabled = false;
// What the corners were last drawn from, so that telling them the same again changes nothing.
var drawn = null;
var elements = [];
var holding = false;

function hold (on) {
	if (holding !== on) {
		holding = on;
		onHold(on);
	}
}

function ensureStyle () {
	if (!doc || typeof doc.getElementById !== 'function' || doc.getElementById(STYLE_ID)) {
		return;
	}
	var style = doc.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	doc.head.append(style);
}

// cfg: host (#overlays), onStart(), onHold(held) -- true while the pointer rests in a 'never'
// corner -- and, for the tests, doc and the timer pair.
export function init (cfg) {
	clearElements();
	doc = cfg.doc || document;
	host = cfg.host;
	onStart = cfg.onStart || function () {};
	onHold = cfg.onHold || function () {};
	setTimer = cfg.setTimeout || function (fn, ms) { return setTimeout(fn, ms); };
	clearTimer = cfg.clearTimeout || function (id) { clearTimeout(id); };
	holding = false;
	drawn = null;
	ensureStyle();
	update(cfg.corners, cfg.enabled);
}

// The corners as chosen, and whether they are live: a screensaver is chosen and not running. The
// screensaver says so on every change it has, and the same again leaves a corner's wait running.
export function update (next, on) {
	corners = normalizeCorners(next);
	enabled = !!on;
	var key = JSON.stringify([corners, enabled]);
	if (key === drawn) {
		return;
	}
	drawn = key;
	clearElements();
	if (!enabled || !host) {
		return;
	}
	CORNERS.forEach(function (corner) {
		if (corners[corner]) {
			elements.push(makeCorner(corner, corners[corner]));
		}
	});
}

export function setEnabled (on) {
	if (!!on !== enabled) {
		update(corners, on);
	}
}

function clearElements () {
	elements.forEach(function (item) {
		item.dispose();
	});
	elements = [];
	hold(false);
}

function makeCorner (corner, action) {
	var element = doc.createElement('div');
	element.className = 'PixHotCorner';
	element.dataset.corner = corner;
	element.setAttribute('aria-hidden', 'true');
	var wait = null;
	var aside = false;

	function cancel () {
		if (wait !== null) {
			clearTimer(wait);
			wait = null;
		}
	}

	element.addEventListener('pointerenter', function () {
		if (action === 'never') {
			hold(true);
			return;
		}
		cancel();
		wait = setTimer(function () {
			wait = null;
			onStart();
		}, DWELL_MS);
	});
	element.addEventListener('pointerleave', function () {
		cancel();
		if (action === 'never') {
			hold(false);
		}
	});
	element.addEventListener('pointerdown', function (e) {
		e.preventDefault();
		cancel();
		if (action === 'never') {
			hold(false);
		}
		stepAside();
		var below = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(e.clientX, e.clientY) : null;
		var tag = below ? String(below.tagName || '').toUpperCase() : '';
		if (below && tag !== 'IFRAME' && tag !== 'FRAME' && typeof below.click === 'function') {
			below.click();
		}
	});
	// Out of the way until a move is seen more than a corner's width from it.
	function stepAside () {
		element.style.pointerEvents = 'none';
		if (!aside) {
			aside = true;
			doc.addEventListener('pointermove', comeBack, true);
		}
	}

	function comeBack (e) {
		var box = element.getBoundingClientRect();
		var away = e.clientX < box.left - SIZE || e.clientX > box.right + SIZE
			|| e.clientY < box.top - SIZE || e.clientY > box.bottom + SIZE;
		if (away) {
			back();
		}
	}

	function back () {
		if (aside) {
			aside = false;
			doc.removeEventListener('pointermove', comeBack, true);
		}
		element.style.pointerEvents = '';
	}

	host.append(element);

	return {
		element: element,
		dispose: function () {
			cancel();
			back();
			element.remove();
		}
	};
}
