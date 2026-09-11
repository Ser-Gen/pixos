// Turning a failure into a sentence.
//
// `fetch` reports a CORS block, an extension block and a dead network identically:
// `TypeError: Failed to fetch`, no status, no detail. That is deliberate on the browser's
// part and cannot be worked around, so the job here is to narrow it honestly with what is
// observable — and to say what is still ambiguous rather than pick one and sound certain.

import {describeFetchFailure, describeError, isCrossOrigin, describeWriteLimit, formatBytes, MAX_FILE_BYTES, describeSeedFailure, describeBootFallback} from '../js/shell/failure.js';
import fs from 'node:fs';
import {check, report} from './assert.mjs';

const ORIGIN = 'http://localhost:8000';
const typeError = () => Object.assign(new TypeError('Failed to fetch'), {name: 'TypeError'});

// --- an answer arrived, and it was a refusal --------------------------------------------

const http = (status, statusText) => describeFetchFailure({
	context: 'Could not download that file',
	url: 'https://example.com/a.zip',
	response: {ok: false, status: status, statusText: statusText || ''},
	online: true,
	pageOrigin: ORIGIN
});

check('the context becomes the title', http(404).title, 'Could not download that file');
check('404 says what a 404 means', http(404).message,
	'The server says there is nothing at that address (404).');
check('404 is classified', http(404).reason, 'http');
check('403 points at the sign-in PixOS cannot do',
	http(403).message.includes('sign-in that PixOS cannot provide'), true);
check('401 is the same case', http(401).reason, 'http');
check('429 names rate limiting', http(429).message.includes('rate-limiting'), true);
check('500 blames the server, not you', http(500, 'Internal Server Error').message,
	'The server failed on its end (500 Internal Server Error).');
check('503 too', http(503).message.includes('failed on its end'), true);
check('an unusual status is still reported exactly', http(418, "I'm a teapot").message,
	"The server answered with 418 I'm a teapot.");

// --- nothing arrived: the ambiguous case ---------------------------------------------------

const dead = (url, online) => describeFetchFailure({
	context: 'Could not download that file',
	url: url,
	error: typeError(),
	online: online === undefined ? true : online,
	pageOrigin: ORIGIN
});

check('offline is the one certain answer, and outranks the rest',
	dead('https://example.com/a.zip', false).reason, 'offline');
check('and says the request never left', dead('https://example.com/a.zip', false).message,
	'You are offline, so the request never left the browser.');

const cors = dead('https://example.com/a.zip');
check('a cross-origin failure is most likely CORS', cors.reason, 'cors');
// The honesty requirement: never claim CORS as fact when the browser refuses to say.
check('but it does not claim to know', cors.message.includes('no way to tell that apart'), true);
check('and offers a way to find out', cors.message.includes('browser tab'), true);

check('a same-origin failure is not blamed on CORS', dead(ORIGIN + '/a.zip').reason, 'network');
check('a relative url is same-origin', dead('/__browserfs__/a.zip').reason, 'network');

check('a cancelled request is not an error to explain',
	describeFetchFailure({error: Object.assign(new Error('x'), {name: 'AbortError'}), online: true}).reason,
	'abort');

// Firefox and Safari word it differently; the classification must not depend on Chrome.
check('Firefox wording is recognised', describeFetchFailure({
	url: 'https://example.com/a', error: new Error('NetworkError when attempting to fetch resource.'),
	online: true, pageOrigin: ORIGIN
}).reason, 'cors');
check('Safari wording is recognised', describeFetchFailure({
	url: 'https://example.com/a', error: new Error('Load failed'),
	online: true, pageOrigin: ORIGIN
}).reason, 'cors');

check('anything else is passed through verbatim rather than guessed at',
	describeFetchFailure({error: new Error('something odd'), online: true}).message, 'something odd');
check('and marked as unclassified', describeFetchFailure({error: new Error('x')}).reason, 'unknown');
check('no arguments at all does not throw', typeof describeFetchFailure().message, 'string');
check('and gets a usable title', describeFetchFailure().title, 'Request failed');

// --- origins ---------------------------------------------------------------------------

check('a different host is cross-origin', isCrossOrigin('https://example.com/a', ORIGIN), true);
check('the same origin is not', isCrossOrigin(ORIGIN + '/a', ORIGIN), false);
check('a relative path is not', isCrossOrigin('/a/b', ORIGIN), false);
check('a different port is', isCrossOrigin('http://localhost:9000/a', ORIGIN), true);
check('http vs https is', isCrossOrigin('https://localhost:8000/a', ORIGIN), true);
check('nonsense is not treated as a policy problem', isCrossOrigin('::::', ORIGIN), false);

// --- filesystem errors, which speak in errno ---------------------------------------------

const fsError = code => describeError('Rename failed', Object.assign(new Error('raw'), {code: code}));

