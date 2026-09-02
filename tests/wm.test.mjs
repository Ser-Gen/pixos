// The window manager's bookkeeping, without a browser.
//
// GoldenLayout, jQuery and the DOM are stubbed down to exactly what js/shell/wm.js
// touches. The stubs reproduce one thing carefully on purpose: GoldenLayout delivers
// non-throttled bubbling events to the layout manager as the originating item, and the
// WM has to cope with that shape.

import {check, report} from './assert.mjs';

class El {
	constructor (tag) {
		this.tagName = tag.toUpperCase();
		this.children = [];
		this.parentNode = null;
		this.dataset = {};
		this.style = {};
		this.listeners = {};
	}
	addEventListener (event, fn) {
		(this.listeners[event] = this.listeners[event] || []).push(fn);
	}
	dispatch (event) {
		(this.listeners[event] || []).forEach(fn => fn());
	}
	append (...kids) {
		kids.forEach(kid => {
			kid.remove();
			kid.parentNode = this;
			this.children.push(kid);
		});
	}
	remove () {
		if (!this.parentNode) {
			return;
		}
		this.parentNode.children = this.parentNode.children.filter(child => child !== this);
		this.parentNode = null;
	}
	all () {
		return this.children.flatMap(child => [child, ...child.all()]);
	}
	querySelectorAll (selector) {
		const key = selector.indexOf('winid') > -1 ? 'goldenlayoutWinid' : 'goldenlayoutContid';
		const value = (selector.match(/="([^"]+)"/) || [])[1];
		return this.all().filter(child => child.dataset[key] !== undefined
			&& (value === undefined || child.dataset[key] === value));
	}
	querySelector (selector) {
		if (selector === '#root') {
			return layoutRoot;
		}
		if (selector === '#windows') {
			return windowsRoot;
		}
		return this.querySelectorAll(selector)[0] || null;
	}
	replaceChildren () {
		this.children.forEach(child => { child.parentNode = null; });
		this.children = [];
	}
	getBoundingClientRect () {
		return {top: 0, left: 0, width: 100, height: 100};
	}
	closest () {
		return null;
	}
}

// A real document contains the layout, the windows layer and the drag proxy's home in
// document.body -- the sweep has to see all three.
let windowsRoot;
let layoutRoot;
let bodyRoot;
const documentRoot = new El('html');
documentRoot.createElement = tag => new El(tag);
globalThis.document = documentRoot;

// Each independent WM gets a clean document. Sharing one let a stale placeholder from an
// earlier instance answer a later instance's lookup, which is exactly how the bug that
// deleted every restored window got through this file.
function resetDom () {
	windowsRoot = new El('div');
	layoutRoot = new El('div');
	bodyRoot = new El('body');
	documentRoot.replaceChildren();
	documentRoot.append(layoutRoot, windowsRoot, bodyRoot);
}
resetDom();

globalThis.$ = function (arg) {
	// The WM wraps a workspace's own element, not just a selector.
	if (arg instanceof El) {
		const wrapper = [arg];
		wrapper.append = node => arg.append(node[0] || node);
		return wrapper;
	}
	if (typeof arg === 'string' && arg.charAt(0) === '<') {
		const element = new El(arg.match(/^<(\w+)/)[1]);
		const wrapper = [element];
		wrapper.attr = function (name, value) {
			element.dataset[name.replace(/^data-goldenlayout-(\w)/, (m, c) => 'goldenlayout' + c.toUpperCase())] = String(value);
			return wrapper;
		};
		return wrapper;
	}
	const element = arg === '#root' ? layoutRoot : windowsRoot;
	const wrapper = [element];
	wrapper.append = node => element.append(node[0] || node);
	return wrapper;
};

class Item {
	constructor (config, layout, parent) {
		this.config = config;
		this.layout = layout;
		this.parent = parent;
		this.contentItems = [];
		this.isComponent = config && config.type === 'component';
	}
	addChild (config) {
		const item = new Item(config, this.layout, this);
		this.contentItems.push(item);
		this.layout.factory({
			parent: item,
			getElement: () => ({
				html: () => {
					item.holder = new El('div');
					item.holder.dataset.goldenlayoutWinid = String(config.componentState.winID);
					// Placeholders live inside their own desktop's element, which is what
					// makes an inactive desktop's windows measurable as hidden.
					(this.layout.container || layoutRoot).append(item.holder);
				}
			})
		}, config.componentState);
		this.layout.emit('stackCreated', this);
		return item;
	}
	remove () {
		this.parent.contentItems = this.parent.contentItems.filter(item => item !== this);
		if (this.holder) {
			this.holder.remove();
		}
		this.layout.emit('itemDestroyed', this);
	}
	setActiveContentItem (item) {
		((this.local || {}).activeContentItemChanged || []).forEach(cb => cb(item));
	}
	setTitle (title) {
		this.config.title = title;
	}
	on (event, cb) {
		this.local = this.local || {};
		this.local[event] = (this.local[event] || []).concat(cb);
	}
}

