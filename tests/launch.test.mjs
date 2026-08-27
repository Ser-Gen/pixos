// The launch funnel, lifted straight out of index.html.
//
// Every window in the system goes through launch(), including the per-app quirks that
// used to be branches inside openFile(). The region is extracted by marker rather than
// duplicated here, so the tests fail loudly if the shell is reorganised.

import fs from 'fs';
import {check, report} from './assert.mjs';

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
		return {set onload (fn) {}};
	}
};
const desktop = {isPeeking: () => false, togglePeek () {}, openWallpaperPicker () {}};

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
	getInstallableApps: () => [
		{id: 'ace', name: 'Ace', entryPath: '/apps/ace/index.html'},
		{id: 'treemap', name: 'Disk Treemap', entryPath: '/apps/treemap/index.html'},
		{id: 'media-player', name: 'Video Player', entryPath: '/apps/media-player/index.html'},
		{id: 'photopea', name: 'Photopea', entryPath: '/apps/photopea/index.html'},
		{id: 'notinstalled', name: 'Ghost', entryPath: '/apps/ghost/index.html'}
	],
	getCatalogApp: () => null
};

globalThis.location = {href: 'http://localhost:8000/'};
globalThis.fetch = async () => ({blob: async () => 'BLOB', arrayBuffer: async () => 'AB'});
globalThis.URL = class {
	static createObjectURL () { return 'blob:tic'; }
	constructor (path) { this.href = 'http://localhost:8000' + path; }
};

const api = new Function('window', 'winManager', 'desktop',
	region + '\n; return {launch, openApp, openFile, openFiles, openPath, buildDesktopMenu, listLaunchableApps};'
)(win, winManager, desktop);

const srcOf = index => opened[index].content.match(/src="([^"]*)"/)[1];

await api.openApp('ace');
check('an app with no file opens on its entry path', srcOf(0), '__browserfs__/apps/ace/index.html');
check('such a window is titled with the app name', opened[0].title, 'Ace');
check('and records no path', opened[0].path, null);

await api.openFile('/docs/a.txt', 'ace');
check('a file window is titled with the path', opened[1].title, '/docs/a.txt');
check('and carries the descriptor a restore would replay', opened[1].launch, {appId: 'ace', paths: ['/docs/a.txt'], title: null});

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
check('the desktop menu leads with Applications', menu[0].label, 'Applications');
check('which lists every launchable app', menu[0].submenu.length, 6);
check('and it ends with wallpaper and peek', menu.slice(-2).map(item => item.label), ['Wallpaper...', 'Show desktop']);

globalThis.fetch = async () => { throw new Error('gone'); };
const before = opened.length;
await api.openFile('/broken.png', 'photopea');
check('a file that cannot be read still opens its app', opened.length, before + 1);

let message = null;
try {
	await api.launch({appId: 'nosuchapp'});
}
catch (err) {
	message = err.message;
}
check('launching an unknown app fails loudly', message, 'App nosuchapp has no launch path');

process.exit(report('launch') ? 1 : 0);
