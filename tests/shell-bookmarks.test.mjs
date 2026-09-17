// Adding a bookmark from outside the Bookmarks app.
//
// This is the shell's copy of rules that also live in `apps/bookmarks/js/links.js` -- a
// second copy because an app is installed into BrowserFS and the shell cannot import a
// module from one. The URL rule in particular has to stay identical in both, and
// `tests/links.test.mjs` covers the other copy, so a change to one that is not made to the
// other shows up as a disagreement between these two files.
//
// The rule that matters most here is not about bookmarks at all: `addBookmark` is callable
// from inside any app iframe, so what it will store is a security question.

import fs from 'node:fs';
import {check, report} from './assert.mjs';
import * as bookmarks from '../js/shell/bookmarks.js';
import * as links from '../apps/bookmarks/js/links.js';

// --- what an address may be ---------------------------------------------------------------

check('a path inside PixOS is a bookmark', bookmarks.normalizeUrl('/home/about.md'), '/home/about.md');
check('so is a web address', bookmarks.normalizeUrl('https://example.com/a'), 'https://example.com/a');
check('a bare hostname is upgraded rather than refused',
	bookmarks.normalizeUrl('example.com'), 'https://example.com');
check('a script url is refused outright -- any app iframe can call addBookmark, and the '
	+ 'Bookmarks app will later put this in an href',
	bookmarks.normalizeUrl('javascript:alert(1)'), null);
check('and so is every other scheme', [
	bookmarks.normalizeUrl('data:text/html,hi'),
	bookmarks.normalizeUrl('file:///etc/passwd'),
	bookmarks.normalizeUrl('vbscript:x')
], [null, null, null]);
check('nothing is not an address', bookmarks.normalizeUrl('   '), null);

// The two copies have to agree, or a link the shell writes is one Bookmarks then drops.
const SAME = ['/home/a.md', 'https://x.test/p', 'example.com', 'javascript:1', 'data:x', '', 'no spaces here'];
check('the shell and the app answer identically for every shape',
	SAME.map(bookmarks.normalizeUrl), SAME.map(links.normalizeUrl));

// --- adding ---------------------------------------------------------------------------------

let added = bookmarks.addTo(null, {url: '/home/notes.txt'});
check('with no document at all, one is created', added.ok, true);
check('with the version the app reads', added.doc.version, 1);
check('and the bookmark in a group of its own', added.doc.groups.map(g => g.name), ['Bookmarks']);
check('titled by filename when nothing else is given', added.link.title, 'notes.txt');
check('a site with no title is titled by host',
	bookmarks.addTo(null, {url: 'https://www.example.com/deep/page'}).link.title, 'example.com');
check('a given title wins', bookmarks.addTo(null, {url: '/a/b.txt', title: 'Notes'}).link.title, 'Notes');
check('a link carries every field the app expects', Object.keys(added.link).sort(),
	['frame', 'id', 'note', 'title', 'url']);
check('"open inside PixOS" is meaningless for a path and is not stored',
	bookmarks.addTo(null, {url: '/a/b.txt', frame: true}).link.frame, false);
check('but it is kept for a site', bookmarks.addTo(null, {url: 'https://x.test', frame: true}).link.frame, true);

// A trailing slash is the document's own way of saying "this is a folder" -- the app
// reads it to choose between openPath and openFile. Stored without one, a bookmarked
// folder comes back as a file and raises the *Open with...* chooser instead of Explorer.
check('a folder is stored with a trailing slash',
	bookmarks.addTo(null, {url: '/home/docs', directory: true}).link.url, '/home/docs/');
check('one that already has it is not given a second',
	bookmarks.addTo(null, {url: '/home/docs/', directory: true}).link.url, '/home/docs/');
check('a file is left exactly as it is',
	bookmarks.addTo(null, {url: '/home/notes.txt', directory: false}).link.url, '/home/notes.txt');
check('and so is one that never said', bookmarks.addTo(null, {url: '/home/notes.txt'}).link.url,
	'/home/notes.txt');
check('a site is a site, whatever the flag says',
	bookmarks.addTo(null, {url: 'https://x.test/a', directory: true}).link.url, 'https://x.test/a');
check('and it is still titled by folder name, not left blank',
	bookmarks.addTo(null, {url: '/home/docs', directory: true}).link.title, 'docs');

