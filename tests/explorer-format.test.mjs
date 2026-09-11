// The first code in Explorer that could be imported.
//
// Until phase 21 every one of these lived inside `openExplorer`, a single 4,702-line
// function, where nothing could reach them: the two tests that needed one scraped it out
// of the HTML with `indexOf` and ran it through `new Function`. They are here now because
// they are a module, and that is the entire argument for the split in one paragraph.
//
// `path` is injected, so node's `path.posix` stands in for BrowserFS's — the same answers
// for every input `normalizePath`, `getParentPath` and `splitNameAndExtension` give it.

import path from 'path';
import {check, report} from './assert.mjs';
import {createFormat} from '../apps/explorer/js/format.js';

const {
	normalizePath, getParentPath, formatSize, getItemTitle,
	escapeHtml, escapeAttr, getExt, getNameByPath,
	splitNameAndExtension, basenameEnd, isImageExtension
} = createFormat(path.posix);

// --- paths ------------------------------------------------------------------------------

check('an empty path is the root', normalizePath(''), '/');
check('so is nothing at all', normalizePath(undefined), '/');
check('a relative path is made absolute', normalizePath('home/docs'), '/home/docs');
check('an absolute one is left alone', normalizePath('/home/docs'), '/home/docs');
check('a doubled separator collapses', normalizePath('/home//docs'), '/home/docs');
check('and .. is resolved, not carried', normalizePath('/home/docs/../pics'), '/home/pics');
// Not dropped -- node's `normalize` keeps it, and BrowserFS's path is a port of node's.
// Worth pinning rather than wishing away: every caller that compares two paths as strings
// is relying on nothing upstream ever handing it one with a trailing slash.
check('a trailing slash survives', normalizePath('/home/docs/'), '/home/docs/');

check('the root has no parent but itself', getParentPath('/'), '/');
check('nor does nothing at all', getParentPath(''), '/');
check('a top-level folder is a child of the root', getParentPath('/home'), '/');
check('and a nested one of its folder', getParentPath('/home/docs/a.txt'), '/home/docs');

check('a name is the last segment', getNameByPath('/home/docs/a.txt'), 'a.txt');
check('even with no folder above it', getNameByPath('a.txt'), 'a.txt');

// --- sizes ------------------------------------------------------------------------------
//
// Bytes are whole, and so is anything past 10 of a unit -- "1.5 KB" is worth the decimal,
// "15.3 MB" is not.

check('nothing is zero bytes', formatSize(0), '0 B');
check('and so is a missing size', formatSize(undefined), '0 B');
check('bytes stay whole', formatSize(512), '512 B');
check('1024 is one kilobyte', formatSize(1024), '1.0 KB');
check('and a half is shown', formatSize(1536), '1.5 KB');
check('past ten the decimal goes', formatSize(1024 * 15.3), '15 KB');
check('megabytes', formatSize(1024 * 1024 * 2.5), '2.5 MB');
check('gigabytes', formatSize(1024 * 1024 * 1024 * 3), '3.0 GB');
check('and nothing larger, so a terabyte is four figures of GB',
	formatSize(1024 * 1024 * 1024 * 1024), '1024 GB');

check('a folder shows a dash where its size would be',
	getItemTitle({name: 'docs', isDirectory: true, size: 4096, mtime: '2026-01-01 10:00:00'}),
	'Name: docs\nSize: -\nModified: 2026-01-01 10:00:00');
check('a file shows the formatted size',
	getItemTitle({name: 'a.txt', isDirectory: false, size: 2048, mtime: '2026-01-01 10:00:00'}),
	'Name: a.txt\nSize: 2.0 KB\nModified: 2026-01-01 10:00:00');

// --- escaping ---------------------------------------------------------------------------
//
// Every row in the listing is built as a string of HTML, and a file can be named anything
// at all. `&` goes first or it would re-escape the entities the later rules produce.

check('a tag cannot open', escapeHtml('<script>'), '&lt;script&gt;');
check('an ampersand is escaped once, not twice', escapeHtml('a & b'), 'a &amp; b');
check('and an entity is not double-escaped into nonsense',
	escapeHtml('&lt;'), '&amp;lt;');
check('quotes go, because these land in attributes',
	escapeHtml('say "hi"'), 'say &quot;hi&quot;');
check('single quotes too', escapeHtml("it's"), 'it&#39;s');
check('a number is still escaped as text', escapeHtml(42), '42');

check('an attribute also escapes the backtick', escapeAttr('a`b'), 'a&#96;b');
check('and everything escapeHtml does', escapeAttr('<a "b">'), '&lt;a &quot;b&quot;&gt;');

// --- extensions -------------------------------------------------------------------------

check('an extension is lower-cased', getExt('REPORT.PDF'), 'pdf');
check('only the last one counts', getExt('book.fb2.zip'), 'zip');
check('a name with no dot has none', getExt('README'), '');
// A dotfile is a name, not an extension -- getExt requires the dot past position 0.
check('a dotfile has no extension', getExt('.gitignore'), '');

check('a name splits from its extension',
	splitNameAndExtension('report.pdf'), {name: 'report', ext: '.pdf'});
check('only at the last dot',
	splitNameAndExtension('book.fb2.zip'), {name: 'book.fb2', ext: '.zip'});
check('and a name with none keeps all of itself',
	splitNameAndExtension('README'), {name: 'README', ext: ''});
check('a dotfile is all name',
	splitNameAndExtension('.gitignore'), {name: '.gitignore', ext: ''});

// --- how much of a name a rename dialog selects -------------------------------------------

check('a plain name selects whole', basenameEnd('README'), 6);
check('an extension is left out', basenameEnd('report.pdf'), 6);
check('only the last extension is left out', basenameEnd('report.final.pdf'), 12);
check('a dotfile selects whole', basenameEnd('.gitignore'), 10);
check('a dotfile with an extension keeps the extension out', basenameEnd('.eslintrc.json'), 9);
check('an empty name does not throw', basenameEnd(''), 0);
check('nor does nothing at all', basenameEnd(null), 0);
check('a trailing dot selects up to it', basenameEnd('name.'), 4);

// --- images -------------------------------------------------------------------------------

check('a png is an image', isImageExtension('photo.png'), true);
check('case does not matter', isImageExtension('PHOTO.JPG'), true);
check('svg counts, since the viewer can show one', isImageExtension('icon.svg'), true);
check('a pdf does not', isImageExtension('report.pdf'), false);
check('and a name with no extension does not',
	isImageExtension('README'), false);

process.exit(report('explorer-format') ? 1 : 0);
