// The markdown renderer behind apps/markdown-viewer and the About widget.
//
// It renders documents from the filesystem into the shell's own origin, so the escaping
// rules here are a security boundary, not a formatting preference.

import {render, escapeHtml, safeUrl, parseFrontmatter} from '../apps/markdown-viewer/js/markdown.js';
import {check, report} from './assert.mjs';

var md = function (text) {
	return render(text);
};

// --- blocks ----------------------------------------------------------------------

check('a heading carries its level and a slug id', md('## Getting started'),
	'<h2 id="getting-started">Getting started</h2>');
check('Cyrillic survives the slug', md('# Привет мир'), '<h1 id="привет-мир">Привет мир</h1>');

check('consecutive lines are one paragraph', md('one\ntwo'), '<p>one\ntwo</p>');
check('a blank line starts a new one', md('one\n\ntwo'), '<p>one</p>\n<p>two</p>');
check('two trailing spaces are a hard break', md('one  \ntwo'), '<p>one<br>\ntwo</p>');

check('a bullet list is tight', md('- one\n- two'), '<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
check('an ordered list keeps its numbering', md('3. three\n4. four'),
	'<ol start="3">\n<li>three</li>\n<li>four</li>\n</ol>');
check('a nested list nests', md('- one\n  - inner\n- two'),
	'<ul>\n<li>one\n<ul>\n<li>inner</li>\n</ul></li>\n<li>two</li>\n</ul>');
check('a paragraph after a list is not swallowed by it', md('- one\n\nafter'),
	'<ul>\n<li>one</li>\n</ul>\n<p>after</p>');

check('a fenced block keeps its language', md('```js\nvar a = 1;\n```'),
	'<pre><code class="language-js">var a = 1;</code></pre>');
check('markup inside a fence is not markup', md('```\n# not a heading **not bold**\n```'),
	'<pre><code># not a heading **not bold**</code></pre>');
check('a fence closes only on a matching fence', md('````\n```\nstill code\n````'),
	'<pre><code>```\nstill code</code></pre>');

check('a blockquote renders its contents as blocks', md('> **hi**'),
	'<blockquote>\n<p><strong>hi</strong></p>\n</blockquote>');
check('three dashes are a rule', md('---'), '<hr>');

check('a table renders with alignment', md('| a | b |\n| --- | ---: |\n| 1 | 2 |'),
	'<table>\n<thead><tr><th>a</th><th style="text-align:right">b</th></tr></thead>\n'
	+ '<tbody>\n<tr><td>1</td><td style="text-align:right">2</td></tr>\n</tbody>\n</table>');
check('a pipe without a delimiter row is just a paragraph', md('a | b\nc | d'), '<p>a | b\nc | d</p>');

check('an empty document renders to nothing', md(''), '');
check('null renders to nothing rather than "null"', md(null), '');

// --- inline ----------------------------------------------------------------------

check('bold and italic', md('**b** and *i*'), '<p><strong>b</strong> and <em>i</em></p>');
check('underscores too', md('__b__ and _i_'), '<p><strong>b</strong> and <em>i</em></p>');
check('an underscore inside a word is not emphasis', md('snake_case_name'), '<p>snake_case_name</p>');
check('strikethrough', md('~~gone~~'), '<p><del>gone</del></p>');
check('a code span', md('use `npm test`'), '<p>use <code>npm test</code></p>');
check('markup inside a code span is literal', md('`**not bold**`'),
	'<p><code>**not bold**</code></p>');

check('an external link opens in a new tab', md('[x](https://example.com)'),
	'<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a></p>');
check('a filesystem link is tagged for the shell instead', md('[x](/home/about.md)'),
	'<p><a href="/home/about.md" data-pixos-path="/home/about.md">x</a></p>');
check('an autolink is a link', md('<https://example.com>'),
	'<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a></p>');
check('an image renders as an image', md('![alt](/pics/a.png)'),
	'<p><img src="/pics/a.png" alt="alt"></p>');

// --- escaping ----------------------------------------------------------------------
//
// Every one of these is a document the user could open from anywhere in the filesystem.

check('raw HTML is text, not markup', md('<script>alert(1)</script>'),
	'<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
check('an img onerror payload is text', md('<img src=x onerror=alert(1)>'),
	'<p>&lt;img src=x onerror=alert(1)&gt;</p>');
check('a javascript: link loses its href', md('[click](javascript:alert(1))'),
	'<p>click</p>');
check('a data: link loses its href', md('[click](data:text/html,<script>x</script>)'),
	'<p>click</p>');
check('a javascript: image src is dropped too', md('![x](javascript:alert(1))'), '<p>x</p>');
check('a link title renders as an attribute', md('[x](https://a.dev "the title")'),
	'<p><a href="https://a.dev" title="the title" target="_blank" rel="noopener noreferrer">x</a></p>');
// A quote cannot survive escapeHtml(), so a crafted title cannot close the attribute and
// start another one. What is left is inert text next to the link.
check('a crafted title cannot inject an attribute',
	md('[x](https://a.dev "a\\" onerror=\\"alert(1)")').includes('onerror="'), false);
check('ampersands are escaped in hrefs', md('[x](https://a.dev/?a=1&b=2)'),
	'<p><a href="https://a.dev/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">x</a></p>');
check('HTML inside a fence is escaped', md('```\n<b>x</b>\n```'),
	'<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>');

check('escapeHtml covers the four that matter', escapeHtml('<&">'), '&lt;&amp;&quot;&gt;');
check('safeUrl passes https', safeUrl('https://a.dev'), 'https://a.dev');
check('safeUrl passes a bare path', safeUrl('/home/a.md'), '/home/a.md');
check('safeUrl rejects javascript:', safeUrl('javascript:alert(1)'), null);
check('safeUrl rejects it past whitespace padding', safeUrl('  javascript:alert(1)'), null);
check('safeUrl rejects an empty url', safeUrl(''), null);

// --- frontmatter ------------------------------------------------------------------

var about = parseFrontmatter([
	'---',
	'name: Sergey',
	'tagline: "Builds things in browsers"',
	'links:',
	'  - title: Site',
	'    url: https://example.dev',
	'  - title: Mail',
	'    url: mailto:a@b.c',
	'tags:',
	'  - one',
	'  - two',
	'---',
	'',
	'# Hello',
	''
].join('\n'));

check('a scalar field', about.data.name, 'Sergey');
check('quotes are stripped', about.data.tagline, 'Builds things in browsers');
check('a list of objects', about.data.links, [
	{title: 'Site', url: 'https://example.dev'},
	{title: 'Mail', url: 'mailto:a@b.c'}
]);
check('a list of scalars', about.data.tags, ['one', 'two']);
check('the body is what is left', about.body, '\n# Hello\n');

var plain = parseFrontmatter('# Just a document\n');
check('a document without frontmatter yields an empty object', plain.data, {});
check('and keeps its whole body', plain.body, '# Just a document\n');

check('frontmatter must be the first thing in the file',
	parseFrontmatter('\n---\nname: x\n---\n').data, {});
check('malformed frontmatter does not throw', parseFrontmatter('---\n: : :\n---\nbody').data, {});
check('an empty document has no frontmatter', parseFrontmatter('').data, {});

process.exit(report('markdown') ? 1 : 0);
