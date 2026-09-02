// The launch funnel, lifted straight out of index.html.
//
// Every window in the system goes through launch(), including the per-app quirks that
// used to be branches inside openFile(). The region is extracted by marker rather than
// duplicated here, so the tests fail loudly if the shell is reorganised.

import fs from 'fs';
import {check, report} from './assert.mjs';
// The real model, not a stub: the launchers and the menus are supposed to agree with it.
import * as appsModel from '../js/shell/apps-model.js';

const MARKER = 'window.openPath = openPath;';
const shell = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = shell.indexOf(MARKER);
if (start === -1) {
	console.error('launch.test.mjs: could not find "' + MARKER + '" in index.html');
	process.exit(1);
}
const region = shell.slice(start, shell.indexOf('</script>', start));

const opened = [];
const winManager = {
	openWindow (cfg) {
		opened.push(cfg);
		return {id: opened.length - 1};
	},
	getFrame () {
		// Enough of an iframe for launch(): somewhere to hang onload, and a parent the
		// web-view decorator can query without a DOM.
		return {
			set onload (fn) {},
			parentElement: {
				querySelector: function (selector) {
					decorated.push(selector);
					return null;
				}
			}
		};
	}
};
var decorated = [];
const desktop = {isPeeking: () => false, togglePeek () {}, openWallpaperPicker () {}};
const palette = {open () {}, toggle () {}};

const win = {
	viewCounter: 0,
	path: {
		basename: p => String(p).split('/').pop(),
		extname: p => {
			const base = String(p).split('/').pop();
			const dot = base.lastIndexOf('.');
			return dot > 0 ? base.slice(dot) : '';
		}
	},
	apps: [{id: 'ace'}, {id: 'treemap'}, {id: 'media-player'}, {id: 'photopea'}],
	// The real registry record carries both `label` (what App Manager reads) and `name`.
	// `ace` here has only `label`, because that is all the record used to have and the
	// shell silently fell back to showing ids.
	getInstallableApps: () => [
		{id: 'ace', label: 'Ace', entryPath: '/apps/ace/index.html'},
		{id: 'treemap', name: 'Disk Treemap', label: 'Disk Treemap', icon: '/apps/treemap/favicon.svg', entryPath: '/apps/treemap/index.html'},
		{id: 'media-player', name: 'Video Player', label: 'Video Player', entryPath: '/apps/media-player/index.html'},
		{id: 'photopea', name: 'Photopea', label: 'Photopea', entryPath: '/apps/photopea/index.html'},
		{id: 'notinstalled', name: 'Ghost', label: 'Ghost', entryPath: '/apps/ghost/index.html'}
	],
	getCatalogApp: () => null,
	// Enough of a filesystem to answer "is this still there, and is it a folder". Callbacks
	// fire synchronously, which the real one does not -- but what is under test is which
	// call the answer leads to, not the timing.
	fs: {
		stat (filePath, callback) {
			var tree = {'/docs/a.txt': false, '/docs/b.txt': false, '/home': true};
			if (!(filePath in tree)) {
				callback(new Error('ENOENT'), null);
				return;
			}
			callback(null, {isDirectory: () => tree[filePath]});
		}
	},
	notify (note) {
		notes.push(note);
	},
	// The extension machinery the chooser reads. Enough of it to tell a page from a
	// spreadsheet, which is the only distinction openFile() makes.
	getExtensionCandidates (filePath) {
		const base = String(filePath).split('/').pop();
		const parts = base.split('.');
		if (parts.length < 2 || parts[0] === '') {
			return [];
		}
		return parts.length > 2
			? [parts.slice(-2).join('.').toLowerCase(), parts[parts.length - 1].toLowerCase()]
			: [parts[parts.length - 1].toLowerCase()];
	},
	getFileCompatibilityProfile: async filePath => ({extension: String(filePath).split('.').pop()}),
	// ace reads text; the uninstalled 'notinstalled' claims csv too, so the chooser has
	// one of each kind to offer.
	isAppCompatibleWithProfile: async (appId, profile) =>
		(appId === 'ace' && profile.extension === 'csv')
		|| (appId === 'notinstalled' && profile.extension === 'csv'),
	installAppById: async appId => {
		installs.push(appId);
		if (appId === 'refuses') {
			throw new Error('offline');
		}
	},
	setDefaultAppForExtension: async (ext, appId) => {
		if (ext === 'unwritable') {
			throw new Error('read-only');
		}
		defaults.push([ext, appId]);
	},
	describeError: (context, err) => ({title: context, message: String(err.message)}),
	open (address) {
		tabs.push(address);
		return {};
	}
};
const notes = [];
const installs = [];
const defaults = [];
const tabs = [];