const existing = {
	version: 1,
	favicons: true,
	groups: [
		{id: 'g1', name: 'PixOS', links: [{id: 'l1', title: 'About', url: '/home/about.md', note: '', frame: false}]},
		{id: 'g2', name: 'Bookmarks', links: []}
	]
};
const intoExisting = bookmarks.addTo(existing, {url: '/home/report.md'});
check('an existing group of the right name is used, not a second one made',
	intoExisting.doc.groups.length, 2);
check('and the bookmark lands in it', intoExisting.doc.groups[1].links.map(l => l.url), ['/home/report.md']);
check('a setting the shell knows nothing about survives the write', intoExisting.doc.favicons, true);
check('as do the groups it did not touch', intoExisting.doc.groups[0].links.length, 1);

// A document read off disk and then not written -- the write failed, or an earlier step
// refused -- must be exactly as it was, or the bookmark exists in memory and nowhere else.
check('the document handed in is not modified',
	existing.groups[1].links.length, 0);

check('a named group is honoured',
	bookmarks.addTo(null, {url: '/a.txt', group: 'Work'}).doc.groups[0].name, 'Work');
check('and matched case-insensitively rather than duplicated',
	bookmarks.addTo(existing, {url: '/a.txt', group: 'bookmarks'}).doc.groups.length, 2);

// --- the same file twice ----------------------------------------------------------------

const again = bookmarks.addTo(existing, {url: '/home/about.md'});
check('bookmarking something already bookmarked is not a failure', again.ok, true);
check('but it is reported as what it is', again.reason, 'duplicate');
check('with the group it is already in, so the note can say where', again.group.name, 'PixOS');
check('and nothing is added', again.duplicate.id, 'l1');

check('an address that cannot be a bookmark says so instead of writing one',
	bookmarks.addTo(null, {url: 'javascript:alert(1)'}), {
		ok: false, reason: 'url', doc: null, link: null, group: null, duplicate: null
	});

// --- documents that are not quite documents -------------------------------------------------

const messy = bookmarks.addTo({groups: [null, 'nope', {name: 'Real'}]}, {url: '/a.txt', group: 'Real'});
check('a group that is not an object is dropped rather than crashing the write',
	messy.doc.groups.length, 1);
check('and a group with no links array gets one', messy.doc.groups[0].links.length, 1);
check('a document with no groups key at all still works',
	bookmarks.addTo({version: 1}, {url: '/a.txt'}).doc.groups.length, 1);

check('ids are unique across a run', (() => {
	const one = bookmarks.addTo(null, {url: '/a.txt'}).link.id;
	const two = bookmarks.addTo(null, {url: '/b.txt'}).link.id;
	return one === two;
})(), false);

check('what is written is what the app reads back',
	links.normalize(JSON.parse(bookmarks.serialize(intoExisting.doc)))
		.groups.map(g => g.links.map(l => l.url)),
	[['/home/about.md'], ['/home/report.md']]);

// --- the file exists before anyone adds to it ------------------------------------------------
//
// The Bookmarks app shows a built-in starter document when there is no file and writes it
// out on the first edit. `addBookmark` writing the file *first* meant the starter was never
// written at all: you added one bookmark from the desktop and that one bookmark was your
// entire collection, with the six the app had been showing you gone. Preinstall now seeds
// the same document, so both halves start from the same place.
//
// Two copies again, for the same reason the URL rule is two copies — an app is installed
// *into* BrowserFS and preinstall reads over HTTP — so they are checked against each other
// rather than trusted.

const template = JSON.parse(fs.readFileSync(new URL('../templates/links.json', import.meta.url), 'utf8'));
check('the seeded document is the one the app would have shown', template, links.DEFAULT_DOC);
check('and it is a document the app will actually parse',
	links.normalize(template).groups.map(g => g.name), ['PixOS', 'Daily']);
check('with every link surviving normalisation',
	links.normalize(template).groups.map(g => g.links.length), [3, 3]);

const preinstall = JSON.parse(fs.readFileSync(new URL('../settings/preinstall.json', import.meta.url), 'utf8'));
check('preinstall seeds it where the app looks for it',
	preinstall.seed.filter(entry => entry.path === '/settings/links.json')
		.map(entry => entry.from),
	['/templates/links.json']);
// Seeds are copied once and never reasserted, which is what stops this overwriting a
// collection somebody has actually built.
check('and it is a seed rather than a file re-copied on every boot',
	preinstall.files.some(entry => entry.path === '/settings/links.json'), false);

// A bookmark added to the seeded document must land beside the starter links, not replace
// them — which is the whole point of seeding it.
const seeded = bookmarks.addTo(links.normalize(template),
	{title: 'Added later', url: 'https://example.com/'});
