// Who can reach this machine, and how well.
//
// The work in phase 16 is plumbing, and plumbing with no surface is plumbing nobody can
// check — but that is not the only reason this exists. "Who is connected to my computer
// right now" must have an answer somewhere on screen, in one place, with a button that
// ends it. A feature that opens a channel to another machine and then keeps quiet about it
// is the shape of the thing you regret shipping.
//
// It reads `peers.js` and calls it. It decides nothing: every rule about ids, names,
// latency and transfers lives in that module, where it is tested.

import * as peers from './peers.js';

var STYLE_ID = 'pixos-peers-style';

var CSS = `
.PixPeers {
	position: absolute;
	inset: 0 0 var(--pixos-taskbar-height, 38px) 0;
	background: rgba(14, 16, 20, .86);
	backdrop-filter: blur(2px);
	display: flex;
	flex-direction: column;
	font-family: Arial, Helvetica, sans-serif;
	color: #e4e4e4;
}

.PixPeers__head {
	flex: none;
	display: flex;
	align-items: baseline;
	gap: 12px;
	padding: 18px 22px 10px;
}

.PixPeers__title { font-size: 14px; letter-spacing: .04em; }
.PixPeers__hint { font-size: 11px; color: #8a919c; flex: 1 1 auto; }

.PixPeers__body {
	flex: 1 1 auto;
	overflow: auto;
	padding: 4px 22px 22px;
	display: flex;
	flex-direction: column;
	gap: 18px;
	max-width: 780px;
}

.PixPeers__card {
	border: 1px solid rgba(255, 255, 255, .1);
	background: rgba(24, 28, 34, .72);
	padding: 14px 16px;
}

.PixPeers__label {
	font-size: 10px;
	text-transform: uppercase;
	letter-spacing: .09em;
	color: #8a919c;
	margin-bottom: 9px;
}

.PixPeers__id {
	font-family: ui-monospace, Menlo, Consolas, monospace;
	font-size: 15px;
	word-break: break-all;
	color: #fff;
}

.PixPeers__note { font-size: 12px; color: #9aa2ae; margin-top: 8px; line-height: 1.5; }

.PixPeers__row {
	display: flex;
	align-items: center;
	gap: 10px;
	flex-wrap: wrap;
	margin-top: 10px;
}

.PixPeers button, .PixPeers input {
	font: inherit;
	font-size: 12px;
	padding: 5px 10px;
	color: #e4e4e4;
	background: rgba(255, 255, 255, .07);
	border: 1px solid rgba(255, 255, 255, .16);
	border-radius: 3px;
}

.PixPeers button { cursor: pointer; }
.PixPeers button:hover { background: rgba(255, 255, 255, .14); }
.PixPeers button.danger:hover { background: #7a3430; border-color: #a8564f; }
.PixPeers input { min-width: 260px; font-family: ui-monospace, Menlo, Consolas, monospace; }

.PixPeers__state {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	font-size: 12px;
	color: #c3c9d2;
}

.PixPeers__dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: #6b727d;
	flex: none;
}

.PixPeers__dot--online { background: #63c07a; }
.PixPeers__dot--connecting, .PixPeers__dot--reconnecting { background: #ffb648; }
.PixPeers__dot--offline, .PixPeers__dot--unavailable { background: #ff6b5e; }

.PixPeers__link {
	display: flex;
	align-items: center;
	gap: 12px;
	flex-wrap: wrap;
	padding: 10px 0;
	border-top: 1px solid rgba(255, 255, 255, .08);
}

.PixPeers__link:first-of-type { border-top: none; }
.PixPeers__name { font-size: 13px; color: #fff; }
.PixPeers__meta { font-size: 11px; color: #8a919c; font-variant-numeric: tabular-nums; }
.PixPeers__spacer { flex: 1 1 auto; }

/* Indented under the connection they belong to, because a flat column of them beside the
   peers reads as a list of peers. */
.PixPeers__transfer {
	padding: 3px 0 3px 18px;
	border-left: 1px solid rgba(255, 255, 255, .1);
	margin-left: 3px;
}

.PixPeers__transfer--done { opacity: .62; }

.PixPeers__bar {
	position: relative;
	width: 100%;
	max-width: 320px;
	height: 5px;
	margin-top: 5px;
	background: rgba(255, 255, 255, .12);
	overflow: hidden;
}

.PixPeers__barFill { position: absolute; inset: 0 auto 0 0; background: #6fb3ff; }

.PixPeers__empty { font-size: 12px; color: #8a919c; }

/* --- the conversation ------------------------------------------------------------------
   Its own column, and its own lifetime: everything to the left of it is thrown away and
   rebuilt on every state announcement, which happens every three seconds because that is
   how often a ping updates. Rebuilding a composer on that schedule would take the focus,
   the caret and the half-typed line with it. */

.PixPeers__panes { flex: 1 1 auto; display: flex; min-height: 0; }

.PixPeers__chat {
	flex: 1 1 380px;
	max-width: 520px;
	display: flex;
	flex-direction: column;
	min-height: 0;
	border-left: 1px solid rgba(255, 255, 255, .1);
	background: rgba(18, 21, 26, .6);
}

.PixPeers__chatHead {
	flex: none;
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 12px 16px 10px;
	border-bottom: 1px solid rgba(255, 255, 255, .08);
}

.PixPeers__chatWho { font-size: 13px; color: #fff; }
.PixPeers__chatState { font-size: 11px; color: #8a919c; }

.PixPeers__log {
	flex: 1 1 auto;
	overflow-y: auto;
	padding: 12px 16px;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.PixPeers__msg {
	max-width: 88%;
	padding: 6px 10px;
	border-radius: 10px;
	font-size: 13px;
	line-height: 1.45;
	/* A message is somebody else's text and may be a wall of it, or one word 400
	   characters long. Both have to stay inside this column. */
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	background: rgba(255, 255, 255, .07);
	align-self: flex-start;
}

.PixPeers__msg--out { align-self: flex-end; background: rgba(111, 179, 255, .18); }
.PixPeers__when { font-size: 10px; color: #8a919c; margin-top: 3px; }

.PixPeers__composer {
	flex: none;
	display: flex;
	gap: 8px;
	padding: 10px 16px 14px;
	border-top: 1px solid rgba(255, 255, 255, .08);
}

.PixPeers__composer textarea {
	flex: 1 1 auto;
	min-width: 0;
	resize: none;
	font: inherit;
	font-size: 13px;
	line-height: 1.4;
	padding: 6px 9px;
	color: #e4e4e4;
	background: rgba(255, 255, 255, .07);
	border: 1px solid rgba(255, 255, 255, .16);
	border-radius: 3px;
}

.PixPeers__composer textarea:disabled { opacity: .5; }

.PixPeers__badge {
	flex: none;
	min-width: 18px;
	padding: 1px 5px;
	border-radius: 9px;
	background: #6fb3ff;
	color: #10141a;
	font-size: 11px;
	font-weight: bold;
	text-align: center;
}

/* One column at a time when there is not room for two: a conversation squeezed into
   160px is not a conversation. */
@media (max-width: 720px) {
	.PixPeers--chatting .PixPeers__body { display: none; }
	.PixPeers__chat { max-width: none; border-left: none; }
}
`;

