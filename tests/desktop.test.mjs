// The desktop's decisions about a background since phase 26: which pointer events on the desktop
// reach a page drawn behind it, when the screensaver counts as covering it, and what a failure
// says. The rest of desktop.js is drawing, and the browser checklist. The dialog's field is
// tests/wallpaper-dialog.test.mjs.

import {check, report} from './assert.mjs';

// Enough of a browser for the module graph to import: context-menu and system-stats register
// window listeners at module scope.
globalThis.window = {addEventListener () {}, removeEventListener () {}};
globalThis.document = {addEventListener () {}, getElementById: () => null};

const desktop = await import('../js/shell/desktop.js');

// --- the pointer ------------------------------------------------------------------------------

const wallpaperEl = {name: 'wallpaper'};
const desktopEl = {name: 'desktop'};
const widget = {name: 'a widget'};

check('a move over the background reaches it', desktop.isBackgroundInput({type: 'pointermove', target: wallpaperEl}, wallpaperEl, desktopEl), true);
check('and a move over a widget, so the page still sees where the pointer is',
	desktop.isBackgroundInput({type: 'pointermove', target: widget}, wallpaperEl, desktopEl), true);
check('a press on the background reaches it', desktop.isBackgroundInput({type: 'pointerdown', target: wallpaperEl}, wallpaperEl, desktopEl), true);
check('and on the bare desktop', desktop.isBackgroundInput({type: 'click', target: desktopEl}, wallpaperEl, desktopEl), true);
check('a press on a widget is the widget\'s', desktop.isBackgroundInput({type: 'pointerdown', target: widget}, wallpaperEl, desktopEl), false);
check('and so is its click', desktop.isBackgroundInput({type: 'click', target: widget}, wallpaperEl, desktopEl), false);

// --- the wiring ---------------------------------------------------------------------------------

const fs = await import('node:fs');
const source = fs.readFileSync(new URL('../js/shell/desktop.js', import.meta.url), 'utf8');
check('the desktop listens for exactly the events the page is handed',
	(source.match(/\[('pointermove', 'pointerdown', 'pointerup', 'click')\]\.forEach/) || [])[1],
	"'pointermove', 'pointerdown', 'pointerup', 'click'");
check('the right-click is still the desktop\'s menu', /desktopEl\.addEventListener\('contextmenu', onContextMenu\)/.test(source), true);
check('the screensaver covers the background as a window does',
	/var covered = \(.*\) \|\| obscured;/.test(source), true);
check('and hides the widgets, so their readings slow down', /widgets\.setVisible\(\(empty \|\| peeking\) && !obscured\)/.test(source), true);

// --- saying what failed -------------------------------------------------------------------------

check('a page that fails is named as one',
	desktop.wallpaperErrorNote('cannot read /home/Rain.xscr.html', {type: 'page'}, 'background'),
	{level: 'error', title: 'The background could not be drawn',
		message: 'That screensaver page failed: cannot read /home/Rain.xscr.html. The default gradient is showing instead.', source: 'PixOS'});
check('the screensaver says it was the screensaver', desktop.wallpaperErrorNote('x', {type: 'shader'}, 'screensaver').title,
	'The screensaver could not be drawn');
check('and a shader is named as one', desktop.wallpaperErrorNote('x', {type: 'shader'}).message.indexOf('That shader failed: x.'), 0);

process.exit(report('desktop') ? 1 : 0);
