// A page as the background (phase 26). What is decided without a browser: which paths are
// screensavers, where the frame points, holding a window's animation frames, and what a
// pointer event on the desktop becomes inside the page. Then one mount driven through a fake
// frame's load, which is where the order of things matters: a pause can come before the page
// does, a page may pause itself, and a missing file comes back as a 404 page.
//
// Whether a hidden frame stops drawing on its own is the one thing that needed a real browser,
// and is docs/checks/hidden-frame.html: in Chrome it does not.

import {check, report} from './assert.mjs';

// --- enough of a browser ------------------------------------------------------------------

let lastFrame = null;
globalThis.document = {
	createElement (tag) {
		const listeners = {};
		lastFrame = {
			tag,
			title: '',
			src: '',
			style: {cssText: ''},
			attributes: {},
			removed: false,
			contentWindow: null,
			setAttribute (name, value) { this.attributes[name] = value; },
			addEventListener (type, fn) { listeners[type] = fn; },
			load (win) {
				this.contentWindow = win;
				listeners.load();
			},
			remove () { this.removed = true; },
			getBoundingClientRect: () => ({left: 0, top: 0, width: 1280, height: 800})
		};
		return lastFrame;
	}
};

const wallpaper = await import('../js/shell/wallpaper.js');
const page = await import('../js/shell/wallpaper-page.js');

check('importing it registers a provider', wallpaper.listTypes().includes('page'), true);

// --- which paths are screensavers ----------------------------------------------------------

check('a single file is Name.xscr.html', page.isScreensaverPath('/home/Rain.xscr.html'), true);
check('or .htm', page.isScreensaverPath('/home/Rain.xscr.htm'), true);
check('a folder is Name.xscr', page.isScreensaverPath('/apps/screensavers/Matrix.xscr'), true);
check('with or without its slash', page.isScreensaverPath('/apps/screensavers/Matrix.xscr/'), true);
check('in any case', page.isScreensaverPath('/home/RAIN.XSCR.HTML'), true);
check('a plain page is not one', page.isScreensaverPath('/home/index.html'), false);
check('nor a bare .xscr file with something after it', page.isScreensaverPath('/home/Rain.xscr.txt'), false);
check('nor a name that only has xscr in it', page.isScreensaverPath('/home/xscr.html'), false);
check('nor a file inside a folder one', page.isScreensaverPath('/apps/screensavers/Matrix.xscr/index.html'), false);
check('nor anything that is not a string', page.isScreensaverPath(null), false);

check('a screensaver is called by its name', page.pageName('/home/Rain.xscr.html'), 'Rain');
check('a folder one too', page.pageName('/apps/screensavers/Matrix.xscr'), 'Matrix');
check('and so is any file inside it, which is what an error report names',
	page.pageName('/__browserfs__/apps/screensavers/Matrix.xscr/js/main.js'), 'Matrix');
check('an escaped name is read back', page.pageName('/__browserfs__/home/Deep%20Sea.xscr.html'), 'Deep Sea');
check('a stray % does not throw', page.pageName('/home/100%.xscr.html'), '100%');
check('anything else has no name', page.pageName('/apps/ace/index.html'), '');

// --- where the frame points ---------------------------------------------------------------------

check('a file is served through the worker', page.pageUrl('/home/Rain.xscr.html'), '/__browserfs__/home/Rain.xscr.html');
check('a folder opens its index.html', page.pageUrl('/apps/screensavers/Matrix.xscr'),
	'/__browserfs__/apps/screensavers/Matrix.xscr/index.html');
check('its trailing slash is not doubled', page.pageUrl('/apps/screensavers/Matrix.xscr/'),
	'/__browserfs__/apps/screensavers/Matrix.xscr/index.html');
check('a look can name another page, with a query', page.pageUrl('/apps/screensavers/Matrix.xscr', 'index.html?version=3d'),
	'/__browserfs__/apps/screensavers/Matrix.xscr/index.html?version=3d');
check('or a page further in', page.pageUrl('/a/Tank.xscr', 'scenes/reef/wallpaper.html'),
	'/__browserfs__/a/Tank.xscr/scenes/reef/wallpaper.html');
check('a # or ? in a filename is escaped, not the end of the address', page.pageUrl('/home/Is it #1?.xscr.html'),
	'/__browserfs__/home/Is%20it%20%231%3F.xscr.html');
check('an already-served path is not prefixed twice', page.pageUrl('/__browserfs__/home/Rain.xscr.html'),
	'/__browserfs__/home/Rain.xscr.html');
check('a look may not climb out of its folder', page.pageUrl('/a/Tank.xscr', '../../settings/x.html'), null);
check('nor start from the root', page.pageUrl('/a/Tank.xscr', '/settings/x.html'), null);
check('nor go somewhere else entirely', page.pageUrl('/a/Tank.xscr', 'https://example.com/'), null);
check('nor javascript:', page.pageUrl('/a/Tank.xscr', 'javascript:alert(1)'), null);
check('a name with two dots in it is still a name', page.pageUrl('/a/Tank.xscr', 'a..b.html'),
	'/__browserfs__/a/Tank.xscr/a..b.html');
