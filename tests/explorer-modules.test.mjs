// Explorer's files have to be named in four separate lists, and not one of them will
// complain if they are not.
//
// Explorer is a reserved id: `npm run generate-apps` walks straight past it and prints
// nothing about the app you just changed, so `pixos.app.json` is maintained by hand.
// `settings/preinstall.json` is what copies the files into BrowserFS, `PRECACHE` in
// `sw.js` is what makes them survive a first boot with no network, and
// `FALLBACK_PREINSTALL` in the shell's `index.html` is what a boot falls back on when
// preinstall.json itself is unreachable.
//
// A module present in one list and absent from another does not fail at build time. It
// 404s on the next boot, in the app you browse files with, and phase 21 turned Explorer
// from two files into five — so this is the check that keeps that survivable.

import fs from 'fs';
import crypto from 'crypto';
import {check, report} from './assert.mjs';

const root = new URL('../', import.meta.url);
const read = rel => fs.readFileSync(new URL(rel, root), 'utf8');

// --- what is actually on disk ---------------------------------------------------------

function walk (dir, prefix, out) {
	fs.readdirSync(new URL(dir, root), {withFileTypes: true}).sort((a, b) =>
		a.name < b.name ? -1 : 1
	).forEach(entry => {
		if (entry.isDirectory()) {
			walk(dir + entry.name + '/', prefix + entry.name + '/', out);
		}
		else if (entry.name !== 'pixos.app.json') {
			out.push(prefix + entry.name);
		}
	});
	return out;
}

const onDisk = walk('apps/explorer/', '/apps/explorer/', []);

check('Explorer is more than one file now', onDisk.length > 2, true);
check('and the split put them where the plan said',
	onDisk.includes('/apps/explorer/js/format.js')
		&& onDisk.includes('/apps/explorer/js/fs-helpers.js'), true);

// --- the four lists -------------------------------------------------------------------

const manifest = JSON.parse(read('apps/explorer/pixos.app.json'));
const manifestPaths = manifest.files.map(f => f.path).sort();

const preinstall = JSON.parse(read('settings/preinstall.json'))
	.files.map(f => f.path)
	.filter(p => p.startsWith('/apps/explorer/'))
	.sort();

const precache = (read('sw.js').match(/var PRECACHE = \[([\s\S]*?)\n\];/) || [, ''])[1]
	.split('\n')
	.map(line => (line.match(/'([^']+)'/) || [])[1])
	.filter(Boolean)
	.filter(p => p.startsWith('./apps/explorer/'))
	.map(p => p.slice(1))
	.sort();

const shell = read('index.html');
const fallbackBlock = shell.slice(shell.indexOf('FALLBACK_PREINSTALL'));
const fallback = [...fallbackBlock.slice(0, 2000).matchAll(/path: '(\/apps\/explorer\/[^']+)'/g)]
	.map(m => m[1])
	.sort();

const want = onDisk.slice().sort();

check('the manifest names every file that exists', manifestPaths, want);
check('preinstall.json copies every one of them in', preinstall, want);
check('the service worker precaches every one of them', precache, want);
check('and the shell\'s fallback list has them too', fallback, want);

// --- and the hashes are the ones the files actually have -------------------------------
//
// Nothing at boot verifies this, because Explorer is preloaded with `refresh: true` and
// never installed through the registry -- which is exactly why a wrong hash can sit here
// for months before App Manager surfaces it as a phantom "modified locally".

const wrong = manifest.files.filter(entry => {
	const data = fs.readFileSync(new URL(entry.path.slice(1), root));
	return 'sha256:' + crypto.createHash('sha256').update(data).digest('hex') !== entry.hash;
}).map(entry => entry.path);

check('every hash in the manifest matches its file', wrong, []);

// --- and every import resolves ---------------------------------------------------------
//
// The entry point names its modules by relative URL. Those are resolved by the browser
// against wherever Explorer is being served from, which on a booted system is BrowserFS.

const entry = read('apps/explorer/index.html');
const imports = [...entry.matchAll(/from ["'](\.\/[^"']+)["']/g)].map(m => m[1]);

check('index.html imports its own modules', imports.length > 0, true);
check('and every one of them is a file that exists',
	imports.filter(rel => !fs.existsSync(new URL('apps/explorer/' + rel.slice(2), root))), []);

const styles = [...entry.matchAll(/<link[^>]+href="([^"]+)"/g)].map(m => m[1]);
check('and the stylesheet it links is one too',
	styles.filter(rel => !fs.existsSync(new URL('apps/explorer/' + rel, root))), []);
check('which is no longer a <style> block', /<style>/.test(entry), false);

process.exit(report('explorer-modules') ? 1 : 0);
