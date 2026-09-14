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
import os from 'os';
import path from 'path';
import {execFileSync} from 'child_process';
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

// --- and it is a module that parses ----------------------------------------------------------
//
// Written after a pass cut one line too many out of this file, took `function bindEvents () {`
// with it, and shipped: the body of `bindEvents` ran on into `openExplorer`, whose closing
// brace then closed nothing, and the browser answered `Unexpected token '}'` on the last line
// of the file. Every unit test still passed — they import the modules, and nothing here had
// ever asked whether the file that wires them together is syntactically a file.
//
// It must be checked as a **module**, which is how the browser loads it. A stray brace at the
// end of a *script* is tolerated by the same parser that rejects it in a module, so the check
// that missed this was `node --check` on a `.js` file. Hence the .mjs extension below, and
// hence `--check`: it parses and does not run, which is the only option for a file whose first
// line expects a shell in the parent window.

const scriptOpen = entry.indexOf('<script type="module">');
const scriptClose = entry.indexOf('\n</script>', scriptOpen);
check('index.html carries one module script', scriptOpen > -1 && scriptClose > -1, true);

const source = entry.slice(entry.indexOf('\n', scriptOpen) + 1, scriptClose + 1);
const scratch = path.join(os.tmpdir(), 'pixos-explorer-entry.mjs');
fs.writeFileSync(scratch, source);

let parseError = null;
try {
	execFileSync(process.execPath, ['--check', scratch], {stdio: 'pipe'});
}
catch (err) {
	// The message carries the line number inside the extracted script, which is what somebody
	// reading a red test needs; the offset to a line of index.html is the script's start.
	parseError = String(err.stderr || err.message).split('\n').slice(0, 4).join(' ').trim();
}
fs.unlinkSync(scratch);
check('and it parses as one -- the way the browser loads it', parseError, null);

// --- and the order they are built in ------------------------------------------------------
//
// Load-bearing, and the only failure mode is at runtime. A factory reads the *value* of
// everything handed to it, so a module built above the thing it is given gets `undefined`
// and says nothing until somebody presses the button — which is not the same day.
//
// Three rules, each with a reason that is not guessable from the line itself:
//
//   * `createMenuItems` and `createSidebar` go after `var actions`, and after the loop that
//     wraps every entry in it, because a menu entry reads `actions.copySelected` when the menu
//     is built and every mount row carries an unmount button. Built earlier, both would hold
//     the *unwrapped* action and a failure would go back to being a console line.
//   * The window's boot goes after both. The first `refreshCurrentDir` draws the sidebar.
//   * `renderLayout` comes first inside that boot: it is what puts the nodes in `ui`, and
//     everything after it reads one.

const at = needle => {
	const i = entry.indexOf(needle);
	if (i === -1) {
		console.error('explorer-modules.test.mjs: could not find "' + needle + '" in index.html');
		process.exit(1);
	}
	return i;
};

// The three late-bound pairs, which are what the ordering above costs. All are written as a
// thunk rather than a reference for the same reason: the function they call is a `var` further
// down the file, so a reference taken here would be `undefined` for ever. Replace any thunk
// with the bare name and nothing fails until somebody selects a row, unmounts something or
// copies a file.
check('selection gets its two renders late-bound, because js/view.js is built after it',
	/renderStatus: function \(\) \{ return renderStatus\(\); \}/.test(entry)
	&& /renderToolbarState: function \(\) \{ return renderToolbarState\(\); \}/.test(entry), true);
check('and the mount actions get renderSidebar the same way, the sidebar being built from them',
	/renderSidebar: function \(\) \{ return renderSidebar\(\); \}/.test(entry), true);
check('and the view gets hasInternalClipboard the same way, js/clipboard.js redrawing its toolbar',
	/hasInternalClipboard: function \(\) \{ return hasInternalClipboard\(\); \}/.test(entry), true);

check('the action table is built before the loop that guards it',
	at('var actions = {') < at('Object.keys(actions).forEach'), true);
check('menus are built after that loop, not with the other modules',
	at('Object.keys(actions).forEach') < at('= createMenuItems({'), true);
check('and so is the sidebar', at('Object.keys(actions).forEach') < at('= createSidebar({'), true);
check('the window boots only once every module exists',
	at('= createSidebar({') < at('\n\trenderLayout();'), true);
check('and it draws its layout before it binds anything to it',
	at('\n\trenderLayout();') < at('\n\tbindEvents();'), true);
check('the first listing is read last of all',
	at('\n\tbindEvents();') < at('\n\tawait refreshCurrentDir(false);'), true);

process.exit(report('explorer-modules') ? 1 : 0);