check('an address is not a path', page.pageUrl('https://example.com/Rain.xscr.html'), null);
check('nor is a relative path', page.pageUrl('home/Rain.xscr.html'), null);
check('nor a plain page', page.pageUrl('/home/index.html'), null);

// --- holding a window's animation frames -----------------------------------------------------

function fakeWindow (extra) {
	const scheduled = new Map();
	let next = 1;
	const win = Object.assign({
		scheduled,
		requestAnimationFrame (fn) {
			scheduled.set(next, fn);
			return next++;
		},
		cancelAnimationFrame (id) {
			scheduled.delete(id);
		}
	}, extra || {});
	return win;
}

let win = fakeWindow();
let frames = page.holdAnimationFrames(win);
let tick = () => {};
let id = win.requestAnimationFrame(tick);
check('not held, a frame is asked for as usual', [id > 0, win.scheduled.size], [true, 1]);
win.scheduled.clear();

frames.hold();
id = win.requestAnimationFrame(tick);
check('held, it is queued instead, under an id of its own', [id < 0, win.scheduled.size], [true, 0]);
check('the hold says so', frames.isHeld(), true);
const cancelled = win.requestAnimationFrame(() => {});
win.cancelAnimationFrame(cancelled);
frames.release();
check('a release hands the queue on, less what was cancelled', win.scheduled.size, 1);
check('the one handed on is the one that was queued', [...win.scheduled.values()][0], tick);
win.cancelAnimationFrame(id);
check('the id the page was given still cancels it once handed on', win.scheduled.size, 0);
check('released, frames go through again', [win.requestAnimationFrame(tick) > 0, win.scheduled.size], [true, 1]);
win.cancelAnimationFrame([...win.scheduled.keys()][0]);
check('and a real id still cancels a real frame', win.scheduled.size, 0);

// --- what a pointer event becomes inside the page ------------------------------------------------

const rect = {left: 10, top: 20};
let made = page.forwardedEvents({type: 'pointermove', clientX: 110, clientY: 220, button: -1, buttons: 0, pointerId: 7, pointerType: 'mouse', isPrimary: true}, rect);
check('a move becomes a pointer move and a mouse move', made.map(m => m.kind + ' ' + m.type), ['PointerEvent pointermove', 'MouseEvent mousemove']);
check('at the same place, measured from the frame', [made[0].init.clientX, made[0].init.clientY], [100, 200]);
check('both of them', [made[1].init.clientX, made[1].init.clientY], [100, 200]);
check('a pointer event keeps its pointer', [made[0].init.pointerId, made[0].init.pointerType], [7, 'mouse']);
check('a move presses no button: -1 as a pointer event, 0 as a mouse event', made.map(m => m.init.button), [-1, 0]);
check('they bubble, so a page listening on window hears them', made.every(m => m.init.bubbles), true);

made = page.forwardedEvents({type: 'pointerdown', clientX: 5, clientY: 5, button: 0, buttons: 1}, rect);
check('a left press becomes a pointer press and a mouse press', made.map(m => m.type), ['pointerdown', 'mousedown']);
made = page.forwardedEvents({type: 'pointerup', clientX: 5, clientY: 5, button: 0}, rect);
check('and its release', made.map(m => m.type), ['pointerup', 'mouseup']);
made = page.forwardedEvents({type: 'click', clientX: 5, clientY: 5, button: 0}, rect);
check('a click is a click, once', made.map(m => m.type + ' ' + m.init.detail), ['click 1']);

check('a right press is the desktop\'s menu', page.forwardedEvents({type: 'pointerdown', button: 2}, rect), []);
check('a middle press is the browser\'s', page.forwardedEvents({type: 'pointerdown', button: 1}, rect), []);
check('a right click too', page.forwardedEvents({type: 'click', button: 2}, rect), []);
check('a key is not a pointer', page.forwardedEvents({type: 'keydown'}, rect), []);
check('nor is the context menu', page.forwardedEvents({type: 'contextmenu', button: 2}, rect), []);

// --- a mount, through a fake frame's load -------------------------------------------------------

function mountPage (value, extra) {
	const host = {children: [], style: {cssText: '', background: ''}, append (child) { this.children.push(child); }, replaceChildren () { this.children = []; }};
	const errors = [];
	const handle = wallpaper.mount(host, {type: 'page', value, options: extra || {}}, {onError: message => errors.push(message)});
	return {host, errors, handle, frame: lastFrame};
}

function loadedWindow (status, extra) {
	return Object.assign(fakeWindow(extra), {
		document: {documentElement: {}},
		performance: {getEntriesByType: type => type === 'navigation' ? [{responseStatus: status}] : []}
	});
}

