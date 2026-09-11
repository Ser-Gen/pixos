// Which app opens this file — the arithmetic Explorer does on top of what the shell knows.
//
// Phase 21 moved this out of `openExplorer` into apps/explorer/js/open-with.js. It reads
// neither `state` nor `ui`; every fact comes from the shell, and every shell call is behind
// a `typeof` check because Explorer opened in a bare tab has no shell to ask. That made it
// the second module in the split that could be tested rather than only read — and the
// no-shell path, which nobody has ever watched in a browser, is half of what is here.

import path from 'path';
import {check, report} from './assert.mjs';
import {createOpenWith} from '../apps/explorer/js/open-with.js';

// --- a shell that answers whatever a case needs ------------------------------------------

function shellWith (config) {
	var installed = config.installed || [];
	var catalog = config.catalog || [];
	var compatible = config.compatible || {};
	return {
		apps: installed.map(id => ({id: id})),
		getInstallableApps: () => catalog.map(entry =>
			typeof entry === 'string' ? {id: entry, label: entry} : entry),
		getExtensionCompatibilityProfile: extension => ({
			extension: extension, mimeType: null, isText: false
		}),
		isAppCompatibleWithProfile: (appId, profile) =>
			(compatible[profile.extension] || []).indexOf(appId) !== -1,
		getAllDefaultAppAssociations: () => config.defaults || {},
		getDefaultAppForExtension: extension => (config.defaults || {})[extension] || null,
		getExtensionCandidates: filePath => {
			var base = String(filePath).split('/').pop().toLowerCase();
			var parts = base.split('.');
			return parts.length > 2 ? [parts.slice(-2).join('.'), parts.slice(-1)[0]] : [parts.pop()];
		}
	};
}

function build (config) {
	return createOpenWith({shell: shellWith(config), path: path.posix});
}

const file = (p) => ({path: p, isDirectory: false});
const folder = (p) => ({path: p, isDirectory: true});

// --- extensions ---------------------------------------------------------------------------

const plain = build({});
check('a leading dot is not part of an extension', plain.normalizeExtensionInput('.TXT'), 'txt');
check('and neither is surrounding space', plain.normalizeExtensionInput('  MD  '), 'md');
check('nothing normalizes to the empty string', plain.normalizeExtensionInput(null), '');
check('a path gives up its extension', plain.getNormalizedExtension('/home/a/Notes.MD'), 'md');
check('a file with no extension gives up nothing',
	plain.getNormalizedExtension('/home/README'), '');

// 'book.fb2.zip' is an fb2 book, not an archive, and the association has to see that —
// while the mount code deliberately keeps reading the trailing extension instead.
check('the most specific extension wins for an association',
	plain.getSpecificExtension('/home/book.fb2.zip'), 'fb2.zip');
check('a single extension is its own most specific one',
	plain.getSpecificExtension('/home/notes.txt'), 'txt');

// --- no shell at all ------------------------------------------------------------------------

const alone = createOpenWith({shell: {}, path: path.posix});
check('with no shell the extension still resolves, by falling back to path.extname',
	alone.getSpecificExtension('/home/book.fb2.zip'), 'zip');
check('and a profile is still shaped like a profile',
	alone.getCompatibilityProfileForExtension('.TXT'),
	{extension: 'txt', mimeType: null, isText: false});
check('but nothing is compatible, because there is nobody to ask',
	await alone.isAppCompatibleWithProfile('editor', {extension: 'txt'}), false);
check('so a file offers no apps rather than all of them',
	await alone.getOpenWithApps(file('/home/notes.txt')), []);
check('an unknown app has no catalog label', alone.getCatalogLabel('editor'), '');
check('and there is no default to report',
	alone.getDefaultAppIdForExtension('txt'), null);

// A folder is the one case that still answers something without a shell: the three entries
// below are not apps in any registry, they are things Explorer itself can do.
check('a folder still offers the three built-ins',
	(await alone.getOpenWithApps(folder('/home'))).map(app => app.id),
	['explorer', 'new explorer', 'terminal']);

// --- folders --------------------------------------------------------------------------------

const withTreemap = build({installed: ['treemap'], catalog: [{id: 'treemap', label: 'Disk Treemap'}]});
check('an installed treemap joins the folder menu',
	(await withTreemap.getOpenWithApps(folder('/home'))).map(app => app.id),
	['explorer', 'new explorer', 'terminal', 'treemap']);
check('and is marked installed',
	(await withTreemap.getOpenWithApps(folder('/home'))).pop().installed, true);

