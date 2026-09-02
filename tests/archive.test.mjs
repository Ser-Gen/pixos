// Archives: what 7-Zip's output means, and then the whole path through the real engine.
//
// The first half is pure and is the part that matters most. 7-Zip reports a wrong
// password and a truncated file identically as far as the exit code goes — both are 2 —
// and those two send you to completely different next steps. So the classification is
// made from what it actually printed, and the strings below are recorded verbatim from
// 7-Zip 25.01 rather than written from memory.
//
// The second half loads the vendored engine and runs real archives through the real
// wrapper. It is slower than everything else in the suite (a WebAssembly instance per
// command, which is the engine's own rule) and it is worth it: every earlier version of
// this integration was broken in a way no unit test would have caught.

import fs from 'fs';
import {createRequire} from 'module';
import {check, report} from './assert.mjs';
import * as parse from '../apps/7z/js/parse.js';

// --- which files are offered to it -----------------------------------------------------

check('a zip is an archive', parse.isArchiveName('holiday.zip'), true);
check('so is a 7z', parse.isArchiveName('backup.7z'), true);
check('and a rar, which the old integration never offered', parse.isArchiveName('scans.rar'), true);
check('and a tarball', parse.isArchiveName('src.tar.gz'), true);
check('and the short spelling of one', parse.isArchiveName('src.tgz'), true);
check('an .iso is one too — it is a container 7-Zip reads',
	parse.isArchiveName('disc.iso'), true);
check('a text file is not', parse.isArchiveName('notes.txt'), false);
check('nor is something with no extension at all', parse.isArchiveName('Makefile'), false);
check('the check is case-insensitive, because Windows names are',
	parse.isArchiveName('PHOTOS.ZIP'), true);

check('a tarball is two archives and says so', parse.isTarball('src.tar.gz'), true);
check('a plain tar is only one', parse.isTarball('src.tar'), false);
check('and a zip is never one', parse.isTarball('src.zip'), false);

// --- where the contents go ----------------------------------------------------------------

check('both extensions come off a tarball', parse.baseNameFor('holiday.tar.gz'), 'holiday');
check('and one off everything else', parse.baseNameFor('holiday.zip'), 'holiday');
check('a name with dots in it keeps them', parse.baseNameFor('v1.2.3.zip'), 'v1.2.3');

const taken = names => name => names.includes(name);
check('the folder is named after the archive',
	parse.destinationFor('holiday.zip', taken([])), 'holiday');
// Extracting the same archive twice is ordinary, and merging into a folder somebody has
// since put their own files in cannot be undone.
check('a name already in use is not written over',
	parse.destinationFor('holiday.zip', taken(['holiday'])), 'holiday-2');
check('and it keeps counting', parse.destinationFor('holiday.zip',
	taken(['holiday', 'holiday-2', 'holiday-3'])), 'holiday-4');

// --- the arguments ------------------------------------------------------------------------

// -p is the one that bites: without it 7-Zip asks for a password on stdin, there is no
// stdin, and the extraction hangs for ever with no output and no exit.
check('a password is always passed, empty when there is none',
	parse.extractArgs({}).includes('-p'), true);
check('and carries the password when there is one',
	parse.extractArgs({password: 'hunter2'}).includes('-phunter2'), true);
check('prompts are answered', parse.extractArgs({}).includes('-y'), true);
check('and the progress redraw is off, or the output is unreadable',
	parse.extractArgs({}).includes('-bd'), true);
check('a subset comes in through a list file, never on the command line — a path with a '
	+ 'space or a wildcard in it is otherwise 7-Zip\'s to misread',
	parse.extractArgs({listFile: '/in/sel.txt'}).slice(-2), ['-scsUTF-8', '@/in/sel.txt']);
check('listing asks for the parseable form', parse.listArgs({}).slice(0, 2), ['l', '-slt']);

// --- reading a listing ------------------------------------------------------------------------

