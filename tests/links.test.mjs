// The bookmarks document. The app around it is a renderer; every rule lives here.

import * as links from '../apps/bookmarks/js/links.js';
import {check, report} from './assert.mjs';

// --- normalising what is on disk ---------------------------------------------------

var doc = links.normalize({
	groups: [
		{name: 'Daily', links: [
			{title: 'A', url: 'https://a.dev'},
			{title: 'B', url: 'b.dev/path'},
			{url: 'https://www.c.dev/x'}
		]}
	]
});

check('a group survives normalising', doc.groups.length, 1);
check('and gains an id', typeof doc.groups[0].id, 'string');
check('links keep their order', doc.groups[0].links.map(l => l.title), ['A', 'B', 'c.dev']);
check('a bare hostname becomes https', doc.groups[0].links[1].url, 'https://b.dev/path');
check('a link with no title is titled by its host', doc.groups[0].links[2].title, 'c.dev');
check('every link gains an id', doc.groups[0].links.every(l => l.id), true);
check('favicons default to off', doc.favicons, false);
check('the version is stamped', doc.version, links.VERSION);

check('an empty document still has somewhere to put a link',
	links.normalize({}).groups.map(g => g.name), ['Links']);
check('so does null', links.normalize(null).groups.length, 1);
check('a string instead of a document does not throw', links.normalize('nope').groups.length, 1);
check('a group that is not an object is dropped',
	links.normalize({groups: [null, 'x', {name: 'Real'}]}).groups.map(g => g.name), ['Real']);
check('a nameless group gets a name', links.normalize({groups: [{name: '  '}]}).groups[0].name, 'Links');
check('links that are not objects are dropped',
	links.normalize({groups: [{name: 'g', links: [null, 5, {url: 'https://a.dev'}]}]}).groups[0].links.length, 1);

// A link with no usable URL is not a link: it would render as a card that does nothing.
check('a javascript: url is dropped', links.normalize({groups: [{links: [{url: 'javascript:alert(1)'}]}]})
	.groups[0].links.length, 0);
check('a data: url is dropped', links.normalize({groups: [{links: [{url: 'data:text/html,x'}]}]})
	.groups[0].links.length, 0);
check('an empty url is dropped', links.normalize({groups: [{links: [{title: 'x', url: ''}]}]})
	.groups[0].links.length, 0);

check('normalizeUrl passes https through', links.normalizeUrl('https://a.dev'), 'https://a.dev');
check('normalizeUrl upgrades a bare host', links.normalizeUrl('a.dev'), 'https://a.dev');
check('normalizeUrl keeps a filesystem path', links.normalizeUrl('/home/about.md'), '/home/about.md');
check('normalizeUrl rejects javascript:', links.normalizeUrl('javascript:alert(1)'), null);
check('normalizeUrl rejects a bare word', links.normalizeUrl('notaurl'), null);
check('normalizeUrl trims', links.normalizeUrl('  https://a.dev  '), 'https://a.dev');

check('a filesystem path is not external', links.isExternal('/home/a.md'), false);
check('an https url is', links.isExternal('https://a.dev'), true);

// --- editing -----------------------------------------------------------------------

var edit = links.normalize({groups: [
	{id: 'g1', name: 'One', links: [
		{id: 'a', title: 'A', url: 'https://a.dev'},
		{id: 'b', title: 'B', url: 'https://b.dev'}
	]},
	{id: 'g2', name: 'Two', links: []}
]});

links.addLink(edit, 'g2', {title: 'C', url: 'c.dev'});
check('a link lands in the group it was added to', edit.groups[1].links.map(l => l.title), ['C']);

check('adding a link with no url adds nothing', links.addLink(edit, 'g2', {title: 'X', url: ''}), null);
check('and leaves the group alone', edit.groups[1].links.length, 1);

links.updateLink(edit, 'a', {title: 'A renamed', note: 'a note'});
check('an edit keeps the id', links.findLink(edit, 'a').link.id, 'a');
check('and applies the patch', links.findLink(edit, 'a').link.title, 'A renamed');
check('and the fields it did not touch', links.findLink(edit, 'a').link.url, 'https://a.dev');
check('and the note', links.findLink(edit, 'a').link.note, 'a note');
check('an edit to an unusable url is refused', links.updateLink(edit, 'a', {url: 'javascript:x'}), null);
check('leaving the link as it was', links.findLink(edit, 'a').link.url, 'https://a.dev');

// Reordering within a group and moving between them are one operation.
links.moveLink(edit, 'a', 'g1', 2);
check('a link moves down within its group', edit.groups[0].links.map(l => l.id), ['b', 'a']);
links.moveLink(edit, 'a', 'g1', 0);
check('and back up', edit.groups[0].links.map(l => l.id), ['a', 'b']);
links.moveLink(edit, 'b', 'g2', 0);
check('a link moves to another group', edit.groups[1].links.map(l => l.title), ['B', 'C']);
check('and leaves the one it came from', edit.groups[0].links.map(l => l.id), ['a']);
check('moving into a group that does not exist changes nothing',
	links.moveLink(edit, 'a', 'nope', 0), false);
check('and the link is still where it was', edit.groups[0].links.map(l => l.id), ['a']);
check('an index past the end appends', links.moveLink(edit, 'a', 'g2', 99), true);
check('at the end', edit.groups[1].links.map(l => l.title), ['B', 'C', 'A renamed']);

check('removing a link removes it', links.removeLink(edit, 'a'), true);
check('and it is gone', links.findLink(edit, 'a'), null);
check('removing it twice is not an error', links.removeLink(edit, 'a'), false);