check('adding one keeps everything already there',
	seeded.doc.groups.map(g => g.links.length), [3, 3, 1]);

// --- a named group is asked about on its own ----------------------------------------------------
//
// Explorer pins a folder into `Places`. A folder already under *Bookmarks* is not already pinned,
// and a whole-document search would refuse the pin with a note saying it was bookmarked.

const elsewhere = bookmarks.addTo(existing, {url: '/home/about.md', group: 'Places'});
check('a link bookmarked in one group can still be put in a named other',
	[elsewhere.reason, elsewhere.group.name], ['added', 'Places']);
check('but not twice into the same one, matched in any case',
	bookmarks.addTo(existing, {url: '/home/about.md', group: 'pixos'}).reason, 'duplicate');

// --- removing, moving and renaming: the same answers as the app ------------------------------
//
// Three more rules that now live in two places. Each is run against links.js on the same
// document, so a change to one that is not made to the other is a disagreement here.

const sample = () => ({version: 1, favicons: false, groups: [
	{id: 'g1', name: 'Places', links: [
		{id: 'a', title: 'A', url: '/a/'},
		{id: 'b', title: 'B', url: '/b/'},
		{id: 'c', title: 'C', url: 'https://c.test'},
		{id: 'd', title: 'D', url: '/d/'}
	]},
	{id: 'g2', name: 'Other', links: [{id: 'e', title: 'E', url: '/e/'}]}
]});
const order = doc => doc.groups.map(g => g.links.map(l => l.id));

{
	const before = sample();
	const removed = bookmarks.removeFrom(before, 'b');
	const theirs = links.normalize(sample());
	links.removeLink(theirs, 'b');
	check('removing a link leaves what the app leaves', order(removed.doc), order(theirs));
	check('and says what went, from where', [removed.reason, removed.link.id, removed.group.name],
		['removed', 'b', 'Places']);
	check('the document handed in is not modified', order(before), order(sample()));
	check('a link that is not there is missing, and nothing to write',
		[bookmarks.removeFrom(sample(), 'zz').reason, CHANGED_HAS('missing')], ['missing', false]);
}

function CHANGED_HAS (reason) {
	return bookmarks.CHANGED.indexOf(reason) !== -1;
}

{
	const disagreements = [];
	['a', 'b', 'c', 'd'].forEach(id => {
		for (let to = 0; to <= 4; to++) {
			const ours = bookmarks.moveWithin(sample(), id, to);
			const theirs = links.normalize(sample());
			links.moveLink(theirs, id, 'g1', to);
			if (JSON.stringify(order(ours.doc)) !== JSON.stringify(order(theirs))) {
				disagreements.push([id, to, order(ours.doc)[0], order(theirs)[0]]);
			}
		}
	});
	check('a move inside the group lands where the app lands it, from every place to every place',
		disagreements, []);
	check('down one place is its index plus two -- the position before it is lifted out',
		order(bookmarks.moveWithin(sample(), 'a', 2).doc)[0], ['b', 'a', 'c', 'd']);
	check('up one place is the index of the one above',
		order(bookmarks.moveWithin(sample(), 'd', 2).doc)[0], ['a', 'b', 'd', 'c']);
	check('with no index it is refused rather than guessed',
		bookmarks.moveWithin(sample(), 'a').reason, 'index');
	check('a move never leaves the link\'s own group',
		order(bookmarks.moveWithin(sample(), 'e', 0).doc), [['a', 'b', 'c', 'd'], ['e']]);
	const before = sample();
	bookmarks.moveWithin(before, 'a', 3);
	check('and leaves the document it was handed alone', order(before), order(sample()));
}

{
	const renamed = bookmarks.renameIn(sample(), 'b', '  Bee  ');
	const theirs = links.normalize(sample());
	links.updateLink(theirs, 'b', {title: '  Bee  '});
	check('renaming gives the title the app gives', renamed.link.title, theirs.groups[0].links[1].title);

	const blank = bookmarks.renameIn(sample(), 'c', '   ');
	const theirBlank = links.normalize(sample());
	links.updateLink(theirBlank, 'c', {title: '   '});
	check('and so does renaming to nothing', blank.link.title, theirBlank.groups[0].links[2].title);
	check('which is the name the link would have had with none', blank.link.title, 'c.test');
	check('only the title changes', [blank.link.url, blank.link.id], ['https://c.test', 'c']);
}

// --- a group created with what it starts with, or left alone ------------------------------------

