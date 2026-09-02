// Which tab is allowed to write the settings.
//
// Open PixOS twice and both tabs share one IndexedDB and one `/settings/session.json`.
// Both save on their own schedule, last writer wins, and neither knows the other exists —
// so arranging your windows in one tab and then closing the other quietly reverts them.
// Nothing guarded this.
//
// One tab is elected owner and is the only one that writes settings. A follower keeps full
// read/write access to *files*: it is the same filesystem, the user opened a second tab in
// order to use it, and crippling it would be inventing a restriction the system does not
// need.
//
// **What this does not fix, and must not be described as fixing:** two tabs writing the
// same file through BrowserFS still race. Electing an owner does nothing about that. The
// honest claim is "your desktop layout will not be clobbered", not "concurrent access is
// safe", and the bar the follower shows says exactly that.
//
// The election is a small state machine over four messages, kept separate from the
// BroadcastChannel so it can be tested without one:
//
//   hello   a tab has arrived and wants to know if anyone is in charge
//   owner   I am the owner (sent on election, and in reply to any hello)
//   yield   I am going away; whoever wants it, take it
//   claim   I am taking over from you
//
// First tab in wins: it says hello, nobody answers, and after a short wait it declares
// itself. A tab that hears `owner` while waiting becomes a follower instead.

// How long a new tab waits for an existing owner to answer before declaring itself. Long
// enough for a message to cross between two tabs on the same machine (which is immediate),
// short enough that a lone tab does not sit there unable to save.
var CLAIM_DELAY = 250;

var channel = null;
var id = null;
var owner = false;
var ownerId = null;
var settled = false;
var claimTimer = null;
var listeners = [];
var send = null;
var later = null;
var cancelLater = null;

export function init (cfg) {
	var config = cfg || {};
	id = config.id || (String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8));
	// Injected so the state machine can be driven by a fake in tests. The real ones are a
	// BroadcastChannel and setTimeout.
	send = config.send || null;
	later = config.setTimeout || function (fn, ms) { return setTimeout(fn, ms); };
	cancelLater = config.clearTimeout || function (timer) { return clearTimeout(timer); };

	owner = false;
	ownerId = null;
	settled = false;

	if (!send) {
		if (typeof BroadcastChannel !== 'function') {
			// One tab, as far as anyone can tell. A browser without BroadcastChannel must
			// not lose the ability to save its session over it.
			becomeOwner();
			return api();
		}
		channel = new BroadcastChannel(config.name || 'pixos');
		channel.onmessage = function (event) {
			receive(event.data);
		};
		send = function (message) {
			channel.postMessage(message);
		};
	}

	send({type: 'hello', from: id});
	claimTimer = later(function () {
		claimTimer = null;
		if (!settled) {
			becomeOwner();
		}
	}, config.claimDelay === undefined ? CLAIM_DELAY : config.claimDelay);

	return api();
}

function api () {
	return {isOwner: isOwner, ownerId: getOwnerId, takeOver: takeOver, release: release};
}

export function receive (message) {
	if (!message || message.from === id) {
		return;
	}
	if (message.type === 'hello') {
		// Answer, so the newcomer knows not to declare itself. A follower stays quiet:
		// two tabs both claiming to be owner is the state being avoided.
		if (owner) {
			send({type: 'owner', from: id});
		}
		return;
	}
	if (message.type === 'owner') {
		if (owner) {
			// Two owners, which two tabs opening in the same instant can produce. The tie
			// has to break the same way in both of them: comparing ids does that, where
			// "step aside politely" would have both yielding and nobody saving.
			if (String(message.from) > String(id)) {
				setOwner(false, message.from);
			}
			else {
				// Re-assert, because the other tab is waiting to hear exactly this.
				send({type: 'owner', from: id});
			}
			return;
		}
		settle(message.from);
		return;
	}
	if (message.type === 'claim') {
		// Someone is taking over. Step aside whether or not we agree: refusing would leave
		// two tabs both believing they are in charge, which is worse than either outcome.
		settle(message.from);
		return;
	}
	if (message.type === 'yield') {
		// The owner is going away. Everyone still here races for it; the tie-break in
		// `owner` above settles any collision.
		if (ownerId === message.from || ownerId === null) {
			becomeOwner();
		}
	}
}

function settle (nextOwnerId) {
	if (claimTimer !== null) {
		cancelLater(claimTimer);
		claimTimer = null;
	}
	settled = true;
	setOwner(false, nextOwnerId);
}

function becomeOwner () {
	if (claimTimer !== null) {
		cancelLater(claimTimer);
		claimTimer = null;
	}
	settled = true;
	setOwner(true, id);
	if (send) {
		send({type: 'owner', from: id});
	}
}

function setOwner (next, nextOwnerId) {
	var changed = next !== owner || nextOwnerId !== ownerId;
	owner = next;
	ownerId = nextOwnerId;
	if (changed) {
		listeners.slice().forEach(function (listener) {
			try {
				listener(owner, ownerId);
			}
			catch (err) {
				console.error('tabs listener failed', err);
			}
		});
	}
}

export function isOwner () {
	// Before the election settles, nobody writes. A quarter of a second of not saving is
	// nothing; two tabs both saving during that quarter second is the whole problem.
	return settled && owner;
}

export function getOwnerId () {
	return ownerId;
}

export function subscribe (listener) {
	listeners.push(listener);
	listener(owner, ownerId);
	return function () {
		listeners = listeners.filter(function (item) {
			return item !== listener;
		});
	};
}

// The user asking for this tab to be in charge.
export function takeOver () {
	if (owner) {
		return;
	}
	send({type: 'claim', from: id});
	becomeOwner();
}

// On pagehide: hand ownership on rather than leaving the remaining tabs following a tab
// that no longer exists and will never answer.
export function release () {
	if (owner && send) {
		send({type: 'yield', from: id});
	}
	owner = false;
}

// Test seam: forget everything between cases.
export function reset () {
	if (claimTimer !== null && cancelLater) {
		cancelLater(claimTimer);
	}
	if (channel) {
		channel.close();
	}
	channel = null;
	claimTimer = null;
	listeners = [];
	owner = false;
	ownerId = null;
	settled = false;
	send = null;
}