// The chooser, stubbed: what it was asked about is recorded, and what it answers is set
// per case. The real one is a DOM overlay and is covered by tests/open-with.test.mjs.
const asked = [];
let answer = null;
const openWith = {
	BROWSER_TAB: 'browser-tab',
	RAW_WINDOW: 'raw-window',
	open (request) {
		asked.push(request);
		return Promise.resolve(answer);
	}
};
const notifications = {notify: note => notes.push(note)};

globalThis.location = {href: 'http://localhost:8000/'};
globalThis.fetch = async () => ({blob: async () => 'BLOB', arrayBuffer: async () => 'AB'});
// Absolute in, absolute out -- the shell resolves relative paths against the page but
// hands openUrl() whole addresses, and a stub that prefixed both would hide that.
globalThis.URL = class {
	static createObjectURL () { return 'blob:tic'; }
	constructor (path) {
		this.href = /^[a-z][a-z0-9+.-]*:\/\//i.test(String(path))
			? String(path)
			: 'http://localhost:8000' + path;
	}
};

const api = new Function('window', 'winManager', 'desktop', 'appsModel', 'palette', 'openWith', 'notifications',
	region + '\n; return {launch, openApp, openFile, openFiles, openPath, openUrl, openRecentFile, buildDesktopMenu, listLaunchableApps, appNeedsNetwork};'
)(win, winManager, desktop, appsModel, palette, openWith, notifications);

appsModel.init({listApps: api.listLaunchableApps});
await appsModel.load();

const srcOf = index => opened[index].content.match(/src="([^"]*)"/)[1];

await api.openApp('ace');
check('an app with no file opens on its entry path', srcOf(0), '__browserfs__/apps/ace/index.html');
check('such a window is titled with the app name, not its id', opened[0].title, 'Ace');
check('and records no path', opened[0].path, null);

await api.openFile('/docs/a.txt', 'ace');
check('a file window is titled with the path', opened[1].title, '/docs/a.txt');
check('and carries the descriptor a restore would replay', opened[1].launch,
	{appId: 'ace', paths: ['/docs/a.txt'], url: null, title: null});

await api.openPath('/home', 'new explorer');
check("Explorer's own 'new explorer' still resolves", srcOf(2), '__browserfs__/apps/explorer/index.html?cwd=%2Fhome');
check('Explorer keeps its file-system-access allowance', /allow="file-system-access"/.test(opened[2].content), true);

await api.openApp('explorer');
check('Explorer with no folder gets no query string', srcOf(3), '__browserfs__/apps/explorer/index.html');

await api.openPath('/home/pics', 'treemap');
check('treemap receives its path as a query parameter', srcOf(4), '__browserfs__/apps/treemap/index.html?path=%2Fhome%2Fpics');

await api.openApp('treemap');
check('treemap with no path drops the query entirely', srcOf(5), '__browserfs__/apps/treemap/index.html');

await api.openFiles(['/a.mp4', '/b.mp4'], 'media-player');
check('media-player takes several files in one window', opened.length, 7);
check('as an initPlaylist', /initPlaylist=/.test(srcOf(6)), true);
check('titled by count', opened[6].title, '2 files');

await api.openFiles(['/a.txt', '/b.txt'], 'ace');
check('an app that takes one file gets one window per file', opened.length, 9);

await api.openFile('/x/app.html');
check('with no app at all, the path is the window', srcOf(9), '__browserfs__/x/app.html');

check('only apps actually in BrowserFS are launchable', api.listLaunchableApps().map(app => app.id).sort(),
	['ace', 'app-manager', 'explorer', 'media-player', 'photopea', 'treemap']);

const menu = api.buildDesktopMenu();
check('a record with only a label still shows a real name', api.listLaunchableApps().find(a => a.id === 'ace').name, 'Ace');
check('the manifest icon reaches the launcher', api.listLaunchableApps().find(a => a.id === 'treemap').icon, '/apps/treemap/favicon.svg');
check('an app without an icon reports none rather than undefined', api.listLaunchableApps().find(a => a.id === 'photopea').icon, null);

