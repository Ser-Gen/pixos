// The model behind all three launchers. Matching quality is the whole point of the
// palette, so most of this is about what ranks above what.

import {check, report} from './assert.mjs';
import * as model from '../js/shell/apps-model.js';

const APPS = [
	{id: 'ace', name: 'Ace'},
	{id: 'app-manager', name: 'App Manager'},
	{id: 'explorer', name: 'Explorer'},
	{id: 'luckySheet', name: 'Lucky Sheet'},
	{id: 'media-player', name: 'Video Player'},
	{id: 'treemap', name: 'Disk Treemap'},
	{id: 'yaReader', name: 'Yandex Book Reader'}
];

let written = null;
model.init({
	listApps: () => APPS,
	readRecents: async () => ['treemap', 'ace'],
	writeRecents: async ids => { written = ids; }
});
await model.load();

// --- scoring tiers ---
check('an exact name wins outright', model.score('Ace', 'ace'), 1000);
check('a prefix beats a word start', model.score('Explorer', 'exp') > model.score('Disk Treemap', 'tree'), true);
check('a word start beats a bare substring', model.score('App Manager', 'man') > model.score('Disk Treemap', 'ee'), true);
check('initials find a two-word name', model.score('Disk Treemap', 'dt') > 700, true);
check('a scattered subsequence still matches', model.score('Yandex Book Reader', 'ybr') !== null, true);
check('a tight subsequence beats a spread one',
	model.score('abcxyz', 'abc') > model.score('axxxxbxxxxc', 'abc'), true);
check('letters out of order do not match', model.score('Ace', 'eca'), null);
check('an empty query is neutral, not a rejection', model.score('Ace', ''), 0);
check('matching is case-insensitive', model.score('Ace', 'ACE'), 1000);

// --- search ---
check('search finds by name', model.search('manager').map(a => a.id), ['app-manager']);
check('search finds by id when the name differs', model.search('media').map(a => a.id), ['media-player']);
check('a name match outranks an id match',
	model.search('player')[0].id, 'media-player');
check('no match returns nothing, not everything', model.search('zzzzz'), []);
check('an empty query returns the ordered list', model.search('').length, APPS.length);
check('search respects the limit', model.search('e', 2).length, 2);

// --- recents ---
check('stored recents come back in order', model.listRecent().map(a => a.id), ['treemap', 'ace']);
check('an empty query leads with recents', model.search('').slice(0, 2).map(a => a.id), ['treemap', 'ace']);
check('ordered() splits recent from the rest', model.ordered().recent.map(a => a.id), ['treemap', 'ace']);
check('and the rest excludes them', model.ordered().rest.some(a => a.id === 'treemap'), false);
check('together they are the whole list',
	model.ordered().recent.length + model.ordered().rest.length, APPS.length);

await model.noteLaunch('explorer');
check('a launch goes to the front', model.getRecentIds().slice(0, 3), ['explorer', 'treemap', 'ace']);
check('and is persisted', written[0], 'explorer');

await model.noteLaunch('treemap');
check('relaunching moves rather than duplicates', model.getRecentIds().slice(0, 3), ['treemap', 'explorer', 'ace']);
check('no duplicates survive', model.getRecentIds().filter(id => id === 'treemap').length, 1);

// --- recent files ---
//
// Same list, different shape: a file entry has to remember whether it was a folder, or
// clicking it would need a stat before it could decide which call to make.

let files = null;
model.init({
	listApps: () => APPS,
	readRecents: async () => [],
	writeRecents: async () => {},
	readRecentFiles: async () => [
		{path: '/home/report.md', dir: false},
		'/home/notes.txt',
		{path: '/home/photos', dir: true}
	],
	writeRecentFiles: async entries => { files = entries; }
});
await model.load();

check('stored file entries come back in order',
	model.listRecentFiles().map(f => f.path), ['/home/report.md', '/home/notes.txt', '/home/photos']);
check('a bare path is accepted and read as a file',
	model.listRecentFiles()[1], {path: '/home/notes.txt', dir: false});
check('a folder stays a folder', model.listRecentFiles()[2].dir, true);

await model.noteFile('/home/photos', true);
check('opening one moves it to the front rather than duplicating it',
	model.listRecentFiles().map(f => f.path), ['/home/photos', '/home/report.md', '/home/notes.txt']);
check('and is persisted', files[0], {path: '/home/photos', dir: true});

await model.noteFile('/settings/session.json');
check('a new file leads the list', model.listRecentFiles()[0].path, '/settings/session.json');
check('the limit is respected', model.listRecentFiles(2).length, 2);

check('a relative path is not a path this system has',
	(await model.noteFile('home/report.md'), model.listRecentFiles()[0].path), '/settings/session.json');
check('and neither is nothing at all',
	(await model.noteFile(null), model.listRecentFiles()[0].path), '/settings/session.json');

check('forgetting a deleted file drops it', await model.forgetFile('/home/report.md'), true);
check('and it is gone', model.listRecentFiles().some(f => f.path === '/home/report.md'), false);
check('and the file was rewritten without it',
	files.some(f => f.path === '/home/report.md'), false);
check('forgetting one that was never there writes nothing',
	await model.forgetFile('/home/nope.txt'), false);

model.init({listApps: () => APPS, readRecents: async () => [], writeRecents: async () => {},
	readRecentFiles: async () => ({not: 'an array'}), writeRecentFiles: async () => {}});
await model.load();
check('a settings file of the wrong shape is ignored, not fatal', model.listRecentFiles(), []);

// An app can be uninstalled while its id is still in the recents file.
model.init({listApps: () => APPS.filter(a => a.id !== 'treemap'), readRecents: async () => ['treemap', 'ace'], writeRecents: async () => {}});
await model.load();
check('a recent id for a missing app is skipped, not launched into nothing',
	model.listRecent().map(a => a.id), ['ace']);

process.exit(report('apps-model') ? 1 : 0);
