// The peer session, apart from the network.
//
// Almost everything worth getting right here is a rule about data that arrived from
// somebody else's machine, and none of it needs a connection to check: what a message may
// be, what a file may be called, what an id looks like, what is remembered and what is
// not. The sharing code this replaces took an HTML document over the wire and
// `new Function`'d it, so the closed message list below is the whole security argument of
// the feature and it is checked first.

import fs from 'node:fs';
import * as peers from '../js/shell/peers.js';
import {check, report} from './assert.mjs';

// --- the wire is a closed list ---------------------------------------------------------

check('a message that is not one of ours is not a message',
	peers.parseMessage({type: 'eval', code: 'doom()'}), null);
check('nor is one with no type', peers.parseMessage({name: 'x'}), null);
check('nor a string', peers.parseMessage('hello'), null);
check('nor null', peers.parseMessage(null), null);
check('and a known type with the wrong shape is refused too',
	peers.parseMessage({type: 'ping', at: 'now'}), null);
check('including one that is nearly right',
	peers.parseMessage({type: 'file-offer', name: 'a.txt'}), null);

check('a ping carries only a timestamp',
	peers.parseMessage({type: 'ping', at: 42, extra: 'ignored'}), {type: 'ping', at: 42});
check('a hello carries only a name',
	peers.parseMessage({type: 'hello', name: 'Laptop', run: 'x'}), {type: 'hello', name: 'Laptop'});
check('a nameless hello still says who it is, rather than nothing',
	peers.parseMessage({type: 'hello'}).name, 'Someone');

// A name is drawn on screen. Control characters in one are how a remote machine would draw
// over the panel that is supposed to be reporting it.
check('a name loses its control characters',
	peers.cleanName('Laptop\u0007\u001b[31m of mine'), 'Laptop [31m of mine');
check('and its length', peers.cleanName('x'.repeat(200)).length, 40);
check('an empty name falls back rather than rendering as nothing',
	peers.cleanName('   '), 'Someone');

const offered = peers.parseMessage({type: 'file-offer', id: 't1', name: 'notes.md', size: 12});
check('a file offer is a name and a size', offered.name + ' ' + offered.size, 'notes.md 12');
check('a file bigger than the ceiling is refused before a byte arrives',
	peers.parseMessage({type: 'file-offer', id: 't1', name: 'a', size: peers.MAX_FILE_SIZE + 1}), null);
check('and so is a negative one',
	peers.parseMessage({type: 'file-offer', id: 't1', name: 'a', size: -1}), null);
check('an id that is not a token is refused',
	peers.parseMessage({type: 'file-accept', id: '../../etc'}), null);

// --- a name from another machine is a path waiting to happen ----------------------------

check('a file name keeps only its last segment',
	peers.fileName('../../etc/passwd'), 'passwd');
check('backslashes are separators too, whatever this filesystem thinks',
	peers.fileName('C:\\Windows\\system32\\evil.dll'), 'evil.dll');
check('a name cannot start with a dot and hide',
	peers.fileName('...hidden'), 'hidden');
check('a name that is only separators is not a name', peers.fileName('../../'), null);
check('nor is an empty one', peers.fileName(''), null);
check('an ordinary name survives intact', peers.fileName('Report 2026.pdf'), 'Report 2026.pdf');

check('a name already taken is not written over',
	peers.freeName('a.txt', ['a.txt']), 'a (2).txt');
check('and neither is the one after that',
	peers.freeName('a.txt', ['a.txt', 'a (2).txt']), 'a (3).txt');
check('the extension stays where it belongs',
	peers.freeName('archive.tar.gz', ['archive.tar.gz']), 'archive.tar (2).gz');
check('a free name is used as it is', peers.freeName('b.txt', ['a.txt']), 'b.txt');

// --- identity ----------------------------------------------------------------------------