{
	const made = bookmarks.ensureGroup(sample(), 'Starred', [
		{url: '/', title: 'Root', directory: true},
		{url: '/apps', title: 'Apps', directory: true},
		{url: 'javascript:alert(1)', title: 'No'}
	]);
	check('a group that is not there is created, after the others',
		[made.reason, made.doc.groups.map(g => g.name)], ['created', ['Places', 'Other', 'Starred']]);
	check('holding its links to the rules adding one is held to -- a folder gains its slash, a '
		+ 'script address is dropped', made.group.links.map(l => [l.title, l.url]), [['Root', '/'], ['Apps', '/apps/']]);
	check('each with an id, so it can be edited afterwards',
		made.group.links.every(l => typeof l.id === 'string' && l.id.length > 0), true);
	check('what is written is a document the app reads back',
		links.normalize(JSON.parse(bookmarks.serialize(made.doc))).groups[2].links.map(l => l.url), ['/', '/apps/']);

	const there = bookmarks.ensureGroup(sample(), ' places ', [{url: '/x/'}]);
	check('one that is there is left exactly as it is, whatever it was asked to start with',
		[there.reason, there.doc.groups[0].links.length, CHANGED_HAS('exists')], ['exists', 4, false]);
	check('a group needs a name', bookmarks.ensureGroup(sample(), '  ', []).ok, false);
}

{
	check('a group is listed by name, in any case', bookmarks.listGroup(sample(), 'PLACES'), {
		group: {id: 'g1', name: 'Places'},
		links: [
			{id: 'a', title: 'A', url: '/a/'}, {id: 'b', title: 'B', url: '/b/'},
			{id: 'c', title: 'C', url: 'https://c.test'}, {id: 'd', title: 'D', url: '/d/'}
		]
	});
	check('no such group is a null group -- a different answer from an empty one',
		bookmarks.listGroup(sample(), 'Nope'), {group: null, links: []});
	check('and an empty group is a group', bookmarks.listGroup({groups: [{name: 'Places'}]}, 'Places'),
		{group: {id: null, name: 'Places'}, links: []});
	check('no document lists nothing', bookmarks.listGroup(null, 'Places'), {group: null, links: []});
	check('a link with no address is left out, and one with no title is given the one it would get',
		bookmarks.listGroup({groups: [{name: 'P', links: [{url: '/home/docs/'}, null, {title: 'x'}]}]}, 'p').links,
		[{id: null, title: 'docs', url: '/home/docs/'}]);
}

// --- the read-apply-write -------------------------------------------------------------------------

function store (options) {
	options = options || {};
	const s = {disk: options.disk === undefined ? sample() : options.disk, writes: [], notes: [], opened: 0};
	s.api = bookmarks.createBookmarks({
		read: async () => {
			if (options.unreadable) {
				throw new SyntaxError('Unexpected token } in JSON');
			}
			// A turn of the event loop, so that two edits that were not queued would both
			// have read before either wrote.
			await Promise.resolve();
			return s.disk === null ? null : JSON.parse(JSON.stringify(s.disk));
		},
		write: async text => {
			if (options.writeFails) {
				throw Object.assign(new Error('quota'), {code: 'ENOSPC'});
			}
			await Promise.resolve();
			s.writes.push(text);
			s.disk = JSON.parse(text);
		},
		notify: note => s.notes.push(note),
		describeError: (title, err) => ({title: title, message: err.code}),
		openBookmarks: () => { s.opened++; }
	});
	return s;
}

{
	const s = store();
	const both = await Promise.all([s.api.remove('a'), s.api.remove('b')]);
	check('two edits at once both land -- the second does not write back what the first removed',
		[both, order(s.disk)[0]], [[true, true], ['c', 'd']]);
	check('each its own write, and nothing to say about either', [s.writes.length, s.notes], [2, []]);
}

{
	const s = store();
	s.api.remove('a');
	const listed = await s.api.list('Places');
	check('a list asked for after an edit sees the edit', listed.links.map(l => l.id), ['b', 'c', 'd']);
}

{
	const s = store({unreadable: true});
	check('an edit to a file that will not read writes nothing', [await s.api.remove('a'), s.writes.length], [false, 0]);
	check('and says so, naming the file', s.notes.map(n => [n.level, n.title, /\/settings\/links\.json/.test(n.message)]),
		[['error', 'Could not remove the bookmark', true]]);
	check('an add to it writes nothing either', [await s.api.add({url: '/x.txt'}), s.writes.length], [null, 0]);
	let rejected = null;
	try {
		await s.api.list('Places');
	}
	catch (err) {
		rejected = err.name;
	}
	check('a list of it rejects instead, for the caller to decide what to draw', rejected, 'SyntaxError');
}