let m = mountPage('/home/Rain.xscr.html');
check('the frame points at the page', m.frame.src, '/__browserfs__/home/Rain.xscr.html');
check('and is in the element', m.host.children.length, 1);
check('it is called by the screensaver\'s name', m.frame.title, 'Rain');
check('it never takes the pointer itself', /pointer-events:none/.test(m.frame.style.cssText), true);
check('nor the keyboard', m.frame.attributes.tabindex, '-1');
check('and has none of the border every other frame gets', /border:0/.test(m.frame.style.cssText), true);

// Paused before it loaded: the hold goes on at load.
m.handle.pause();
win = loadedWindow(200);
m.frame.load(win);
win.requestAnimationFrame(() => {});
check('paused before the page arrived, its frames are held once it does', win.scheduled.size, 0);
m.handle.resume();
check('and handed on when it is seen', win.scheduled.size, 1);
win.scheduled.clear();
m.handle.pause();
win.requestAnimationFrame(() => {});
check('paused while loaded, the same', win.scheduled.size, 0);
m.handle.resume();

// A page that knows how to pause itself is asked, and not held.
const said = [];
m = mountPage('/apps/screensavers/Tank.xscr');
win = loadedWindow(200, {pixosPause () { said.push('pause'); }, pixosResume () { said.push('resume'); }});
m.frame.load(win);
m.handle.pause();
win.requestAnimationFrame(() => {});
check('a page with pixosPause is asked to pause', said, ['pause']);
check('and its frames are not held', win.scheduled.size, 1);
m.handle.resume();
check('and asked to resume', said, ['pause', 'resume']);

// A pixosPause that throws is not the end of it.
m = mountPage('/home/Broken.xscr.html');
win = loadedWindow(200, {pixosPause () { throw new Error('no'); }});
m.frame.load(win);
const quiet = console.error;
console.error = () => {};
m.handle.pause();
console.error = quiet;
win.scheduled.clear();
win.requestAnimationFrame(() => {});
check('a pixosPause that throws falls back to holding the frames', win.scheduled.size, 0);

// A page that reloads itself while paused is a new document, and is held again.
m = mountPage('/home/Rain.xscr.html');
m.frame.load(loadedWindow(200));
m.handle.pause();
win = loadedWindow(200);
m.frame.load(win);
win.requestAnimationFrame(() => {});
check('a new document in a paused frame is held too', win.scheduled.size, 0);

// A missing file comes back as the worker's 404 page.
m = mountPage('/home/Gone.xscr.html');
m.frame.load(loadedWindow(404));
check('a page that 404s is a failure, said out loud', m.errors, ['cannot read /home/Gone.xscr.html']);
check('and its frame is taken away', m.frame.removed, true);
check('the default gradient shows instead', /^linear-gradient/.test(m.host.style.background), true);

// A browser that does not report the status loads what it loads.
m = mountPage('/home/Rain.xscr.html');
m.frame.load(Object.assign(fakeWindow(), {document: {documentElement: {}}, performance: {getEntriesByType: () => []}}));
check('no status reported is not a failure', m.errors, []);

m = mountPage('/home/index.html');
check('a path that is not a screensaver fails at once', m.errors, ['not a screensaver page: /home/index.html']);

// Input goes to whatever is under the pointer, as the frame's own kind of event.
const dispatched = [];
m = mountPage('/home/Rain.xscr.html');
class FramePointerEvent { constructor (type, init) { this.type = type; this.init = init; this.realm = 'frame'; } }
class FrameMouseEvent { constructor (type, init) { this.type = type; this.init = init; this.realm = 'frame'; } }
const under = {dispatchEvent (event) { dispatched.push(event); }};
win = Object.assign(loadedWindow(200), {PointerEvent: FramePointerEvent, MouseEvent: FrameMouseEvent});
win.document = {documentElement: {}, elementFromPoint: (x, y) => (x === 300 && y === 400 ? under : null)};
m.frame.load(win);
m.handle.forward({type: 'pointermove', clientX: 300, clientY: 400, button: -1});
check('a move reaches what is under the pointer, twice', dispatched.map(e => e.type), ['pointermove', 'mousemove']);
check('as events made in the frame\'s window', dispatched.every(e => e.realm === 'frame'), true);
check('which they name as their view', dispatched[0].init.view, win);
dispatched.length = 0;
m.handle.pause();
m.handle.forward({type: 'click', clientX: 300, clientY: 400, button: 0});
check('nothing reaches a paused page', dispatched, []);
m.handle.resume();

m.handle.unmount();
check('unmounting takes the frame away', m.frame.removed, true);
m.frame.load(loadedWindow(404));
check('and a load that arrives after that is ignored', m.errors, []);

process.exit(report('wallpaper-page') ? 1 : 0);