var host = null;
var element = null;
var body = null;
var deps = {};
var unsubscribe = null;
var latest = null;
// The conversation on screen, if any. Kept out of `render()` on purpose -- see the CSS.
var chatView = null;
// Half-typed lines, per peer, for as long as this panel object lives. Never written down:
// a draft is not a message, and the one place it must not turn up is the history file.
var drafts = {};

function ensureStyle () {
	if (document.getElementById(STYLE_ID)) {
		return;
	}
	var style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.append(style);
}

export function init (cfg) {
	deps = cfg || {};
	host = deps.host || null;
	ensureStyle();
}

export function isOpen () {
	return !!element;
}

export function toggle () {
	if (isOpen()) {
		close();
	}
	else {
		open();
	}
}

export function open () {
	if (element || !host) {
		return;
	}
	element = document.createElement('div');
	element.className = 'PixPeers';
	// The window in front is usually an app iframe, and a keystroke inside one never
	// reaches this document -- so an overlay that does not take the focus cannot be closed
	// with Esc by exactly the person who opened it over an app.
	element.tabIndex = -1;
	host.append(element);
	element.focus();

	element.onkeydown = function (e) {
		if (e.key === 'Escape') {
			e.preventDefault();
			close();
		}
	};

	unsubscribe = peers.subscribe(function (state) {
		latest = state;
		render();
	});

	// `/settings/peers.json` is a file a person edits, so it is re-read every time this
	// opens rather than only at boot. Without it, changing the broker looked like it had
	// done nothing until the whole system was restarted.
	peers.load().catch(function (err) {
		say(err.message);
	});

	if (deps.onToggle) {
		deps.onToggle(true);
	}
}