globalThis.GoldenLayout = class {
	constructor (config, $container) {
		this.handlers = {};
		this.container = $container && $container[0];
		this.config = config;
		this.root = new Item({}, this, null);
		this.root.contentItems.push(new Item({type: 'row'}, this, this.root));
		// A saved layout arrives as content the factory has to be run over, which is how
		// restored windows find their items.
		this.pendingContent = (config && config.content && config.content[0]
			&& config.content[0].content) || [];
	}
	destroy () {
		this.destroyed = true;
	}
	toConfig () {
		return {content: [{type: 'row', content: this.root.contentItems[0].contentItems.map(i => i.config)}]};
	}
	registerComponent (name, fn) {
		this.factory = fn;
	}
	init () {
		this.pendingContent.forEach(child => this.root.contentItems[0].addChild(child));
		this.emit('initialised');
	}
	on (event, cb) {
		(this.handlers[event] = this.handlers[event] || []).push(cb);
	}
	emit (event, payload) {
		(this.handlers[event] || []).forEach(cb => cb(payload));
	}
	updateSize () {}
};

globalThis.window = {addEventListener: () => {}};

const WM = (await import('../js/shell/wm.js')).default;

const wm = new WM({root: '#root', windowsRoot: '#windows'});
const events = [];
wm.on('opened', w => events.push('opened:' + w.id));
wm.on('closed', w => events.push('closed:' + w.id));

const a = wm.openWindow({
	title: 'a.txt', appId: 'ace', path: '/a.txt',
	content: '<iframe id="view1"></iframe>',
	launch: {appId: 'ace', paths: ['/a.txt']}
});
const b = wm.openWindow({title: 'b.png', appId: 'image', path: '/b.png', content: '<iframe id="view2"></iframe>'});

check('two windows tracked', wm.count(), 2);
check('ids are distinct', [a.id, b.id], [0, 1]);
check('listWindows carries app and path', wm.listWindows().map(w => [w.appId, w.path]), [['ace', '/a.txt'], ['image', '/b.png']]);
check('the launch descriptor survives', wm.getWindow(0).launch, {appId: 'ace', paths: ['/a.txt']});
check('getFrame finds the iframe itself, not a wrapper', wm.getFrame(0).tagName, 'IFRAME');
check('containers land in the windows root', windowsRoot.children.length, 2);

wm.setTitle(0, 'renamed.txt');
check('setTitle updates the record', wm.getWindow(0).title, 'renamed.txt');

// --- unsaved work ------------------------------------------------------------------------
//
// Reported by the app, never guessed at: the shell cannot see inside an editor, and a
// guess would either nag about nothing or stay quiet about something. The whole value of
// the browser's close warning is that it only appears when there is a reason.

check('a new window is not dirty', wm.getWindow(0).dirty, false);
check('and nothing is waiting to be saved', wm.listDirty(), []);

check('marking it dirty reports a change', wm.setDirty(0, true), true);
check('the window says so', wm.getWindow(0).dirty, true);
check('and it can be listed without walking every window',
	wm.listDirty().map(w => w.id), [0]);
check('the pane title carries a dot', wm.windows.get(0).item.config.title, '\u25cf renamed.txt');

check('marking it dirty again changes nothing', wm.setDirty(0, false), true);
check('an app that reports on every keystroke does not redraw the world',
	wm.setDirty(0, false), false);
check('and the dot comes off', wm.windows.get(0).item.config.title, 'renamed.txt');

wm.setDirty(0, true);
wm.setTitle(0, 'saved-as.txt');
check('renaming a dirty window keeps its dot',
	wm.windows.get(0).item.config.title, '\u25cf saved-as.txt');
wm.setDirty(0, false);
wm.setTitle(0, 'renamed.txt');
check('an unknown window cannot be marked', wm.setDirty(99, true), false);

