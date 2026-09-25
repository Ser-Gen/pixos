// The dialog for the background and the screensaver (phase 26), in its decisions: what the file
// field sets, which pictures are the same picture, which pages the gallery offers and in what
// order, the slideshow's folder going in and out of its address, and what the screensaver tab
// says about idle detection. Drawing it is the browser checklist.

import {check, report} from './assert.mjs';
import fs from 'node:fs';

globalThis.window = {addEventListener () {}, removeEventListener () {}};
globalThis.document = {addEventListener () {}, getElementById: () => null};

const dialog = await import('../js/shell/wallpaper-dialog.js');
const {BLANK} = await import('../js/shell/screensaver.js');

// --- the field (moved here from desktop.js) ------------------------------------------------------

check('an empty field sets nothing', dialog.configForPath('   ', 'cover'), null);
check('a screensaver file is a page', dialog.configForPath('/home/Rain.xscr.html'), {type: 'page', value: '/home/Rain.xscr.html'});
check('so is a screensaver folder', dialog.configForPath(' /apps/screensavers/Matrix.xscr '), {type: 'page', value: '/apps/screensavers/Matrix.xscr'});
check('a .glsl file is a shader', dialog.configForPath('/home/plasma.glsl'), {type: 'shader', value: '/home/plasma.glsl'});
check('and so is a .frag', dialog.configForPath('/home/plasma.FRAG'), {type: 'shader', value: '/home/plasma.FRAG'});
check('anything else is an image, fitted as chosen', dialog.configForPath('/home/sea.jpg', 'tile'),
	{type: 'image', value: '/home/sea.jpg', options: {fit: 'tile'}});
check('covering when nothing was chosen', dialog.configForPath('/home/sea.jpg').options, {fit: 'cover'});
check('a plain page is not a background', dialog.configForPath('/home/index.html').type, 'image');

