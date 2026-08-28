// PixOS window manager.
//
// GoldenLayout owns the tiling. This owns the bookkeeping GoldenLayout has no concept
// of: which windows exist, which app and file each one holds, how it was launched, which
// desktop it is on, and events when any of that changes. Everything above the WM -- the
// desktop menu, the taskbar, session restore -- reads listWindows() and listens here.
//
// Iframes never live inside the layout. Each window's real content sits in a sibling
// container in the windows root, positioned from the rect of an empty placeholder inside
// the layout. That indirection exists for one reason: reparenting an iframe reloads it,
// and a reload throws away whatever the app was doing.
//
// Desktops build on the same idea. Each one gets its own GoldenLayout in its own root
// element, but they all share ONE windows container. Switching desktops hides a layout
// and shows another; moving a window between desktops moves its *placeholder* and leaves
// the iframe exactly where it is. Nothing reloads, and nothing unsaved is lost.

function emptyLayoutConfig () {
	return {
		content: [{
			type: 'row',
			// The root row must survive its last child being closed, or there is
			// nothing left to add windows to and the only way back is a reload.
			isClosable: false,
			content: []
		}]
	};
}

export default class WM {
	constructor (cfg) {
		cfg = cfg || {};
		if (typeof cfg.root === 'undefined') {
			throw new Error('WM needs a root selector');
		}

		var _this = this;

		this.root = cfg.root;
		this.rootElement = document.querySelector(cfg.root);
		this.rootContent = $(cfg.windowsRoot || 'body');
		this.winID = 0;
		this.workspaceID = 0;
		this.windows = new Map();
		this.workspaces = new Map();
		this.handlers = {};
		this.activeWindowId = null;
		this.activeWorkspaceId = null;
		this.rebuilding = false;
		// Ids being moved between desktops. Removing a placeholder fires itemDestroyed,
		// which would otherwise be indistinguishable from the window being closed.
		this.moving = new Set();

		this.initialised = cfg.initialised || function () {};

		this.createWorkspace({name: cfg.workspaceName || 'Desktop 1'});

		// addEventListener, not onresize: one layout per desktop, and a bare assignment
		// would let the last one built silence all the others.
		window.addEventListener('resize', function () {
			_this.updateSize();
		});
	}

	// --- desktops -------------------------------------------------------------

	createWorkspace (cfg) {
		cfg = cfg || {};
		var _this = this;
		var id = cfg.id || ('w' + (++this.workspaceID));
		while (this.workspaces.has(id)) {
			id = 'w' + (++this.workspaceID);
		}

		var element = document.createElement('div');
		element.className = 'PixWorkspace';
		element.dataset.workspace = id;
		this.rootElement.append(element);

		var workspace = {
			id: id,
			name: cfg.name || ('Desktop ' + (this.workspaces.size + 1)),
			element: element,
			layout: null
		};
		this.workspaces.set(id, workspace);

		this.buildLayout(workspace, cfg.layout);

		if (!this.activeWorkspaceId) {
			this.activeWorkspaceId = id;
		}
		this.applyWorkspaceVisibility();
		this.emit('workspaces-changed');
		this.emit('changed');
		return workspace;
	}