check('the focused window can be identified, which is what Cmd+W closes',
	wm.getActiveWindow().id, 1);

wm.closeWindow(0);
check('closing drops the window', wm.count(), 1);
check('closing removes its container', windowsRoot.children.length, 1);
check('closing an unknown id is a no-op', wm.closeWindow(99), false);
check('events fire in order', events, ['opened:0', 'opened:1', 'closed:0']);

// While a tab is dragged, GoldenLayout moves its element -- placeholder included -- into
// a drag proxy appended to document.body. The sweep must not read that as a close.
const dragged = wm.windows.get(1);
const placeholder = dragged.item.holder;
bodyRoot.append(placeholder);
wm.syncGeometry();
check('a tab mid-drag is not swept away', wm.count(), 1);
layoutRoot.append(placeholder);

// A destroyed item whose event never propagated: the geometry sweep is the safety net.
wm.windows.get(1).item.holder.remove();
wm.syncGeometry();
check('the sweep forgets an orphaned container', wm.count(), 0);
check('the sweep reports it as closed', events[events.length - 1], 'closed:1');

// A broken taskbar is a nuisance; a window that cannot be opened is a reload.
wm.on('opened', () => { throw new Error('listener blew up (expected)'); });
const c = wm.openWindow({title: 'c', content: '<iframe id="view3"></iframe>'});
check('a throwing listener does not break openWindow', wm.count(), 1);

wm.focusWindow(c.id);
check('focus is recorded', wm.getWindow(c.id).active, true);

// Shell shortcuts and click-away have to survive an app having focus. Driven through
// the iframe's load event rather than by calling bridgeInput() directly: an earlier
// version of this test called the method itself and passed while the load path was
// throwing, so no window ever got a bridge.
const forwarded = [];
wm.on('keydown', e => forwarded.push('key:' + e.code));
wm.on('mousedown', () => forwarded.push('click'));

const appDoc = {listeners: {}, addEventListener (evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); }};
const framed = wm.openWindow({title: 'app', content: '<iframe id="view9"></iframe>'});
wm.getFrame(framed.id).contentDocument = appDoc;
wm.getFrame(framed.id).dispatch('load');

check('loading a window installs the bridge', Object.keys(appDoc.listeners).sort(), ['keydown', 'mousedown']);
appDoc.listeners.keydown[0]({code: 'KeyK'});
appDoc.listeners.mousedown[0]({});
check('input inside an app is republished to the shell', forwarded, ['key:KeyK', 'click']);

wm.getFrame(framed.id).dispatch('load');
check('a second load does not double-subscribe', appDoc.listeners.keydown.length, 1);

const crossOriginFrame = {
	addEventListener () {},
	get contentDocument () { throw new Error('cross-origin'); }
};
wm.bridgeInput(crossOriginFrame);
check('a cross-origin frame is skipped without throwing', forwarded.length, 2);

// --- an app's own iframes ---------------------------------------------------------
//
// tinymce edits inside a nested same-origin iframe it builds itself. A keystroke there
// reaches neither the app's document nor the shell, so every shell chord was dead in that
// one editor -- the bridge has to follow the frame down, and keep following, because the
// frame is created long after load and rebuilt whenever the editor is.

function fakeDoc () {
	var doc = {
		listeners: {},
		frames: [],
		documentElement: {},
		addEventListener (evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); },
		querySelectorAll () { return doc.frames; }
	};
	return doc;
}

function fakeFrame (doc) {
	return {addEventListener () {}, contentDocument: doc};
}

const observers = [];
globalThis.MutationObserver = class {
	constructor (callback) { this.callback = callback; observers.push(this); }
	observe () { this.observing = true; }
	disconnect () {}
};

const editorDoc = fakeDoc();
const innerDoc = fakeDoc();
editorDoc.frames = [fakeFrame(innerDoc)];

const editor = wm.openWindow({title: 'tinymce', content: '<iframe id="view10"></iframe>'});
wm.getFrame(editor.id).contentDocument = editorDoc;
wm.getFrame(editor.id).dispatch('load');

check('a nested same-origin frame is bridged too',
	Object.keys(innerDoc.listeners).sort(), ['keydown', 'mousedown']);
innerDoc.listeners.keydown[0]({code: 'KeyK'});
check('so a keystroke in the document you are typing into reaches the shell',
	forwarded[forwarded.length - 1], 'key:KeyK');

