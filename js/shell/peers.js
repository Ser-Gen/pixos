// One connection to another PixOS, and everything that hangs off it.
//
// The shell owns this rather than Explorer, which is where it used to live, because
// Explorer is only ever going to be one caller: a shared folder is a *mount*
// (`js/mount-manager.js`, shell-side), a call is not a file manager's business, and a
// phone driving this machine is not either. Explorer's own share was replaced wholesale by
// the mount and then removed, connection, guest page and all.
//
// Three things about the shape of it.
//
// **The wire protocol is a closed list.** `parseMessage` accepts exactly the message types
// below and returns null for everything else. This is the security boundary of the whole
// feature: what arrives here was written by somebody else's machine, and the sharing code
// this replaces took an HTML document over the wire and `new Function`'d it. Nothing here
// is ever evaluated, nothing is dispatched by name from the wire, and every field is
// bounded.
//
// **A stable id is a stable identifier.** It is generated once and kept in
// `/settings/peers.json` so a reconnect does not need a fresh link exchanged by hand --
// which is what makes "this phone is mine" possible later. The cost is real and the panel
// says so: it can be seen, copied and reset, and it is never sent anywhere by itself.
//
// **Vendoring the library did not remove the broker.** WebRTC needs somebody to introduce
// two peers, and by default that is the PeerJS cloud -- an internet service. The broker is
// configurable so a `peerjs-server` on a LAN makes two machines in one room work with no
// internet at all, and whichever is in use is named on screen. "Who introduced us" is not
// something a system should keep to itself.

import {formatBytes} from './failure.js';

var ID_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';
var ID_LENGTH = 20;

// PeerJS puts the id in a URL path, so this is deliberately narrower than what it accepts.
var ID_RE = /^pixos-[a-z0-9]{8,40}$/;

// Everything below arrives from another machine, so everything below is bounded. A name is
// drawn on screen, so it also loses the control characters that would let it pretend to be
// part of the panel.
var CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
var MAX_NAME = 40;
var MAX_FILE_NAME = 120;
// 64 KB a chunk: small enough that progress moves, large enough that a big file is not a
// million messages. PeerJS chunks again underneath at its own MTU.
export var CHUNK_SIZE = 65536;
// A ceiling, so a peer cannot fill this filesystem while you watch a progress bar.
export var MAX_FILE_SIZE = 256 * 1024 * 1024;
var MAX_KNOWN = 40;
// A finished transfer is a record, not a job. Kept so you can see what happened, capped so
// an afternoon of sending files is not a wall of dead progress bars.
var MAX_FINISHED = 6;
var PING_SAMPLES = 5;

// A read over the wire carries the whole file in one message, so this is the ceiling on
// what a peer mount will open. Deliberately far below MAX_FILE_SIZE: *sending* a file is a
// deliberate act with a progress bar, opening one from a mount is a double-click.
export var MAX_READ = 32 * 1024 * 1024;
// A call that never comes back must fail rather than hang. The files3 mount taught this
// once already, which is why file-search races every read against a deadline.
export var CALL_TIMEOUT = 20000;

// A message is text and nothing else, and it is bounded like everything else that arrives
// from another machine. 2 KB is a long message and a short essay; a peer that wants to
// send you a document sends a file, where there is a question with a size on it.
var MAX_CHAT_TEXT = 2000;
// A conversation is kept, so it has to have an end. The oldest go first.
var MAX_CHAT_LOG = 300;
// How long a "typing" stays true without another one. Deliberately longer than the 3 s
// ping that redraws the panel, so the line does not flicker between keystrokes.
export var TYPING_FOR = 5000;

// The two things one machine can open to another. Deliberately a list rather than a
// boolean: a camera is a third kind, and the day it exists it belongs here rather than in
// an `if` somewhere downstream.
export var CALL_KINDS = ['voice', 'screen'];
// How long an offer rings before it gives up on its own. Long enough to walk to the
// machine, short enough that a question nobody saw does not sit on the far side's screen
// all afternoon claiming to be live.
export var RING_FOR = 45000;
// From "they accepted" to "a media connection actually opened". WebRTC can fail to
// negotiate long after both people have said yes, and a bar that says *connecting…* for
// ever is the same lie as a progress bar that has stopped.
export var MEDIA_TIMEOUT = 25000;

export var SETTINGS_PATH = '/settings/peers.json';
export var INBOX = '/home/received';
// One file per peer, because a conversation is a document about one person: deleting it is
// then deleting a file, and reading it in Explorer is reading a file.
export var CHAT_DIR = '/settings/peer-chats';

// --- identity ------------------------------------------------------------------------

export function newPeerId (random) {
	var pick = random || function () { return Math.random(); };
	var out = '';
	for (var i = 0; i < ID_LENGTH; i++) {
		out += ID_ALPHABET.charAt(Math.floor(pick() * ID_ALPHABET.length) % ID_ALPHABET.length);
	}
	return 'pixos-' + out;
}

export function isValidPeerId (id) {
	return typeof id === 'string' && ID_RE.test(id);
}

// A name is decoration: it is chosen by whoever is on the other end, so it is cut to
// length and stripped before it is ever drawn.
export function cleanName (value, fallback) {
	var text = String(value == null ? '' : value)
		.replace(CONTROL, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_NAME);
	return text || (fallback || 'Someone');
}

// --- the broker ------------------------------------------------------------------------

export function brokerFrom (raw) {
	var data = raw && typeof raw === 'object' ? raw : {};
	var host = String(data.host || '').replace(CONTROL, '').trim();
	if (!host) {
		// The PeerJS cloud, which is what `new Peer()` uses and what this used before.
		return null;
	}
	var port = Number(data.port);
	return {
		host: host,
		port: port > 0 && port < 65536 ? Math.floor(port) : 443,
		path: String(data.path || '/').replace(CONTROL, '').replace(/^([^/])/, '/$1'),
		// A page served over https cannot open a ws:// socket, and that failure is silent
		// and baffling; default to secure and let a LAN setup say otherwise.
		secure: data.secure === undefined ? true : !!data.secure
	};
}

// What `new Peer(id, ...)` is handed. Pure, so the interesting half is testable with no
// network: an empty object means the library's own defaults, which is the cloud.
export function peerOptions (broker) {
	if (!broker) {
		return {};
	}
	return {
		host: broker.host,
		port: broker.port,
		path: broker.path,
		secure: broker.secure
	};
}

export function brokerLabel (broker) {
	if (!broker) {
		return 'the PeerJS cloud (0.peerjs.com)';
	}
	return broker.host + ':' + broker.port + (broker.path === '/' ? '' : broker.path);
}

// --- what is remembered ----------------------------------------------------------------

export function settingsFrom (raw) {
	var data = raw && typeof raw === 'object' ? raw : {};
	return {
		id: isValidPeerId(data.id) ? data.id : null,
		label: cleanName(data.label, 'This PixOS'),
		broker: brokerFrom(data.broker),
		known: knownFrom(data.known)
	};
}

export function knownFrom (raw) {
	if (!Array.isArray(raw)) {
		return [];
	}
	var seen = {};
	var out = [];
	raw.forEach(function (entry) {
		if (!entry || !isValidPeerId(entry.id) || seen[entry.id]) {
			return;
		}
		seen[entry.id] = true;
		out.push({
			id: entry.id,
			name: cleanName(entry.name, entry.id),
			at: typeof entry.at === 'number' ? entry.at : 0
		});
	});
	return out.slice(0, MAX_KNOWN);
}

// Most recent first, never twice, and capped -- a list of everyone you have ever connected
// to is a list anybody who opens this panel can read.
export function rememberPeer (known, entry) {
	if (!entry || !isValidPeerId(entry.id)) {
		return knownFrom(known);
	}
	var next = knownFrom(known).filter(function (candidate) {
		return candidate.id !== entry.id;
	});
	next.unshift({
		id: entry.id,
		name: cleanName(entry.name, entry.id),
		at: typeof entry.at === 'number' ? entry.at : 0
	});
	return next.slice(0, MAX_KNOWN);
}