const LISTING = `
7-Zip (z) 25.01 (LE) : Copyright (c) 1999-2025 Igor Pavlov : 2025-08-03

Listing archive: /in/archive

--
Path = /in/archive
Type = zip
Physical Size = 609

----------
Path = b.txt
Folder = -
Size = 12
Packed Size = 12
Modified = 2026-08-29 16:13:53
Attributes =  -rw-r--r--
Encrypted = -
CRC = E472FF82
Method = Store

Path = sub
Folder = +
Size = 0
Packed Size = 0
Modified = 2026-08-29 16:13:53
Attributes = D drwxr-xr-x
Encrypted = -
Method = Store

Path = sub/c.txt
Folder = -
Size = 5
Packed Size = 17
Modified = 2026-08-29 16:13:53
Attributes =  -rw-r--r--
Encrypted = +
CRC = 279EB882
Method = ZipCrypto Store
`;

const entries = parse.parseListing(LISTING);
check('every entry is found', entries.map(e => e.path), ['b.txt', 'sub', 'sub/c.txt']);
// The block before `----------` describes the archive itself and has a Path of its own.
check('and the archive is not listed as one of its own contents',
	entries.some(e => e.path === '/in/archive'), false);
check('sizes are numbers', entries[0].size, 12);
check('a folder is marked as one', entries.map(e => e.isDirectory), [false, true, false]);
check('an encrypted member is marked', entries[2].encrypted, true);
check('and the listing as a whole says so', parse.isEncryptedListing(entries), true);
check('a listing with nothing encrypted does not',
	parse.isEncryptedListing(entries.slice(0, 2)), false);
check('the method is kept — it is how you find out why something will not open',
	entries[2].method, 'ZipCrypto Store');
check('output with no entries at all is not an error', parse.parseListing('nothing here'), []);

// --- what a failure means ---------------------------------------------------------------------

// Recorded from the engine, one case at a time.
const WRONG_PASSWORD = {code: 2, stderr: [
	'ERROR: Wrong password : b.txt', 'ERROR: Wrong password : sub/c.txt']};
const HEADER_PASSWORD = {code: 2, stderr: [
	'ERROR: /in/archive : Cannot open encrypted archive. Wrong password?']};
const TRUNCATED = {code: 2, stdout: ['Type = zip', 'ERRORS:', 'Unexpected end of archive'],
	stderr: ['', 'ERRORS:', 'Unexpected end of archive']};
const NOT_ARCHIVE = {code: 2, stdout: ["Can't open as archive: 1"],
	stderr: ['ERROR: /in/archive', 'Cannot open the file as archive']};
const OK = {code: 0, stdout: ['Everything is Ok', 'Folders: 1', 'Files: 3']};

check('a password given that did not work says exactly that',
	parse.classify(Object.assign({hadPassword: true}, WRONG_PASSWORD)).kind, 'password');
// 7-Zip cannot tell the two apart — both come back as `Wrong password` — so the caller's
// own knowledge is what makes the sentence right.
check('and no password given asks for one instead',
	parse.classify(Object.assign({hadPassword: false}, WRONG_PASSWORD)).kind, 'password-needed');
check('the wording follows',
	parse.classify(Object.assign({hadPassword: false}, WRONG_PASSWORD)).title,
	'This archive needs a password');
check('an archive whose headers are encrypted is the same question',
	parse.classify(Object.assign({hadPassword: false}, HEADER_PASSWORD)).kind, 'password-needed');
check('and with a password that failed, the same answer',
	parse.classify(Object.assign({hadPassword: true}, HEADER_PASSWORD)).kind, 'password');

// The distinction the whole file exists for: same exit code, different next step.
check('a truncated archive is damaged, not locked',
	parse.classify(TRUNCATED).kind, 'corrupt');
check('and is described in terms of what is wrong with it',
	parse.classify(TRUNCATED).message.startsWith('It stops in the middle'), true);
check('a file that is not an archive says so rather than blaming the archive',
	parse.classify(NOT_ARCHIVE).kind, 'unsupported');
check('and does not blame the extension either',
	parse.classify(NOT_ARCHIVE).message.includes('The extension is not what decides it'), true);
check('a checksum failure is damage', parse.classify({code: 2,
	stderr: ['ERROR: CRC Failed : a.txt']}).kind, 'corrupt');
check('with its own sentence', parse.classify({code: 2,
	stderr: ['ERROR: CRC Failed : a.txt']}).message.startsWith('A file inside it fails'), true);

