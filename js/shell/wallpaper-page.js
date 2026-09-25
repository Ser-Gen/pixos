// A page as a wallpaper: a screensaver file (`Name.xscr.html`) or folder (`Name.xscr/`, with an
// `index.html` inside), drawn in a frame behind the windows. Phase 26; docs/screensavers-plan.md.
//
// It registers itself like the shader provider does, and three things set it apart from every
// background before it:
//
//   Pausing a page that is not ours. Checked in headless Chrome 153 with
//   docs/checks/hidden-frame.html: a same-origin frame hidden by `display:none`,
//   `visibility:hidden` or `opacity:0` goes on drawing at 60 frames a second. Hiding it does
//   nothing. So a page offering `window.pixosPause` / `window.pixosResume` is asked, and any
//   other page has its `requestAnimationFrame` held from outside -- the same check took that
//   to 0 frames, and back to 60 after. What a hold cannot reach, a timer or a CSS animation,
//   stops when wallpaper.js unloads the page after it has been out of sight for a while.
//
//   Input. The frame keeps `pointer-events: none`, or it would take right-clicks and dropped
//   files away from the desktop. The desktop hands it pointer moves and left clicks instead,
//   as events made in the frame's own window -- possible only because every page here is
//   same-origin.
//
//   A missing file. The worker answers one with a 404 page, which a frame draws as readily as
//   the real thing. Chrome reports the status of what a frame loaded, so a page that 404s is
//   taken away and the failure said out loud; a browser that does not report it shows the 404.
//
// A folder may have looks (pass 4): several pages or queries in one folder, listed in its
// looks.json. A choice names its look's page as `options.entry`; a folder chosen by its path alone
// opens its first look.
//
// Screensavers are trusted like apps: the page runs in PixOS's origin. Sandboxing both is a
// phase of its own (docs/backlog.md).

import * as wallpaper from './wallpaper.js';

// `Name.xscr.html` is one self-contained page; `Name.xscr` is a folder holding one. The name
// keeps an honest `.html` so that the same file opens from a plain link outside PixOS.
export function isScreensaverPath (path) {
	return typeof path === 'string' && /\.xscr(\.html?|\/?)$/i.test(path);
}

function isFolderPath (path) {
	return /\.xscr\/?$/i.test(path);
}

// What a screensaver is called: its name without the `.xscr` and whatever follows it, from
// the path of the screensaver or of any file inside a folder one. '' when it is not one.
export function pageName (path) {
	var text = String(path || '');
	try {
		text = decodeURIComponent(text);
	}
	catch (err) {
		// A stray % is a character in a filename, not an escape.
	}
	var match = /([^/]+)\.xscr(?:\.html?$|\/|$)/i.exec(text);
	return match ? match[1] : '';
}

// A folder's looks, from its `looks.json` (pass 4): `{looks: [{name, entry, files, tile}]}`, where
// `entry` is the page and query the look opens, `files` what only it needs (read by the generator,
// scripts/screensaver-index.js, which is strict about all of it), and `tile` a CSS background for its
// tile in the gallery. Read leniently here: a look without a name, or with an entry pageUrl would
// refuse, is left out, and anything that is not a list of looks is none.
export function readLooks (doc) {
	var looks = doc && Array.isArray(doc.looks) ? doc.looks : [];
	var seen = {};
	return looks.filter(function (look) {
		var name = look && typeof look.name === 'string' ? look.name.trim() : '';
		if (!name || seen[name]) {
			return false;
		}
		if (look.entry !== undefined && !pageUrl('/a.xscr', look.entry)) {
			return false;
		}
		seen[name] = true;
		return true;
	}).map(function (look) {
		var out = {name: look.name.trim()};
		if (typeof look.entry === 'string') {
			out.entry = look.entry;
		}
		if (typeof look.tile === 'string') {
			out.tile = look.tile;
		}
		return out;
	});
}