export function forgetPeer (known, id) {
	return knownFrom(known).filter(function (entry) {
		return entry.id !== id;
	});
}

// --- the wire ---------------------------------------------------------------------------
//
// A closed list. Anything that is not exactly one of these is not a message, and the
// sender is told nothing about why -- a peer probing for what this understands learns
// nothing from silence.

export function parseMessage (raw) {
	if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string') {
		return null;
	}
	switch (raw.type) {
	case 'hello':
		return {type: 'hello', name: cleanName(raw.name, 'Someone')};
	case 'ping':
	case 'pong':
		return typeof raw.at === 'number' && isFinite(raw.at)
			? {type: raw.type, at: raw.at}
			: null;
	case 'bye':
		return {type: 'bye'};
	// A file arrives as an offer, then an answer, then chunks. The offer is a question on
	// the receiving machine, always: a peer that can write into your filesystem because
	// you once pressed Connect is not a peer, it is an intruder.
	case 'file-offer':
		return token(raw.id) && fileName(raw.name) && sizeOf(raw.size) !== null
			? {
				type: 'file-offer',
				id: token(raw.id),
				name: fileName(raw.name),
				size: sizeOf(raw.size)
			}
			: null;
	case 'file-accept':
	case 'file-refuse':
		return token(raw.id) ? {type: raw.type, id: token(raw.id)} : null;
	case 'file-chunk':
		return token(raw.id) && typeof raw.at === 'number' && raw.at >= 0 && raw.data
			? {type: 'file-chunk', id: token(raw.id), at: Math.floor(raw.at), data: raw.data}
			: null;
	case 'file-done':
		return token(raw.id) ? {type: 'file-done', id: token(raw.id)} : null;

	// A message carries text and nothing else -- no id, no timestamp, no name. The name is
	// the one from `hello` on this connection, and the time is this machine's clock: a
	// sender that chooses its own could put its message at the top of your conversation,
	// or in next week, and the first thing you would blame is your own history file.
	case 'chat':
		return chatText(raw.text) ? {type: 'chat', text: chatText(raw.text)} : null;
	// The smallest message there is, and deliberately: "somebody is writing" is worth
	// knowing and nothing about it is worth a field.
	case 'chat-typing':
		return {type: 'chat-typing'};

	// A call is arranged here, on the data channel, and only then does any media move.
	// That order is the point: the far side gets *this system's* question first, answers
	// it, and only a yes reaches the microphone — so a refusal never touches the media
	// layer at all, and the browser's own permission prompt is never the first thing a
	// stranger can make appear on your screen.
	case 'call-offer':
		return token(raw.id) && callKind(raw.kind)
			? {type: 'call-offer', id: token(raw.id), kind: callKind(raw.kind)}
			: null;
	// `call-live` means "your media reached me". It exists because a screen share is
	// one-way: the watcher answers with nothing, so no stream ever arrives back at the
	// person sharing, and without this their bar would sit at *connecting…* through the
	// whole call and then time out under it.
	case 'call-accept':
	case 'call-live':
	case 'call-end':
		return token(raw.id) ? {type: raw.type, id: token(raw.id)} : null;
	case 'call-refuse':
		return token(raw.id)
			? {type: 'call-refuse', id: token(raw.id), reason: cleanName(raw.reason, 'They said no.')}
			: null;
	// Not decoration: without it the two most common minutes of any call are one person
	// talking to a muted microphone and the other wondering whether the line has died.
	case 'call-mute':
		return token(raw.id) ? {type: 'call-mute', id: token(raw.id), muted: !!raw.muted} : null;

	// A shared folder. The guest asks for whatever the host is sharing -- it never names a
	// path, because naming one would make "which folder" a question the *guest* answers.
	case 'mount-request':
		return {type: 'mount-request'};
	case 'mount-ok':
		return {type: 'mount-ok', name: cleanName(raw.name, 'Shared folder')};
	case 'mount-no':
		return {type: 'mount-no', reason: cleanName(raw.reason, 'Refused')};
	case 'unshare':
		return {type: 'unshare'};
	case 'fs-call':
		return token(raw.id) && FS_OPS.indexOf(raw.op) !== -1 && typeof raw.path === 'string'
			? {type: 'fs-call', id: token(raw.id), op: raw.op, path: raw.path.slice(0, 4096)}
			: null;
	case 'fs-reply':
		return token(raw.id) ? {
			type: 'fs-reply',
			id: token(raw.id),
			ok: !!raw.ok,
			error: raw.error ? cleanName(raw.error, 'Failed') : null,
			// Shapes are checked where they are used, by the one function that knows what
			// each op answers with.
			data: raw.ok ? raw.data : null
		} : null;

	default:
		return null;
	}
}

// Read-only, and that is the phase rather than an oversight: a backend that answers these
// three is half the surface and all of the value -- browse, open, copy out.
export var FS_OPS = ['readdir', 'stat', 'read'];

function token (value) {
	return typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : null;
}

function sizeOf (value) {
	var size = Number(value);
	return isFinite(size) && size >= 0 && size <= MAX_FILE_SIZE ? Math.floor(size) : null;
}

// A file name from another machine is a path traversal waiting to happen. Only the last
// segment survives, and only characters that mean nothing to a filesystem.
export function fileName (value) {
	var name = String(value == null ? '' : value)
		.replace(/\\/g, '/')
		.split('/')
		.pop()
		.replace(CONTROL, '')
		.replace(/^\.+/, '')
		.trim()
		.slice(0, MAX_FILE_NAME);
	return name || null;
}

// Two peers can send the same name, and one of yours may already have it. The second must
// never land on top of the first.
export function freeName (name, taken) {
	var used = taken || [];
	if (used.indexOf(name) === -1) {
		return name;
	}
	var dot = name.lastIndexOf('.');
	var stem = dot > 0 ? name.slice(0, dot) : name;
	var ext = dot > 0 ? name.slice(dot) : '';
	for (var n = 2; n < 1000; n++) {
		var candidate = stem + ' (' + n + ')' + ext;
		if (used.indexOf(candidate) === -1) {
			return candidate;
		}
	}
	return stem + ' (' + Date.now() + ')' + ext;
}

// --- the share boundary ---------------------------------------------------------------------
//
// The one function standing between a guest and the rest of this filesystem, which is why
// it is here, pure, and tested before anything that calls it. The share it replaces had a
// single `path.dirname(filePath) !== sharePath` comparison doing this job.
//
// A path from the wire is always *relative to the share*: a leading slash means the share's
// own root, never this machine's.

export function normalizeAbsolute (value) {
	var out = [];
	String(value == null ? '' : value)
		.replace(/\\/g, '/')
		.replace(CONTROL, '')
		.split('/')
		.forEach(function (part) {
			if (!part || part === '.') {
				return;
			}
			if (part === '..') {
				out.pop();
				return;
			}
			out.push(part);
		});
	return '/' + out.join('/');
}

export function resolveShared (root, requested) {
	if (typeof root !== 'string' || root.charAt(0) !== '/') {
		return null;
	}
	var base = normalizeAbsolute(root);
	if (base === '/') {
		// Sharing the whole filesystem is not a thing this offers. It would make every
		// other rule here decorative.
		return null;
	}
	var joined = normalizeAbsolute(base + '/' + String(requested == null ? '' : requested));
	if (joined !== base && joined.indexOf(base + '/') !== 0) {
		return null;
	}
	return joined;
}

// What a directory entry looks like on the wire. Names only -- the guest asks for a stat
// when it wants one, which is what keeps a listing of a thousand files one message.
export function entryNames (list) {
	return (list || []).filter(function (name) {
		return typeof name === 'string' && name && name.indexOf('/') === -1;
	}).slice(0, 5000);
}