check('success is success', parse.classify(OK).kind, 'ok');
// `Everything is Ok` is printed when 7-Zip finishes a *job*. Listing is not one, and
// demanding the line there rejected every successful listing there has ever been.
check('a listing that exits cleanly has worked, with no such line to look for',
	parse.classify({code: 0, stdout: ['Listing archive: /in/archive'], expect: 'listing'}).kind, 'ok');
check('but a listing that failed still fails',
	parse.classify(Object.assign({expect: 'listing'}, NOT_ARCHIVE)).kind, 'unsupported');
// Exit code 0 with nothing extracted is how this used to fail silently.
check('but an exit code of zero is not enough on its own',
	parse.classify({code: 0, stdout: ['Scanning the drive for archives:']}).kind, 'failed');
check('a warning keeps what was extracted and says the rest is missing',
	parse.classify({code: 1, stdout: ['Everything is Ok'], stderr: ['ERROR: Can not open output file']}).kind,
	'partial');
check('running out of memory is its own answer, not "damaged"',
	parse.classify({code: 8, stdout: []}).kind, 'memory');
check('and an unexplained stop still says what 7-Zip last said',
	parse.classify({code: 2, stderr: ['ERROR: something nobody has seen before']}).message,
	'something nobody has seen before');
check('with nothing to go on it admits that rather than inventing a reason',
	parse.classify({code: 5, stdout: [], stderr: []}).message.includes('said nothing'), true);

// --- the real engine ----------------------------------------------------------------------------

// The vendored bundle is a UMD script that assigns a global, and `archive.js` loads it by
// appending a <script>. Here the global is put in place first, so the loader finds it and
// appends nothing — the same short-circuit a second archive takes in a real session.
const require = createRequire(import.meta.url);
globalThis.window = {JS7z: require('../apps/7z/vendor/js7z.js')};
globalThis.document = {createElement: () => ({}), head: {appendChild () {}}};

const archive = await import('../apps/7z/js/archive.js');
const fixture = name => new Uint8Array(fs.readFileSync(new URL('./fixtures/' + name, import.meta.url)));
const text = data => Buffer.from(data).toString().trim();

let listed = await archive.inspect(fixture('plain.zip'), {name: 'plain.zip'});
check('a real archive lists its contents', listed.entries.map(e => e.path).sort(),
	['a.txt', 'b.txt', 'sub', 'sub/c.txt']);
check('and nothing was written anywhere to find that out', listed.failure, null);
check('it is not encrypted', listed.encrypted, false);

// An archive with encrypted *headers* cannot be listed at all without the password: the
// table of contents is inside the encryption. Asking is the only move.
listed = await archive.inspect(fixture('secret.7z'), {name: 'secret.7z'});
check('an archive with encrypted headers asks rather than failing', listed.needsPassword, true);
check('and says why', listed.failure.title, 'This archive needs a password');
listed = await archive.inspect(fixture('secret.7z'), {name: 'secret.7z', password: 'secret'});
check('with the password it opens', listed.entries.map(e => e.path).sort(), ['in', 'in/a.txt', 'in/b.txt']);

// A .tar.gz lists one entry — the tar — which is true and useless.
listed = await archive.inspect(fixture('bundle.tar.gz'), {name: 'bundle.tar.gz'});
check('a tarball is opened to its real contents', listed.entries.map(e => e.path).sort(),
	['in', 'in/a.txt', 'in/sub', 'in/sub/c.txt']);
check('and says it had to go through a wrapper to do it', listed.unwrapped, true);

let out = await archive.extract(fixture('plain.zip'), {name: 'plain.zip'});
check('extracting gives back every file', out.files.map(f => f.path).sort(),
	['a.txt', 'b.txt', 'sub/c.txt']);
check('with their contents intact',
	text(out.files.find(f => f.path === 'sub/c.txt').data), 'deep');
check('and the folders, so an empty one is not lost', out.dirs, ['sub']);

out = await archive.extract(fixture('plain.zip'), {name: 'plain.zip', paths: ['sub/c.txt']});
check('a subset gives back only what was asked for', out.files.map(f => f.path), ['sub/c.txt']);

