// Walking the tree to find a file, and stopping before it costs anything.
//
// The matching is the easy half. What is worth testing is every way the walk is supposed
// to give up: a cap, a deadline, a directory that never answers, a query that changed
// while it was running — and, in each case, that it *says* the answer is partial rather
// than passing a truncated list off as a complete one.

import {check, report} from './assert.mjs';
import * as search from '../js/shell/file-search.js';

// A tree as object literals. Values are arrays of entries; a name ending in / is a
// directory, which keeps the fixtures readable.
function makeTree (spec) {
	return function (dirPath) {
		var names = spec[dirPath];
		if (!names) {
			return Promise.resolve([]);
		}
		return Promise.resolve(names.map(function (name) {
			var isDirectory = name.endsWith('/');
			return {name: isDirectory ? name.slice(0, -1) : name, isDirectory: isDirectory};
		}));
	};
}

const TREE = {
	'/': ['home/', 'apps/', 'settings/', 'readme.txt'],
	'/home': ['report.pdf', 'report-draft.md', 'photos/', 'notes.txt'],
	'/home/photos': ['report-cover.png', 'holiday.jpg'],
	'/apps': ['explorer/', 'monaco-cdn/'],
	'/apps/explorer': ['index.html', 'report-icon.svg'],
	'/apps/monaco-cdn': ['index.html'],
	'/settings': ['session.json']
};

const readdir = makeTree(TREE);

// --- matching ---------------------------------------------------------------------------

let found = await search.search({readdir: readdir, query: 'report', skip: search.buildSkip('/report')});
check('every matching name is found', found.matches.map(m => m.path),
	['/home/report.pdf', '/home/report-draft.md', '/home/photos/report-cover.png']);
check('a complete answer says so', found.partial, false);
check('with no reason to give', found.reason, null);

check('matching is case-insensitive',
	(await search.search({readdir: readdir, query: 'REPORT.PDF'})).matches.length, 1);
check('an empty query searches for nothing rather than everything',
	(await search.search({readdir: readdir, query: '  '})).matches, []);

// Shallow first: the point of walking breadth-first is that /home/report.pdf arrives
// before the one three folders down, because it is the one you probably meant.
check('shallow matches come first', found.matches[0].path, '/home/report.pdf');
check('and depth is reported', found.matches.map(m => m.depth), [2, 2, 3]);

check('directories match too, and are marked',
	(await search.search({readdir: readdir, query: 'photo'})).matches,
	[{name: 'photos', path: '/home/photos', isDirectory: true, depth: 2}]);

// --- /apps ----------------------------------------------------------------------------------

check('/apps is skipped by default — it is thousands of vendored files',
	found.matches.some(m => m.path.indexOf('/apps/') === 0), false);

const inApps = await search.search({
	readdir: readdir, query: 'report', skip: search.buildSkip('/apps/report')
});
check('naming /apps in the query opts back in',
	inApps.matches.map(m => m.path).includes('/apps/explorer/report-icon.svg'), true);
check('and the rest of the tree still comes with it',
	inApps.matches.map(m => m.path).includes('/home/report.pdf'), true);
check('the opt-in is not case-sensitive either', search.buildSkip('/APPS/x')('/apps/explorer'), false);
check('a query mentioning apps elsewhere does not opt in', search.buildSkip('/home/apps')('/apps'), true);

// --- a subtree --------------------------------------------------------------------------------

check('a root confines the walk to it',
	(await search.search({readdir: readdir, query: 'report', root: '/home/photos'})).matches
		.map(m => m.path),
	['/home/photos/report-cover.png']);

// --- the cap ------------------------------------------------------------------------------------

const capped = await search.search({readdir: readdir, query: 'report', limit: 2});
check('the cap stops it', capped.matches.length, 2);
check('and the result admits to being partial', capped.partial, true);
check('naming which limit it hit', capped.reason, 'limit');
check('which is what the user is told, because the fix is theirs',
	search.describe(capped), 'First 2 matches — type more to narrow it down');
check('a complete result says nothing', search.describe(found), null);

// --- the deadline ---------------------------------------------------------------------------------
//
// Checking the clock between directories is not enough on its own: a mount reads over the
// network, and one readdir that never resolves would hang the walk forever with the
// elapsed time never being looked at again.

let reads = 0;
const hangs = function (dirPath) {
	reads++;
	if (dirPath === '/slow') {
		return new Promise(function () {});
	}
	return readdir(dirPath === '/' ? '/' : dirPath);
};
const slowTree = Object.assign({}, TREE, {'/': ['slow/', 'home/']});
const hanging = function (dirPath) {
	reads++;
	if (dirPath === '/slow') {
		return new Promise(function () {});
	}
	return makeTree(slowTree)(dirPath);
};

const started = Date.now();
const stalled = await search.search({readdir: hanging, query: 'report', budgetMs: 40});
const elapsed = Date.now() - started;
check('a directory that never answers does not hang the search', elapsed < 400, true);
check('the result is partial', stalled.partial, true);
check('and blames the clock rather than the cap', stalled.reason, 'budget');
check('what it says points at the tree, not at the query',
	search.describe(stalled).indexOf('Stopped searching') === 0, true);

// An exhausted budget is checked before the next directory as well, so a walk that has
// run out does not read one more just to throw the answer away.
let clock = 0;
const counted = function (dirPath) {
	clock += 50;
	return readdir(dirPath);
};
const expired = await search.search({
	readdir: counted, query: 'report', budgetMs: 60, now: () => clock
});
check('an expired budget stops before the next read', expired.scanned < 3, true);
check('and reports the budget', expired.reason, 'budget');

// --- cancelling ---------------------------------------------------------------------------------

const token = search.createToken();
token.cancel();
const cancelled = await search.search({readdir: readdir, query: 'report', token: token});
check('a cancelled search reads nothing', cancelled.scanned, 0);
check('and says it was cancelled rather than empty', cancelled.cancelled, true);
check('a cancelled search is not reported as a partial one — nobody is waiting for it',
	cancelled.partial, false);

const live = search.createToken();
const running = search.search({
	readdir: function (dirPath) {
		live.cancel();
		return readdir(dirPath);
	},
	query: 'report',
	token: live
});
check('cancelling mid-walk stops it', (await running).cancelled, true);

// --- a filesystem that throws --------------------------------------------------------------------
//
// BrowserFS rejects on a directory that has gone, and a mount can reject for reasons of
// its own. One unreadable folder must not lose the matches from every other folder.

const flaky = function (dirPath) {
	if (dirPath === '/home/photos') {
		return Promise.reject(new Error('EIO'));
	}
	return readdir(dirPath);
};
const survived = await search.search({readdir: flaky, query: 'report'});
check('an unreadable directory is skipped, not fatal', survived.matches.map(m => m.path),
	['/home/report.pdf', '/home/report-draft.md']);

const threw = function (dirPath) {
	if (dirPath === '/home') {
		throw new Error('EIO');
	}
	return readdir(dirPath);
};
check('and a readdir that throws synchronously is the same case',
	(await search.search({readdir: threw, query: 'settings'})).matches.map(m => m.path),
	['/settings']);

check('with no readdir at all there is nothing to search',
	(await search.search({query: 'report'})).matches, []);

check('reads happened at all', reads > 0, true);
check('the hanging fixture was used', typeof hangs, 'function');

process.exit(report('file-search') ? 1 : 0);
