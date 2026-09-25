// Which file a /__browserfs__ request names, and where a folder without its slash is sent. sw.js
// cannot be imported -- it is a worker script that registers listeners and opens BrowserFS -- so the
// region between its markers is run on its own, as tests/sw-mount-reads.test.mjs does.
//
// Found in phase 26, pass 4: Chrome keeps a page's fragment in the request.url a worker sees, and the
// worker dropped only the query, so Pipes, opened as `index.html#{"hideUI":true}`, was a 404.

import {check, report} from './assert.mjs';
import fs from 'node:fs';

const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const start = sw.indexOf('// --- the path a /__browserfs__ request names');
const end = sw.indexOf('// --- end of the path');
check('the region is there', start > -1 && end > start, true);
const {servedPath, withSlash} = new Function(sw.slice(start, end) + '\nreturn {servedPath, withSlash};')();

const at = 'http://localhost:8000/__browserfs__';
check('a file is its path', servedPath(at + '/apps/ace/index.html'), '/apps/ace/index.html');
check('without its query, which is the page\'s', servedPath(at + '/apps/treemap/index.html?path=/home'), '/apps/treemap/index.html');
check('and without its fragment, which is the page\'s too',
	servedPath(at + '/apps/screensavers/Pipes.xscr/index.html#%7B%22hideUI%22%3Atrue%7D'), '/apps/screensavers/Pipes.xscr/index.html');
check('both', servedPath(at + '/a/index.html?x=1#y'), '/a/index.html');
check('a ? inside the fragment is the fragment\'s', servedPath(at + '/a/index.html#y?x=1'), '/a/index.html');
check('an escaped # or ? in a filename stays in the name, still escaped', servedPath(at + '/home/Is%20it%20%231%3F.xscr.html'),
	'/home/Is%20it%20%231%3F.xscr.html');
check('the root is empty, which is a folder without its slash', [servedPath(at), servedPath(at + '?x'), servedPath(at + '#x')], ['', '', '']);
check('and a site in a subfolder is the same', servedPath('https://user.github.io/pixos/__browserfs__/apps/x/index.html#a'), '/apps/x/index.html');
check('anything else names nothing', servedPath('http://localhost:8000/index.html'), null);
check('the worker serves what it names', /var path = servedPath\(url\);[\s\S]{0,200}serve\(path\);/.test(sw), true);

check('a folder gets its slash', withSlash(at + '/apps/ace'), at + '/apps/ace/');
check('before its query, not after it', withSlash(at + '/apps/x?folder=%2Fhome'), at + '/apps/x/?folder=%2Fhome');
check('and without its fragment, which the browser carries over', withSlash(at + '/apps/x#top'), at + '/apps/x/');
check('the redirect is made with it', /Response\.redirect\(withSlash\(url\), 301\)/.test(sw), true);

process.exit(report('sw-served-path') ? 1 : 0);