check('the context is kept', fsError('ENOENT').title, 'Rename failed');
check('ENOENT is translated', fsError('ENOENT').message, 'That file or folder no longer exists.');
check('EEXIST is translated', fsError('EEXIST').message, 'Something with that name is already there.');
check('ENOTEMPTY is translated', fsError('ENOTEMPTY').message, 'That folder is not empty.');
check('ENOSPC is translated', fsError('ENOSPC').message, 'There is no storage space left.');
check('the code is reported', fsError('EISDIR').reason, 'EISDIR');
check('an unknown code falls back to the message', fsError('EWEIRD').message, 'raw');
check('an error with no code falls back too', describeError('X', new Error('boom')).message, 'boom');

// BrowserFS does not always set .code -- some errors carry the errno only in the message,
// which is how a raw "ENOENT: No such file or directory." reached the screen.
const raw = describeError('Rename failed', new Error("ENOENT: No such file or directory., '/image.png'"));
check('an errno in the message is read too', raw.reason, 'ENOENT');
check('and translated', raw.message.startsWith('That file or folder no longer exists.'), true);
check('keeping the path, which is the useful half', raw.message.includes('/image.png'), true);
check('an errno-looking message with no known code is left alone',
	describeError('X', new Error('EWHATEVER: something')).message, 'EWHATEVER: something');
check('a message that merely starts with capitals is not mistaken for an errno',
	describeError('X', new Error('FATAL error occurred')).reason, 'unknown');
// Installing or updating an app is a fetch underneath, and a failed one arrives as an
// exception rather than a Response -- so it lands here, not in describeFetchFailure, and
// used to be shown as the raw "TypeError: Failed to fetch" in a modal.
const install = online => describeError('Could not install monaco', typeError(), {online: online});
check('a failed fetch reaching describeError is classified', install(true).reason, 'network');
check('and explained', install(true).message.includes('could not be fetched'), true);
check('offline is said plainly', install(false).message,
	'You are offline, so the request never left the browser.');
check('and classified', install(false).reason, 'offline');
check('the context survives it', install(false).title, 'Could not install monaco');
check('with no options at all it does not claim to know you are offline',
	describeError('X', typeError()).reason, 'network');
// A TypeError is the most common kind of ordinary bug there is. Only the wording matches.
check('an unrelated TypeError is not dressed up as a network problem',
	describeError('X', new TypeError('x.map is not a function')).reason, 'unknown');
check('and is passed through verbatim',
	describeError('X', new TypeError('x.map is not a function')).message, 'x.map is not a function');

check('a thrown string does not throw again', describeError('X', 'just a string').message, 'just a string');
check('undefined does not throw', describeError('X', undefined).message, 'Unknown error');
check('and there is always a title', describeError(null, new Error('b')).title, 'Something went wrong');

// --- a write the browser will refuse -------------------------------------------------------
//
// BrowserFS's IndexedDB backend translates a *synchronous* failure properly — a
// QuotaExceededError becomes ENOSPC — but an asynchronous one goes through a handler that
// ignores `request.error` entirely and reports a bare EIO. So by the time a failed write
// comes back there is nothing left to explain with, and the only honest place to answer is
// before it.

check('a dropped file the browser will not keep whole is refused before it is read',
	describeWriteLimit(MAX_FILE_BYTES + 1, null).reason, 'too-large');
check('and the sentence says the size and the ceiling, not an errno',
	/143 MB[\s\S]*128 MB/.test(describeWriteLimit(150 * 1000 * 1000, null).message), true);
check('and says nothing was written, because nothing was',
	/Nothing was written/.test(describeWriteLimit(MAX_FILE_BYTES + 1, null).message), true);
check('one exactly at the ceiling is allowed through',
	describeWriteLimit(MAX_FILE_BYTES, null), null);
check('an ordinary file is not stopped', describeWriteLimit(4096, null), null);
check('nor is one of no size at all', describeWriteLimit(0, null), null);
check('and a size that is not a number does not become a refusal',
	describeWriteLimit('big', null), null);

// The estimate is the browser's own answer passed in, never read here.
const room = (quota, usage) => ({quota: quota, usage: usage});
check('a file with no room left for it is refused, and separately',
	describeWriteLimit(50 * 1024 * 1024, room(100 * 1024 * 1024, 80 * 1024 * 1024)).reason,
	'no-room');
check('the refusal counts what is free rather than what is used',
	/20 MB free of 100 MB/.test(
		describeWriteLimit(50 * 1024 * 1024, room(100 * 1024 * 1024, 80 * 1024 * 1024)).message),
	true);
check('one that fits is written', describeWriteLimit(10 * 1024 * 1024, room(100 * 1024 * 1024, 80 * 1024 * 1024)), null);
// Not every browser answers estimate(), and a check that refused to run without one would
// stop every write on Safari rather than the one that was going to fail anyway.
check('a browser that will not estimate does not block the write',
	describeWriteLimit(10 * 1024 * 1024, {}), null);
check('nor does one that answers with nonsense',
	describeWriteLimit(10 * 1024 * 1024, room('lots', 0)), null);
check('and the certain case is still caught without an estimate',
	describeWriteLimit(MAX_FILE_BYTES + 1, {}).reason, 'too-large');