// Where the frame goes. A folder opens its `entry`, `index.html` unless a look names another
// page or a query inside it; the entry is relative and may not climb out of the folder. Each
// part of the path is escaped, because a `#` or `?` in a filename is otherwise the end of it.
export function pageUrl (path, entry) {
	if (typeof path !== 'string' || path.charAt(0) !== '/' || !isScreensaverPath(path)) {
		return null;
	}
	var served = path.indexOf('/__browserfs__/') === 0 ? path.slice('/__browserfs__'.length) : path;
	var escaped = '/__browserfs__' + served.replace(/\/+$/, '').split('/').map(function (part) {
		return encodeURIComponent(part);
	}).join('/');
	if (!isFolderPath(served)) {
		return escaped;
	}
	var inside = typeof entry === 'string' && entry ? entry : 'index.html';
	if (inside.charAt(0) === '/' || /^[a-z][a-z0-9+.-]*:/i.test(inside) || /(^|\/)\.\.(\/|$|\?|#)/.test(inside)) {
		return null;
	}
	return escaped + '/' + inside;
}

// Holding a same-origin window's animation frames from outside. Its requestAnimationFrame is
// replaced for as long as the document lives: while held, a callback is queued under a
// negative id instead of scheduled, and a release hands the queue to the real one. The page's
// cancelAnimationFrame is replaced too, so that cancelling an id it was given -- queued, or
// since handed on -- still cancels.
export function holdAnimationFrames (win) {
	var request = win.requestAnimationFrame;
	var cancel = win.cancelAnimationFrame;
	var queue = new Map();
	var handedOn = new Map();
	var held = false;
	var next = 0;

	win.requestAnimationFrame = function (callback) {
		if (!held) {
			return request.call(win, callback);
		}
		next -= 1;
		queue.set(next, callback);
		return next;
	};
	win.cancelAnimationFrame = function (id) {
		if (queue.delete(id)) {
			return;
		}
		if (handedOn.has(id)) {
			cancel.call(win, handedOn.get(id));
			handedOn.delete(id);
			return;
		}
		cancel.call(win, id);
	};

	return {
		hold: function () {
			held = true;
		},
		release: function () {
			held = false;
			handedOn.clear();
			queue.forEach(function (callback, id) {
				handedOn.set(id, request.call(win, callback));
			});
			queue.clear();
		},
		isHeld: function () {
			return held;
		}
	};
}

var FORWARDED = {
	pointermove: ['pointermove', 'mousemove'],
	pointerdown: ['pointerdown', 'mousedown'],
	pointerup: ['pointerup', 'mouseup'],
	click: ['click']
};

// What a pointer event on the desktop becomes inside the page, relative to the frame's own
// corner. A real pointer event brings its mouse event with it and a made one does not, so both
// are made: a page may listen for either. Only the left button presses anything -- the right
// one opens the desktop's menu, and the middle one is the browser's.
export function forwardedEvents (event, rect) {
	var types = FORWARDED[event && event.type];
	if (!types) {
		return [];
	}
	if (event.type !== 'pointermove' && event.button !== 0) {
		return [];
	}
	var x = event.clientX - ((rect && rect.left) || 0);
	var y = event.clientY - ((rect && rect.top) || 0);
	return types.map(function (type) {
		var pointer = type.indexOf('pointer') === 0;
		var init = {
			bubbles: true,
			cancelable: true,
			composed: true,
			clientX: x,
			clientY: y,
			screenX: event.screenX || 0,
			screenY: event.screenY || 0,
			movementX: event.movementX || 0,
			movementY: event.movementY || 0,
			// A pointer move has no button, -1; a mouse event has none either, and says 0.
			button: pointer ? (event.button || 0) : Math.max(0, event.button || 0),
			buttons: event.buttons || 0,
			altKey: !!event.altKey,
			ctrlKey: !!event.ctrlKey,
			metaKey: !!event.metaKey,
			shiftKey: !!event.shiftKey,
			detail: type === 'click' ? 1 : 0
		};
		if (pointer) {
			init.pointerId = event.pointerId || 1;
			init.pointerType = event.pointerType || 'mouse';
			init.isPrimary = event.isPrimary !== false;
		}
		return {kind: pointer ? 'PointerEvent' : 'MouseEvent', type: type, init: init};
	});
}

// The status the frame's document came with, or 0 when the browser does not say.
function loadedStatus (win) {
	try {
		var entry = win.performance.getEntriesByType('navigation')[0];
		return (entry && entry.responseStatus) || 0;
	}
	catch (err) {
		return 0;
	}
}

function windowOf (frame) {
	try {
		return frame.contentWindow && frame.contentWindow.document ? frame.contentWindow : null;
	}
	catch (err) {
		// Not same-origin after all. Nothing here can reach into it.
		return null;
	}
}

// The page a folder opens when nothing names a look: the first of its looks whose page is here, if
// it has a looks.json, or null for index.html. A folder is chosen by its path alone from Explorer
// or the file field, and Pipes' index.html shows a panel of controls unless the look's address
// hides it. "Here", because a folder may have only some of its looks downloaded, and a look's page
// is the last of its files written. With none here it is the first look, whose 404 says so. Read
// through the worker like the page itself; a missing or broken looks.json is no looks.
export function firstLookEntry (path) {
	var served = function (url) {
		return Promise.resolve().then(function () {
			return fetch(url);
		});
	};
	return served(pageUrl(path, 'looks.json')).then(function (response) {
		return response && response.ok ? response.json() : null;
	}).then(function (doc) {
		var looks = readLooks(doc);
		var next = function (index) {
			if (index >= looks.length) {
				return looks.length ? looks[0].entry || null : null;
			}
			return served(pageUrl(path, looks[index].entry)).then(function (response) {
				return response && response.ok ? looks[index].entry || null : next(index + 1);
			}, function () {
				return next(index + 1);
			});
		};
		return next(0);
	}).catch(function () {
		return null;
	});
}

function mountPage (element, config, context) {
	var path = config.value;
	var entry = config.options && config.options.entry;
	var url = pageUrl(path, entry);
	if (!url) {
		context.fail('not a screensaver page: ' + path);
		return null;
	}

	var frame = document.createElement('iframe');
	var frames = null;
	var paused = false;
	var pausedBy = null;
	var gone = false;

	// What shows while the page loads, and between its frames if it draws with transparency.
	element.style.background = '#0b0d12';
	frame.title = pageName(path) || 'Background';
	frame.setAttribute('tabindex', '-1');
	frame.setAttribute('aria-hidden', 'true');
	// Inline, because the shell's stylesheet gives every iframe a border and a grey ground.
	frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;'
		+ 'border:0;background:transparent;pointer-events:none;';

	function stopDrawing (win) {
		if (typeof win.pixosPause === 'function') {
			try {
				win.pixosPause();
				pausedBy = 'page';
				return;
			}
			catch (err) {
				console.error('Wallpaper page: pixosPause threw', err);
			}
		}
		if (frames) {
			frames.hold();
			pausedBy = 'hold';
		}
	}

	function startDrawing (win) {
		if (pausedBy === 'page' && win && typeof win.pixosResume === 'function') {
			try {
				win.pixosResume();
			}
			catch (err) {
				console.error('Wallpaper page: pixosResume threw', err);
			}
		}
		if (frames) {
			frames.release();
		}
		pausedBy = null;
	}

	// Every load is a new document: whatever held the last one went with it.
	frame.addEventListener('load', function () {
		pausedBy = null;
		var win = windowOf(frame);
		frames = win ? holdAnimationFrames(win) : null;
		if (win && loadedStatus(win) >= 400) {
			frame.remove();
			context.fail('cannot read ' + path);
			return;
		}
		if (paused && win) {
			stopDrawing(win);
		}
	});

	if (isFolderPath(path) && !entry) {
		firstLookEntry(path).then(function (first) {
			if (!gone) {
				frame.src = (first && pageUrl(path, first)) || url;
			}
		});
	}
	else {
		frame.src = url;
	}
	element.append(frame);

	return {
		pause: function () {
			paused = true;
			var win = windowOf(frame);
			if (win && !pausedBy) {
				stopDrawing(win);
			}
		},
		resume: function () {
			paused = false;
			startDrawing(windowOf(frame));
		},
		// Nothing to guard after this but a first look still being read: a removed frame fires no
		// load, and the handle takes nothing from an instance it has unmounted.
		unmount: function () {
			gone = true;
			frame.remove();
		},
		forward: function (event) {
			var win = windowOf(frame);
			var doc = win && win.document;
			if (!doc || !doc.documentElement) {
				return;
			}
			var rect = frame.getBoundingClientRect();
			var target = null;
			forwardedEvents(event, rect).forEach(function (made) {
				target = target || doc.elementFromPoint(made.init.clientX, made.init.clientY)
					|| doc.body || doc.documentElement;
				var Made = win[made.kind] || win.MouseEvent;
				made.init.view = win;
				target.dispatchEvent(new Made(made.type, made.init));
			});
		}
	};
}

wallpaper.register('page', {mount: mountPage});