check('the desktop menu leads with Applications', menu[0].label, 'Applications');
check('recent files sit beside the applications, not inside them', menu[1].label, 'Recent files');
check('listing what was opened, most recent first, by filename',
	menu[1].submenu[0].label, 'app.html');
check('with the folder it is in beside it, since basenames repeat',
	menu[1].submenu[0].hint, '/x');
check('and a folder marked as one', menu[1].submenu.find(i => i.label === 'home/').hint, '/');
check('search is one level up, not buried in a submenu',
	menu.map(item => item.label).includes('Search...'), true);
check('and so is the window overview',
	menu.map(item => item.label).includes('All windows'), true);
check('and it ends with wallpaper and peek', menu.slice(-2).map(item => item.label), ['Wallpaper...', 'Show desktop']);

// Promoting must not duplicate or drop anything: the submenu is still every app once,
// with a separator between the recent ones and the rest.
const entries = menu[0].submenu;
check('every launchable app appears exactly once', entries.filter(i => !i.separator).length, 6);
check('recents are separated from the rest', entries.filter(i => i.separator).length, 1);

// Launching through any surface feeds one recents list, which every surface then reads.
// The openApp() calls earlier in this file have already been recorded, which is the point.
await api.openApp('media-player');
const after = api.buildDesktopMenu()[0].submenu;
check('the newest launch leads the menu', after[0].label, 'Video Player');
check('and still appears only once', after.filter(i => i.label === 'Video Player').length, 1);
check('the app count is unchanged', after.filter(i => !i.separator).length, 6);

globalThis.fetch = async () => { throw new Error('gone'); };
const before = opened.length;
await api.openFile('/broken.png', 'photopea');
check('a file that cannot be read still opens its app', opened.length, before + 1);

// --- web pages in windows -----------------------------------------------------------
//
// Not an app and not a file: openUrl builds the one kind of window whose src is used
// verbatim instead of being resolved under /__browserfs__.

const web = opened.length;
await api.openUrl('https://example.com/a?b=1');
check('a url opens a window', opened.length, web + 1);
check('with the site as the iframe src', srcOf(web), 'https://example.com/a?b=1');
check('wrapped in a bar that offers a browser tab', /PixWebView__bar/.test(opened[web].content), true);
// Without this every cross-origin site is blocked by the shell's own COEP header, before
// the site's framing policy is even consulted -- see WEB_VIEW in index.html.
check('and the frame is credentialless, or COEP blocks it outright',
	/<iframe [^>]*credentialless/.test(opened[web].content), true);
check('titled by host when no title is given', opened[web].title, 'example.com');
check('and it is not attributed to an app', opened[web].appId, null);
check('the descriptor a restore would replay carries the url', opened[web].launch,
	{appId: null, paths: [], url: 'https://example.com/a?b=1', title: null});
check('the decorator ran against the window it built', decorated.length > 0, true);

await api.openUrl('https://example.com/', 'Example');
check('an explicit title wins', opened[web + 1].title, 'Example');

// openUrl is reachable from inside any app iframe, so anything that is not http(s) has
// to be refused here rather than becoming a src in the shell's own origin.
for (const bad of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'file:///etc/passwd', '', null]) {
	let refused = null;
	try {
		await api.openUrl(bad);
	}
	catch (err) {
		refused = err.message;
	}
	check('openUrl refuses ' + (bad || 'an empty url'), refused, 'launch() needs an app, a path or a url');
}
check('and no window was opened for any of them', opened.length, web + 2);

let message = null;
try {
	await api.launch({appId: 'nosuchapp'});
}
catch (err) {
	message = err.message;
}
check('launching an unknown app fails loudly', message, 'App nosuchapp has no launch path');

// --- which apps cannot work offline ---------------------------------------------------
//
// Two records answer this, and either one saying yes is enough. The installed record is
// assembled field by field in js/app-registry.js, and `needsNetwork` was left out of one
// of those lists -- so the shell saw the flag on the catalog app and not on the installed
// copy, which is every app anyone actually runs, and the warning never appeared at all.
// Reading both records means it now takes two omissions to lose it rather than one.