const source = fs.readFileSync(new URL('../js/shell/wallpaper-dialog.js', import.meta.url), 'utf8');
check('an empty field does not reset the choice', /if \(!typed\) \{\s*return;/.test(source), true);

// --- the same picture ------------------------------------------------------------------------------

check('a folder page is the same with or without its slash',
	dialog.samePicture({type: 'page', value: '/apps/screensavers/Matrix.xscr/'}, {type: 'page', value: '/apps/screensavers/Matrix.xscr'}), true);
check('a slideshow is the same slideshow whatever folder it shows',
	dialog.samePicture(dialog.slideshowConfig('/home/a'), dialog.slideshowConfig('/home/b')), true);
check('two pages are not', dialog.samePicture({type: 'page', value: '/a.xscr.html'}, {type: 'page', value: '/b.xscr.html'}), false);
check('a built-in shader by its key', dialog.samePicture({type: 'shader', value: 'aurora'}, {type: 'shader', value: 'aurora'}), true);
check('a colour by its value', dialog.samePicture({type: 'color', value: '#000'}, {type: 'color', value: '#111'}), false);
check('the same value of another type is another picture',
	dialog.samePicture({type: 'image', value: '/x.xscr.html'}, {type: 'page', value: '/x.xscr.html'}), false);
check('nothing is the same as nothing, and not as something', [dialog.samePicture(null, null), dialog.samePicture(null, BLANK)], [false, false]);

// --- the pages in /apps/screensavers ---------------------------------------------------------------

check('only screensavers, by name, as paths',
	dialog.pagesIn(['Slideshow.xscr', 'README.md', 'matrix.xscr', 'Rain.xscr.html', 'index.html', 'Pipes.xscr.htm'], '/apps/screensavers/'),
	['/apps/screensavers/matrix.xscr', '/apps/screensavers/Pipes.xscr.htm', '/apps/screensavers/Rain.xscr.html', '/apps/screensavers/Slideshow.xscr']);
check('an unreadable folder is an empty gallery', dialog.pagesIn(null, '/apps/screensavers'), []);

// --- the slideshow's folder ------------------------------------------------------------------------

const odd = '/home/my pictures/#1 & more';
check('a folder goes into the address escaped', dialog.slideshowConfig(odd).options.entry,
	'index.html?folder=%2Fhome%2Fmy%20pictures%2F%231%20%26%20more');
check('and comes back out whole', dialog.slideshowFolder(dialog.slideshowConfig(odd)), odd);
check('an empty field is /home', dialog.slideshowFolder(dialog.slideshowConfig('  ')), '/home');
check('a slideshow with no folder in its address shows /home',
	dialog.slideshowFolder({type: 'page', value: '/apps/screensavers/Slideshow.xscr/'}), '/home');
check('a stray % is /home, not a crash',
	dialog.slideshowFolder({type: 'page', value: dialog.SLIDESHOW, options: {entry: 'index.html?folder=%E0%A4%A'}}), '/home');
check('any other choice has no folder', [dialog.slideshowFolder({type: 'page', value: '/home/Rain.xscr.html'}),
	dialog.slideshowFolder({type: 'shader', value: 'aurora'}), dialog.slideshowFolder(null)], [null, null, null]);

// --- the gallery -----------------------------------------------------------------------------------

const pages = ['/apps/screensavers/Slideshow.xscr'];
const plain = dialog.animatedTiles(pages, null);
check('the shaders first, then the pages', plain.map(t => t.title), ['Aurora', 'Drift', 'Grid', 'Slideshow']);
check('nothing is marked when nothing moving is chosen', plain.filter(t => t.active).length, 0);
check('the chosen shader is marked', dialog.animatedTiles(pages, {type: 'shader', value: 'drift'}).filter(t => t.active).map(t => t.title), ['Drift']);

const showing = dialog.slideshowConfig('/home/trips');
const withSlideshow = dialog.animatedTiles(pages, showing);
check('the chosen slideshow is marked', withSlideshow.filter(t => t.active).map(t => t.title), ['Slideshow']);
check('and its tile keeps the folder it shows, so choosing it again does not lose it',
	dialog.slideshowFolder(withSlideshow.find(t => t.title === 'Slideshow').config), '/home/trips');

const elsewhere = dialog.animatedTiles(pages, {type: 'page', value: '/home/Trail.xscr.html'});
check('a page chosen from somewhere else gets a tile of its own while it is the choice',
	elsewhere.map(t => t.title), ['Aurora', 'Drift', 'Grid', 'Slideshow', 'Trail']);
check('marked', elsewhere[4].active, true);
check('and so does a shader file', dialog.animatedTiles(pages, {type: 'shader', value: '/home/plasma.glsl'}).pop().title, 'plasma.glsl');
check('an image does not: it is not something that moves', dialog.animatedTiles(pages, {type: 'image', value: '/home/sea.jpg'}).length, 4);

const saverTiles = dialog.screensaverTiles(pages, null);
check('the screensaver tab adds None and Blank in front of the same gallery', saverTiles.map(t => t.title),
	['None', 'Blank', 'Aurora', 'Drift', 'Grid', 'Slideshow']);
check('None is off, and marked when nothing is chosen', [saverTiles[0].config, saverTiles[0].active], [null, true]);
check('Blank is marked when it is the choice',
	dialog.screensaverTiles(pages, BLANK).filter(t => t.active).map(t => t.title), ['Blank']);

// --- what it says about idle ---------------------------------------------------------------------

const detector = dialog.idleNote({mode: 'detector', permission: 'granted'});
check('watching the whole computer says so, and offers nothing', [/whole computer/.test(detector.text), detector.allow], [true, false]);
const prompt = dialog.idleNote({mode: 'fallback', permission: 'prompt'});
check('not asked yet: only PixOS counts, and it offers to ask', [/Only input in PixOS/.test(prompt.text), prompt.allow], [true, true]);
const denied = dialog.idleNote({mode: 'fallback', permission: 'denied'});
check('refused: it says where that is changed, and does not ask again', [/settings/.test(denied.text), denied.allow], [true, false]);
const missing = dialog.idleNote({mode: 'fallback', permission: 'unsupported'});
check('no idle detection at all: it says what counts, and what holds it off',
	[/cannot tell/.test(missing.text), /web page open in a window/.test(missing.text), missing.allow], [true, true, false]);
check('allowed but not running is not passed off as working',
	/would not start/.test(dialog.idleNote({mode: 'fallback', permission: 'granted'}).text), true);
check('every one says media and a hidden tab hold it off',
	[detector, prompt, denied, missing].every(n => /video or a sound/.test(n.text) && /hidden tab/.test(n.text)), true);

// --- the click that turns it on ------------------------------------------------------------------

check('turning it on asks for idle detection in the same click, before anything is awaited',
	/if \(config && !chosen\) \{\s*saver\.askForIdle\(\);\s*\}\s*Promise\.resolve\(saver\.setSettings/.test(source), true);

// --- Explorer's commands (pass 3) ----------------------------------------------------------------
//
// A double-click previews a screensaver file or folder, and the menu sets one as the background or
// the screensaver. The path becomes a choice here, by the file field's rule.

const page = {type: 'page', value: '/home/Rain.xscr.html'};
const pictures = dialog.slideshowConfig('/home/pictures');
check('a file is a choice by the field\'s rule', dialog.choiceForFile('/home/Rain.xscr.html', null), page);
check('the slideshow chosen again keeps the folder it shows', dialog.choiceForFile(dialog.SLIDESHOW, pictures), pictures);
check('with or without its slash', dialog.choiceForFile(dialog.SLIDESHOW + '/', pictures), pictures);
check('another page replaces it', dialog.choiceForFile('/home/Rain.xscr.html', pictures), page);
check('nothing typed is nothing chosen', dialog.choiceForFile('', pictures), null);

check('the note names a page by its name, and says when it will start',
	dialog.screensaverNote(page, 5), {level: 'info', title: 'Rain is the screensaver', message: 'It starts after 5 minutes with nobody there.', source: 'PixOS'});
check('a folder one too, and one minute is a minute',
	[dialog.screensaverNote(pictures, 1).title, dialog.screensaverNote(pictures, 1).message],
	['Slideshow is the screensaver', 'It starts after 1 minute with nobody there.']);
check('anything else by its file name', dialog.screensaverNote({type: 'shader', value: '/home/plasma.glsl'}, 5).title,
	'plasma.glsl is the screensaver');

const calls = [];
const notes = [];
let saverSettings = {show: null, minutes: 5};
let wall = {type: 'gradient', value: 'dusk'};
const fakeSaver = {
	getSettings: () => saverSettings,
	askForIdle: () => { calls.push('ask'); },
	setSettings: patch => {
		calls.push(['set', patch]);
		saverSettings = Object.assign({}, saverSettings, patch);
		return Promise.resolve(saverSettings);
	},
	start: config => { calls.push(['start', config]); return true; }
};
dialog.init({
	host: null,
	screensaver: fakeSaver,
	getWallpaper: () => wall,
	setWallpaper: config => { calls.push(['wallpaper', config]); wall = config; return Promise.resolve(config); },
	notify: note => { notes.push(note); }
});

check('a preview shows the file, and says it did', [dialog.previewFile('/home/Rain.xscr.html'), calls], [true, [['start', page]]]);
calls.length = 0;
check('with no path there is nothing to preview', [dialog.previewFile('  '), calls], [false, []]);

let settled = dialog.useFile('/home/Rain.xscr.html', 'screensaver');
check('set as the screensaver with nothing chosen, it asks about idle first, in the same click',
	calls, ['ask', ['set', {show: page}]]);
check('and resolves to the settings', (await settled).show, page);
// Nothing on screen changes, so it says what it set -- with a way to see it, and to change it.
check('then says so, and when it starts', notes.map(n => [n.title, n.message, n.actions.map(a => a.label)]),
	[['Rain is the screensaver', 'It starts after 5 minutes with nobody there.', ['Preview', 'Screensaver...']]]);
calls.length = 0;
notes[0].actions[0].run();
check('its Preview shows what was set', calls, [['start', page]]);
notes.length = 0;
calls.length = 0;
await dialog.useFile(dialog.SLIDESHOW, 'screensaver');
check('with one already chosen it does not ask again', calls, [['set', {show: {type: 'page', value: dialog.SLIDESHOW}}]]);
saverSettings = {show: pictures, minutes: 5};
calls.length = 0;
await dialog.useFile(dialog.SLIDESHOW, 'screensaver');
check('the slideshow set again keeps its folder', calls, [['set', {show: pictures}]]);
calls.length = 0;
check('nothing to set sets nothing', [await dialog.useFile('', 'screensaver'), calls], [null, []]);

notes.length = 0;
settled = dialog.useFile('/home/Rain.xscr.html', 'background');
check('set as the background, it goes to the desktop', calls, [['wallpaper', page]]);
check('and resolves to what was set', await settled, page);
check('with no note: a background is seen', notes, []);
wall = pictures;
calls.length = 0;
await dialog.useFile(dialog.SLIDESHOW + '/', 'background');
check('the slideshow background keeps its folder too', calls, [['wallpaper', pictures]]);

dialog.init({host: null, screensaver: null, getWallpaper: () => wall, setWallpaper: () => Promise.resolve()});
calls.length = 0;
// The shell's three entry points for Explorer, in index.html: each goes where its name says.
const shellSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
check('the shell hands Explorer a preview, a background and a screensaver, each to its own surface', [
	/window\.previewScreensaver = function \(filePath\) \{\s*return wallpaperDialog\.previewFile\(filePath\);/.test(shellSource),
	/window\.setWallpaperPage = function \(filePath\) \{\s*return wallpaperDialog\.useFile\(filePath, 'background'\);/.test(shellSource),
	/window\.setScreensaverPage = function \(filePath\) \{\s*return wallpaperDialog\.useFile\(filePath, 'screensaver'\);/.test(shellSource),
	/notify: function \(note\) \{\s*window\.notify\(note\);/.test(shellSource)
], [true, true, true, true]);

check('with no screensaver module there is nothing to preview or set',
	[dialog.previewFile('/home/Rain.xscr.html'), await dialog.useFile('/home/Rain.xscr.html', 'screensaver'), calls], [false, null, []]);

process.exit(report('wallpaper-dialog') ? 1 : 0);