	// Split out from createWorkspace because session restore replaces a fresh empty
	// layout with one rebuilt from the saved config, after the window records exist.
	buildLayout (workspace, layoutConfig) {
		var _this = this;

		if (workspace.layout) {
			// destroy() tears down every content item, and each one emits itemDestroyed
			// on the way out. Without this flag a rebuild would look exactly like the
			// user closing all of those windows, and their iframes would go with them.
			this.rebuilding = true;
			try {
				workspace.layout.destroy();
			}
			catch (err) {
				console.error('destroying a layout failed', err);
			}
			finally {
				this.rebuilding = false;
			}
			workspace.element.replaceChildren();
		}

		var layout = new GoldenLayout(layoutConfig || emptyLayoutConfig(), $(workspace.element));

		layout.registerComponent('PixOS', function (container, state) {
			container.getElement().html(state.html);
			// On restore the record already exists and this is where it finds its item.
			var record = _this.windows.get(state.winID);
			if (record) {
				record.container = container;
				record.item = container.parent;
			}
		});
		layout.init();

		layout.on('initialised', this.initialised);
		layout.on('stateChanged', function () {
			_this.syncGeometry();
			// Dragging a splitter changes nothing the WM tracks, but it does change what
			// a session restore should reproduce.
			_this.emit('layout-changed');
		});

		// The authoritative close signal. The geometry sweep catches anything this
		// misses (a destroyed item that never propagated), but it runs a frame late.
		layout.on('itemDestroyed', function (payload) {
			var id = winIdOf(payload);
			if (id !== null) {
				_this.forget(id);
			}
		});

		// 'activeContentItemChanged' is a plain emit on the stack, not a bubbling event,
		// so it never reaches the layout manager -- subscribing to it there looks right
		// and silently never fires. Each stack has to be hooked as it is created.
		layout.on('stackCreated', function (payload) {
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

		workspace.layout = layout;
		return layout;
	}

	listWorkspaces () {
		var _this = this;
		return Array.from(this.workspaces.values()).map(function (workspace) {
			return {
				id: workspace.id,
				name: workspace.name,
				active: workspace.id === _this.activeWorkspaceId,
				windowCount: _this.listWindows(workspace.id).length
			};
		});
	}

	getActiveWorkspace () {
		return this.activeWorkspaceId;
	}

	switchTo (workspaceId) {
		if (!this.workspaces.has(workspaceId) || workspaceId === this.activeWorkspaceId) {
			return false;
		}
		this.activeWorkspaceId = workspaceId;
		this.applyWorkspaceVisibility();
		// A hidden layout measures zero, so both of these have to happen after the
		// element is visible again rather than being trusted to have kept up.
		this.updateSize();
		this.syncGeometry();
		this.emit('workspaces-changed');
		this.emit('changed');
		return true;
	}

	renameWorkspace (workspaceId, name) {
		var workspace = this.workspaces.get(workspaceId);
		var trimmed = String(name || '').trim();
		if (!workspace || !trimmed) {
			return false;
		}
		workspace.name = trimmed;
		this.emit('workspaces-changed');
		this.emit('changed');
		return true;
	}

	// Never closes the windows on it: they move to the neighbour. Because the iframes
	// live in the shared container, that move is a placeholder reparent inside
	// GoldenLayout only -- nothing reloads and nothing unsaved is lost.
	closeWorkspace (workspaceId) {
		var workspace = this.workspaces.get(workspaceId);
		if (!workspace || this.workspaces.size < 2) {
			return false;
		}

		var ids = Array.from(this.workspaces.keys());
		var index = ids.indexOf(workspaceId);
		var neighbourId = ids[index - 1] || ids[index + 1];

		var _this = this;
		this.listWindows(workspaceId).forEach(function (win) {
			_this.moveWindow(win.id, neighbourId);
		});

		try {
			workspace.layout.destroy();
		}
		catch (err) {
			console.error('destroying a layout failed', err);
		}
		workspace.element.remove();
		this.workspaces.delete(workspaceId);

		if (this.activeWorkspaceId === workspaceId) {
			this.activeWorkspaceId = neighbourId;
		}
		this.applyWorkspaceVisibility();
		this.updateSize();
		this.syncGeometry();
		this.emit('workspaces-changed');
		this.emit('changed');
		return true;
	}

	moveWindow (id, workspaceId) {
		var record = this.windows.get(id);
		var target = this.workspaces.get(workspaceId);
		if (!record || !target || record.workspace === workspaceId) {
			return false;
		}

		// Removing the placeholder fires itemDestroyed; forget() has to know this is a
		// move rather than a close, or the iframe would be deleted mid-flight.
		this.moving.add(id);
		try {
			if (record.item && record.item.parent) {
				record.item.remove();
			}
		}
		finally {
			this.moving.delete(id);
		}

		record.workspace = workspaceId;
		this.addPlaceholder(target, record);
		this.syncGeometry();
		this.emit('workspaces-changed');
		this.emit('changed');
		return true;
	}

	applyWorkspaceVisibility () {
		var _this = this;
		this.workspaces.forEach(function (workspace) {
			workspace.element.style.display = workspace.id === _this.activeWorkspaceId ? '' : 'none';
		});
	}

	addPlaceholder (workspace, record) {
		workspace.layout.root.contentItems[0].addChild({
			title: record.title,
			type: 'component',
			componentName: 'PixOS',
			componentState: {
				html: '<div data-goldenlayout-winid="' + record.id + '"></div>',
				winID: record.id
			}
		});
	}

	updateSize () {
		var workspace = this.workspaces.get(this.activeWorkspaceId);
		if (workspace && workspace.layout) {
			workspace.layout.updateSize();
		}
	}

	// Input inside an app iframe never reaches the shell's document, so a shell-wide
	// shortcut is dead the moment an app has focus -- and so is "click anywhere else to
	// close this". Apps are same-origin (they are served through the service worker), so
	// the shell listens inside them and republishes what it hears. Capture phase, so an
	// app that swallows its own events is still heard.
	//
	// An app that nests a cross-origin iframe of its own -- photopea does -- is opaque
	// below this level, and neither shortcuts nor dismissal will fire from down there.
	bridgeInput (frame) {
		var wm = this;
		try {
			var doc = frame.contentDocument;
			if (!doc || doc.__pixosInputBridge) {
				return;
			}
			doc.__pixosInputBridge = true;
			doc.addEventListener('keydown', function (e) {
				wm.emit('keydown', e);
			}, true);
			doc.addEventListener('mousedown', function (e) {
				wm.emit('mousedown', e);
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

			// A window on another desktop is hidden outright rather than positioned: its
			// placeholder lives in a display:none layout and reports a zero rect, which
			// would otherwise be written onto the iframe and lost on the way back.
			var record = _this.windows.get(Number(id));
			if (record && record.workspace !== _this.activeWorkspaceId) {
				container.style.display = 'none';
				return;
			}
			container.style.display = '';

			var rect = placeholder.getBoundingClientRect();

			container.style.top = rect.top + 'px';
			container.style.left = rect.left + 'px';
			container.style.width = rect.width + 'px';
			container.style.height = rect.height + 'px';
			container.style.zIndex = placeholder.closest('.lm_maximised') ? '101' : '';
		});

		this.rootContent[0].querySelectorAll('[data-goldenlayout-contid]').forEach(function (container) {
			var id = Number(container.dataset.goldenlayoutContid);
			var record = _this.windows.get(id);
			// Mid-restore a window legitimately has no placeholder yet.
			if (record && record.detached) {
				return;
			}
			if (!document.querySelector('[data-goldenlayout-winid="' + id + '"]')) {
				_this.forget(id);
			}
		});
	}

	// Kept for callers of the old API.
	stateChanged () {
		this.syncGeometry();
	}

	// --- session restore ------------------------------------------------------
	//
	// Restoring runs in three steps, in this order for a reason:
	//   1. createWorkspace() for each saved desktop, empty.
	//   2. openWindow({detached: true, id, workspace}) for each saved window, which
	//      creates the record and the iframe but no placeholder.
	//   3. applySavedLayout() rebuilds each desktop's layout from its saved config. The
	//      component factory then finds the record waiting for it and binds the two.
	//
	// Doing it the other way round would mean the factory running before the records
	// exist, leaving every window's item unattached.

	// Ends the restore: every window that found a pane keeps it, and every window that
	// did not -- because its desktop had no saved layout, or the layout did not mention
	// it -- gets a fresh one rather than staying invisible forever.
	finishRestore () {
		var _this = this;
		this.windows.forEach(function (record) {
			if (!record.detached) {
				return;
			}
			record.detached = false;
			if (!record.item) {
				var workspace = _this.workspaces.get(record.workspace) || _this.workspaces.get(_this.activeWorkspaceId);
				if (workspace) {
					_this.addPlaceholder(workspace, record);
				}
			}
		});
		this.updateSize();
		this.syncGeometry();
		this.emit('changed');
	}

	applySavedLayout (workspaceId, layoutConfig) {
		var workspace = this.workspaces.get(workspaceId);
		if (!workspace || !layoutConfig) {
			return false;
		}
		this.buildLayout(workspace, layoutConfig);
		this.pruneUnbackedPlaceholders(workspace);
		this.applyWorkspaceVisibility();
		this.updateSize();
		this.syncGeometry();
		return true;
	}

	// A saved layout can name a window that could not be reopened -- its app was
	// uninstalled, its file deleted. Left alone that is an empty pane with a title and no
	// way to tell what went wrong, so the placeholder goes.
	pruneUnbackedPlaceholders (workspace) {
		var _this = this;
		collectComponents(workspace.layout.root).forEach(function (item) {
			var id = winIdOf(item);
			if (id === null || _this.windows.has(id)) {
				return;
			}
			// No record for this pane: its app is gone, or its file is.
			try {
				item.remove();
			}
			catch (err) {
				console.error('could not drop a stale placeholder', err);
			}
		});
	}

	// The shape session.js persists. Geometry comes from GoldenLayout's own config, which
	// carries each pane's winID, so ids have to survive a restore -- hence openWindow
	// accepting an explicit one.
	serialize () {
		var _this = this;
		return {
			version: 1,
			activeWorkspace: this.activeWorkspaceId,
			workspaces: Array.from(this.workspaces.values()).map(function (workspace) {
				return {
					id: workspace.id,
					name: workspace.name,
					layout: safeToConfig(workspace.layout),
					windows: _this.listWindows(workspace.id).map(function (win) {
						return {
							id: win.id,
							title: win.title,
							appId: win.appId,
							path: win.path,
							launch: win.launch
						};
					})
				};
			})
		};
	}

	// cfg: {title, content, appId, path, launch, workspace, id, detached}
	// `launch` is the descriptor that reopens this window from scratch -- session
	// restore replays it, so anything a window needs to come back has to live in there.
	//
	// `detached` is the restore path: the record and the iframe are created, but no
	// placeholder is added, because the saved layout already contains one carrying this
	// window's id. Rebuilding that layout is what binds the two together.
	openWindow (cfg) {
		cfg = cfg || {};

		var id = typeof cfg.id === 'number' ? cfg.id : this.winID++;
		if (id >= this.winID) {
			this.winID = id + 1;
		}
		var workspaceId = this.workspaces.has(cfg.workspace) ? cfg.workspace : this.activeWorkspaceId;
		var title = cfg.title || 'PixOS';
		var record = {
			id: id,
			title: title,
			appId: cfg.appId || null,
			path: cfg.path || null,
			launch: cfg.launch || null,
			workspace: workspaceId,
			// A restored window has no placeholder until its desktop's layout is rebuilt
			// around it. Until then the orphan sweep below must leave it alone, or it
			// would be reaped the moment it is created.
			detached: !!cfg.detached,
			element: null,
			container: null,
			item: null
		};

		// Registered before addChild: the component factory runs synchronously inside it
		// and looks this record up to attach the container.
		this.windows.set(id, record);

		if (!cfg.detached) {
			this.addPlaceholder(this.workspaces.get(workspaceId), record);
		}

		var $content = $(cfg.content).attr('data-goldenlayout-contid', id);
		this.rootContent.append($content);
		record.element = $content[0];

		var frame = this.getFrame(id);
		if (frame) {
			var wm = this;
			// addEventListener, not .onload: callers assign that property themselves to
			// hand the app its file.
			frame.addEventListener('load', function () {
				wm.bridgeInput(frame);
			});
		}

		if (!cfg.detached) {
			this.activeWindowId = id;
		}
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

	// No argument lists every window; a workspace id narrows it to that desktop.
	listWindows (workspaceId) {
		var _this = this;
		return Array.from(this.windows.keys())
			.map(function (id) {
				return _this.describe(id);
			})
			.filter(function (win) {
				return !workspaceId || win.workspace === workspaceId;
			});
	}

	count (workspaceId) {
		return workspaceId ? this.listWindows(workspaceId).length : this.windows.size;
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
			workspace: record.workspace,
			active: this.activeWindowId === record.id
		};
	}

	forget (id) {
		var record = this.windows.get(id);
		// Mid-move, or mid-rebuild, the placeholder is destroyed on purpose and the
		// window is not going away.
		if (!record || this.moving.has(id) || this.rebuilding) {
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

function collectComponents (item, found) {
	found = found || [];
	if (!item) {
		return found;
	}
	if (item.isComponent) {
		found.push(item);
	}
	(item.contentItems || []).forEach(function (child) {
		collectComponents(child, found);
	});
	return found;
}

// toConfig() throws if the layout was destroyed or never initialised. A session that
// cannot be serialised should degrade to "no saved geometry", not break the save.
function safeToConfig (layout) {
	try {
		return layout && typeof layout.toConfig === 'function' ? layout.toConfig() : null;
	}
	catch (err) {
		console.error('could not serialise a layout', err);
		return null;
	}
}

// GoldenLayout hands non-throttled bubbling events to the layout manager as the
// originating item, but throttled ones arrive wrapped. Accept either.
function winIdOf (payload) {
	var item = (payload && payload.origin) || payload;
	var state = item && item.config && item.config.componentState;
	return state && typeof state.winID === 'number' ? state.winID : null;
}