const catalog = {};
win.getCatalogApp = id => catalog[id] || null;

win.apps = [{id: 'monaco-cdn', needsNetwork: true}];
check('an installed app that declares it needs the network', api.appNeedsNetwork('monaco-cdn'), true);

win.apps = [{id: 'monaco-cdn'}];
catalog['monaco-cdn'] = {id: 'monaco-cdn', needsNetwork: true};
check('an installed record that dropped the field still gets the warning',
	api.appNeedsNetwork('monaco-cdn'), true);

win.apps = [{id: 'ace'}];
catalog.ace = {id: 'ace'};
check('an app neither record flags is left alone', api.appNeedsNetwork('ace'), false);

win.apps = [];
check('an app that is not installed at all is read from the catalog',
	api.appNeedsNetwork('monaco-cdn'), true);
check('and an app nothing knows about is not flagged', api.appNeedsNetwork('ghost'), false);

// --- recent files ---------------------------------------------------------------------
//
// Recorded in launch() rather than in each of openFile/openPath/openApp, so a route added
// later feeds the list without anyone remembering to wire it up.

await api.openFile('/docs/a.txt', 'ace');
check('opening a file records it', appsModel.listRecentFiles()[0], {path: '/docs/a.txt', dir: false});

await api.openPath('/home');
check('opening a folder records it as one', appsModel.listRecentFiles()[0], {path: '/home', dir: true});

await api.openApp('ace');
check('opening an app with no file records nothing new',
	appsModel.listRecentFiles()[0].path, '/home');

const beforeRestore = appsModel.listRecentFiles().length;
await api.launch({appId: 'ace', paths: ['/docs/b.txt']}, {title: '/docs/b.txt'});
check('a session restore does not count as opening', appsModel.listRecentFiles().length, beforeRestore);
check('and does not reorder the list', appsModel.listRecentFiles()[0].path, '/home');

const beforeReopen = opened.length;
await api.openRecentFile({path: '/home', dir: true});
check('opening a recent folder opens Explorer on it', opened[beforeReopen].launch,
	{appId: 'explorer', paths: ['/home'], url: null, title: null});

// The stored flag is a hint that saves a stat in the menu; the stat at open time is the
// truth, so an entry recorded wrong -- or a path that has changed kind -- still works.
const beforeWrong = opened.length;
await api.openRecentFile({path: '/home', dir: false});
check('a stored flag that disagrees with the filesystem loses',
	opened[beforeWrong].launch.appId, 'explorer');

await appsModel.noteFile('/docs/gone.txt', false);
check('a deleted file is in the list until it is tried',
	appsModel.listRecentFiles()[0].path, '/docs/gone.txt');
const beforeMissing = opened.length;
await api.openRecentFile({path: '/docs/gone.txt'});
check('opening it opens no window', opened.length, beforeMissing);
check('it is pruned rather than left to fail again',
	appsModel.listRecentFiles().some(f => f.path === '/docs/gone.txt'), false);
check('and the user is told, rather than nothing happening', notes.length, 1);
check('by the system, named as such', notes[0].source, 'PixOS');
check('as a warning that stays until dismissed', notes[0].level, 'warn');

check('a recent entry with no path does nothing at all',
	(await api.openRecentFile({}), opened.length), beforeMissing);

// --- a file with no default app ------------------------------------------------------
//
// This used to be silent, and it picked the worst option available: with no app to hand
// the file to, `launch()` falls back to using the path itself as the iframe src, so a csv
// became the browser's rendering of a csv and the perfectly good chooser was never
// offered. Now it is asked about -- except where "the path is the window" is the right
// answer rather than the worst one.

// The needsNetwork cases above left the installed list emptied; the chooser reads it, so
// it is put back to what the rest of this file assumes.
win.apps = [{id: 'ace'}, {id: 'treemap'}, {id: 'media-player'}, {id: 'photopea'}];

const beforeAsk = opened.length;
answer = null;
await api.openFile('/home/rows.csv');
check('a file with no default app is asked about', asked.length, 1);
check('and nothing is opened until it is answered', opened.length, beforeAsk);
check('the file is named in the question', asked[0].subtitle, '/home/rows.csv');
check('along with the extension the answer could be remembered for', asked[0].extension, 'csv');
check('the apps offered are the ones that can read it', asked[0].apps.map(a => a.id),
	['ace', 'notinstalled']);
