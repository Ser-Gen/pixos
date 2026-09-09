// A call, on screen, outside everything else.
//
// The Peers panel is where a call is *started*, and it is the wrong place for a call to
// live: the panel is an overlay you close with Esc, and closing the window you were
// looking at must not be the same gesture as hanging up on somebody. So this is a second
// surface, small and always in front, and it exists for exactly as long as there is a
// call.
//
// It decides nothing. Whether a call may start, who is on it, when it is live and what
// happens to the tracks is all `peers.js`, where it is tested; this reads a snapshot and
// draws it.
//
// Three things about it are load-bearing.
//
// **The bar is built once and updated in place.** A ping lands every three seconds and
// every ping is a state announcement, so a bar rebuilt on each one would replace the
// *Hang up* button under a moving finger three times a minute. Only text and labels
// change; the elements do not.
//
// **A media element is never re-attached to the same stream.** Assigning `srcObject` again
// restarts playback, and on a screen share that is a black flash every three seconds.
//
// **`hidden` is not enough on its own.** The viewer has a `display` from a rule in this
// sheet, and an author rule that sets `display` beats the browser's own `[hidden]` rule —
// cascade origin, not specificity. The same trap ate two of filmoskop's overlays, so the
// `!important` line below is deliberate and is not to be tidied away.

import * as peers from './peers.js';

var STYLE_ID = 'pixos-call-style';

var CSS = `
.PixCall {
	position: absolute;
	left: 50%;
	transform: translateX(-50%);
	/* Top centre, not bottom. The note stack is anchored bottom-right and is drawn above
	   every other overlay, so a bar down there would have its right-hand end -- which is
	   where *Hang up* is -- covered by the very question that started the call. */
	top: 14px;
	z-index: 2;
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 9px 12px;
	border: 1px solid rgba(255, 255, 255, .16);
	border-radius: 6px;
	background: rgba(18, 21, 26, .94);
	backdrop-filter: blur(3px);
	box-shadow: 0 8px 26px rgba(0, 0, 0, .45);
	font-family: Arial, Helvetica, sans-serif;
	font-size: 12px;
	color: #e4e4e4;
	max-width: min(680px, calc(100vw - 24px));
}

.PixCall__dot {
	width: 9px;
	height: 9px;
	border-radius: 50%;
	background: #ffb648;
	flex: none;
}

.PixCall__dot--live { background: #63c07a; }

.PixCall__text { min-width: 0; }
.PixCall__who { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.PixCall__meta { font-size: 11px; color: #8a919c; margin-top: 2px; }

.PixCall button {
	font: inherit;
	font-size: 12px;
	padding: 5px 10px;
	color: #e4e4e4;
	background: rgba(255, 255, 255, .07);
	border: 1px solid rgba(255, 255, 255, .16);
	border-radius: 3px;
	cursor: pointer;
	flex: none;
}

.PixCall button:hover { background: rgba(255, 255, 255, .14); }
.PixCall button.danger:hover { background: #7a3430; border-color: #a8564f; }
.PixCall button.go { background: rgba(99, 192, 122, .18); border-color: rgba(99, 192, 122, .5); }
.PixCall button.go:hover { background: rgba(99, 192, 122, .3); }
.PixCall button.on { background: rgba(255, 182, 72, .2); border-color: rgba(255, 182, 72, .55); }

.PixCall__viewer {
	position: absolute;
	inset: 0 0 var(--pixos-taskbar-height, 38px) 0;
	z-index: 1;
	background: #08090b;
	display: flex;
	align-items: center;
	justify-content: center;
	outline: none;
}

.PixCall__viewer video {
	max-width: 100%;
	max-height: 100%;
	background: #000;
}

/* An author rule above sets a display, and that beats the browser's own [hidden] rule.
   Without this line the viewer cannot be hidden at all. */
.PixCall [hidden], .PixCall__viewer[hidden] { display: none !important; }

.PixCall__media { display: none; }
`;