// The one that actually bit: the editor iframe does not exist when the app loads.
check('the app document is watched for frames added later', observers.length > 0, true);
const lateDoc = fakeDoc();
observers[observers.length - 1].callback([{addedNodes: [
	{nodeType: 1, tagName: 'IFRAME', addEventListener () {}, contentDocument: lateDoc}
]}]);
check('a frame created after load is bridged when it appears',
	Object.keys(lateDoc.listeners).sort(), ['keydown', 'mousedown']);

const buriedDoc = fakeDoc();
const wrapper = {
	nodeType: 1,
	tagName: 'DIV',
	querySelectorAll () { return [fakeFrame(buriedDoc)]; }
};
observers[observers.length - 1].callback([{addedNodes: [wrapper]}]);
check('and so is one added inside a wrapper element',
	Object.keys(buriedDoc.listeners).sort(), ['keydown', 'mousedown']);

observers[observers.length - 1].callback([{addedNodes: [{nodeType: 3}]}]);
check('a text node -- which is most of what an editor adds -- is ignored',
	forwarded.length > 0, true);

// --- which window is the focused one ------------------------------------------------
//
// Two panes side by side are both visible, so selecting one tab and then typing in the
// other left the shell naming the wrong window. "Close window" then closed it.

wm.focusWindow(framed.id);
check('the tab selection is the starting point', wm.getActiveWindow().id, framed.id);

innerDoc.listeners.mousedown[0]({});
check('clicking into another window makes that one active', wm.getActiveWindow().id, editor.id);

appDoc.listeners.keydown[0]({code: 'KeyA'});
check('and so does typing in it', wm.getActiveWindow().id, framed.id);

const focusEvents = [];
wm.on('focused', win => focusEvents.push(win.id));
appDoc.listeners.keydown[0]({code: 'KeyB'});
appDoc.listeners.keydown[0]({code: 'KeyC'});
check('a keystroke in the window that is already active changes nothing',
	focusEvents, []);

// --- desktops -------------------------------------------------------------------
//
// The property under test throughout: a window changes desktop, or its desktop is
// closed, without its iframe ever leaving the shared container. Anything that moved the
// iframe in the DOM would reload the app and lose whatever was in it.

resetDom();
const desk = new WM({root: '#root', windowsRoot: '#windows', workspaceName: 'Work'});
check('a WM starts with one desktop', desk.listWorkspaces().map(w => w.name), ['Work']);
check('which is active', desk.getActiveWorkspace(), desk.listWorkspaces()[0].id);

const work = desk.getActiveWorkspace();
const w1 = desk.openWindow({title: 'a.txt', appId: 'ace', path: '/a.txt', content: '<iframe id="v1"></iframe>', launch: {appId: 'ace', paths: ['/a.txt']}});
const media = desk.createWorkspace({name: 'Media'});

check('a new desktop does not steal focus', desk.getActiveWorkspace(), work);
check('windows belong to the desktop they were opened on', desk.getWindow(w1.id).workspace, work);
check('listWindows can be narrowed to one desktop', desk.listWindows(media.id).length, 0);
check('and unfiltered it still sees everything', desk.listWindows().length, 1);

const iframeBefore = desk.getFrame(w1.id);
desk.moveWindow(w1.id, media.id);
check('moving a window changes its desktop', desk.getWindow(w1.id).workspace, media.id);
check('the window still exists', desk.count(), 1);
// The whole design rests on this: same element, same parent, so no reload.
check('the iframe is the very same element', desk.getFrame(w1.id) === iframeBefore, true);
check('and never left the windows container', desk.getFrame(w1.id).parentNode === windowsRoot, true);

desk.switchTo(media.id);
check('switching desktops works', desk.getActiveWorkspace(), media.id);
check('the taskbar sees the window on the active desktop', desk.listWindows(media.id).length, 1);

desk.renameWorkspace(media.id, 'Video');
check('desktops can be renamed', desk.listWorkspaces().find(w => w.id === media.id).name, 'Video');
check('a blank name is refused', desk.renameWorkspace(media.id, '   '), false);

// Closing a desktop must never cost you the windows on it.
const beforeClose = desk.getFrame(w1.id);
desk.closeWorkspace(media.id);
check('closing a desktop removes it', desk.listWorkspaces().length, 1);
check('its windows survive', desk.count(), 1);
check('they move to the neighbour', desk.getWindow(w1.id).workspace, work);
check('and their iframes are untouched', desk.getFrame(w1.id) === beforeClose, true);
check('the survivor becomes active', desk.getActiveWorkspace(), work);
check('the last desktop cannot be closed', desk.closeWorkspace(work), false);
check('count() can be narrowed to one desktop', desk.count(desk.getActiveWorkspace()), 1);
check('and unfiltered counts them all', desk.count(), 1);