check('installed ones marked as such', asked[0].apps.map(a => a.installed), [true, false]);
check('and named, not identified', asked[0].apps[0].label, 'Ace');

check('cancelling opens nothing at all', await api.openFile('/home/rows.csv'), null);
check('and really nothing', opened.length, beforeAsk);

// A folder reaching openFile is Explorer's, not a question. Bookmarks was the one that
// found this: a bookmarked folder is a path like any other, and the chooser was offering
// to open a directory in a text editor. Only the filesystem knows which it is, so the
// funnel asks it rather than expecting every caller to.
const beforeFolder = opened.length;
const askedBeforeFolder = asked.length;
await api.openFile('/home');
check('a folder handed to openFile opens Explorer', opened[beforeFolder].launch,
	{appId: 'explorer', paths: ['/home'], url: null, title: null});
check('and was never asked about', asked.length, askedBeforeFolder);

// A page is already a window, which is the one case where the old fallback was right --
// and it is how a local app's own index.html, App Manager included, is reached.
const beforeHtml = opened.length;
await api.openFile('/x/page.html');
check('an html file still opens straight into a window, without asking', opened.length, beforeHtml + 1);
check('and was never asked about', asked.length, 2);

// --- acting on the answer ---------------------------------------------------------------

answer = {choice: {kind: 'app', appId: 'ace', label: 'Ace', install: false}, setDefault: false};
const pickedApp = opened.length;
await api.openFile('/home/rows.csv');
check('picking an app opens the file in it', opened[pickedApp].launch,
	{appId: 'ace', paths: ['/home/rows.csv'], url: null, title: null});
check('and nothing was installed or remembered', [installs.length, defaults.length], [0, 0]);

answer = {choice: {kind: 'browser-tab'}, setDefault: false};
const pickedTab = opened.length;
check('the browser tab opens no PixOS window', await api.openFile('/home/rows.csv'), null);
check('really none', opened.length, pickedTab);
check('it hands the file to the browser, through the service worker like everything else',
	tabs[0], 'http://localhost:8000/__browserfs__/home/rows.csv');

answer = {choice: {kind: 'raw-window'}, setDefault: false};
const pickedRaw = opened.length;
await api.openFile('/home/rows.csv');
check('the old fallback is still reachable, now as a choice', srcOf(pickedRaw),
	'__browserfs__/home/rows.csv');

// --- installing, and remembering ---------------------------------------------------------

answer = {
	choice: {kind: 'app', appId: 'notinstalled', label: 'Ghost', install: true},
	setDefault: true
};
const pickedInstall = opened.length;
await api.openFile('/home/rows.csv');
check('an app that is not on disk is installed first', installs, ['notinstalled']);
// An association can only name an installed app, so the other order would throw and lose
// the preference the user just asked for.
check('and only then made the default', defaults, [['csv', 'notinstalled']]);
check('then the file opens in it', opened[pickedInstall].launch.appId, 'notinstalled');

const beforeRefused = opened.length;
const notesBeforeRefused = notes.length;
answer = {choice: {kind: 'app', appId: 'refuses', label: 'Refuses', install: true}, setDefault: false};
check('an install that fails opens nothing', await api.openFile('/home/rows.csv'), null);
check('and says so rather than leaving a dead click', notes.length, notesBeforeRefused + 1);
check('as an error', notes[notes.length - 1].level, 'error');
check('no window was left behind', opened.length, beforeRefused);

// Failing to remember a preference must not cost the open: that is what was asked for.
const beforeUnwritable = opened.length;
answer = {choice: {kind: 'app', appId: 'ace', label: 'Ace', install: false}, setDefault: true};
await api.openFile('/home/rows.unwritable');
check('a default that cannot be stored still opens the file', opened.length, beforeUnwritable + 1);
check('and only the preference is reported lost', notes[notes.length - 1].level, 'warn');

// An app named explicitly is not a question, and neither is a default that exists.
const beforeExplicit = opened.length;
const askedBeforeExplicit = asked.length;
await api.openFile('/home/rows.csv', 'ace');
check('naming the app skips the chooser entirely', asked.length, askedBeforeExplicit);
check('and opens straight away', opened.length, beforeExplicit + 1);

process.exit(report('launch') ? 1 : 0);