check('bytes read as bytes', formatBytes(512), '512 B');
check('and megabytes as megabytes', formatBytes(150 * 1024 * 1024), '150 MB');
check('with one decimal where it matters', formatBytes(1536), '1.5 KB');

// EIO is what every refused IndexedDB write arrives as, and it was reaching the screen as
// "Input/output error" — which tells nobody anything at all.
check('an EIO is not left reading as an errno',
	describeError('Could not add that file', {code: 'EIO', message: 'EIO: Input/output error.'}).reason,
	'EIO');
check('and says which two things it nearly always is',
	/too large[\s\S]*no room left/.test(
		describeError('X', {code: 'EIO', message: 'EIO: Input/output error.'}).message),
	true);

// The path a 150 MB drop actually takes, which no unit test can drive: it is the order of
// these three that matters, so it is checked in the source.
const explorer = fs.readFileSync(new URL('../apps/explorer/index.html', import.meta.url), 'utf8');
check('a file is measured before it is read into memory',
	/refuseOversizedFile\(file\)[\s\S]{0,120}return;[\s\S]{0,600}fileToAB\(file\)/.test(explorer), true);
check('a failed write leaves nothing behind',
	/catch \(err\) \{\s*await unlinkQuietly\(destPath\);\s*throw err;/.test(explorer), true);
// This one was the worse half: the old order deleted the file being replaced and then
// wrote over the name, so a write that failed took the original with it.
check('replacing a file writes somewhere else first',
	/writeFile\(staging, contents\)[\s\S]{0,200}await unlink\(destPath\);\s*await fsRename\(staging, destPath\)/.test(explorer),
	true);
// `fileToAB` moved into apps/explorer/js/fs-helpers.js in phase 21. The check follows it
// rather than being dropped: a reader with no onerror is a promise that never settles, and
// the drop waiting on it never finishes and never reports.
const explorerFs = fs.readFileSync(
	new URL('../apps/explorer/js/fs-helpers.js', import.meta.url), 'utf8');
check('and a FileReader that fails rejects rather than hanging for ever',
	/reader\.onerror = function \(\) \{\s*reject\(/.test(explorerFs), true);
check('every route a file arrives by reports per file rather than abandoning the rest',
	explorer.split('await addIncomingFile(').length - 1, 5);


// --- a boot that did not get what it asked for -------------------------------------------
//
// A server missing two files in `templates/` produced a PixOS with no `/home` folder --
// nothing else creates that directory -- and said so only in the console.

check('nothing failed, nothing to say', describeSeedFailure([]), null);
check('and an absent list is not a failure either', describeSeedFailure(undefined), null);

const seeds = describeSeedFailure([
	{path: '/home/about.md', from: '/templates/about.md', error: new Error('404 Not Found')},
	{path: '/home/talk.deck.md', from: '/templates/talk.deck.md', error: new Error('404 Not Found')}
]);
check('the count is in the title', seeds.title, '2 starter files are missing');
check('the file you will find missing is named', seeds.message.includes('/home/about.md'), true);
// The other half of the sentence, and the actionable one: whoever reads this note is
// usually the person who deployed the server the file is not on.
check('so is the file to put on the server', seeds.message.includes('/templates/about.md'), true);
check('one shared reason is stated once', seeds.message.split('404 Not Found').length - 1, 1);
check('and the retry is promised, because it is real',
	/next boot will try again/.test(seeds.message), true);

const oneSeed = describeSeedFailure([{path: '/home/about.md', from: '/templates/about.md'}]);
check('one failure reads as one', oneSeed.title, 'A starter file is missing');
check('and says nothing about a reason it does not have',
	/did not return it\. Nothing/.test(oneSeed.message), true);

const mixed = describeSeedFailure([
	{path: '/a', from: '/t/a', error: new Error('404 Not Found')},
	{path: '/b', from: '/t/b', error: new Error('Failed to fetch')}
]);
check('two different reasons are not passed off as one',
	/did not return them\. Nothing/.test(mixed.message), true);

// The fallback is Explorer, App Manager and the registry. A system on it looks like a
// working PixOS somebody emptied, which is exactly the thing that has to be said out loud.
const fallback = describeBootFallback(new Error('404 Not Found'));
check('the fallback names the file that was unreachable',
	fallback.message.includes('settings/preinstall.json'), true);
check('and the status it answered with', fallback.message.includes('404 Not Found'), true);
check('and what is consequently not there',
	/no apps were installed and no starter files were created/.test(fallback.message), true);
check('a fallback with no error still produces a sentence',
	describeBootFallback(null).message.includes('()'), false);

// Both are raised from the boot chain in index.html, which no unit test can drive.
const shell = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
check('a failed seed reaches the screen',
	/describeSeedFailure\(failures\)[\s\S]{0,120}notifications\.notify\(/.test(shell), true);
check('one note for the lot, raised after the loop',
	/failures\.push\(\{path: entry\.path[\s\S]{0,600}describeSeedFailure/.test(shell), true);
check('and so does a boot that fell back to the built-in minimum',
	/describeBootFallback\(err\)[\s\S]{0,140}notifications\.notify\(/.test(shell), true);

process.exit(report('failure') ? 1 : 0);