const id = peers.newPeerId();
check('a generated id is one this system recognises', peers.isValidPeerId(id), true);
check('and it is prefixed, so it is obvious what it belongs to', id.startsWith('pixos-'), true);
check('two ids are not the same', peers.newPeerId() === peers.newPeerId(), false);
check('an id with a slash in it is refused — it ends up in the broker\'s URL',
	peers.isValidPeerId('pixos-a/b'), false);
check('so is one that is not ours', peers.isValidPeerId('some-other-peer'), false);
check('and a non-string', peers.isValidPeerId(null), false);

// --- the broker ---------------------------------------------------------------------------
//
// Vendoring the library did not remove the need for one, so which broker is in use is a
// setting and a sentence on screen rather than a silent default.

check('no host means the library\'s own default, which is the cloud',
	peers.peerOptions(peers.brokerFrom({})), {});
check('and it says so in words', peers.brokerLabel(null), 'the PeerJS cloud (0.peerjs.com)');

const lan = peers.brokerFrom({host: 'nas.local', port: 9000, secure: false});
check('a host is carried through', peers.peerOptions(lan).host, 'nas.local');
check('with its port', peers.peerOptions(lan).port, 9000);
check('and its scheme, because a LAN broker is usually not https',
	peers.peerOptions(lan).secure, false);
check('a broker with no port gets the https one, not zero',
	peers.brokerFrom({host: 'x'}).port, 443);
check('a nonsense port is not honoured', peers.brokerFrom({host: 'x', port: 99999}).port, 443);
check('a path is made absolute', peers.brokerFrom({host: 'x', path: 'peers'}).path, '/peers');
check('and the label names it', peers.brokerLabel(lan), 'nas.local:9000');

// --- what is remembered --------------------------------------------------------------------

check('settings from nothing are still settings', peers.settingsFrom(null).known, []);
check('an id that does not parse is not adopted', peers.settingsFrom({id: 'nope'}).id, null);
check('a good one is', peers.settingsFrom({id: id}).id, id);

const a = peers.newPeerId();
const b = peers.newPeerId();
let known = peers.rememberPeer([], {id: a, name: 'Laptop', at: 1});
known = peers.rememberPeer(known, {id: b, name: 'Phone', at: 2});
check('the most recent peer is first', known[0].id, b);
known = peers.rememberPeer(known, {id: a, name: 'Laptop', at: 3});
check('reconnecting moves it back to the front', known[0].id, a);
check('and does not add it twice', known.length, 2);
check('a peer with a bad id is not remembered at all',
	peers.rememberPeer(known, {id: 'junk', name: 'x'}).length, 2);
check('forgetting one removes exactly it', peers.forgetPeer(known, a).length, 1);
check('forgetting one nobody knows changes nothing', peers.forgetPeer(known, 'junk').length, 2);
check('a stored list with duplicates in it is cleaned on the way in',
	peers.knownFrom([{id: a}, {id: a}, {id: b}]).length, 2);
check('and entries that are not peers are dropped',
	peers.knownFrom([{id: a}, null, {name: 'no id'}]).length, 1);

// --- latency ---------------------------------------------------------------------------------
//
// The number that says whether a remote control or a call is going to be usable. A median
// rather than the last sample: one slow packet should not make a good link look broken.

check('with no samples there is no number yet', peers.medianPing([]), null);
check('one sample is the answer', peers.medianPing([30]), 30);
check('an odd run takes the middle', peers.medianPing([10, 90, 20]), 20);
check('an even run averages the two middles', peers.medianPing([10, 20, 30, 40]), 25);
check('one outlier does not move it much', peers.medianPing([20, 22, 21, 4000, 23]), 22);
check('rubbish samples are ignored rather than poisoning it',
	peers.medianPing([20, null, NaN, 'x', 22, 24]), 22);
check('only the last few are kept',
	peers.addSample([1, 2, 3, 4, 5], 6), [2, 3, 4, 5, 6]);