export function close () {
	if (!element) {
		return;
	}
	if (unsubscribe) {
		unsubscribe();
		unsubscribe = null;
	}
	// Nothing is on screen, so nothing is being read: the next message from anyone counts
	// as unread and raises its note.
	peers.readingChat(null);
	chatView = null;
	element.remove();
	element = null;
	body = null;
	if (deps.onToggle) {
		deps.onToggle(false);
	}
}

// Open the panel *and* a conversation. This is what a message notification presses, so it
// has to work from nothing on screen at all.
export function openChat (id) {
	open();
	showChat(id);
}

function card (title) {
	var box = document.createElement('div');
	box.className = 'PixPeers__card';
	var label = document.createElement('div');
	label.className = 'PixPeers__label';
	label.textContent = title;
	box.append(label);
	return box;
}

function button (text, run, danger) {
	var element = document.createElement('button');
	element.type = 'button';
	element.textContent = text;
	element.className = danger ? 'danger' : '';
	element.onclick = run;
	return element;
}

function note (box, text) {
	var line = document.createElement('div');
	line.className = 'PixPeers__note';
	line.textContent = text;
	box.append(line);
	return line;
}

// Only the left column is thrown away and rebuilt. The conversation is a living element
// with a caret in it, and this runs every three seconds.
function render () {
	if (!element || !latest) {
		return;
	}
	if (!body) {
		var head = document.createElement('div');
		head.className = 'PixPeers__head';
		var title = document.createElement('div');
		title.className = 'PixPeers__title';
		title.textContent = 'Peers';
		var hint = document.createElement('div');
		hint.className = 'PixPeers__hint';
		hint.textContent = 'Esc closes';
		head.append(title, hint, button('Close', close));

		var panes = document.createElement('div');
		panes.className = 'PixPeers__panes';
		body = document.createElement('div');
		body.className = 'PixPeers__body';
		panes.append(body);
		element.append(head, panes);
	}

	body.innerHTML = '';
	body.append(machineCard(), shareCard(), connectCard(), linksCard(), knownCard());
	refreshChat();
}

function machineCard () {
	var box = card('This machine');

	var id = document.createElement('div');
	id.className = 'PixPeers__id';
	id.textContent = latest.id || 'no id yet';
	box.append(id);

	var state = document.createElement('div');
	state.className = 'PixPeers__row';
	var chip = document.createElement('span');
	chip.className = 'PixPeers__state';
	var dot = document.createElement('span');
	dot.className = 'PixPeers__dot PixPeers__dot--' + latest.status;
	var text = document.createElement('span');
	text.textContent = latest.detail;
	chip.append(dot, text);
	state.append(chip);
	box.append(state);

	var actions = document.createElement('div');
	actions.className = 'PixPeers__row';
	actions.append(button('Copy id', function () {
		copy(latest.id);
	}));
	if (latest.status !== 'online' && latest.owner) {
		actions.append(button('Go online', function () {
			peers.start().catch(function (err) {
				say(err.message);
			});
		}));
	}
	if (latest.status === 'online') {
		actions.append(button('Go offline', function () {
			peers.stop();
		}));
	}
	// Deliberately not one press: every peer that knows this machine stops being able to
	// reach it, and nothing anywhere else can undo that.
	actions.append(button('New id…', function () {
		if (window.confirm('Give this machine a new peer id?\n\nEveryone who has the old '
			+ 'one will no longer be able to reach you, and there is no way back to it.')) {
			peers.resetIdentity();
		}
	}, true));
	box.append(actions);

	// Naming the broker is not a detail. It is the one party in this that is neither of
	// the two machines, and it is an internet service unless somebody changed it.
	note(box, 'Introduced by ' + (latest.activeBroker || latest.broker) + '. Two peers talk '
		+ 'directly once they have been introduced, but the broker is how they find each '
		+ 'other — set your own in ' + peers.SETTINGS_PATH + ' to keep that on your network.');

	// The file changed under a live connection. Said rather than acted on: dropping a
	// working connection because somebody opened this panel would be worse than waiting to
	// be told to.
	if (latest.brokerStale) {
		note(box, 'The settings now name ' + latest.broker + ', but this connection was '
			+ 'made through ' + latest.activeBroker + '. Go offline and online again to use '
			+ 'the new one.');
	}
	note(box, 'This id is stable, so a peer that knows it can reach this machine whenever '
		+ 'PixOS is open here. Give it out the way you would a phone number.');

	if (!latest.owner) {
		note(box, 'Another tab of PixOS holds the connection. A peer id can only be '
			+ 'registered with a broker once, so this tab is watching rather than '
			+ 'connecting.');
	}
	return box;
}