export function statPayload (stats) {
	return {
		dir: !!(stats && typeof stats.isDirectory === 'function' && stats.isDirectory()),
		size: (stats && typeof stats.size === 'number') ? stats.size : 0,
		mtime: (stats && stats.mtime) ? Number(new Date(stats.mtime)) : 0
	};
}

export function statFrom (payload) {
	var data = payload && typeof payload === 'object' ? payload : {};
	return {
		dir: !!data.dir,
		size: typeof data.size === 'number' && data.size >= 0 ? data.size : 0,
		mtime: typeof data.mtime === 'number' ? data.mtime : 0
	};
}

// --- latency ------------------------------------------------------------------------------
//
// A number on screen is what tells you whether a remote control or a call is going to be
// usable at all, so it is a rolling median rather than the last sample: one slow packet
// should not make a good link look broken, and one fast one should not hide a bad one.

export function addSample (samples, ms) {
	var next = (samples || []).concat([ms]);
	return next.slice(Math.max(0, next.length - PING_SAMPLES));
}

export function medianPing (samples) {
	var list = (samples || []).filter(function (value) {
		return typeof value === 'number' && isFinite(value) && value >= 0;
	}).sort(function (a, b) {
		return a - b;
	});
	if (!list.length) {
		return null;
	}
	var middle = Math.floor(list.length / 2);
	return list.length % 2 ? list[middle] : Math.round((list[middle - 1] + list[middle]) / 2);
}

export function describePing (ms) {
	if (ms === null || ms === undefined) {
		return 'measuring…';
	}
	return Math.round(ms) + ' ms'
		+ (ms < 80 ? '' : ms < 250 ? ' · laggy' : ' · too slow to drive');
}

// --- transfers -----------------------------------------------------------------------------

// Which states mean nothing more will happen. The panel draws a bar only while something
// is still moving; past that a transfer is one line saying how it ended.
export var FINISHED = ['sent', 'saved', 'refused', 'failed', 'lost'];

export function isFinished (transfer) {
	return FINISHED.indexOf(transfer && transfer.state) !== -1;
}

// Everything still running, and only the last few that are not. Oldest finished go first:
// the one you just watched fail is the one worth still having on screen.
export function pruneTransfers (transfers, keep) {
	var list = transfers || [];
	var limit = keep === undefined ? MAX_FINISHED : keep;
	var finished = list.filter(isFinished);
	var drop = Math.max(0, finished.length - limit);
	var dropped = finished.slice(0, drop);
	return list.filter(function (transfer) {
		return dropped.indexOf(transfer) === -1;
	});
}

export function progressOf (transfer) {
	var total = (transfer && transfer.size) || 0;
	var done = Math.min((transfer && transfer.done) || 0, total);
	return {
		ratio: total ? done / total : 0,
		label: total ? formatBytes(done) + ' of ' + formatBytes(total) : formatBytes(done)
	};
}

// One spelling of a size across the whole system -- see failure.js. This module had its
// own, which rounded differently, so the same file read as two sizes depending on which
// panel was showing it.
export {formatBytes};

export function chunkPlan (size, chunkSize) {
	var step = chunkSize || CHUNK_SIZE;
	var offsets = [];
	for (var at = 0; at < size; at += step) {
		offsets.push({at: at, end: Math.min(at + step, size)});
	}
	return offsets;
}

// --- what a message is ------------------------------------------------------------------
//
// Text, and only text. It is drawn with `textContent` wherever it is drawn, so this is not
// the escaping — that would be a single point of failure for something a stranger writes.
// This is the *shape*: newlines survive because a message may be two lines, every other
// control character does not, because those are what let a line pretend to be part of the
// panel around it.

export function chatText (value) {
	if (typeof value !== 'string') {
		return null;
	}
	// Split on the line break, strip the control characters from each line, put it back
	// together: the newline survives because it is the separator rather than a character
	// this has to make an exception for, and the class doing the stripping is the same
	// tested one every other field from the wire goes through.
	var text = value
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map(function (line) {
			return line.replace(CONTROL, '');
		})
		.join('\n')
		.slice(0, MAX_CHAT_TEXT)
		// A message that is fifty blank lines is a message that scrolls yours away.
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return text || null;
}

export function chatPath (id) {
	return isValidPeerId(id) ? CHAT_DIR + '/' + id + '.json' : null;
}

// A stored conversation is a file, and a file can be edited, truncated or replaced by
// something that is not a conversation at all. Read as defensively as anything off the
// wire: a log that will not parse becomes an empty one rather than an exception at boot.
export function chatFrom (raw) {
	var data = raw && typeof raw === 'object' ? raw : {};
	var messages = Array.isArray(data.messages) ? data.messages : [];
	var out = [];
	messages.forEach(function (entry) {
		var text = entry && chatText(entry.text);
		if (!text) {
			return;
		}
		out.push({
			at: typeof entry.at === 'number' && isFinite(entry.at) ? entry.at : 0,
			way: entry.way === 'out' ? 'out' : 'in',
			text: text
		});
	});
	return out.slice(-MAX_CHAT_LOG);
}

// The clock is always this machine's, never the sender's. Two machines disagree about the
// time as a matter of course, and a peer choosing its own timestamps could put its message
// at the top of your conversation, or in next week.
export function addChat (messages, entry) {
	var text = entry && chatText(entry.text);
	if (!text) {
		return Array.isArray(messages) ? messages.slice(-MAX_CHAT_LOG) : [];
	}
	var next = (Array.isArray(messages) ? messages : []).concat([{
		at: typeof entry.at === 'number' && isFinite(entry.at) ? entry.at : Date.now(),
		way: entry.way === 'out' ? 'out' : 'in',
		text: text
	}]);
	return next.slice(-MAX_CHAT_LOG);
}

export function isTyping (at, now) {
	return typeof at === 'number' && (now || Date.now()) - at < TYPING_FOR;
}

// --- a call ------------------------------------------------------------------------------

export function callKind (value) {
	return CALL_KINDS.indexOf(value) === -1 ? null : value;
}

// One place that knows what to call these, because the panel button, the question on the
// far side, the bar and the note when it ends all have to agree. `way` is this machine's
// side of it: the same call reads differently from each end, and "sharing your screen" and
// "watching their screen" are not the same sentence.
export function describeCall (kind, way, name) {
	var who = name || 'them';
	if (kind === 'screen') {
		return way === 'out' ? 'Sharing your screen with ' + who : 'Watching ' + who + '’s screen';
	}
	return 'Talking to ' + who;
}

export function describeCallOffer (kind, name) {
	var who = name || 'Someone';
	return kind === 'screen'
		? who + ' wants to show you their screen'
		: who + ' wants to talk to you';
}

// `getUserMedia` and `getDisplayMedia` fail by `name`, and every one of these is something
// the person can act on — which is the same argument `failure.js` makes about fetch. A
// refused microphone and a microphone another program is holding are the same
// `Error` to anyone who does not read the name.
export function describeMediaError (err, kind) {
	var what = kind === 'screen' ? 'screen' : 'microphone';
	var name = (err && err.name) || '';
	var messages = {
		NotAllowedError: kind === 'screen'
			? 'Nothing was picked to share — or this page is not allowed to capture the screen.'
			: 'The microphone was refused. The browser keeps that answer per site, so it '
				+ 'has to be changed there rather than here.',
		NotFoundError: 'This machine has no ' + what + ' the browser can see.',
		NotReadableError: 'Something else on this machine is holding the ' + what + '.',
		OverconstrainedError: 'No ' + what + ' here matches what was asked for.',
		SecurityError: 'The browser refused on security grounds — a page has to be on '
			+ 'https (or localhost) to use a ' + what + '.',
		AbortError: 'The browser gave up getting the ' + what + '.',
		TypeError: 'This browser will not capture a ' + what + ' from a page like this one.'
	};
	if (messages[name]) {
		return messages[name];
	}
	// Not a DOMException at all, most likely no `mediaDevices` on an insecure origin.
	return (err && err.message) || 'The ' + what + ' could not be opened.';
}