check('no reading says so rather than showing a zero', peers.describePing(null), 'measuring…');
check('a good link is just a number', peers.describePing(30), '30 ms');
check('a middling one is named', peers.describePing(120).includes('laggy'), true);
check('and a hopeless one says what it cannot do',
	peers.describePing(400).includes('too slow to drive'), true);

// --- transfers --------------------------------------------------------------------------------

check('a transfer with nothing sent is at zero', peers.progressOf({size: 100, done: 0}).ratio, 0);
check('half way is a half', peers.progressOf({size: 100, done: 50}).ratio, 0.5);
check('a done count past the size does not read as more than finished',
	peers.progressOf({size: 100, done: 400}).ratio, 1);
check('a zero-length file is not a division by zero',
	peers.progressOf({size: 0, done: 0}).ratio, 0);
check('and the label is readable rather than exact',
	peers.progressOf({size: 2048, done: 1024}).label, '1.0 KB of 2.0 KB');

check('a file splits into whole chunks', peers.chunkPlan(10, 4).length, 3);
check('the last one is short rather than padded', peers.chunkPlan(10, 4)[2], {at: 8, end: 10});
check('an exact multiple has no empty chunk at the end', peers.chunkPlan(8, 4).length, 2);
check('an empty file is no chunks at all', peers.chunkPlan(0, 4).length, 0);

// --- a finished transfer is a record, not a job ------------------------------------------------
//
// They used to pile up: every transfer ever, each with a full progress bar under it, so a
// column of finished work read as work still going on and there was no way to clear it.

check('a transfer still running is not finished', peers.isFinished({state: 'sending'}), false);
check('nor is one waiting to be answered', peers.isFinished({state: 'offered'}), false);
['sent', 'saved', 'refused', 'failed', 'lost'].forEach(state => {
	check('a transfer that ended as "' + state + '" is finished',
		peers.isFinished({state: state}), true);
});

const many = [
	{state: 'saved', name: '1'}, {state: 'saved', name: '2'}, {state: 'refused', name: '3'},
	{state: 'sending', name: 'live'}, {state: 'saved', name: '4'}
];
check('everything still moving is kept whatever the cap',
	peers.pruneTransfers(many, 0).map(t => t.name), ['live']);
check('and the most recent finished ones with it — the one you just watched fail is the '
	+ 'one worth still seeing',
	peers.pruneTransfers(many, 2).map(t => t.name), ['3', 'live', '4']);
check('under the cap nothing is dropped at all',
	peers.pruneTransfers(many, 10).length, 5);

// --- the share boundary -------------------------------------------------------------------
//
// The one function standing between a guest and the rest of this filesystem. The share it
// replaces had a single dirname comparison doing this job, which is why these come before
// anything that calls it.

check('an ordinary path resolves inside the share',
	peers.resolveShared('/home/photos', '/holiday.jpg'), '/home/photos/holiday.jpg');
check('the share root itself is the root of the mount',
	peers.resolveShared('/home/photos', '/'), '/home/photos');
check('so is an empty path', peers.resolveShared('/home/photos', ''), '/home/photos');
check('a nested path is fine', peers.resolveShared('/home/p', '/a/b/c.txt'), '/home/p/a/b/c.txt');

check('.. cannot climb out', peers.resolveShared('/home/photos', '../secrets'), null);
check('however many there are',
	peers.resolveShared('/home/photos', '../../../../etc/passwd'), null);
check('or how they are buried',
	peers.resolveShared('/home/photos', '/a/../../../etc'), null);
check('a backslash is a separator here too, whatever this filesystem thinks',
	peers.resolveShared('/home/photos', '..\\..\\etc'), null);
check('a sibling that merely starts with the same letters is not inside it',
	peers.resolveShared('/home/photos', '/../photos-private/x'), null);
check('.. that climbs and comes back is still inside, and is allowed',
	peers.resolveShared('/home/photos', '/a/../b.txt'), '/home/photos/b.txt');
check('control characters are stripped rather than passed to the filesystem',
	peers.resolveShared('/home/photos', '/a\u0000b'), '/home/photos/ab');

