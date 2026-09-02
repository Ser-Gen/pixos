// The mode in which Ctrl/Cmd+W belongs to PixOS.
//
// There is exactly one way for a page to take that key, and it comes with two conditions
// that cannot be worked around: Keyboard Lock is Chromium-only, and it only holds while
// the page is fullscreen. Those conditions are the feature — a mode that silently did
// nothing in Firefox would be worse than no mode at all, because the entire point is
// knowing whether closing the tab is about to cost you your desktop.
//
// So what is tested here is mostly what it says when it cannot do the thing.

import {check, report} from './assert.mjs';

const handlers = {};
let fullscreenElement = null;
const calls = [];

globalThis.document = {
	documentElement: {
		async requestFullscreen () {
			calls.push('requestFullscreen');
			fullscreenElement = globalThis.document.documentElement;
		}
	},
	get fullscreenElement () { return fullscreenElement; },
	async exitFullscreen () {
		calls.push('exitFullscreen');
		fullscreenElement = null;
	},
	addEventListener (type, fn) { handlers[type] = fn; }
};

let keyboard = {
	async lock (keys) { calls.push('lock:' + keys.join(',')); },
	unlock () { calls.push('unlock'); }
};
Object.defineProperty(globalThis, 'navigator', {
	value: {get keyboard () { return keyboard; }},
	configurable: true,
	writable: true
});

const fullscreen = await import('../js/shell/fullscreen.js');
fullscreen.init();

// --- Chromium, where it actually works ------------------------------------------------

check('nothing is claimed before entering', fullscreen.isActive(), false);
check('and no keys are held', fullscreen.isKeyboardLocked(), false);
check('the browser can do it', fullscreen.canLockKeys(), true);

const seen = [];
fullscreen.subscribe(state => seen.push(state));
check('a subscriber is told the state immediately', seen[0], {active: false, locked: false, canLockKeys: true});

await fullscreen.enter();
check('fullscreen is requested before the lock, because the lock needs it',
	calls, ['requestFullscreen', 'lock:KeyW,KeyT,KeyN']);
check('and the three keys the browser owns destructively are the ones taken',
	calls[1], 'lock:KeyW,KeyT,KeyN');
check('the mode is active', fullscreen.isActive(), true);
check('and the keys are ours', fullscreen.isKeyboardLocked(), true);
check('subscribers hear about it', seen[seen.length - 1], {active: true, locked: true, canLockKeys: true});

// The condition that bites: leaving fullscreen by *any* route hands the keys straight
// back, and the browser does not ask. Believing otherwise would leave the UI saying Cmd+W
// is safe at the exact moment it stops being.
fullscreenElement = null;
handlers.fullscreenchange();
check('leaving fullscreen releases the keys whether or not we asked',
	fullscreen.isKeyboardLocked(), false);
check('and subscribers are told', seen[seen.length - 1], {active: false, locked: false, canLockKeys: true});

calls.length = 0;
await fullscreen.enter();
await fullscreen.exit();
check('leaving deliberately unlocks and then exits, in that order',
	calls, ['requestFullscreen', 'lock:KeyW,KeyT,KeyN', 'unlock', 'exitFullscreen']);

calls.length = 0;
await fullscreen.exit();
check('exiting when not fullscreen does not call exitFullscreen',
	calls.includes('exitFullscreen'), false);

// --- a browser that will not give the key up ---------------------------------------------

keyboard = undefined;
check('Keyboard Lock is reported as missing', fullscreen.canLockKeys(), false);

calls.length = 0;
await fullscreen.enter();
check('fullscreen still works', fullscreen.isActive(), true);
check('but nothing was locked', calls, ['requestFullscreen']);
check('and it does not claim the keys', fullscreen.isKeyboardLocked(), false);

const unsupported = fullscreen.describe();
check('the mode is still offered', unsupported.available, true);
check('but its name says what it will not do', unsupported.title,
	'Fullscreen (Cmd+W still closes the tab)');
check('and it explains why rather than just failing',
	unsupported.message.includes('Only Chromium browsers'), true);

await fullscreen.exit();

// --- a lock the browser refuses at the last moment ------------------------------------------

keyboard = {
	async lock () { throw new Error('refused'); },
	unlock () {}
};
await fullscreen.enter();
check('a refused lock does not take fullscreen down with it', fullscreen.isActive(), true);
check('and the mode admits the keys are not ours', fullscreen.isKeyboardLocked(), false);
await fullscreen.exit();

// --- what it says when it works ---------------------------------------------------------------

keyboard = {async lock () {}, unlock () {}};
const supported = fullscreen.describe();
check('the supported wording names the key', supported.title.includes('Ctrl/Cmd+W'), true);
check('and warns that leaving gives it back', supported.message.includes('Esc'), true);

// --- a browser with no fullscreen at all ---------------------------------------------------------

const realDocument = globalThis.document;
globalThis.document = {documentElement: {}, addEventListener () {}};
check('no fullscreen support is detected', fullscreen.isSupported(), false);
const none = fullscreen.describe();
check('and the mode is not offered', none.available, false);
check('with a reason', none.message.includes('will not let the page go fullscreen'), true);

let refused = null;
try {
	await fullscreen.enter();
}
catch (err) {
	refused = err.message;
}
check('entering fails loudly rather than doing nothing', refused, 'This browser cannot go fullscreen');
globalThis.document = realDocument;

process.exit(report('fullscreen') ? 1 : 0);