{
	const s = store({writeFails: true});
	check('a write that did not land is not answered as done', await s.api.rename('a', 'Aye'), null);
	check('and is reported in the words describeError gives it',
		s.notes.map(n => [n.title, n.message]), [['Could not rename the bookmark', 'ENOSPC']]);
	check('a move that did not land is false', await s.api.move('a', 3), false);
}

{
	const s = store();
	check('a link removed elsewhere a moment ago is false, and quiet, and writes nothing',
		[await s.api.remove('zz'), await s.api.move('zz', 0), await s.api.rename('zz', 'x'), s.writes.length, s.notes],
		[false, false, null, 0, []]);
	const renamed = await s.api.rename('b', 'Bee');
	check('a rename answers with the link as written', [renamed && renamed.title, s.disk.groups[0].links[1].title],
		['Bee', 'Bee']);
	check('a move is written', [await s.api.move('d', 0), order(s.disk)[0]], [true, ['d', 'a', 'b', 'c']]);
}

{
	const s = store();
	const link = await s.api.add({url: '/home/new', directory: true});
	check('an add writes, and says where it went with a way to go and look',
		[link && link.url, s.writes.length, s.notes.map(n => [n.level, n.title, n.actions && n.actions[0].label])],
		['/home/new/', 1, [['info', 'Added to bookmarks', 'Open Bookmarks']]]);
	if (s.notes[0] && s.notes[0].actions) {
		s.notes[0].actions[0].run();
	}
	check('whose button opens Bookmarks', s.opened, 1);
	await s.api.add({url: '/home/new', directory: true});
	check('adding it again writes nothing and says it is already there',
		[s.writes.length, s.notes.map(n => n.title)], [1, ['Added to bookmarks', 'Already bookmarked']]);
	check('every note is signed by the shell', s.notes.every(n => n.source === 'PixOS'), true);

	const quiet = store();
	await quiet.api.add({url: '/p/', group: 'Places', directory: true}, {quiet: true});
	await quiet.api.add({url: '/p/', group: 'Places', directory: true}, {quiet: true});
	check('quiet: written once, and not a word about either time', [quiet.writes.length, quiet.notes], [1, []]);
	await quiet.api.add({url: 'javascript:alert(1)'}, {quiet: true});
	check('but a refusal is said, quiet or not', quiet.notes.map(n => [n.level, n.title]),
		[['warn', 'That is not an address PixOS can bookmark']]);
}

{
	const s = store({disk: null});
	const made = await s.api.ensureGroup('Places', [{url: '/', title: 'Root', directory: true}]);
	check('with no file at all, a group is created and written',
		[made && made.created, made && made.group.name, s.disk && s.disk.groups.map(g => g.name)], [true, 'Places', ['Places']]);
	const again = await s.api.ensureGroup('places', [{url: '/other/'}]);
	check('asked for again it is there, and nothing is written over it',
		[again && again.created, s.writes.length, s.disk.groups[0].links.map(l => l.url)], [false, 1, ['/']]);
}

{
	// A note that could not be drawn must not turn a write that landed into a failure.
	const api = bookmarks.createBookmarks({
		read: async () => null,
		write: async () => {},
		notify: () => { throw new Error('no surface to draw on'); },
		describeError: () => ({}),
		openBookmarks: () => {}
	});
	let added = null;
	try {
		added = await api.add({url: '/a.txt'});
	}
	catch (err) {
		added = err.message;
	}
	check('a note that throws does not undo the add', added && added.url, '/a.txt');
}

// --- and the shell hands all of it out through the one store ---------------------------------------

const shellSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
check('every edit is on window, and each goes through the one store -- two stores would be two queues',
	['addBookmark', 'listBookmarks', 'removeBookmark', 'moveBookmark', 'renameBookmark', 'ensureBookmarkGroup']
		.filter(name => !new RegExp('window\\.' + name + ' = function \\([^)]*\\) \\{ return bookmarkStore\\.').test(shellSource)),
	[]);
check('built once', (shellSource.match(/bookmarks\.createBookmarks\(/g) || []).length, 1);
check('reading with the reader that tells a missing file from a broken one',
	/read: readBookmarksDocument,/.test(shellSource), true);

process.exit(report('shell-bookmarks') ? 1 : 0);