var host = null;
var element = null;
var viewer = null;
var video = null;
var audio = null;
var parts = null;
var deps = {};
var latest = null;
var timer = null;
// What is currently attached to which element, so a stream is never assigned twice.
var attached = {audio: null, video: null};
// Whether the viewer is on screen. Not derived from the call: a screen share you have
// hidden to get on with something is still a screen share.
var showing = false;

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
	peers.subscribe(function (state) {
		latest = state;
		render();
	});
}

export function isShowing () {
	return showing;
}

function button (text, run, className) {
	var element = document.createElement('button');
	element.type = 'button';
	element.textContent = text;
	element.className = className || '';
	element.onclick = run;
	return element;
}

function build () {
	element = document.createElement('div');
	element.className = 'PixCall';

	var dot = document.createElement('div');
	dot.className = 'PixCall__dot';

	var text = document.createElement('div');
	text.className = 'PixCall__text';
	var who = document.createElement('div');
	who.className = 'PixCall__who';
	var meta = document.createElement('div');
	meta.className = 'PixCall__meta';
	text.append(who, meta);

	// A stream carries somebody's voice, so it is played rather than drawn: an <audio> for
	// a call, a <video> for a screen. The audio element stays in the bar even while the
	// viewer is hidden -- an element out of the document plays nothing.
	audio = document.createElement('audio');
	audio.className = 'PixCall__media';
	audio.autoplay = true;

	var accept = button('Accept', function () {
		peers.acceptCall().catch(function (err) {
			say(err.message);
		});
	}, 'go');
	var refuse = button('Refuse', function () {
		peers.refuseCall('No.');
	}, 'danger');
	var mute = button('Mute', function () {
		peers.setMuted(!(latest && latest.call && latest.call.muted));
	});
	var show = button('Show', function () {
		setShowing(!showing);
	});
	// Autoplay can be refused even after a press, and a silent call that looks connected is
	// the worst of both. The button appears only when the browser has actually said no.
	var play = button('Let it play', function () {
		start(audio);
		start(video);
	}, 'go');
	play.hidden = true;
	var hang = button('Hang up', function () {
		peers.endCall();
	}, 'danger');

	element.append(dot, text, accept, refuse, mute, show, play, hang);
	parts = {dot: dot, who: who, meta: meta, accept: accept, refuse: refuse,
		mute: mute, show: show, play: play, hang: hang};

	viewer = document.createElement('div');
	viewer.className = 'PixCall__viewer';
	// The window in front is usually an app iframe, and a keystroke inside one never
	// reaches this document -- so a full-screen viewer that does not take the focus cannot
	// be dismissed with Esc by the person looking at it.
	viewer.tabIndex = -1;
	viewer.hidden = true;
	video = document.createElement('video');
	video.autoplay = true;
	video.playsInline = true;
	viewer.append(video);
	viewer.onkeydown = function (e) {
		if (e.key === 'Escape') {
			// Hides the screen, never ends the call. Those are different acts and only one
			// of them is undoable.
			e.preventDefault();
			e.stopPropagation();
			setShowing(false);
		}
	};

	host.append(viewer, element);
}

function teardown () {
	stopTimer();
	setShowing(false);
	detach();
	if (element) {
		element.remove();
	}
	if (viewer) {
		viewer.remove();
	}
	element = null;
	viewer = null;
	video = null;
	audio = null;
	parts = null;
}

function detach () {
	if (audio) {
		audio.srcObject = null;
	}
	if (video) {
		video.srcObject = null;
	}
	attached = {audio: null, video: null};
}

function setShowing (want) {
	showing = !!want && !!viewer;
	if (!viewer) {
		return;
	}
	viewer.hidden = !showing;
	if (showing) {
		viewer.focus();
	}
	if (parts) {
		parts.show.textContent = showing ? 'Hide' : 'Show';
		parts.show.className = showing ? 'on' : '';
	}
	if (deps.onShowing) {
		deps.onShowing(showing);
	}
}

