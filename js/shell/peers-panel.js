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
`;

var host = null;
var element = null;
var deps = {};
var unsubscribe = null;
var latest = null;

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
	element.remove();
	element = null;
	if (deps.onToggle) {
		deps.onToggle(false);
	}
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

function render () {
	if (!element || !latest) {
		return;
	}
	element.innerHTML = '';

	var head = document.createElement('div');
	head.className = 'PixPeers__head';
	var title = document.createElement('div');
	title.className = 'PixPeers__title';
	title.textContent = 'Peers';
	var hint = document.createElement('div');
	hint.className = 'PixPeers__hint';
	hint.textContent = 'Esc closes';
	head.append(title, hint, button('Close', close));
	element.append(head);

	var body = document.createElement('div');
	body.className = 'PixPeers__body';
	element.append(body);

	body.append(machineCard(), shareCard(), connectCard(), linksCard(), knownCard());
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
		row.append(name, meta, spacer, button('Connect', function () {
			peers.connect(entry.id).catch(function (err) {
				say(err.message);
			});
		}), button('Forget', function () {
			peers.forget(entry.id);
		}, true));
		box.append(row);
	});
	return box;
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
