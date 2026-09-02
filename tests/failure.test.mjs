// Turning a failure into a sentence.
//
// `fetch` reports a CORS block, an extension block and a dead network identically:
// `TypeError: Failed to fetch`, no status, no detail. That is deliberate on the browser's
// part and cannot be worked around, so the job here is to narrow it honestly with what is
// observable — and to say what is still ambiguous rather than pick one and sound certain.

import {describeFetchFailure, describeError, isCrossOrigin} from '../js/shell/failure.js';
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

process.exit(report('failure') ? 1 : 0);