// `play()` returns a promise that rejects when the browser will not start on its own. The
// bar then offers the press that will, rather than sitting there silently.
function start (media) {
	if (!media || !media.srcObject || typeof media.play !== 'function') {
		return;
	}
	var playing = media.play();
	if (playing && typeof playing.then === 'function') {
		playing.then(function () {
			if (parts) {
				parts.play.hidden = true;
			}
		}, function () {
			if (parts) {
				parts.play.hidden = false;
			}
		});
	}
}

function attach (call) {
	var streams = peers.getCallMedia();
	if (!streams || streams.id !== call.id) {
		return;
	}
	// A screen share sends nothing back, so the person sharing watches their own capture
	// and the person watching gets theirs. Either way it is one video element.
	var wanted = call.kind === 'screen'
		? (call.way === 'out' ? streams.local : streams.remote)
		: null;
	if (wanted !== attached.video) {
		attached.video = wanted;
		video.srcObject = wanted || null;
		// Your own screen played back to you would be your own audio played back to you.
		video.muted = call.way === 'out';
		start(video);
		// The screen turning up is the moment it is worth looking at. Hiding it afterwards
		// is a decision the person has made, and this must not undo it every three seconds.
		if (wanted && call.way === 'in' && !showing) {
			setShowing(true);
		}
	}
	var heard = call.kind === 'voice' ? streams.remote : null;
	if (heard !== attached.audio) {
		attached.audio = heard;
		audio.srcObject = heard || null;
		start(audio);
	}
}

function stopTimer () {
	clearInterval(timer);
	timer = null;
}

function render () {
	var call = latest && latest.call;
	if (!call) {
		if (element) {
			teardown();
		}
		return;
	}
	if (!host) {
		return;
	}
	if (!element) {
		build();
	}

	var ringing = call.state === 'ringing';
	var live = call.state === 'live';
	parts.dot.className = 'PixCall__dot' + (live ? ' PixCall__dot--live' : '');
	parts.who.textContent = ringing
		? peers.describeCallOffer(call.kind, call.name)
		: (call.state === 'offering'
			? 'Calling ' + call.name + '…'
			: peers.describeCall(call.kind, call.way, call.name));

	parts.meta.textContent = [
		live ? peers.formatDuration(Date.now() - call.at) : stateWord(call.state),
		call.connected ? peers.describePing(call.ping) : 'not connected',
		call.muted ? 'your microphone is off' : '',
		call.farMuted ? call.name + '’s microphone is off' : ''
	].filter(Boolean).join(' · ');

	parts.accept.hidden = !ringing;
	parts.refuse.hidden = !ringing;
	// Muting is only ever about what this machine is sending, so it is offered exactly
	// when this machine is sending something.
	parts.mute.hidden = ringing || call.kind !== 'voice';
	parts.mute.textContent = call.muted ? 'Unmute' : 'Mute';
	parts.mute.className = call.muted ? 'on' : '';
	parts.show.hidden = !(live && call.kind === 'screen');
	parts.hang.textContent = ringing ? 'Refuse' : (call.state === 'offering' ? 'Cancel' : 'Hang up');
	parts.hang.hidden = ringing;

	if (live) {
		attach(call);
		if (!timer) {
			// A duration that only moves when a ping lands reads as a clock that has
			// stopped, so this one has its own second.
			timer = setInterval(render, 1000);
		}
	}
	else {
		stopTimer();
		detach();
		setShowing(false);
	}
}

function stateWord (state) {
	if (state === 'offering') {
		return 'ringing';
	}
	if (state === 'ringing') {
		return 'they are calling';
	}
	return 'connecting…';
}

function say (message) {
	if (typeof window.notify === 'function') {
		window.notify({level: 'warn', title: 'The call', message: message, source: 'PixOS'});
	}
}