check('sharing the whole filesystem is refused outright — it would make every other rule '
	+ 'here decorative', peers.resolveShared('/', '/anything'), null);
check('and so is a share root that is not absolute',
	peers.resolveShared('home/photos', '/a'), null);

check('a path normalises the way the rest of the system expects',
	peers.normalizeAbsolute('/a//b/./c/'), '/a/b/c');
check('including one that climbs past the root', peers.normalizeAbsolute('/../../a'), '/a');

// --- what a listing and a stat look like on the wire ---------------------------------------

check('a listing carries names only, so a thousand files is one message',
	peers.entryNames(['a.txt', 'b.txt']), ['a.txt', 'b.txt']);
check('a name with a separator in it is not a name in a listing',
	peers.entryNames(['a.txt', '../etc']), ['a.txt']);
check('and neither is a non-string', peers.entryNames(['a', null, 3]), ['a']);

const dirStat = peers.statPayload({isDirectory: () => true, size: 4096, mtime: 0});
check('a stat says whether it is a folder', dirStat.dir, true);
check('a stat with nothing in it is still a stat', peers.statFrom(null).size, 0);
check('and a hostile one does not become a negative size',
	peers.statFrom({size: -5}).size, 0);

// --- the wire grew, and stayed closed --------------------------------------------------------

check('an fs call names one of exactly three operations',
	peers.parseMessage({type: 'fs-call', id: 'c1', op: 'readdir', path: '/'}).op, 'readdir');
check('anything else is not a call at all',
	peers.parseMessage({type: 'fs-call', id: 'c1', op: 'writeFile', path: '/x'}), null);
check('nor is one with no path',
	peers.parseMessage({type: 'fs-call', id: 'c1', op: 'stat'}), null);
check('a mount request carries nothing, so there is nothing to lie about in it',
	peers.parseMessage({type: 'mount-request', path: '/etc'}), {type: 'mount-request'});
check('a refusal carries a reason and only a reason',
	peers.parseMessage({type: 'mount-no', reason: 'No', run: 'x'}), {type: 'mount-no', reason: 'No'});
check('a reply that failed carries no data',
	peers.parseMessage({type: 'fs-reply', id: 'c1', ok: false, data: 'x'}).data, null);

// --- the parts that touch a browser are the parts that are not here ------------------------
//
// This module is loaded by the shell, and a module that reached for `window` at import time
// could not be tested at all — which is the state `system-stats.js` is in.

check('importing it needs no browser', typeof peers.parseMessage, 'function');
check('and it says so when the library is missing rather than throwing',
	peers.isAvailable(), false);