// A live media connection is the one thing here that was *not* asked for over the data
// channel: `peer.on('call')` fires for anybody who knows this machine's id. So the closed
// list is only closed if an arriving media connection is checked against the offer that
// was actually agreed — the peer, the state and the id all have to match, and the id
// arrives inside somebody else's metadata, so it is bounded like everything else.
export function mediaAllowed (call, peerId, metadata) {
	// `way` is checked too: the side that *placed* the offer is the side that places the
	// media call, so an incoming one while offering is somebody else's, whatever id it
	// carries.
	if (!call || call.state !== 'connecting' || call.way !== 'in' || call.peerId !== peerId) {
		return false;
	}
	return !!call.id && token(metadata && metadata.call) === call.id;
}

export function formatDuration (ms) {
	var total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
	var seconds = total % 60;
	var minutes = Math.floor(total / 60) % 60;
	var hours = Math.floor(total / 3600);
	var pad = function (value) {
		return (value < 10 ? '0' : '') + value;
	};
	return (hours ? hours + ':' + pad(minutes) : String(minutes)) + ':' + pad(seconds);
}

// --- the session ---------------------------------------------------------------------------
//
// Everything above is pure and tested. Everything below touches the library, the clock and
// the filesystem, and is deliberately thin: it decides nothing that could have been
// decided above it.

var deps = {};
var settings = settingsFrom(null);
var peer = null;
var links = {};
var listeners = [];
var starting = null;
// The broker the live connection was made through. Not the same thing as the one in the
// settings the moment somebody edits them, and the difference is worth saying out loud
// rather than resolving by dropping a working connection.
var activeBroker = null;
var status = {state: 'idle', detail: 'Not connected to the network'};
var pingTimer = null;

export function init (cfg) {
	deps = cfg || {};
	return deps;
}

export function subscribe (listener) {
	listeners.push(listener);
	listener(snapshot());
	return function () {
		listeners = listeners.filter(function (candidate) {
			return candidate !== listener;
		});
	};
}

function announce () {
	Object.keys(links).forEach(function (id) {
		links[id].transfers = pruneTransfers(links[id].transfers);
	});
	var state = snapshot();
	listeners.forEach(function (listener) {
		try {
			listener(state);
		}
		catch (err) {
			console.error('a peers listener failed', err);
		}
	});
}

export function snapshot () {
	return {
		id: settings.id,
		label: settings.label,
		broker: brokerLabel(settings.broker),
		activeBroker: peer ? brokerLabel(activeBroker) : null,
		brokerStale: !!peer && brokerLabel(activeBroker) !== brokerLabel(settings.broker),
		status: status.state,
		detail: status.detail,
		owner: canRun(),
		known: settings.known.slice(),
		// What this machine is offering, and to whom. "Who can read my files" has to have
		// an answer on screen, and this is where it comes from.
		share: share,
		// Every conversation this session knows about, connected or not: unread that
		// vanished when somebody disconnected would be unread you never read.
		chats: Object.keys(chats).map(chatSummary),
		// One at a time, and the bar that draws it is not the panel: a call has to survive
		// the panel closing, and the panel closes on Esc.
		call: callView(),
		links: Object.keys(links).map(function (id) {
			var link = links[id];
			return {
				id: id,
				name: link.name,
				state: link.state,
				granted: !!link.granted,
				ping: medianPing(link.samples),
				unread: chats[id] ? chats[id].unread : 0,
				typing: isTyping(link.typingAt),
				transfers: link.transfers.map(function (transfer) {
					return {
						id: transfer.id,
						name: transfer.name,
						way: transfer.way,
						state: transfer.state,
						size: transfer.size,
						done: transfer.done
					};
				})
			};
		})
	};
}

// One tab holds the connection, for the same reason one tab writes the session: a peer id
// can only be registered with a broker once, so a second tab claiming it would take the
// first tab's connection away rather than opening its own.
function canRun () {
	return typeof deps.canWrite !== 'function' || deps.canWrite();
}

// Re-readable, and called again every time the session is about to go online rather than
// once at boot: `/settings/peers.json` is a file a person edits, and a setting that only
// takes effect after restarting the whole system is a setting that looks broken.
//
// An id already in hand survives a file that has lost one. Otherwise editing that file to
// add a broker -- which is exactly what the instructions say to do -- would silently give
// this machine a new identity and every peer that knew it would stop being able to reach
// it.
export async function load () {
	var held = settings.id;
	settings = settingsFrom(await deps.read());
	if (!settings.id) {
		settings.id = held || newPeerId();
		await save();
	}
	announce();
	return settings;
}

async function save () {
	if (!canRun()) {
		return;
	}
	await deps.write({
		id: settings.id,
		label: settings.label,
		broker: settings.broker || {},
		known: settings.known
	});
}

export function getSettings () {
	return settings;
}

export async function setLabel (label) {
	settings.label = cleanName(label, 'This PixOS');
	await save();
	announce();
}

// A new identity is a real action with a real cost -- every peer that knew you no longer
// does -- so it is a button, never something that happens on its own.
export async function resetIdentity () {
	stop();
	settings.id = newPeerId();
	await save();
	announce();
	return settings.id;
}

// Clearing the record is the user's, not a timer's: a transfer that vanished on its own
// before you looked at it would be the same as one that never reported.
export function clearFinished (id) {
	var link = links[id];
	if (!link) {
		return;
	}
	link.transfers = link.transfers.filter(function (transfer) {
		return !isFinished(transfer);
	});
	announce();
}

export async function forget (id) {
	settings.known = forgetPeer(settings.known, id);
	await save();
	announce();
}

export async function setBroker (raw) {
	settings.broker = brokerFrom(raw);
	await save();
	stop();
	announce();
	return settings.broker;
}

function setStatus (state, detail) {
	status = {state: state, detail: detail};
	announce();
}

// The library is a <script> tag rather than an import -- it is an IIFE that sets a global.
// Missing it is not a crash: the panel says the feature cannot work and why.
function library () {
	return typeof window !== 'undefined' && window.Peer ? window.Peer : null;
}

export function isAvailable () {
	return !!library();
}

export function start () {
	if (peer) {
		return Promise.resolve(peer);
	}
	if (starting) {
		return starting;
	}
	var Peer = library();
	if (!Peer) {
		setStatus('unavailable', 'The peer library did not load, so nothing can connect.');
		return Promise.reject(new Error('PeerJS is not loaded'));
	}
	if (!canRun()) {
		setStatus('follower', 'Another tab holds this machine’s connection. '
			+ 'A peer id can only be registered once.');
		return Promise.reject(new Error('another tab owns the peer session'));
	}

	// The file is re-read here, not only at boot, so editing the broker and pressing Go
	// online is enough. Going through `starting` means two callers do not race into two
	// reads and two peers.
	starting = load().then(openPeer);
	return starting;
}

function openPeer () {
	var Peer = library();
	activeBroker = settings.broker;
	setStatus('connecting', 'Asking ' + brokerLabel(settings.broker) + ' to introduce us…');
	return new Promise(function (resolve, reject) {
		var instance = new Peer(settings.id, peerOptions(settings.broker));
		var settled = false;

		instance.on('open', function () {
			settled = true;
			peer = instance;
			starting = null;
			setStatus('online', 'Reachable as ' + settings.id);
			resolve(instance);
		});
		instance.on('connection', function (conn) {
			adopt(conn, 'in');
		});
		instance.on('call', onIncomingMedia);
		instance.on('disconnected', function () {
			// The broker connection dropped, not the peers. PeerJS can rejoin, and the
			// existing links keep working while it does.
			setStatus('reconnecting', 'Lost the broker; trying to get back.');
			try {
				instance.reconnect();
			}
			catch (err) {
				setStatus('offline', 'Lost the broker and could not get back.');
			}
		});
		instance.on('close', function () {
			peer = null;
			setStatus('idle', 'Not connected to the network');
		});
		instance.on('error', function (err) {
			var message = describeError(err);
			if (!settled) {
				settled = true;
				starting = null;
				instance.destroy();
				setStatus('offline', message);
				reject(new Error(message));
				return;
			}
			setStatus(peer ? 'online' : 'offline', message);
		});
	});
}

