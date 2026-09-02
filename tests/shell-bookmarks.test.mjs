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

process.exit(report('shell-bookmarks') ? 1 : 0);
