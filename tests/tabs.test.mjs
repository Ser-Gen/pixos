// Which tab is allowed to write the settings.
//
// Two tabs of PixOS share one IndexedDB and one /settings/session.json, both save on their
// own schedule, and last writer wins — so arranging windows in one tab and closing the
// other silently reverts them. The election is a state machine over four messages, and it
// is kept separate from BroadcastChannel precisely so it can be driven by hand here.
//
// The property that matters is not "someone is in charge". It is that **at no point are
// two tabs both in charge** — including the quarter-second before a new tab has heard back
// from anyone, and including the moment an owner goes away.

import {check, report} from './assert.mjs';
import * as tabs from '../js/shell/tabs.js';

// A bus every tab is on, with timers the test fires by hand. Each "tab" is one import of
// the module, which JavaScript will not give us twice — so instead the module is
// re-initialised per tab and the messages are routed to whichever tab is being spoken to.
// That is enough to test the machine: it makes exactly one decision at a time.
function makeTab (name, bus, options) {
	const timers = [];
	const sent = [];
	const tab = {
		name: name,
		sent: sent,
		timers: timers,
		fire () {
			const due = timers.splice(0, timers.length);
			due.forEach(fn => fn());
		}
	};
	tabs.reset();
	tabs.init(Object.assign({
		id: name,
		send (message) {
			sent.push(message);
			bus.push({from: name, message: message});
		},
		setTimeout (fn) {
			timers.push(fn);
			return timers.length;
		},
		clearTimeout (index) {
			timers[index - 1] = () => {};
		}
	}, options || {}));
	tab.isOwner = () => tabs.isOwner();
	tab.ownerId = () => tabs.getOwnerId();
	tab.receive = message => tabs.receive(message);
	tab.takeOver = () => tabs.takeOver();
	tab.release = () => tabs.release();
	return tab;
}

// --- one tab, alone ---------------------------------------------------------------------

let bus = [];
let one = makeTab('one', bus);

check('a new tab announces itself', one.sent, [{type: 'hello', from: 'one'}]);
check('and does not write anything before it knows', one.isOwner(), false);

one.fire();
check('nobody answered, so it takes charge', one.isOwner(), true);
check('and says so, in case a tab arrives later',
	one.sent[one.sent.length - 1], {type: 'owner', from: 'one'});

// --- a second tab arrives ------------------------------------------------------------------

bus = [];
const second = makeTab('two', bus);
check('the newcomer waits rather than assuming', second.isOwner(), false);

second.receive({type: 'owner', from: 'one'});
check('hearing an owner makes it a follower', second.isOwner(), false);
check('and it knows which tab is in charge', second.ownerId(), 'one');

second.fire();
check('the timer that would have made it an owner does not fire', second.isOwner(), false);

// A follower must not answer a third tab's hello: two tabs both claiming would be worse
// than the problem being solved.
const before = second.sent.length;
second.receive({type: 'hello', from: 'three'});
check('a follower stays quiet when asked who is in charge', second.sent.length, before);

// --- the owner answers -----------------------------------------------------------------------

bus = [];
const owner = makeTab('one', bus);
owner.fire();
owner.sent.length = 0;
owner.receive({type: 'hello', from: 'two'});
check('an owner answers a newcomer', owner.sent, [{type: 'owner', from: 'one'}]);

owner.receive({type: 'hello', from: 'one'});
check('and ignores its own message coming back round', owner.sent.length, 1);

// --- the owner goes away ------------------------------------------------------------------

bus = [];
const follower = makeTab('two', bus);
follower.receive({type: 'owner', from: 'one'});
check('following', follower.isOwner(), false);

follower.receive({type: 'yield', from: 'one'});
check('the owner leaving promotes whoever is left', follower.isOwner(), true);
check('and it announces itself', follower.sent[follower.sent.length - 1], {type: 'owner', from: 'two'});

// A yield from a tab that was not the owner changes nothing.
bus = [];
const bystander = makeTab('three', bus);
bystander.receive({type: 'owner', from: 'one'});
bystander.receive({type: 'yield', from: 'nine'});
check('a stranger leaving does not promote anyone', bystander.isOwner(), false);
check('and the owner is unchanged', bystander.ownerId(), 'one');

// --- taking over by hand --------------------------------------------------------------------

bus = [];
const taker = makeTab('two', bus);
taker.receive({type: 'owner', from: 'one'});
taker.takeOver();
check('taking over makes this tab the owner', taker.isOwner(), true);
check('and tells the previous one', taker.sent.some(m => m.type === 'claim'), true);

const already = makeTab('one', bus);
already.fire();
already.sent.length = 0;
already.takeOver();
check('taking over when already the owner is a no-op', already.sent, []);

// The tab being taken from steps aside without arguing. Refusing would leave two tabs each
// believing they are in charge, which is the one outcome worse than either.
bus = [];
const displaced = makeTab('one', bus);
displaced.fire();
displaced.receive({type: 'claim', from: 'two'});
check('a claim is not contested', displaced.isOwner(), false);
check('and the new owner is recorded', displaced.ownerId(), 'two');

// --- two tabs both think they own it -----------------------------------------------------------
//
// Possible if two tabs open in the same instant and neither hears the other's hello. Both
// then hear the other's `owner`. The tie has to break the same way in both, or they either
// both yield (nobody saves) or both hold (the original problem).

bus = [];
const high = makeTab('zzz', bus);
high.fire();
high.receive({type: 'owner', from: 'aaa'});
check('the tab with the higher id keeps it', high.isOwner(), true);
check('and re-asserts, so the other one hears', high.sent[high.sent.length - 1], {type: 'owner', from: 'zzz'});

bus = [];
const low = makeTab('aaa', bus);
low.fire();
low.receive({type: 'owner', from: 'zzz'});
check('the tab with the lower id yields', low.isOwner(), false);
check('to the other one', low.ownerId(), 'zzz');

// --- a browser with no BroadcastChannel ------------------------------------------------------
//
// Nothing can be coordinated, so nothing is: the tab must not lose the ability to save its
// session over a feature it does not have.

tabs.reset();
const realChannel = globalThis.BroadcastChannel;
delete globalThis.BroadcastChannel;
const solo = tabs.init({id: 'solo'});
check('with no way to ask, the tab owns the session', solo.isOwner(), true);
globalThis.BroadcastChannel = realChannel;

// --- subscribers ------------------------------------------------------------------------------

tabs.reset();
const seen = [];
const stop = tabs.subscribe((isOwner, ownerId) => seen.push([isOwner, ownerId]));
check('a subscriber is told the current state immediately', seen, [[false, null]]);

const watched = makeTab('one', []);
// reset() inside makeTab drops the subscriber, which is the documented behaviour of a test
// seam; re-subscribe against the live machine instead.
const seenAfter = [];
tabs.subscribe((isOwner, ownerId) => seenAfter.push([isOwner, ownerId]));
watched.fire();
check('and told again when it changes', seenAfter[seenAfter.length - 1], [true, 'one']);
stop();

process.exit(report('tabs') ? 1 : 0);
