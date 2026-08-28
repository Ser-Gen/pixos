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
	getCatalogApp: () => null
};

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

const api = new Function('window', 'winManager', 'desktop', 'appsModel', 'palette',
	region + '\n; return {launch, openApp, openFile, openFiles, openPath, openUrl, buildDesktopMenu, listLaunchableApps};'
)(win, winManager, desktop, appsModel, palette);

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
check('search is one level up, not buried in the submenu', menu[1].label, 'Search...');
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

process.exit(report('launch') ? 1 : 0);
