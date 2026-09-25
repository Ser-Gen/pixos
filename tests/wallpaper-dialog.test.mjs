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

// What the catalog lists (tests/screensaver-catalog.test.mjs): here, only the slideshow.
const pages = [{name: 'Slideshow', path: '/apps/screensavers/Slideshow.xscr', looks: null}];
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

check('turning it on asks for idle detection in the same click, before anything is awaited or downloaded',
	/if \(config && !chosen\) \{\s*saver\.askForIdle\(\);\s*\}\s*var again = redrawIfSame\(render\);\s*choose\(tile, config/.test(source), true);
check('the background goes through the same choose', /choose\(tile, config, setWallpaper\)\.then\(again, again\)/.test(source), true);

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

// --- looks, and downloading one (pass 4) ---------------------------------------------------------
//
// The catalog (js/shell/screensaver-catalog.js) lists each screensaver with its looks, and what each
// look would still download. A look is a tile; one to download says what it costs, and choosing it
// downloads it first.

const MATRIX = '/apps/screensavers/Matrix.xscr';
const matrix = {name: 'Matrix', path: MATRIX, looks: [
	{name: 'Classic', entry: 'index.html?suppressWarnings=true', tile: 'green', missing: 0},
	{name: 'Resurrections', entry: 'index.html?version=resurrections', missing: 231369},
	{name: 'Plain', missing: 0}
]};
const pipes = {name: 'Pipes', path: '/apps/screensavers/Pipes.xscr', looks: [{name: 'Pipes', entry: 'index.html#hide', missing: 626757}]};
const listed = [matrix, pipes, pages[0]];
const looksTiles = dialog.animatedTiles(listed, null);
const byTitle = title => looksTiles.find(t => t.title === title);

check('a tile per look, in the order the looks come', looksTiles.map(t => t.title),
	['Aurora', 'Drift', 'Grid', 'Classic', 'Resurrections', 'Plain', 'Pipes', 'Slideshow']);
check('each chooses its look of its folder, by name and by page',
	byTitle('Resurrections').config, {type: 'page', value: MATRIX, options: {look: 'Resurrections', entry: 'index.html?version=resurrections'}});
check('a look with no page of its own opens index.html, so it names none', byTitle('Plain').config.options, {look: 'Plain'});
check('a look is drawn with its own colours, or a page\'s when it has none', [byTitle('Classic').look, byTitle('Resurrections').look === byTitle('Slideshow').look], ['green', true]);
check('its screensaver\'s name goes above it, unless the look already says it',
	[byTitle('Classic').group, byTitle('Pipes').group], ['Matrix', '']);
check('what is still to download is on the tile', [byTitle('Classic').download, byTitle('Resurrections').download], [0, 231369]);

check('two looks of one folder are two pictures', dialog.samePicture(byTitle('Classic').config, byTitle('Resurrections').config), false);
check('one look is one picture, slash or not',
	dialog.samePicture(byTitle('Classic').config, {type: 'page', value: MATRIX + '/', options: {look: 'Classic'}}), true);
check('and a look is not the folder chosen by its path alone', dialog.samePicture(byTitle('Classic').config, {type: 'page', value: MATRIX}), false);

const marked = chosen => dialog.animatedTiles(listed, chosen).filter(t => t.active).map(t => t.title);
check('the folder chosen by its path alone is its first look, which is what it opens',
	marked({type: 'page', value: MATRIX + '/'}), ['Classic']);
check('a chosen look marks that look only', marked({type: 'page', value: MATRIX, options: {look: 'Resurrections'}}), ['Resurrections']);
const riverOnly = [{name: 'Habitats', path: '/apps/screensavers/Habitats.xscr', looks: [{name: 'Reefscape', missing: 100}, {name: 'Riverscape', missing: 0}]}];
check('with the first look not downloaded, the folder by its path alone is the first look that is, which is what it opens',
	dialog.animatedTiles(riverOnly, {type: 'page', value: '/apps/screensavers/Habitats.xscr'}).filter(t => t.active).map(t => t.title), ['Riverscape']);
check('and with none downloaded, the first', dialog.animatedTiles([{name: 'Habitats', path: '/apps/screensavers/Habitats.xscr',
	looks: [{name: 'Reefscape', missing: 100}, {name: 'Riverscape', missing: 50}]}], {type: 'page', value: '/apps/screensavers/Habitats.xscr'})
	.filter(t => t.active).map(t => t.title), ['Reefscape']);
const gone = dialog.animatedTiles(listed, {type: 'page', value: MATRIX, options: {look: 'Trinity', entry: 'index.html?version=trinity'}});
check('a look the folder no longer has gets a tile of its own, named by both', [gone.pop().title, gone.some(t => t.active)],
	['Matrix · Trinity', false]);

check('a choice is called by its screensaver and its look',
	[dialog.choiceName(byTitle('Resurrections').config), dialog.choiceName(byTitle('Pipes').config), dialog.choiceName({type: 'page', value: MATRIX})],
	['Matrix · Resurrections', 'Pipes', 'Matrix']);
check('and the note says so', dialog.screensaverNote(byTitle('Resurrections').config, 5).title, 'Matrix · Resurrections is the screensaver');
check('a tile says what it costs, in the one spelling of a size',
	[dialog.tileTip(byTitle('Resurrections')), dialog.tileTip(byTitle('Classic')), dialog.tileTip(byTitle('Pipes'), true)],
	['Matrix · Resurrections, 226 KB to download', 'Matrix · Classic', 'Pipes, downloading']);

// Choosing a look to download. The download is the catalog's; the note, and which choice wins, are here.
const events = [];
let finish = null;
let fail = null;
const fakeCatalog = {
	list: () => Promise.resolve(listed),
	download (path, look, onProgress) {
		events.push(['download', path, look]);
		onProgress(0, 231369, null);
		onProgress(1000, 231369, 'assets/resurrections_msdf.png');
		return new Promise((resolve, reject) => { finish = resolve; fail = reject; });
	}
};
dialog.init({
	host: null,
	screensaver: fakeSaver,
	getWallpaper: () => wall,
	setWallpaper: config => Promise.resolve(config),
	catalog: fakeCatalog,
	progress: cfg => {
		events.push(['note', cfg.title, cfg.total, cfg.unit]);
		return {
			update: next => { events.push(['update', next.value, next.total, next.message]); },
			done: next => { events.push(['done', next.title]); },
			fail: next => { events.push(['fail', next.title, next.message]); }
		};
	},
	describeError: (context, err) => ({title: context, message: 'because ' + err.message})
});
const applied = [];
const apply = label => config => { applied.push(label); return config; };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

const resurrections = byTitle('Resurrections');
const first = dialog.choose(resurrections, resurrections.config, apply('first click'));
await tick();
check('a look to download is not chosen yet', applied, []);
check('a note says what is downloading and what it costs, in bytes',
	events[0], ['note', 'Downloading Matrix · Resurrections', 231369, 'bytes']);
check('the catalog is asked for that look of that folder', events[1], ['download', MATRIX, 'Resurrections']);
check('and what it reports goes onto the note', events.slice(2), [['update', 0, 231369, ''], ['update', 1000, 231369, 'assets/resurrections_msdf.png']]);
const second = dialog.choose(resurrections, resurrections.config, apply('second click'));
await tick();
check('clicked again while it runs, it is the same download and the same note',
	[events.filter(e => e[0] === 'note').length, events.filter(e => e[0] === 'download').length], [1, 1]);
finish({files: 2, bytes: 231369});
await Promise.all([first, second]);
check('downloaded, it says so', events.filter(e => e[0] === 'done'), [['done', 'Matrix · Resurrections is downloaded']]);
check('and is chosen once, by the last click', applied, ['second click']);

events.length = 0;
applied.length = 0;
const later = dialog.choose(byTitle('Pipes'), byTitle('Pipes').config, apply('pipes'));
await dialog.choose(byTitle('Grid'), byTitle('Grid').config, apply('grid'));
check('a choice made while a look downloads is made at once', applied, ['grid']);
finish();
await later;
check('and the download, finishing after it, does not undo it', applied, ['grid']);

applied.length = 0;
const beforeExplorer = dialog.choose(byTitle('Pipes'), byTitle('Pipes').config, apply('pipes'));
await tick();
await dialog.useFile('/home/Rain.xscr.html', 'background');
finish();
await beforeExplorer;
check('nor does one finishing after Explorer set something', applied, []);
const beforeExplorerSaver = dialog.choose(byTitle('Pipes'), byTitle('Pipes').config, apply('pipes'));
await tick();
await dialog.useFile('/home/Rain.xscr.html', 'screensaver');
finish();
await beforeExplorerSaver;
check('as the screensaver too', applied, []);

events.length = 0;
const failing = dialog.choose(byTitle('Pipes'), byTitle('Pipes').config, apply('pipes'));
await tick();
fail(new Error('the server sent 404'));
check('a download that fails chooses nothing', [await failing, applied], [null, []]);
check('and the note becomes the error, in the shell\'s words',
	events.filter(e => e[0] === 'fail'), [['fail', 'Could not download Pipes', 'because the server sent 404']]);
events.length = 0;
await dialog.choose(byTitle('Classic'), byTitle('Classic').config, apply('classic'));
check('a look that is all here is chosen at once, with no note', [applied, events], [['classic'], []]);

check('the shell hands the dialog the catalog, the progress note and the error wording', [
	/catalog: screensaverCatalog,/.test(shellSource),
	/progress: function \(cfg\) \{\s*return window\.startProgress\(cfg\);/.test(shellSource),
	/describeError: function \(context, error\) \{\s*return window\.describeError\(context, error\);/.test(shellSource)
], [true, true, true]);

process.exit(report('wallpaper-dialog') ? 1 : 0);
