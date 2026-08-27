// PixOS window manager.
//
// GoldenLayout owns the tiling. This owns the bookkeeping GoldenLayout has no concept
// of: which windows exist, which app and file each one holds, how it was launched, and
// events when any of that changes. Everything above the WM -- the desktop menu now, the
// taskbar and session restore later -- reads listWindows() and listens here.
//
// Iframes never live inside the layout. Each window's real content sits in a sibling
// container in the windows root, positioned from the rect of an empty placeholder inside
// the layout. That indirection exists for one reason: reparenting an iframe reloads it,
// and a reload throws away whatever the app was doing. Every feature in this shell that
// hides or moves a window has to preserve it.

export default class WM {
	constructor (cfg) {
		cfg = cfg || {};
		if (typeof cfg.root === 'undefined') {
			throw new Error('WM needs a root selector');
		}

		var _this = this;

		this.root = cfg.root;
		this.rootContent = $(cfg.windowsRoot || 'body');
		this.winID = 0;
		this.windows = new Map();
		this.handlers = {};
		this.activeWindowId = null;

		this.layoutConfig = cfg.config || {
			content: [{
				type: 'row',
				// The root row must survive its last child being closed, or there is
				// nothing left to add windows to and the only way back is a reload.
				isClosable: false,
				content: []
			}]
		};

		this.myLayout = new GoldenLayout(this.layoutConfig, $(this.root));
		this.myLayout.registerComponent('PixOS', function (container, state) {
			container.getElement().html(state.html);
			var record = _this.windows.get(state.winID);
			if (record) {
				record.container = container;
				record.item = container.parent;
			}
		});
		this.myLayout.init();

		this.initialised = cfg.initialised || function () {};

		this.myLayout.on('initialised', this.initialised);
		this.myLayout.on('stateChanged', function () {
			_this.syncGeometry();
		});

		// The authoritative close signal. The geometry sweep catches anything this
		// misses (a destroyed item that never propagated), but it runs a frame late.
		this.myLayout.on('itemDestroyed', function (payload) {
			var id = winIdOf(payload);
			if (id !== null) {
				_this.forget(id);
			}
		});

		// 'activeContentItemChanged' is a plain emit on the stack, not a bubbling event,
		// so it never reaches the layout manager -- subscribing to it there looks right
		// and silently never fires. Each stack has to be hooked as it is created.
		this.myLayout.on('stackCreated', function (payload) {
			var stack = (payload && payload.origin) || payload;
			if (!stack || typeof stack.on !== 'function') {
				return;
			}
			stack.on('activeContentItemChanged', function (item) {
				var id = winIdOf(item);
				if (id === null) {
					return;
				}
				_this.activeWindowId = id;
				_this.emit('focused', _this.describe(id));
				_this.emit('changed');
			});
		});

		// addEventListener, not onresize: phase 4 runs one layout per desktop and a bare
		// assignment would let the last one built silence all the others.
		window.addEventListener('resize', function () {
			_this.updateSize();
		});
	}

	updateSize () {
		this.myLayout.updateSize();
	}

	// Keystrokes inside an app iframe never reach the shell's document, so a shell-wide
	// shortcut is dead the moment an app has focus. Apps are same-origin (they are served
	// through the service worker), so the shell can listen inside them and republish what
	// it hears as an event. Capture phase, so an app that swallows keys is still heard.
	//
	// An app that nests a cross-origin iframe of its own -- photopea does -- is opaque
	// below this level, and shortcuts will not fire while focus is down there.
	bridgeHotkeys (frame) {
		var _this = this;
		try {
			var doc = frame.contentDocument;
			if (!doc || doc.__pixosHotkeyBridge) {
				return;
			}
			doc.__pixosHotkeyBridge = true;
			doc.addEventListener('keydown', function (e) {
				_this.emit('keydown', e);
			}, true);
		}
		catch (err) {
			// Cross-origin: nothing to listen to, and not worth logging on every window.
		}
	}

	// Copy each placeholder's rect onto the container holding the real iframe. Hidden
	// elements report zeroes, so this must be re-run whenever a layout becomes visible
	// again rather than trusted to have kept up while it was hidden.
	//
	// Deliberately searched across the whole document rather than inside the layout root:
	// while a tab is being dragged GoldenLayout parks its element -- placeholder and all
	// -- in a drag proxy appended to document.body. Scoping this to the root makes the
	// orphan sweep below mistake a drag in progress for a closed window and delete it.
	syncGeometry () {
		var _this = this;

		document.querySelectorAll('[data-goldenlayout-winid]').forEach(function (placeholder) {
			var id = placeholder.dataset.goldenlayoutWinid;
			var container = _this.rootContent[0].querySelector('[data-goldenlayout-contid="' + id + '"]');
			if (!container) {
				return;
			}
			var rect = placeholder.getBoundingClientRect();

			container.style.top = rect.top + 'px';
			container.style.left = rect.left + 'px';
			container.style.width = rect.width + 'px';
			container.style.height = rect.height + 'px';
			container.style.zIndex = placeholder.closest('.lm_maximised') ? '101' : '';
		});

		this.rootContent[0].querySelectorAll('[data-goldenlayout-contid]').forEach(function (container) {
			var id = container.dataset.goldenlayoutContid;
			if (!document.querySelector('[data-goldenlayout-winid="' + id + '"]')) {
				_this.forget(Number(id));
			}
		});
	}