out = await archive.extract(fixture('bundle.tar.gz'), {name: 'bundle.tar.gz'});
check('a tarball comes out in one step, not as a tar to open again',
	out.files.map(f => f.path).sort(), ['in/a.txt', 'in/sub/c.txt']);

out = await archive.extract(fixture('locked.zip'), {name: 'locked.zip', password: 'secret'});
check('the right password extracts', out.files.map(f => f.path).sort(),
	['a.txt', 'b.txt', 'sub/c.txt']);
check('and the contents are real, not the garbage a wrong key would produce',
	text(out.files.find(f => f.path === 'a.txt').data), 'hello world');

async function fails (bytes, options) {
	try {
		await archive.extract(bytes, options);
		return 'no error';
	}
	catch (err) {
		return err.failure ? err.failure.kind : err.message;
	}
}

check('a locked archive with no password refuses',
	await fails(fixture('locked.zip'), {name: 'locked.zip'}), 'password-needed');
check('and with the wrong one, refuses differently',
	await fails(fixture('locked.zip'), {name: 'locked.zip', password: 'nope'}), 'password');

// 7-Zip leaves files in its output folder even when it fails — truncated, or full of what
// a wrong password decrypted to. Writing those into somebody's folder would be worse than
// the failure, so nothing is read back unless the run actually succeeded.
const truncated = fixture('plain.zip').slice(0, 300);
check('a truncated archive is reported as damaged',
	await fails(truncated, {name: 'plain.zip'}), 'corrupt');
const garbage = new Uint8Array(400).map((_, i) => (i * 37) % 251);
check('and something that is not an archive says so',
	await fails(garbage, {name: 'notes.zip'}), 'unsupported');

// --- making archives ------------------------------------------------------------------

// Three formats, three presets. Everything else 7-Zip exposes — dictionary size, solid
// blocks, thread count — is a dialog that has to explain itself, and none of it changes
// the answer for somebody compressing a folder in a file manager.
check('the formats offered', parse.FORMATS.map(f => f.id), ['7z', 'zip', 'tar.gz']);
check('and only two of them can hold a password', parse.FORMATS.map(f => f.password),
	[true, true, false]);
check('only 7z can hide the file names as well as the contents',
	parse.FORMATS.map(f => f.encryptNames), [true, false, false]);
check('the presets are levels, not adjectives', parse.PRESETS.map(p => p.level), [0, 5, 9]);
check('an unknown format falls back rather than throwing', parse.formatFor('rar').id, '7z');
check('and an unknown preset lands on the middle one', parse.presetFor('turbo').level, 5);

check('one item is named after itself',
	parse.archiveNameFor([{name: 'notes', isDirectory: true}], '7z'), 'notes.7z');
check('a file loses its own extension first',
	parse.archiveNameFor([{name: 'report.pdf'}], 'zip'), 'report.zip');
// Several files have nothing in common but where they are, so that is what names it.
check('several take the folder they are in',
	parse.archiveNameFor([{name: 'a'}, {name: 'b'}], 'tar.gz', 'photos'), 'photos.tar.gz');
check('and fall back to something rather than nothing',
	parse.archiveNameFor([{name: 'a'}, {name: 'b'}], '7z', ''), 'archive.7z');

// 7-Zip does not replace an archive it is given the name of — it tries to *add* to it,
// and on anything that is not already an archive of that type it stops with "Is not
// archive". A free name is a requirement here, not a courtesy.
check('a free name is used as it is', parse.uniqueName('notes', '7z', () => false), 'notes.7z');
check('and a taken one steps aside',
	parse.uniqueName('notes', '7z', n => n === 'notes.7z'), 'notes-2.7z');
check('switching format re-extends the name it had',
	parse.stripExtension('holiday.tar.gz', 'tar.gz') + '.7z', 'holiday.7z');

let steps = parse.compressSteps({name: 'notes.7z', format: '7z', preset: 'best'});
check('one format, one run', steps.length, 1);
check('the level is the preset', steps[0].args.includes('-mx9'), true);
check('prompts are answered here too', steps[0].args.includes('-y'), true);
check('and no password is passed when none was given',
	steps[0].args.some(a => a.startsWith('-p')), false);