var groups = links.normalize({groups: [{id: 'g1', name: 'One'}, {id: 'g2', name: 'Two'}]});
links.addGroup(groups, 'Three');
check('a group is appended', groups.groups.map(g => g.name), ['One', 'Two', 'Three']);
links.renameGroup(groups, 'g1', 'Renamed');
check('a group renames', groups.groups[0].name, 'Renamed');
links.renameGroup(groups, 'g1', '   ');
check('an empty rename is ignored', groups.groups[0].name, 'Renamed');
links.moveGroup(groups, 'g1', 2);
check('a group reorders', groups.groups.map(g => g.name), ['Two', 'Renamed', 'Three']);
check('removing a group removes it', links.removeGroup(groups, 'g2'), true);
check('and it is gone', groups.groups.map(g => g.name), ['Renamed', 'Three']);

// The last group is what makes "Add link" possible at all, so it cannot be deleted.
var single = links.normalize({groups: [{id: 'only', name: 'Only'}]});
check('the last group cannot be removed', links.removeGroup(single, 'only'), false);
check('and is still there', single.groups.length, 1);

// --- search ------------------------------------------------------------------------

var searchable = links.normalize({groups: [
	{id: 'g1', name: 'Reading', links: [
		{id: 'a', title: 'Hacker News', url: 'https://news.ycombinator.com/'},
		{id: 'b', title: 'MDN', url: 'https://developer.mozilla.org/', note: 'web docs'}
	]},
	{id: 'g2', name: 'Tools', links: [
		{id: 'c', title: 'Can I use', url: 'https://caniuse.com/'}
	]}
]});

check('an empty query is everything', links.search(searchable, '').length, 2);
check('so is whitespace', links.search(searchable, '   ').length, 2);
check('a title match narrows to one group', links.search(searchable, 'mdn').map(g => g.name), ['Reading']);
check('and to one link inside it', links.search(searchable, 'mdn')[0].links.map(l => l.id), ['b']);
check('a url matches too', links.search(searchable, 'caniuse')[0].links.map(l => l.id), ['c']);
check('so does a note', links.search(searchable, 'web docs')[0].links.map(l => l.id), ['b']);
check('search is case-insensitive', links.search(searchable, 'HACKER')[0].links.map(l => l.id), ['a']);
check('a group name match keeps all of its links',
	links.search(searchable, 'reading')[0].links.map(l => l.id), ['a', 'b']);
check('no match is no groups', links.search(searchable, 'zzz').length, 0);
check('searching does not mutate the document', searchable.groups[0].links.length, 2);

// --- tiles and favicons --------------------------------------------------------------

check('a two-word title gives two initials', links.tileFor({title: 'Hacker News', url: 'https://x.dev'}).label, 'HN');
check('a one-word title gives one', links.tileFor({title: 'MDN', url: 'https://x.dev'}).label, 'M');
check('a titleless link falls back to its host',
	links.tileFor({title: '', url: 'https://developer.mozilla.org/'}).label, 'D');
// Same host, same colour, forever -- the whole point of hashing rather than assigning.
check('the colour is derived from the host', links.tileFor({title: 'A', url: 'https://a.dev/1'}).color,
	links.tileFor({title: 'Z', url: 'https://a.dev/2'}).color);
check('different hosts differ', links.tileFor({title: 'A', url: 'https://a.dev'}).color
	=== links.tileFor({title: 'A', url: 'https://b.dev'}).color, false);

check('a favicon comes from the site itself, not a third party',
	links.faviconUrl({url: 'https://a.dev/some/page'}), 'https://a.dev/favicon.ico');
check('a filesystem link has no favicon', links.faviconUrl({url: '/home/a.md'}), null);

check('hostOf strips the scheme and www', links.hostOf('https://www.example.com/a/b'), 'example.com');
check('hostOf on a path gives the basename', links.hostOf('/home/about.md'), 'about.md');

// --- round trip ------------------------------------------------------------------------

var saved = links.normalize({groups: [{id: 'g1', name: 'One', links: [
	{id: 'a', title: 'A', url: 'https://a.dev', note: 'n', frame: true},
	{id: 'b', title: 'B', url: 'https://b.dev'}
]}]});
var reloaded = links.normalize(JSON.parse(links.serialize(saved)));

check('a saved document reloads identically', reloaded, saved);
check('an empty note is not written out', JSON.parse(links.serialize(saved)).groups[0].links[1].note, undefined);
check('nor is frame: false', JSON.parse(links.serialize(saved)).groups[0].links[1].frame, undefined);
check('the frame flag survives', reloaded.groups[0].links[0].frame, true);

// "Open inside PixOS" is a choice between a PixOS window and a browser tab, and a
// filesystem path has neither alternative -- it always opens in PixOS. Carrying the flag
// there would mean an editor checkbox that appears to be ignored.
check('a filesystem link cannot be flagged for framing',
	links.normalize({groups: [{links: [{url: '/home/about.md', frame: true}]}]}).groups[0].links[0].frame,
	false);
var flagged = links.normalize({groups: [{id: 'g', links: [{id: 'x', url: 'https://a.dev', frame: true}]}]});
check('an external one can be', flagged.groups[0].links[0].frame, true);
links.updateLink(flagged, 'x', {url: '/home/a.md'});
check('and loses the flag when it becomes a path', flagged.groups[0].links[0].frame, false);

check('the bundled default is a valid document', links.normalize(links.DEFAULT_DOC).groups.length,
	links.DEFAULT_DOC.groups.length);
check('and every link in it survives normalising',
	links.normalize(links.DEFAULT_DOC).groups.reduce((n, g) => n + g.links.length, 0),
	links.DEFAULT_DOC.groups.reduce((n, g) => n + g.links.length, 0));

process.exit(report('links') ? 1 : 0);