// PeerJS reports its failures by `type`, and the wording matters more here than anywhere
// else in this module: every one of these is something the person can act on.
export function describeError (err) {
	var type = (err && err.type) || '';
	var messages = {
		'browser-incompatible': 'This browser cannot do WebRTC, so peers will not work here.',
		'invalid-id': 'This machine’s peer id was rejected. Reset it in this panel.',
		'unavailable-id': 'That id is already registered with the broker — usually '
			+ 'another tab or another window of PixOS still holds it.',
		'network': 'Could not reach the broker. It is an internet service unless you have '
			+ 'pointed this at your own; check the network, or the broker setting.',
		'peer-unavailable': 'That peer is not reachable. Either it is not running PixOS '
			+ 'right now, or the id is wrong.',
		'server-error': 'The broker answered with an error.',
		'socket-error': 'The connection to the broker broke.',
		'ssl-unavailable': 'The broker does not speak https, and this page does.',
		'webrtc': 'WebRTC itself failed to set up the connection.'
	};
	return messages[type] || ((err && err.message) || 'The connection failed.');
}

export function stop () {
	clearCall('Went offline.');
	Object.keys(links).forEach(function (id) {
		disconnect(id);
	});
	if (peer) {
		peer.destroy();
		peer = null;
	}
	activeBroker = null;
	starting = null;
	clearInterval(pingTimer);
	pingTimer = null;
	setStatus('idle', 'Not connected to the network');
}

export async function connect (peerId) {
	if (!isValidPeerId(peerId)) {
		throw new Error('That is not a PixOS peer id. They look like pixos-… .');
	}
	if (peerId === settings.id) {
		throw new Error('That is this machine’s own id.');
	}
	var instance = await start();
	if (links[peerId]) {
		return links[peerId];
	}
	return adopt(instance.connect(peerId, {reliable: true}), 'out');
}

function adopt (conn, way) {
	var id = conn.peer;
	var link = links[id] || {
		id: id,
		name: id,
		way: way,
		state: 'connecting',
		samples: [],
		transfers: [],
		conn: conn
	};
	link.conn = conn;
	links[id] = link;

	conn.on('open', function () {
		link.state = 'open';
		send(id, {type: 'hello', name: settings.label});
		settings.known = rememberPeer(settings.known, {id: id, name: link.name, at: Date.now()});
		save();
		ensurePings();
		announce();
	});
	conn.on('data', function (raw) {
		receive(link, parseMessage(raw));
	});
	conn.on('close', function () {
		drop(id, 'closed');
	});
	conn.on('error', function (err) {
		link.state = 'error';
		link.detail = describeError(err);
		announce();
	});

	announce();
	return link;
}

export function disconnect (id) {
	var link = links[id];
	if (!link) {
		return;
	}
	try {
		send(id, {type: 'bye'});
		link.conn.close();
	}
	catch (err) {
		// Already gone; the bookkeeping below is what matters.
	}
	drop(id, 'closed');
}

function drop (id, state) {
	var link = links[id];
	if (!link) {
		return;
	}
	link.transfers.forEach(function (transfer) {
		if (transfer.state === 'sending' || transfer.state === 'receiving') {
			transfer.state = 'lost';
		}
	});
	// The grant was for this connection and goes with it: reconnecting asks again.
	link.granted = false;
	delete links[id];
	// A call is a connection too. Leaving it up would leave the microphone open and the
	// bar on screen for somebody who is no longer there.
	if (media && media.peerId === id) {
		clearCall('The connection to them went.');
	}
	if (deps.onUnshare) {
		deps.onUnshare(id);
	}
	announce();
}

export function send (id, message) {
	var link = links[id];
	if (!link || !link.conn || !link.conn.open) {
		return false;
	}
	link.conn.send(message);
	return true;
}

function ensurePings () {
	if (pingTimer) {
		return;
	}
	pingTimer = setInterval(function () {
		Object.keys(links).forEach(function (id) {
			send(id, {type: 'ping', at: Date.now()});
		});
	}, 3000);
}

// --- a shared folder --------------------------------------------------------------------
//
// One folder at a time, and the host approves every mount of it: holding a peer id gets
// you as far as asking. The grant lives for the connection and is not written anywhere --
// a remembered grant is exactly the thing nobody re-reads, and phase 16 deliberately has
// no pairing to hang one on.

var share = null;

export function getShare () {
	return share;
}

export function setShare (path) {
	var root = path ? normalizeAbsolute(path) : null;
	if (root === '/') {
		throw new Error('The whole filesystem cannot be shared — pick a folder.');
	}
	share = root;
	if (!share) {
		// Everyone who mounted it is told, rather than left holding a folder whose calls
		// have quietly started failing.
		Object.keys(links).forEach(function (id) {
			if (links[id].granted) {
				links[id].granted = false;
				send(id, {type: 'unshare'});
			}
		});
	}
	announce();
	return share;
}

function grantName () {
	return share ? share.split('/').pop() || share : '';
}

function onMountRequest (link) {
	if (!share) {
		send(link.id, {type: 'mount-no', reason: 'They are not sharing a folder.'});
		return;
	}
	Promise.resolve(deps.askMount ? deps.askMount({from: link.name, folder: share}) : false)
		.then(function (accepted) {
			if (!links[link.id]) {
				return;
			}
			if (!accepted || !share) {
				send(link.id, {type: 'mount-no', reason: 'They said no.'});
				return;
			}
			link.granted = true;
			announce();
			send(link.id, {type: 'mount-ok', name: grantName()});
		});
}

// Every call from a guest goes through here, and every one of them resolves its path
// against the share root before anything touches the filesystem.
async function onFsCall (link, message) {
	var reply = {type: 'fs-reply', id: message.id, ok: false, error: 'Refused', data: null};
	if (!link.granted || !share) {
		send(link.id, reply);
		return;
	}
	var target = resolveShared(share, message.path);
	if (!target) {
		// Deliberately the same answer as "not shared". A guest probing for what is on the
		// other side of the boundary learns nothing from the difference.
		send(link.id, reply);
		return;
	}
	try {
		if (message.op === 'readdir') {
			reply.data = entryNames(await deps.readdir(target));
		}
		else if (message.op === 'stat') {
			reply.data = statPayload(await deps.stat(target));
		}
		else {
			var stats = await deps.stat(target);
			if (stats && typeof stats.size === 'number' && stats.size > MAX_READ) {
				throw new Error('That file is larger than ' + formatBytes(MAX_READ)
					+ ', which is as much as a peer mount reads in one go.');
			}
			var bytes = await deps.readFile(target);
			reply.data = bytes.buffer
				? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
				: bytes;
		}
		reply.ok = true;
		reply.error = null;
	}
	catch (err) {
		reply.ok = false;
		reply.data = null;
		reply.error = (err && err.message) || 'Failed';
	}
	send(link.id, reply);
}

// --- mounting theirs ---------------------------------------------------------------------

var calls = {};
var nextCall = 1;

export function mountRequest (id) {
	var link = links[id];
	if (!link || link.state !== 'open') {
		return Promise.reject(new Error('Not connected to that peer.'));
	}
	if (link.mounting) {
		return link.mounting;
	}
	link.mounting = new Promise(function (resolve, reject) {
		link.onMountAnswer = function (message) {
			link.mounting = null;
			link.onMountAnswer = null;
			if (message.type === 'mount-ok') {
				resolve(message.name);
			}
			else {
				reject(new Error(message.reason));
			}
		};
		send(id, {type: 'mount-request'});
		setTimeout(function () {
			if (link.onMountAnswer) {
				link.onMountAnswer({type: 'mount-no', reason: 'They did not answer.'});
			}
		}, CALL_TIMEOUT);
	});
	return link.mounting;
}