steps = parse.compressSteps({name: 'notes.zip', format: 'zip', preset: 'normal', password: 'hunter2'});
check('a zip password is AES-256, not the old zip encryption which is recoverable '
	+ 'without it', steps[0].args.includes('-mem=AES256'), true);
check('and the password goes with it', steps[0].args.includes('-phunter2'), true);

steps = parse.compressSteps({name: 'notes.7z', format: '7z', preset: 'normal',
	password: 'hunter2', encryptNames: true});
check('7z can hide the names too, when asked', steps[0].args.includes('-mhe=on'), true);
check('and does not when not asked',
	parse.compressSteps({name: 'n.7z', format: '7z', password: 'x'})[0].args.includes('-mhe=on'),
	false);

// A password typed before switching to tar.gz must not silently produce an unprotected
// archive that looks protected. The format cannot hold one, so it never reaches 7-Zip.
steps = parse.compressSteps({name: 'src.tar.gz', format: 'tar.gz', preset: 'best', password: 'x'});
check('a tarball is two runs — tar has no compression, gzip has no notion of two files',
	steps.length, 2);
check('the first makes the tar, with no level pretending to apply to it',
	steps[0].args.some(a => a.startsWith('-mx')), false);
check('the second compresses it', steps[1].args.includes('-mx9'), true);
check('and it is fed the first one\'s output', steps[1].fromPrevious, true);
check('the tar inside is named after the archive, not left as a stray',
	steps[0].name, 'src.tar');
check('no password reaches either run', steps.some(s => s.args.some(a => a.startsWith('-p'))), false);

// --- and the round trip, through the real engine ----------------------------------------
//
// The only test that proves any of it: make an archive, then open it with the same engine
// and compare what comes back. Everything else here is a claim about arguments.

const SOURCE = {
	files: [
		{path: 'a.txt', data: new TextEncoder().encode('hello world\n')},
		{path: 'notes/deep file.md', data: new TextEncoder().encode('# deep\n')}
	],
	dirs: ['notes', 'empty']
};

async function roundTrip (options) {
	const made = await archive.compress(Object.assign({}, SOURCE, options));
	return archive.extract(made.data, {name: made.name, password: options.password});
}

let back = await roundTrip({name: 'made.7z', format: '7z', preset: 'normal'});
check('a 7z comes back with everything that went in',
	back.files.map(f => f.path).sort(), ['a.txt', 'notes/deep file.md']);
check('byte for byte', text(back.files.find(f => f.path === 'a.txt').data), 'hello world');
// A name with a space in it is why the file list goes through a list file rather than the
// command line.
check('a name with a space in it survives',
	text(back.files.find(f => f.path === 'notes/deep file.md').data), '# deep');
check('and an empty folder is still there', back.dirs.includes('empty'), true);

back = await roundTrip({name: 'made.zip', format: 'zip', preset: 'store'});
check('a stored zip round-trips', back.files.map(f => f.path).sort(),
	['a.txt', 'notes/deep file.md']);

back = await roundTrip({name: 'made.tar.gz', format: 'tar.gz', preset: 'best'});
check('a tarball round-trips through both of its layers',
	back.files.map(f => f.path).sort(), ['a.txt', 'notes/deep file.md']);

const locked = await archive.compress(Object.assign({}, SOURCE,
	{name: 'locked.7z', format: '7z', preset: 'normal', password: 'secret', encryptNames: true}));
check('an archive with hidden names cannot even be listed without the password',
	(await archive.inspect(locked.data, {name: 'locked.7z'})).needsPassword, true);
const opened = await archive.extract(locked.data, {name: 'locked.7z', password: 'secret'});
check('and opens with it', opened.files.map(f => f.path).sort(), ['a.txt', 'notes/deep file.md']);
check('the wrong password does not', await fails(locked.data,
	{name: 'locked.7z', password: 'nope'}), 'password');

// Selecting nothing is a mistake, not an empty archive.
try {
	await archive.compress({name: 'empty.7z', format: '7z', files: [], dirs: []});
	check('compressing nothing is refused', 'no error', 'refused');
}
catch (err) {
	check('compressing nothing is refused', err.failure.kind, 'empty');
}

process.exit(report('archive') ? 1 : 0);