const treemapOffered = build({catalog: [{id: 'treemap', label: 'Disk Treemap'}]});
const offered = (await treemapOffered.getOpenWithApps(folder('/home'))).pop();
check('a treemap that is only in the catalog is offered too', offered.id, 'treemap');
check('and says it is not installed yet, which is what makes the row an install',
	offered.installed, false);

const noTreemap = build({installed: ['editor'], catalog: ['editor']});
check('a treemap that is neither installed nor in the catalog is not offered',
	(await noTreemap.getOpenWithApps(folder('/home'))).map(app => app.id),
	['explorer', 'new explorer', 'terminal']);

// --- files ------------------------------------------------------------------------------------

const desk = build({
	installed: ['editor', 'paint'],
	catalog: [{id: 'editor', label: 'Text Editor'}, {id: 'viewer', label: 'Viewer'},
		{id: 'paint', label: 'Paint'}],
	compatible: {txt: ['editor', 'viewer'], png: ['paint', 'viewer']}
});

const forText = await desk.getOpenWithApps(file('/home/notes.txt'));
check('an installed compatible app is offered', forText.map(app => app.id), ['editor', 'viewer']);
check('installed first, then what could be installed',
	forText.map(app => app.installed), [true, false]);
check('labelled from the catalog rather than by id',
	forText.map(app => app.label), ['Text Editor', 'Viewer']);
check('an installed app that cannot open it is not offered',
	forText.some(app => app.id === 'paint'), false);

// --- several files at once -----------------------------------------------------------------------

check('nothing selected offers nothing', await desk.getOpenWithAppsForItems([]), []);
check('one file selected is just that file',
	(await desk.getOpenWithAppsForItems([file('/home/notes.txt')])).map(app => app.id),
	['editor', 'viewer']);

// The intersection, which is the whole reason this function exists: an app offered for a
// multi-selection has to be able to open *every* item, not merely one of them.
check('two kinds of file offer only what can open both',
	(await desk.getOpenWithAppsForItems([file('/a.txt'), file('/b.png')])).map(app => app.id),
	['viewer']);
check('and nothing in common offers nothing at all',
	await desk.getOpenWithAppsForItems([file('/a.txt'), file('/b.unknown')]), []);
check('two files of the same kind keep the whole list',
	(await desk.getOpenWithAppsForItems([file('/a.txt'), file('/b.txt')])).map(app => app.id),
	['editor', 'viewer']);

// A folder cannot be opened by the same app as a file, and 'explorer' being in the folder
// list must not survive the intersection as though it could.
check('a folder mixed into the selection stops the offer',
	await desk.getOpenWithAppsForItems([file('/a.txt'), folder('/home')]), []);

// --- the defaults table ------------------------------------------------------------------------

const defaults = build({
	installed: ['editor', 'paint'],
	catalog: [{id: 'editor', label: 'Text Editor'}, {id: 'paint', label: 'Paint'},
		{id: 'gone', label: 'Departed'}],
	compatible: {txt: ['editor'], png: ['paint'], md: ['editor']},
	defaults: {png: 'paint', md: 'gone', txt: 'editor'}
});

const rows = await defaults.getDefaultAppRows();
check('every association gets a row, in alphabetical order',
	rows.map(row => row.extension), ['md', 'png', 'txt']);
check('each row names the app that is the default',
	rows.map(row => row.appId), ['gone', 'paint', 'editor']);
check('a row offers the installed apps that can open that extension',
	rows[1].apps, [{id: 'paint', label: 'Paint'}]);

// The row that matters: an association pointing at an app that has since been uninstalled.
// Dropping it would silently rewrite the user's choice; showing it plain would look like it
// still works.
const departed = rows[0];
check('a default that is no longer installed is still shown', departed.apps[0].id, 'gone');
check('and said so, in the label', departed.apps[0].label, 'Departed (not installed)');
check('and flagged, so the row can be drawn as broken', departed.apps[0].invalid, true);
check('ahead of the apps that do work', departed.apps.map(app => app.id), ['gone', 'editor']);

check('the picker lists every installed app, compatible or not',
	defaults.getInstalledAppsForPicker(),
	[{id: 'editor', label: 'Text Editor'}, {id: 'paint', label: 'Paint'}]);
check('an installed app missing from the catalog falls back to its id',
	build({installed: ['mystery'], catalog: []}).getInstalledAppsForPicker(),
	[{id: 'mystery', label: 'mystery'}]);

process.exit(report('explorer-open-with') ? 1 : 0);