// One call out, one reply back, and a deadline on every one of them: a mount whose calls
// hang is a file manager that never paints again.
export function fsCall (id, op, path) {
	return new Promise(function (resolve, reject) {
		var link = links[id];
		if (!link || link.state !== 'open') {
			reject(new Error('The connection to that peer is gone.'));
			return;
		}
		var callId = 'c' + (nextCall++);
		var timer = setTimeout(function () {
			if (calls[callId]) {
				delete calls[callId];
				reject(new Error('They did not answer in time.'));
			}
		}, CALL_TIMEOUT);
		calls[callId] = function (message) {
			clearTimeout(timer);
			delete calls[callId];
			if (message.ok) {
				resolve(message.data);
			}
			else {
				reject(new Error(message.error || 'Refused'));
			}
		};
		send(id, {type: 'fs-call', id: callId, op: op, path: path});
	});
}

// --- receiving ------------------------------------------------------------------------------

// --- the conversation ---------------------------------------------------------------------
//
// The one part of a peer connection that is *kept*. A file per peer under `CHAT_DIR`, so a
// conversation is a document: readable in Explorer, deletable in Explorer, and gone for
// good when it is deleted. That is the whole argument for a file rather than a table in
// `peers.json` — everything else in that file is settings, and a conversation is not.
//
// Three rules that are easy to get wrong and impossible to see afterwards. The **clock is
// always this machine's**, never the sender's (see `addChat`). A message is **appended and
// written, never rewritten** — the log is not a document two machines edit. And a peer that
// is not connected cannot leave you a message: there is no store-and-forward here and
// nothing pretending there is, so `sendChat` fails loudly rather than queueing into a void.

var chats = {};
// One chain for every write rather than one per peer. Writes are rare and the order
// between two different files does not matter, but two writes racing on the *same* file
// would interleave a whole-file JSON write, and the loser takes the log with it.
var chatWrites = Promise.resolve();
var typingSent = {};

function chatState (id) {
	if (!chats[id]) {
		chats[id] = {id: id, messages: [], unread: 0, loaded: false, noted: false, reading: false};
	}
	return chats[id];
}

function nameOf (id) {
	if (links[id]) {
		return links[id].name;
	}
	var remembered = settings.known.filter(function (entry) {
		return entry.id === id;
	})[0];
	return remembered ? remembered.name : id;
}

// Read once per peer, lazily: a machine with forty conversations should not read forty
// files at boot to draw a panel nobody has opened.
export async function loadChat (id) {
	var state = chatState(id);
	if (state.loaded) {
		return state.messages.slice();
	}
	state.loaded = true;
	var where = chatPath(id);
	if (where && deps.readChat) {
		try {
			state.messages = chatFrom(await deps.readChat(where));
		}
		catch (err) {
			// No file yet is the ordinary case, and a file that will not parse is handled
			// by chatFrom rather than here. Either way an empty conversation is the truth.
			state.messages = [];
		}
	}
	announce();
	return state.messages.slice();
}

export function chatOf (id) {
	return chatState(id).messages.slice();
}

export function chatSummary (id) {
	var state = chatState(id);
	return {id: id, name: nameOf(id), unread: state.unread, count: state.messages.length};
}

function record (id, entry) {
	chatWrites = chatWrites.then(function () {
		return loadChat(id);
	}).then(function () {
		var state = chatState(id);
		state.messages = addChat(state.messages, entry);
		announce();
		var where = chatPath(id);
		if (!where || !deps.writeChat) {
			return null;
		}
		return deps.writeChat(where, {
			id: id,
			// Whatever they were calling themselves when this was written. A name is
			// decoration and may change; the id is what the file is named after.
			name: nameOf(id),
			messages: state.messages
		});
	}).catch(function (err) {
		// The message is on screen either way. Saying so once is the honest answer: a
		// conversation that silently stops being written down is worse than one that says
		// it is not being written down.
		if (deps.onChatFailed) {
			deps.onChatFailed(err);
		}
	});
	return chatWrites;
}

export function sendChat (id, text) {
	var message = chatText(text);
	if (!message) {
		return Promise.resolve(null);
	}
	if (!send(id, {type: 'chat', text: message})) {
		return Promise.reject(new Error('They are not connected, so the message was not '
			+ 'sent. Nothing here holds a message for later.'));
	}
	return record(id, {text: message, way: 'out'}).then(function () {
		return message;
	});
}

// Throttled here rather than in the panel, so every surface that ever sends one gets the
// same rate and none of them has to remember to.
export function sendTyping (id) {
	var now = Date.now();
	if (typingSent[id] && now - typingSent[id] < 2500) {
		return false;
	}
	typingSent[id] = now;
	return send(id, {type: 'chat-typing'});
}

// Which conversation is on screen. Unread is not a count of messages received, it is a
// count of messages received *while you were not looking* — so the surface showing one has
// to say so, and only one can be open at a time.
export function readingChat (id) {
	Object.keys(chats).forEach(function (key) {
		chats[key].reading = false;
	});
	if (id) {
		var state = chatState(id);
		state.reading = true;
		state.unread = 0;
		state.noted = false;
	}
	announce();
}

export async function deleteChat (id) {
	var state = chatState(id);
	state.messages = [];
	state.unread = 0;
	state.loaded = true;
	var where = chatPath(id);
	if (where && deps.removeChat) {
		await deps.removeChat(where);
	}
	announce();
}

function chatArrived (link, message) {
	var state = chatState(link.id);
	// They have stopped typing: they have said it.
	link.typingAt = 0;
	record(link.id, {text: message.text, way: 'in'});
	if (state.reading) {
		announce();
		return;
	}
	state.unread++;
	// One note per peer until you look, not one per message. A conversation is a burst of
	// short lines, and a notification for each of six of them is six notifications.
	if (!state.noted && deps.onChat) {
		state.noted = true;
		deps.onChat({id: link.id, from: link.name, text: message.text});
	}
	announce();
}

// --- a call ---------------------------------------------------------------------------------
//
// Voice, and a screen. Both are arranged on the data channel first and only then does any
// media move, and that order carries most of the safety in this section: the question is
// this system's, asked and answered before a microphone is touched, so a refusal never
// reaches the media layer and a stranger cannot make the browser's own permission prompt
// appear on somebody's screen by knowing their id.
//
// Four rules hold the rest of it up. **One call at a time**, module-wide rather than per
// peer — a second offer is answered *busy*, because silence is indistinguishable from a
// machine that is off. **A media connection that was not agreed is closed unread**
// (`mediaAllowed`): `peer.on('call')` fires for anybody at all, so the closed list would
// mean nothing without it. **The offerer always places the media call**, which is what
// makes a screen share one-way without a second code path. And **every track is stopped**
// when a call ends, on every route out of one: a track left running keeps the browser's
// recording indicator lit after the call has gone from the screen, and a system that says
// it is listening while nothing on screen agrees is the worst bug this feature could have.

var media = null;
var mediaTimer = null;

function callView () {
	if (!media) {
		return null;
	}
	var link = links[media.peerId];
	return {
		id: media.id,
		peerId: media.peerId,
		name: nameOf(media.peerId),
		kind: media.kind,
		way: media.way,
		state: media.state,
		at: media.at || 0,
		muted: !!media.muted,
		farMuted: !!media.farMuted,
		ping: link ? medianPing(link.samples) : null,
		connected: !!link && link.state === 'open'
	};
}

export function getCall () {
	return callView();
}

// A MediaStream is a live handle on a microphone, not state, so it is fetched rather than
// announced. Putting one in the snapshot would put it in every subscriber's copy of the
// snapshot, and one of those copies outliving the call is an open microphone nothing is
// drawing a bar for.
export function getCallMedia () {
	return media ? {id: media.id, kind: media.kind, local: media.local || null, remote: media.remote || null} : null;
}