// What this machine is offering, said plainly and in one place. A system that opens a
// folder to another computer and then does not say which folder, or to whom, is the shape
// of the thing you regret.
function shareCard () {
	var box = card('A folder you are sharing');
	if (!latest.share) {
		var empty = document.createElement('div');
		empty.className = 'PixPeers__empty';
		empty.textContent = 'Nothing is shared. Right-click a folder in Explorer → '
			+ 'Share with peers.';
		box.append(empty);
		return box;
	}

	var path = document.createElement('div');
	path.className = 'PixPeers__id';
	path.textContent = latest.share;
	box.append(path);

	var holders = latest.links.filter(function (link) {
		return link.granted;
	});
	note(box, holders.length
		? 'Open right now by: ' + holders.map(function (link) { return link.name; }).join(', ')
			+ '. Read-only — they cannot change anything in it.'
		: 'Nobody has it open. Each peer has to ask, and you answer.');

	var row = document.createElement('div');
	row.className = 'PixPeers__row';
	row.append(button('Stop sharing', function () {
		peers.setShare(null);
	}, true));
	box.append(row);
	return box;
}

function connectCard () {
	var box = card('Connect to a peer');
	var row = document.createElement('div');
	row.className = 'PixPeers__row';

	var input = document.createElement('input');
	input.placeholder = 'pixos-…';
	input.spellcheck = false;
	var go = button('Connect', function () {
		var value = input.value.trim();
		peers.connect(value).then(function () {
			input.value = '';
		}, function (err) {
			say(err.message);
		});
	});
	input.onkeydown = function (e) {
		if (e.key === 'Enter') {
			go.onclick();
		}
	};
	row.append(input, go);
	box.append(row);
	note(box, 'Ask them to open this panel and press Copy id.');
	return box;
}

function linksCard () {
	var box = card('Connected now');
	if (!latest.links.length) {
		var empty = document.createElement('div');
		empty.className = 'PixPeers__empty';
		empty.textContent = 'Nobody is connected to this machine.';
		box.append(empty);
		return box;
	}

	latest.links.forEach(function (link) {
		var row = document.createElement('div');
		row.className = 'PixPeers__link';

		var name = document.createElement('div');
		name.className = 'PixPeers__name';
		name.textContent = link.name;

		var meta = document.createElement('div');
		meta.className = 'PixPeers__meta';
		meta.textContent = link.id + ' · ' + (link.state === 'open'
			? peers.describePing(link.ping)
			: link.state);

		var spacer = document.createElement('div');
		spacer.className = 'PixPeers__spacer';

		row.append(name, meta, spacer);
		row.append(chatButton(link.id, link.unread));
		if (link.state === 'open') {
			row.append(button('Open their folder', function () {
				Promise.resolve(deps.onMount ? deps.onMount(link.id) : null).catch(function (err) {
					say(err.message);
				});
			}));
		}
		// Only offered when there is something to clear, so the row does not carry a
		// button that does nothing for the whole time nothing has been sent.
		if (link.transfers.some(peers.isFinished)) {
			row.append(button('Clear finished', function () {
				peers.clearFinished(link.id);
			}));
		}
		row.append(button('Disconnect', function () {
			peers.disconnect(link.id);
		}, true));

		var wrap = document.createElement('div');
		wrap.append(row);
		link.transfers.forEach(function (transfer) {
			wrap.append(transferRow(transfer));
		});
		box.append(wrap);
	});
	return box;
}

function transferRow (transfer) {
	var done = peers.isFinished(transfer);
	var wrap = document.createElement('div');
	wrap.className = 'PixPeers__transfer' + (done ? ' PixPeers__transfer--done' : '');

	var progress = peers.progressOf(transfer);
	var line = document.createElement('div');
	line.className = 'PixPeers__meta';
	// A finished transfer says how it ended and how much of it went; one still running
	// says how far it has got. The two are not the same sentence.
	line.textContent = (transfer.way === 'in' ? '↓ ' : '↑ ') + transfer.name + ' · '
		+ transfer.state + (done ? '' : ' · ' + progress.label);
	wrap.append(line);

	// A bar only while something is still moving. A row of full bars under a connection is
	// a history pretending to be work in progress.
	if (!done) {
		var bar = document.createElement('div');
		bar.className = 'PixPeers__bar';
		var fill = document.createElement('div');
		fill.className = 'PixPeers__barFill';
		fill.style.width = (progress.ratio * 100) + '%';
		bar.append(fill);
		wrap.append(bar);
	}
	return wrap;
}

