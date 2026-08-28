// /home/about.md and the desktop widget that reads it.

import {check, report} from './assert.mjs';
import {parseFrontmatter, safeUrl, profileFrom, read, ABOUT_PATH} from '../js/shell/about.js';

// --- frontmatter -------------------------------------------------------------------

var parsed = parseFrontmatter([
	'---',
	'name: Sergey',
	"tagline: 'Builds things in browsers'",
	'links:',
	'  - title: Site',
	'    url: https://example.dev',
	'  - title: Mail',
	'    url: mailto:a@b.c',
	'---',
	'',
	'# About me',
	''
].join('\n'));

check('a scalar field is read', parsed.data.name, 'Sergey');
check('single quotes are stripped too', parsed.data.tagline, 'Builds things in browsers');
check('a list of objects is read', parsed.data.links, [
	{title: 'Site', url: 'https://example.dev'},
	{title: 'Mail', url: 'mailto:a@b.c'}
]);
check('the body starts after the closing fence', parsed.body, '\n# About me\n');

check('a file with no frontmatter yields nothing', parseFrontmatter('# Hello').data, {});
check('and keeps its body intact', parseFrontmatter('# Hello').body, '# Hello');
check('frontmatter must open the file', parseFrontmatter('x\n---\nname: y\n---\n').data, {});
check('an empty file does not throw', parseFrontmatter('').data, {});
check('null does not throw', parseFrontmatter(null).data, {});
check('a comment line is ignored', parseFrontmatter('---\n# note\nname: A\n---\n').data, {name: 'A'});
check('an unparseable line is skipped, not fatal',
	parseFrontmatter('---\n: : :\nname: A\n---\n').data, {name: 'A'});
check('a plain list is a list of strings',
	parseFrontmatter('---\ntags:\n  - a\n  - b\n---\n').data.tags, ['a', 'b']);
check('CRLF frontmatter parses', parseFrontmatter('---\r\nname: A\r\n---\r\nbody').data, {name: 'A'});

// --- urls --------------------------------------------------------------------------
//
// These end up as hrefs on the desktop, which is the shell's own origin.

check('https passes', safeUrl('https://a.dev'), 'https://a.dev');
check('mailto passes', safeUrl('mailto:a@b.c'), 'mailto:a@b.c');
check('a filesystem path passes', safeUrl('/home/notes.md'), '/home/notes.md');
check('javascript: is refused', safeUrl('javascript:alert(1)'), null);
check('data: is refused', safeUrl('data:text/html,x'), null);
check('a relative path is refused', safeUrl('notes.md'), null);
check('an empty url is refused', safeUrl(''), null);
check('a missing url is refused', safeUrl(undefined), null);

// --- profile -----------------------------------------------------------------------

var profile = profileFrom({
	name: 'Sergey',
	tagline: 'Hello',
	links: [
		{title: 'Site', url: 'https://a.dev'},
		{title: 'Bad', url: 'javascript:alert(1)'},
		{url: 'https://b.dev'},
		'not an object',
		null
	]
});

check('name and tagline come through', [profile.name, profile.tagline], ['Sergey', 'Hello']);
check('only usable links survive', profile.links, [
	{title: 'Site', url: 'https://a.dev'},
	{title: 'https://b.dev', url: 'https://b.dev'}
]);

check('title is accepted as a name', profileFrom({title: 'A'}).name, 'A');
check('description is accepted as a tagline', profileFrom({description: 'D'}).tagline, 'D');
check('an empty document gives an empty profile', profileFrom({}),
	{name: '', tagline: '', links: []});
check('so does no document at all', profileFrom(null), {name: '', tagline: '', links: []});
check('links that are not a list are ignored', profileFrom({links: 'x'}).links, []);

// --- reading the file ---------------------------------------------------------------

var requested = [];
globalThis.fetch = async function (url) {
	requested.push(url);
	return {
		ok: true,
		status: 200,
		text: async function () {
			return '---\nname: Sergey\n---\n\n# About\n';
		}
	};
};

var result = await read();
check('the default path is /home/about.md', result.path, ABOUT_PATH);
check('read through the service worker, not window.fs',
	requested[0].startsWith('/__browserfs__/home/about.md'), true);
// Without this the widget shows whatever was cached at boot and never updates after an edit.
check('and not from cache', /\?\d+$/.test(requested[0]), true);
check('the profile is what came back', result.profile.name, 'Sergey');
check('with no error', result.error, null);

globalThis.fetch = async function () {
	return {ok: false, status: 404, statusText: 'Not Found'};
};
var missing = await read();
check('a missing file is not a rejection', missing.profile, {name: '', tagline: '', links: []});
check('it reports why', String(missing.error), 'Error: 404 Not Found');
check('and still names the path it looked for', missing.path, ABOUT_PATH);

globalThis.fetch = async function () {
	throw new Error('offline');
};
var failed = await read('/home/other.md');
check('a failed fetch is not a rejection either', failed.error.message, 'offline');
check('and an explicit path is kept', failed.path, '/home/other.md');

process.exit(report('about') ? 1 : 0);