function stopStream (stream) {
	if (!stream || typeof stream.getTracks !== 'function') {
		return;
	}
	stream.getTracks().forEach(function (track) {
		try {
			track.stop();
		}
		catch (err) {
			// Already stopped. The point is that none is left running.
		}
	});
}

// The browser draws its own "Stop sharing" bar during a capture, and it is the one most
// people press. It is not this system's and it fires nothing this system would hear, so
// the track itself is watched. A microphone unplugged mid-call ends here too.
function watchEnded (stream, id) {
	if (!stream || typeof stream.getTracks !== 'function') {
		return;
	}
	stream.getTracks().forEach(function (track) {
		track.addEventListener('ended', function () {
			if (media && media.id === id) {
				endCall();
			}
		});
	});
}

// A call that never becomes a call has to end by itself, and both ends have to agree that
// it did — so the far side is told before the state goes.
function ring (id, ms, why) {
	clearTimeout(mediaTimer);
	mediaTimer = setTimeout(function () {
		if (media && media.id === id) {
			send(media.peerId, {type: 'call-end', id: id});
			clearCall(why);
		}
	}, ms);
}

function clearCall (detail) {
	clearTimeout(mediaTimer);
	mediaTimer = null;
	if (!media) {
		return;
	}
	var ended = callView();
	stopStream(media.local);
	if (media.conn) {
		try {
			media.conn.close();
		}
		catch (err) {
			// Already closed.
		}
	}
	// The question may still be on screen. Taking it back is the difference between a
	// note that stopped meaning anything and one that lies.
	if (media.withdraw) {
		media.withdraw();
	}
	media = null;
	announce();
	if (deps.onCallEnded) {
		deps.onCallEnded(ended, detail || null);
	}
}

export async function startCall (peerId, kind) {
	var want = callKind(kind);
	if (!want) {
		throw new Error('There is no such kind of call.');
	}
	if (media) {
		throw new Error('There is already a call. One at a time.');
	}
	var link = links[peerId];
	if (!link || link.state !== 'open') {
		throw new Error('Not connected to that peer.');
	}
	var id = newToken();
	// The slot is claimed before the browser is asked for anything, or two presses of the
	// button are two calls and the second one wins silently.
	media = {
		id: id,
		peerId: peerId,
		kind: want,
		way: 'out',
		state: 'offering',
		at: 0,
		muted: false,
		farMuted: false
	};
	announce();

	var stream;
	try {
		// Asked for *before* the offer goes out, and deliberately: pressing the button is
		// the user gesture the browser wants, and asking later — on their answer, with no
		// gesture behind it — is refused outright in some browsers. It also means you find
		// out your microphone is missing before somebody's screen starts ringing, and you
		// choose which window you are sharing before anyone is watching.
		stream = await deps.getMedia(want);
	}
	catch (err) {
		clearCall();
		throw new Error(describeMediaError(err, want));
	}
	if (!media || media.id !== id) {
		// Hung up, or the peer went, while the browser was still asking.
		stopStream(stream);
		return null;
	}
	media.local = stream;
	watchEnded(stream, id);
	if (!send(peerId, {type: 'call-offer', id: id, kind: want})) {
		// No detail, so no note: the caller is about to be told, and the same sentence
		// twice in two places reads as two failures.
		clearCall();
		throw new Error('Not connected to that peer.');
	}
	ring(id, RING_FOR, 'They did not answer.');
	announce();
	return id;
}

export async function acceptCall () {
	if (!media || media.state !== 'ringing') {
		return null;
	}
	var id = media.id;
	var kind = media.kind;
	var peerId = media.peerId;
	if (kind === 'voice') {
		var stream;
		try {
			stream = await deps.getMedia('voice');
		}
		catch (err) {
			// They are told *that* it could not be answered and never *why*: which devices
			// this machine has, and what its owner has refused, is nobody else's.
			refuseCall('They could not answer.');
			throw new Error(describeMediaError(err, 'voice'));
		}
		if (!media || media.id !== id) {
			stopStream(stream);
			return null;
		}
		media.local = stream;
		watchEnded(stream, id);
	}
	// A screen is watched, not swapped: nothing of yours is opened to look at one.
	media.state = 'connecting';
	// Answered here rather than on the note — the bar offers the same two buttons, and a
	// question still sitting on screen after it has been answered is a question that lies.
	if (media.withdraw) {
		media.withdraw();
		media.withdraw = null;
	}
	send(peerId, {type: 'call-accept', id: id});
	ring(id, MEDIA_TIMEOUT, 'The connection never opened.');
	announce();
	return id;
}

export function refuseCall (reason) {
	if (!media || media.state !== 'ringing') {
		return false;
	}
	send(media.peerId, {type: 'call-refuse', id: media.id, reason: reason || 'No.'});
	clearCall();
	return true;
}

// Cancelling an offer and hanging up a live call are the same act from here: stop, and say
// so. A call the far side thinks is still running is the failure being designed out.
export function endCall () {
	if (!media) {
		return false;
	}
	send(media.peerId, {type: 'call-end', id: media.id});
	clearCall();
	return true;
}

export function setMuted (muted) {
	if (!media) {
		return false;
	}
	media.muted = !!muted;
	if (media.local && typeof media.local.getAudioTracks === 'function') {
		media.local.getAudioTracks().forEach(function (track) {
			track.enabled = !media.muted;
		});
	}
	send(media.peerId, {type: 'call-mute', id: media.id, muted: media.muted});
	announce();
	return media.muted;
}

function goLive () {
	if (!media || media.state === 'live') {
		return;
	}
	clearTimeout(mediaTimer);
	mediaTimer = null;
	media.state = 'live';
	media.at = Date.now();
	announce();
}

function callOffered (link, message) {
	if (media) {
		// Busy is an answer. Dropping it would look, from the other end, exactly like a
		// machine that is switched off.
		send(link.id, {type: 'call-refuse', id: message.id, reason: 'They are already on a call.'});
		return;
	}
	media = {
		id: message.id,
		peerId: link.id,
		kind: message.kind,
		way: 'in',
		state: 'ringing',
		at: 0,
		muted: false,
		farMuted: false
	};
	// Rings for as long as the far side is prepared to wait, then stops on its own.
	ring(message.id, RING_FOR, 'It stopped ringing.');
	announce();

	var asked = deps.askCall
		? deps.askCall({id: link.id, from: link.name, kind: message.kind})
		: {answer: Promise.resolve(false), withdraw: null};
	media.withdraw = asked.withdraw || null;
	Promise.resolve(asked.answer).then(function (yes) {
		// Cancelled, timed out, or replaced while the question was on screen.
		if (!media || media.id !== message.id || media.state !== 'ringing') {
			return;
		}
		media.withdraw = null;
		if (!yes) {
			refuseCall('No.');
			return;
		}
		return acceptCall();
	}).catch(function (err) {
		if (deps.onCallFailed) {
			deps.onCallFailed(err);
		}
	});
}

function mine (link, message) {
	return !!media && media.id === message.id && media.peerId === link.id;
}

// The offer was taken. This side placed it, so this side places the media call too.
function callAccepted (link, message) {
	if (!mine(link, message) || media.state !== 'offering' || media.way !== 'out') {
		return;
	}
	media.state = 'connecting';
	ring(media.id, MEDIA_TIMEOUT, 'The connection never opened.');
	announce();
	if (!peer) {
		clearCall('The connection to the broker went.');
		return;
	}
	try {
		adoptMedia(peer.call(media.peerId, media.local, {metadata: {call: media.id}}));
	}
	catch (err) {
		clearCall(describeError(err));
	}
}