function knownCard () {
	var box = card('Peers you have connected to before');
	if (!latest.known.length) {
		var empty = document.createElement('div');
		empty.className = 'PixPeers__empty';
		empty.textContent = 'None yet.';
		box.append(empty);
		return box;
	}
	latest.known.forEach(function (entry) {
		var row = document.createElement('div');
		row.className = 'PixPeers__link';
		var name = document.createElement('div');
		name.className = 'PixPeers__name';
		name.textContent = entry.name;
		var meta = document.createElement('div');
		meta.className = 'PixPeers__meta';
		meta.textContent = entry.id;
		var spacer = document.createElement('div');
		spacer.className = 'PixPeers__spacer';
		var conversation = (latest.chats || []).filter(function (chat) {
			return chat.id === entry.id;
		})[0];
		row.append(name, meta, spacer);
		// A conversation outlives the connection it happened on, so it is reachable from
		// the address book too — read it, and delete it, without connecting to anybody.
		row.append(chatButton(entry.id, conversation ? conversation.unread : 0));
		row.append(button('Connect', function () {
			peers.connect(entry.id).catch(function (err) {
				say(err.message);
			});
		}), button('Forget', function () {
			peers.forget(entry.id);
		}, true));
		box.append(row);
	});
	note(box, 'Forgetting somebody takes them off this list. It does not delete what you '
		+ 'said to each other — that is a file, and it is deleted from the conversation.');
	return box;
}

// --- the conversation ---------------------------------------------------------------------

function showChat (id) {
	if (!element || !id) {
		return;
	}
	if (chatView && chatView.id === id) {
		chatView.input.focus();
		return;
	}
	hideChat();

	var root = document.createElement('div');
	root.className = 'PixPeers__chat';

	var head = document.createElement('div');
	head.className = 'PixPeers__chatHead';
	var who = document.createElement('div');
	who.className = 'PixPeers__chatWho';
	var state = document.createElement('div');
	state.className = 'PixPeers__chatState';
	var spacer = document.createElement('div');
	spacer.className = 'PixPeers__spacer';
	head.append(who, state, spacer, button('Delete…', function () {
		if (window.confirm('Delete this conversation?\n\nThe file it is kept in goes with '
			+ 'it, and there is no copy anywhere else.')) {
			peers.deleteChat(id).then(refreshChat, function (err) {
				say(err.message);
			});
		}
	}, true), button('Close', hideChat));

	var log = document.createElement('div');
	log.className = 'PixPeers__log';

	var composer = document.createElement('div');
	composer.className = 'PixPeers__composer';
	var input = document.createElement('textarea');
	input.rows = 2;
	input.spellcheck = true;
	var sendButton = button('Send', function () {
		submit();
	});
	composer.append(input, sendButton);

	function submit () {
		var text = input.value;
		if (!text.trim()) {
			return;
		}
		input.value = '';
		drafts[id] = '';
		peers.sendChat(id, text).then(refreshChat, function (err) {
			// Put it back rather than losing it: the message was not sent, and retyping
			// it is not a reasonable thing to ask.
			input.value = text;
			drafts[id] = text;
			say(err.message);
		});
	}

	input.oninput = function () {
		drafts[id] = input.value;
		if (input.value.trim()) {
			peers.sendTyping(id);
		}
	};
	input.onkeydown = function (e) {
		// Enter sends and Shift+Enter is a new line, which is what every other chat in the
		// world does. Escape closes the conversation and leaves the panel: the panel's own
		// Escape would close everything, and the draft with it.
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
		else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			hideChat();
		}
	};

	root.append(head, log, composer);
	element.querySelector('.PixPeers__panes').append(root);
	element.classList.add('PixPeers--chatting');

	chatView = {id: id, root: root, log: log, input: input, send: sendButton, who: who, state: state, drawn: 0};
	input.value = drafts[id] || '';
	// This is what makes an arriving message read rather than unread, and it is the whole
	// reason the module has to be told: "on screen" is not something it can work out.
	peers.readingChat(id);
	peers.loadChat(id).then(refreshChat, function () {});
	refreshChat();
	input.focus();
}