// Comments stripped, or this file's own account of what it refuses to do would trip the
// check that it refuses to do it.
const code = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const source = code(fs.readFileSync(new URL('../js/shell/peers.js', import.meta.url), 'utf8'));
// The thing this feature exists to stop being: the share it replaces sent a page of HTML
// and JavaScript that the guest's browser ran.
check('nothing from the wire is ever evaluated',
	/eval\(|new Function|innerHTML/.test(source), false);
check('the message list is a switch over known types, not a lookup by name',
	/handlers\[|dispatch\[/.test(source), false);

const panel = code(fs.readFileSync(new URL('../js/shell/peers-panel.js', import.meta.url), 'utf8'));
// A peer's name and id are drawn in the panel, and both came from another machine.
check('the panel builds its rows rather than writing markup with names in it',
	/innerHTML\s*=\s*[^']*\+/.test(panel), false);
check('it draws a bar only while something is still moving',
	/if \(!done\) \{[\s\S]{0,200}PixPeers__bar/.test(panel), true);
check('and offers to clear the rest only when there is a rest',
	/isFinished\)[\s\S]{0,120}Clear finished/.test(panel), true);

const notes = fs.readFileSync(new URL('../js/shell/notifications.js', import.meta.url), 'utf8');
// The notes are how the system speaks, often about the overlay that is open -- the Peers
// panel reporting a copied id, for one. Appended at boot, they sat *under* every overlay
// opened later, and under a backdrop-filter they were a smear behind glass.
check('notifications sit above every other overlay in their layer',
	/\.PixNotes \{[\s\S]{0,400}z-index: 40/.test(notes), true);
check('and an incoming file is a question the shell asks, not something this module does',
	/deps\.ask/.test(source), true);

const shell = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
check('which the shell answers with Accept and Refuse',
	/Accept[\s\S]{0,200}Refuse/.test(shell), true);
check('and the library is served by PixOS rather than fetched from a CDN',
	/script src="js\/peerjs\/peerjs\.min\.js"/.test(shell), true);

// --- the guest side is a filesystem, and that is the whole point ---------------------------
//
// Once the folder is a mount, Explorer, the palette, the apps and the service worker all
// reach it without being told about peers at all. The backend is a plain object because
// the vendored BrowserFS exports no base class; the interface below is what the bundle
// actually calls, established by experiment.

const peerFsSource = code(fs.readFileSync(new URL('../js/shell/peer-fs.js', import.meta.url), 'utf8'));
['getName', 'isReadOnly', 'supportsSynch', 'readdir', 'stat', 'readFile', 'exists', 'realpath']
	.forEach(method => {
		check('the backend answers ' + method + ', which BrowserFS calls',
			new RegExp('\\b' + method + ':').test(peerFsSource), true);
	});
check('it reports itself read-only, so BrowserFS refuses writes before a message is sent',
	/isReadOnly: function \(\) \{\s*return true/.test(peerFsSource), true);
check('and asynchronous only, since there is no synchronous way to ask another machine',
	/supportsSynch: function \(\) \{\s*return false/.test(peerFsSource), true);
check('a write that reaches it anyway says what is wrong rather than failing as undefined',
	/writeFile: readOnly/.test(peerFsSource), true);

const peersCode = code(fs.readFileSync(new URL('../js/shell/peers.js', import.meta.url), 'utf8'));
check('every call from a guest resolves its path against the share root first',
	/function onFsCall[\s\S]{0,600}resolveShared\(share, message\.path\)/.test(peersCode), true);
check('and an ungranted peer gets the same answer as one that asked for the wrong path',
	/link\.granted[\s\S]{0,400}resolveShared/.test(peersCode), true);
check('a call that never comes back rejects on a deadline rather than hanging',
	/CALL_TIMEOUT[\s\S]{0,600}did not answer in time/.test(peersCode), true);
check('the grant goes with the connection rather than being written down',
	/link\.granted = false;\s*delete links\[id\]/.test(peersCode), true);

// --- the settings file is re-read, not read once ---------------------------------------------
//
// It is a file a person edits. A broker that only took effect after restarting the whole
// system looked like a setting that did nothing.

const peersModule = code(fs.readFileSync(new URL('../js/shell/peers.js', import.meta.url), 'utf8'));
check('going online re-reads the settings first',
	/starting = load\(\)\.then\(openPeer\)/.test(peersModule), true);
check('and an id already in hand survives a file that has lost one — otherwise adding a '
	+ 'broker to that file would silently change this machine\'s identity',
	/var held = settings\.id;[\s\S]{0,300}held \|\| newPeerId\(\)/.test(peersModule), true);
check('the panel re-reads it whenever it opens',
	/peers\.load\(\)\.catch/.test(panel), true);
check('and says so when the file and the live connection disagree, rather than dropping a '
	+ 'working connection on its own',
	/brokerStale/.test(panel), true);

const explorer = fs.readFileSync(new URL('../apps/explorer/index.html', import.meta.url), 'utf8');
check('Explorer loads it from here too, which is what killed sharing offline',
	/src="\/js\/peerjs\/peerjs\.min\.js"/.test(explorer), true);

process.exit(report('peers') ? 1 : 0);