function adoptMedia (conn) {
	media.conn = conn;
	conn.on('stream', function (stream) {
		if (!media || media.conn !== conn) {
			return;
		}
		media.remote = stream;
		goLive();
		// Their media arrived here; theirs may never arrive there, because a screen share
		// sends nothing back. Saying so is what keeps the two bars agreeing.
		send(media.peerId, {type: 'call-live', id: media.id});
	});
	conn.on('close', function () {
		if (media && media.conn === conn) {
			clearCall('The call ended.');
		}
	});
	conn.on('error', function (err) {
		if (media && media.conn === conn) {
			clearCall(describeError(err));
		}
	});
}

function onIncomingMedia (conn) {
	// `peer.on('call')` fires for anybody who knows this machine's id, agreed or not. Only
	// the offer accepted a moment ago on the data channel is answered; everything else is
	// closed without a word, the same as a message that is not on the list.
	if (!mediaAllowed(media, conn.peer, conn.metadata)) {
		try {
			conn.close();
		}
		catch (err) {
			// Nothing to clean up: it was never adopted.
		}
		return;
	}
	conn.answer(media.kind === 'voice' ? media.local : undefined);
	adoptMedia(conn);
}

function receive (link, message) {
	// Not a message this system speaks. Dropped without an answer: a peer probing for what
	// is here should learn nothing from the reply it does not get.
	if (!message) {
		return;
	}
	switch (message.type) {
	case 'hello':
		link.name = message.name;
		settings.known = rememberPeer(settings.known, {id: link.id, name: link.name, at: Date.now()});
		save();
		announce();
		return;
	case 'ping':
		send(link.id, {type: 'pong', at: message.at});
		return;
	case 'pong':
		link.samples = addSample(link.samples, Date.now() - message.at);
		announce();
		return;
	case 'bye':
		drop(link.id, 'closed');
		return;
	case 'chat':
		chatArrived(link, message);
		return;
	case 'chat-typing':
		link.typingAt = Date.now();
		announce();
		return;
	case 'call-offer':
		callOffered(link, message);
		return;
	case 'call-accept':
		callAccepted(link, message);
		return;
	case 'call-refuse':
		if (mine(link, message) && media.way === 'out') {
			clearCall(message.reason);
		}
		return;
	case 'call-live':
		if (mine(link, message)) {
			goLive();
		}
		return;
	case 'call-end':
		if (mine(link, message)) {
			clearCall('The call ended.');
		}
		return;
	case 'call-mute':
		if (mine(link, message)) {
			media.farMuted = message.muted;
			announce();
		}
		return;
	case 'file-offer':
		offered(link, message);
		return;
	case 'file-accept':
		startSending(link, message.id);
		return;
	case 'file-refuse':
		finish(link, message.id, 'refused');
		return;
	case 'file-chunk':
		chunkArrived(link, message);
		return;
	case 'file-done':
		saveReceived(link, message.id);
		return;
	case 'mount-request':
		onMountRequest(link);
		return;
	case 'mount-ok':
	case 'mount-no':
		if (link.onMountAnswer) {
			link.onMountAnswer(message);
		}
		return;
	case 'unshare':
		if (deps.onUnshare) {
			deps.onUnshare(link.id);
		}
		return;
	case 'fs-call':
		onFsCall(link, message);
		return;
	case 'fs-reply':
		if (calls[message.id]) {
			calls[message.id](message);
		}
		return;
	}
}

function transferOf (link, id) {
	return link.transfers.filter(function (transfer) {
		return transfer.id === id;
	})[0] || null;
}

function finish (link, id, state) {
	var transfer = transferOf(link, id);
	if (transfer) {
		transfer.state = state;
		transfer.parts = null;
	}
	announce();
}

// An incoming file is a question, never an event. `deps.ask` is the shell's own surface --
// a notification with Accept and Refuse on it -- so this module does not draw anything.
function offered (link, message) {
	var transfer = {
		id: message.id,
		name: message.name,
		size: message.size,
		done: 0,
		way: 'in',
		state: 'offered',
		parts: []
	};
	link.transfers.push(transfer);
	announce();

	Promise.resolve(deps.ask ? deps.ask({
		from: link.name,
		name: message.name,
		size: message.size
	}) : false).then(function (accepted) {
		if (!links[link.id]) {
			return;
		}
		if (!accepted) {
			transfer.state = 'refused';
			transfer.parts = null;
			send(link.id, {type: 'file-refuse', id: message.id});
			announce();
			return;
		}
		transfer.state = 'receiving';
		send(link.id, {type: 'file-accept', id: message.id});
		announce();
	});
}

function chunkArrived (link, message) {
	var transfer = transferOf(link, message.id);
	if (!transfer || transfer.state !== 'receiving' || !transfer.parts) {
		return;
	}
	var bytes = message.data instanceof ArrayBuffer
		? new Uint8Array(message.data)
		: (message.data && message.data.byteLength !== undefined ? new Uint8Array(message.data) : null);
	if (!bytes) {
		return;
	}
	// The size was agreed in the offer. A peer that keeps sending past it is not going to
	// be allowed to keep filling memory.
	if (transfer.done + bytes.length > transfer.size) {
		transfer.state = 'refused';
		transfer.parts = null;
		send(link.id, {type: 'file-refuse', id: transfer.id});
		announce();
		return;
	}
	transfer.parts.push(bytes);
	transfer.done += bytes.length;
	announce();
}

async function saveReceived (link, id) {
	var transfer = transferOf(link, id);
	if (!transfer || !transfer.parts) {
		return;
	}
	try {
		var path = await deps.saveIncoming(transfer.name, transfer.parts);
		transfer.state = 'saved';
		transfer.path = path;
		transfer.parts = null;
		announce();
		if (deps.onSaved) {
			deps.onSaved({from: link.name, name: transfer.name, path: path});
		}
	}
	catch (err) {
		transfer.state = 'failed';
		transfer.parts = null;
		announce();
		if (deps.onFailed) {
			deps.onFailed({from: link.name, name: transfer.name, error: err});
		}
	}
}

// --- sending ---------------------------------------------------------------------------------

export async function sendFile (id, path) {
	var link = links[id];
	if (!link || link.state !== 'open') {
		throw new Error('Not connected to that peer.');
	}
	var file = await deps.readFile(path);
	var name = fileName(path.split('/').pop());
	if (file.length > MAX_FILE_SIZE) {
		throw new Error(name + ' is larger than the ' + formatBytes(MAX_FILE_SIZE)
			+ ' this can carry.');
	}
	var transfer = {
		id: newToken(),
		name: name,
		size: file.length,
		done: 0,
		way: 'out',
		state: 'offered',
		bytes: file
	};
	link.transfers.push(transfer);
	send(id, {type: 'file-offer', id: transfer.id, name: name, size: file.length});
	announce();
	return transfer.id;
}

function newToken () {
	return 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

// Chunked here rather than handed to the library whole, because progress is the point: a
// transfer with no number moving is indistinguishable from one that has stalled.
async function startSending (link, id) {
	var transfer = transferOf(link, id);
	if (!transfer || !transfer.bytes) {
		return;
	}
	transfer.state = 'sending';
	announce();

	var plan = chunkPlan(transfer.size);
	for (var i = 0; i < plan.length; i++) {
		if (!links[link.id] || transfer.state !== 'sending') {
			return;
		}
		var slice = transfer.bytes.slice(plan[i].at, plan[i].end);
		send(link.id, {
			type: 'file-chunk',
			id: transfer.id,
			at: plan[i].at,
			// A copy of the bytes, not a view onto a buffer the next slice will reuse.
			data: slice.buffer ? slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) : slice
		});
		transfer.done = plan[i].end;
		announce();
		// A breath between chunks, so a large file does not lock the tab up and the
		// progress it is reporting can actually be painted.
		await new Promise(function (resolve) {
			setTimeout(resolve, 0);
		});
	}
	send(link.id, {type: 'file-done', id: transfer.id});
	transfer.state = 'sent';
	transfer.bytes = null;
	announce();
}