function hideChat () {
	if (!chatView) {
		return;
	}
	drafts[chatView.id] = chatView.input.value;
	chatView.root.remove();
	chatView = null;
	if (element) {
		element.classList.remove('PixPeers--chatting');
	}
	peers.readingChat(null);
}

function refreshChat () {
	if (!chatView || !element || !latest) {
		return;
	}
	var id = chatView.id;
	var link = (latest.links || []).filter(function (candidate) {
		return candidate.id === id;
	})[0];
	var connected = !!link && link.state === 'open';

	chatView.who.textContent = link ? link.name : peers.chatSummary(id).name;
	chatView.state.textContent = !link
		? 'not connected'
		: (link.state !== 'open'
			? link.state
			: (link.typing ? 'typing…' : peers.describePing(link.ping)));

	var messages = peers.chatOf(id);
	// Deleted, or a shorter log than what is drawn: start again. Otherwise only what is
	// new is added, because redrawing the column would lose the scroll position every
	// three seconds.
	if (messages.length < chatView.drawn) {
		chatView.log.innerHTML = '';
		chatView.drawn = 0;
	}
	if (messages.length > chatView.drawn) {
		// Follow the conversation only if you were already at the bottom of it: appending
		// while somebody is reading back through it would yank them away.
		var pinned = chatView.log.scrollHeight - chatView.log.scrollTop - chatView.log.clientHeight < 40;
		messages.slice(chatView.drawn).forEach(function (message) {
			chatView.log.append(messageRow(message));
		});
		chatView.drawn = messages.length;
		if (pinned) {
			chatView.log.scrollTop = chatView.log.scrollHeight;
		}
	}
	if (!messages.length && !chatView.log.firstChild) {
		var empty = document.createElement('div');
		empty.className = 'PixPeers__empty';
		empty.textContent = 'Nothing said yet.';
		chatView.log.append(empty);
	}

	// Only when it changes: assigning `disabled` to an already-disabled field is free, but
	// assigning it to the focused one is not.
	if (chatView.input.disabled !== !connected) {
		chatView.input.disabled = !connected;
		chatView.send.disabled = !connected;
	}
	chatView.input.placeholder = connected
		? 'Message ' + (link ? link.name : '')
		: 'Not connected. Nothing here holds a message for later.';
}

function messageRow (message) {
	var row = document.createElement('div');
	row.className = 'PixPeers__msg' + (message.way === 'out' ? ' PixPeers__msg--out' : '');
	var text = document.createElement('div');
	// Somebody else's words, drawn as text. This is the one line that matters most in
	// this file.
	text.textContent = message.text;
	var when = document.createElement('div');
	when.className = 'PixPeers__when';
	var at = new Date(message.at || 0);
	when.textContent = message.at ? at.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '';
	when.title = message.at ? at.toLocaleString() : '';
	row.append(text, when);
	return row;
}

function chatButton (id, unread) {
	var wrap = document.createElement('span');
	wrap.className = 'PixPeers__state';
	wrap.append(button('Chat', function () {
		showChat(id);
	}));
	if (unread) {
		var badge = document.createElement('span');
		badge.className = 'PixPeers__badge';
		badge.textContent = unread > 99 ? '99+' : String(unread);
		wrap.append(badge);
	}
	return wrap;
}

// The clipboard can refuse -- a frame without permission, an insecure context -- so this
// falls back the way Explorer's copy does rather than doing nothing and looking broken.
function copy (text) {
	if (!text) {
		return;
	}
	var fallback = function () {
		var area = document.createElement('textarea');
		area.value = text;
		area.style.position = 'fixed';
		area.style.opacity = '0';
		document.body.append(area);
		area.select();
		var ok = false;
		try {
			ok = document.execCommand('copy');
		}
		catch (err) {
			ok = false;
		}
		area.remove();
		say(ok ? 'Peer id copied.' : 'The browser would not let this page copy. The id is '
			+ text);
	};
	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(text).then(function () {
			say('Peer id copied.');
		}, fallback);
		return;
	}
	fallback();
}

function say (message) {
	if (typeof window.notify === 'function') {
		window.notify({level: 'info', title: 'Peers', message: message, source: 'PixOS'});
	}
}