	// Kept for callers of the old API.
	stateChanged () {
		this.syncGeometry();
	}

	// cfg: {title, content, appId, path, launch}
	// `launch` is the descriptor that reopens this window from scratch -- session
	// restore replays it, so anything a window needs to come back has to live in there.
	openWindow (cfg) {
		cfg = cfg || {};

		var id = this.winID++;
		var title = cfg.title || 'PixOS';
		var record = {
			id: id,
			title: title,
			appId: cfg.appId || null,
			path: cfg.path || null,
			launch: cfg.launch || null,
			element: null,
			container: null,
			item: null
		};

		// Registered before addChild: the component factory runs synchronously inside it
		// and looks this record up to attach the container.
		this.windows.set(id, record);

		this.myLayout.root.contentItems[0].addChild({
			title: title,
			type: cfg.type || 'component',
			componentName: cfg.name || 'PixOS',
			componentState: {
				html: cfg.html || '<div data-goldenlayout-winid="' + id + '"></div>',
				winID: id
			}
		});

		var $content = $(cfg.content).attr('data-goldenlayout-contid', id);
		this.rootContent.append($content);
		record.element = $content[0];

		var frame = this.getFrame(id);
		if (frame) {
			// addEventListener, not .onload: callers assign that property themselves to
			// hand the app its file.
			frame.addEventListener('load', function () {
				_this.bridgeHotkeys(frame);
			});
		}

		this.activeWindowId = id;
		this.syncGeometry();
		this.emit('opened', this.describe(id));
		this.emit('changed');

		return record;
	}

	closeWindow (id) {
		var record = this.windows.get(id);
		if (!record) {
			return false;
		}
		if (record.item && record.item.parent) {
			record.item.remove();
		}
		else {
			this.forget(id);
		}
		return true;
	}

	closeAll () {
		var _this = this;
		this.listWindows().forEach(function (win) {
			_this.closeWindow(win.id);
		});
	}

	// There is no minimize and no z-order by design; focusing a window means selecting
	// its tab in whatever stack it ended up in.
	focusWindow (id) {
		var record = this.windows.get(id);
		if (!record || !record.item) {
			return false;
		}
		var stack = record.item.parent;
		if (stack && typeof stack.setActiveContentItem === 'function') {
			stack.setActiveContentItem(record.item);
		}
		this.activeWindowId = id;
		this.emit('focused', this.describe(id));
		this.emit('changed');
		return true;
	}

	setTitle (id, title) {
		var record = this.windows.get(id);
		if (!record) {
			return false;
		}
		record.title = title;
		if (record.item && typeof record.item.setTitle === 'function') {
			record.item.setTitle(title);
		}
		this.emit('changed');
		return true;
	}

	getWindow (id) {
		return this.describe(id);
	}

	listWindows () {
		var _this = this;
		return Array.from(this.windows.keys()).map(function (id) {
			return _this.describe(id);
		});
	}

	count () {
		return this.windows.size;
	}

	// The iframe of a window, for the callers that still need to talk to the app inside.
	// The window's content is usually the iframe itself, not a wrapper around one.
	getFrame (id) {
		var record = this.windows.get(id);
		if (!record || !record.element) {
			return null;
		}
		return record.element.tagName === 'IFRAME' ? record.element : record.element.querySelector('iframe');
	}

	describe (id) {
		var record = this.windows.get(id);
		if (!record) {
			return null;
		}
		return {
			id: record.id,
			title: record.title,
			appId: record.appId,
			path: record.path,
			launch: record.launch,
			active: this.activeWindowId === record.id
		};
	}

	forget (id) {
		var record = this.windows.get(id);
		if (!record) {
			return;
		}
		var described = this.describe(id);
		this.windows.delete(id);
		if (record.element && record.element.parentNode) {
			record.element.remove();
		}
		if (this.activeWindowId === id) {
			this.activeWindowId = null;
		}
		this.emit('closed', described);
		this.emit('changed');
	}

	on (event, handler) {
		(this.handlers[event] = this.handlers[event] || []).push(handler);
		return this;
	}

	off (event, handler) {
		var list = this.handlers[event];
		if (!list) {
			return this;
		}
		this.handlers[event] = list.filter(function (item) {
			return item !== handler;
		});
		return this;
	}

	// A throwing listener must not take the WM down with it -- a broken taskbar is a
	// nuisance, a window that cannot be closed is a reload.
	emit (event, payload) {
		(this.handlers[event] || []).slice().forEach(function (handler) {
			try {
				handler(payload);
			}
			catch (err) {
				console.error('WM listener for "' + event + '" failed', err);
			}
		});
	}
}

// GoldenLayout hands non-throttled bubbling events to the layout manager as the
// originating item, but throttled ones arrive wrapped. Accept either.
function winIdOf (payload) {
	var item = (payload && payload.origin) || payload;
	var state = item && item.config && item.config.componentState;
	return state && typeof state.winID === 'number' ? state.winID : null;
}
