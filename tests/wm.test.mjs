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
		return this.querySelectorAll(selector)[0] || null;
	}
	getBoundingClientRect () {
		return {top: 0, left: 0, width: 100, height: 100};
	}
	closest () {
		return null;
	}
}

const windowsRoot = new El('div');
const layoutRoot = new El('div');
const bodyRoot = new El('body');

// A real document contains the layout, the windows layer and the drag proxy's home in
// document.body -- the sweep has to see all three.
const documentRoot = new El('html');
documentRoot.append(layoutRoot, windowsRoot, bodyRoot);
globalThis.document = documentRoot;

globalThis.$ = function (arg) {
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
					layoutRoot.append(item.holder);
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
	constructor () {
		this.handlers = {};
		this.root = new Item({}, this, null);
		this.root.contentItems.push(new Item({type: 'row'}, this, this.root));
	}
	registerComponent (name, fn) {
		this.factory = fn;
	}
	init () {
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

// Shell shortcuts have to survive an app having focus.
const forwarded = [];
wm.on('keydown', e => forwarded.push(e.code));
const listeners = [];
const sameOriginFrame = {contentDocument: {addEventListener: (evt, fn) => listeners.push(fn)}};
wm.bridgeHotkeys(sameOriginFrame);
wm.bridgeHotkeys(sameOriginFrame);
check('the hotkey bridge is installed once per document', listeners.length, 1);
listeners[0]({code: 'KeyD'});
check('a key pressed inside an app is republished', forwarded, ['KeyD']);

const crossOriginFrame = {get contentDocument () { throw new Error('cross-origin'); }};
wm.bridgeHotkeys(crossOriginFrame);
check('a cross-origin frame is skipped without throwing', forwarded, ['KeyD']);

process.exit(report('wm') ? 1 : 0);