// --- session ---------------------------------------------------------------------

const snapshot = desk.serialize();
check('a snapshot names the active desktop', snapshot.activeWorkspace, work);
check('and carries one entry per desktop', snapshot.workspaces.length, 1);
check('with the launch descriptor needed to reopen each window',
	snapshot.workspaces[0].windows[0].launch, {appId: 'ace', paths: ['/a.txt']});
check('and the window id, so the saved layout still points at it',
	snapshot.workspaces[0].windows[0].id, w1.id);

// Restore: records first, layout second. Reversing that leaves every item unattached.
resetDom();
const fresh = new WM({root: '#root', windowsRoot: '#windows'});
const target = fresh.getActiveWorkspace();
const saved = snapshot.workspaces[0];
saved.windows.forEach(win => {
	fresh.openWindow({
		id: win.id, workspace: target, detached: true,
		title: win.title, appId: win.appId, path: win.path, launch: win.launch,
		content: '<iframe id="restored"></iframe>'
	});
});
// The regression: openWindow ends in syncGeometry, whose orphan sweep deletes any
// container without a placeholder -- which a detached window deliberately does not have
// yet. Every restored window used to be created and reaped in the same breath.
check('a detached window exists before any placeholder does', fresh.count(), 1);
fresh.syncGeometry();
check('and survives a geometry sweep with no placeholder', fresh.count(), 1);
check('its iframe is still reachable, which is what launch() needs', !!fresh.getFrame(w1.id), true);
check('its id is the saved one, not a fresh one', fresh.listWindows()[0].id, w1.id);
check('and the next new window will not collide with it', fresh.winID > w1.id, true);

fresh.applySavedLayout(target, saved.layout);
fresh.finishRestore();
check('rebuilding the layout binds the record to its pane', !!fresh.windows.get(w1.id).item, true);
check('and the window is no longer exempt from the sweep', fresh.windows.get(w1.id).detached, false);

// A desktop whose layout could not be serialised still has to show its windows.
resetDom();
const noLayout = new WM({root: '#root', windowsRoot: '#windows'});
noLayout.openWindow({id: 4, workspace: noLayout.getActiveWorkspace(), detached: true, title: 'orphan', content: '<iframe id="o"></iframe>'});
noLayout.finishRestore();
check('a window with no saved layout still gets a pane', !!noLayout.windows.get(4).item, true);
noLayout.syncGeometry();
check('and is not swept away afterwards', noLayout.count(), 1);

// A saved layout can name a window whose app is gone; the empty pane must not remain.
resetDom();
const stale = new WM({root: '#root', windowsRoot: '#windows'});
stale.applySavedLayout(stale.getActiveWorkspace(), saved.layout);
check('a pane with no window behind it is dropped', stale.count(), 0);

// Rebuilding a layout destroys every content item, and each one announces itself on the
// way out. Without the rebuild guard that is indistinguishable from the user closing
// them all, and the iframes would be deleted along with the panes.
resetDom();
const rebuilt = new WM({root: '#root', windowsRoot: '#windows'});
const keep = rebuilt.openWindow({title: 'keep', appId: 'ace', content: '<iframe id="keep"></iframe>'});
const keepFrame = rebuilt.getFrame(keep.id);
rebuilt.buildLayout(rebuilt.workspaces.get(rebuilt.getActiveWorkspace()));
check('rebuilding a layout does not close its windows', rebuilt.count(), 1);
check('and does not touch their iframes', rebuilt.getFrame(keep.id) === keepFrame, true);

// The wallpaper and the desktop menu key off this: an empty desktop beside a busy one.
resetDom();
const twoDesks = new WM({root: '#root', windowsRoot: '#windows'});
twoDesks.openWindow({title: 'busy', content: '<iframe id="busy"></iframe>'});
const spare = twoDesks.createWorkspace({name: 'Spare'});
twoDesks.switchTo(spare.id);
check('an empty desktop reports empty even when another has windows',
	twoDesks.count(twoDesks.getActiveWorkspace()), 0);

process.exit(report('wm') ? 1 : 0);
