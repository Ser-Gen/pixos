// An app that dies before its own code runs.
//
// An error inside an iframe fires on *that* window, so the shell's global handlers never
// see it: `ace` with no network opened a blank window and left a console line, because the
// editor it loads from a CDN was not there and its own script then died on
// `ace is not defined` — before it could have installed a handler of its own.
//
// The handler therefore has to arrive before the app does, which only `sw.js` can arrange.
// What is checked here is the part that is easy to get quietly wrong: *where* it is
// injected, and *when* it is not.

import fs from 'node:fs';
import {check, report} from './assert.mjs';

const root = new URL('../', import.meta.url);
const sw = fs.readFileSync(new URL('sw.js', root), 'utf8');

function region (from, to) {
	const start = sw.indexOf(from);
	const end = sw.indexOf(to, start);
	if (start === -1 || end === -1) {
		console.error('app-errors.test.mjs: could not find "' + from + '" in sw.js');
		process.exit(1);
	}
	return sw.slice(start, end);
}

const {withErrorReporter, ERROR_REPORTER} = new Function(
	region('var ERROR_REPORTER =', '\nself.addEventListener')
	+ '\n; return {withErrorReporter: withErrorReporter, ERROR_REPORTER: ERROR_REPORTER};'
)();

// --- where it lands ------------------------------------------------------------------------

const doc = '<!DOCTYPE html>\n<html>\n<head>\n<title>App</title>\n</head>\n<body>x</body>\n</html>';
const injected = withErrorReporter(doc);

check('the reporter is there', injected.includes(ERROR_REPORTER), true);
// Anything before the doctype drops the document into quirks mode, which changes how every
// app in the system is laid out. This is the one that would be found late and blamed on CSS.
check('and never before the doctype', injected.indexOf('<!DOCTYPE html>'), 0);
check('it goes immediately after <head>, so it runs before any script the app loads',
	injected.indexOf(ERROR_REPORTER), injected.indexOf('<head>') + '<head>'.length);
check('the document is otherwise untouched',
	injected.replace(ERROR_REPORTER, ''), doc);

// A `<head>` with attributes on it is still a `<head>`.
check('an attribute on the head tag does not defeat the match',
	withErrorReporter('<!doctype html><head lang="en"><title>t</title></head>')
		.indexOf(ERROR_REPORTER), '<!doctype html><head lang="en">'.length);
check('a lowercase doctype is a doctype', /^<!doctype html>/.test(
	withErrorReporter('<!doctype html><body>x</body>')), true);

// The browser inserts a `<head>` for a fragment like this, and the script has to be inside
// the document rather than in front of a doctype that is not there.
check('a document with no head still gets one, after the doctype',
	withErrorReporter('<!DOCTYPE html><body>only a body</body>'),
	'<!DOCTYPE html>' + ERROR_REPORTER + '<body>only a body</body>');
check('and a fragment with neither gets it at the front',
	withErrorReporter('<p>hi</p>'), ERROR_REPORTER + '<p>hi</p>');

// --- what it reports ---------------------------------------------------------------------

check('it is one self-contained script tag',
	/^<script>[\s\S]*<\/script>$/.test(ERROR_REPORTER), true);
// A <script src> or an <img> that fails to load fires an error event that does not bubble,
// so only the capture phase sees it — and for an app that loads half of itself from
// somewhere else, that failure is the actual news rather than the exception that follows.
check('it listens in the capture phase, or a failed script tag is invisible',
	/addEventListener\("error",[\s\S]*?,true\)/.test(ERROR_REPORTER), true);
check('a failed resource is reported as the address that failed',
	ERROR_REPORTER.includes('"Could not load "+(e.target.src||e.target.href)'), true);
check('and a rejection nobody caught is reported too',
	ERROR_REPORTER.includes('addEventListener("unhandledrejection"'), true);
check('every report is wrapped, because a reporter that throws is worse than none',
	/try\{[\s\S]*?\}catch\(e\)\{\}/.test(ERROR_REPORTER), true);
check('it says nothing when there is no shell around the page',
	ERROR_REPORTER.includes('parent!==window'), true);

// Explorer reports its own failures in three layers, each naming the operation and
// translating the errno. Two notes for one error is worse than one.
check('an app that reports its own errors can say so',
	ERROR_REPORTER.includes('if(window.__pixosOwnErrors){return;}'), true);
const explorer = fs.readFileSync(new URL('apps/explorer/index.html', root), 'utf8');
check('and Explorer does', /window\.__pixosOwnErrors = true;/.test(explorer), true);

// --- when it is not injected ------------------------------------------------------------
//
// The objection to rewriting a served document is that something reads it as data. Nothing
// does today — installs, hashes and `pixos_supported` reads all fetch files, not pages —
// and restricting this to navigations is what keeps it true whatever is added later.
check('only a document on its way into a frame is rewritten',
	/contentType === 'text\/html' && request\.mode === 'navigate'/.test(sw), true);
check('and the length is recomputed rather than left describing the file on disk',
	/Content-Length': String\(injected\.byteLength\)/.test(sw), true);

// --- the shell end of it -------------------------------------------------------------------

const shell = fs.readFileSync(new URL('index.html', root), 'utf8');
check('the shell has somewhere for those reports to arrive',
	/window\.__pixosAppError = function/.test(shell), true);
// An app picks its own name, so what it says goes in the title as content and `source`
// stays PixOS — the same rule a peer's label follows.
check('and an app cannot borrow the system’s voice with it',
	/title: name \+ ' hit an error'[\s\S]{0,120}source: 'PixOS'/.test(shell), true);
check('a report is matched to its app by folder, not by entry file',
	/\/\\\/apps\\\/\(\[\^\/\]\+\)\\\//.test(shell), true);

process.exit(report('app-errors') ? 1 : 0);
