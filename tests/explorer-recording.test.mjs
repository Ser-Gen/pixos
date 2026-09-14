// Screen recording, driven with no browser.
//
// Until phase 21 moved this into apps/explorer/js/recording.js, not one line of it could be
// reached by a test: every path runs through getDisplayMedia, MediaRecorder and AudioContext,
// and the first of those cannot be reached without a person clicking a permission prompt over
// a real screen. The module takes `win` and `nav` as parameters, so everything below is a
// whole recording — options, permission, the audio graph, the timer, the written file and the
// teardown — with fakes in their place.
//
// Two failures here are not cosmetic. A start that fails after the prompt was answered and
// does not stop its tracks leaves the browser's own capture indicator lit over an Explorer
// that believes nothing is recording. And a stop that tears the streams down before the
// recorder has handed over its last chunk loses the end of the file.

import {check, report} from './assert.mjs';
import {createRecording} from '../apps/explorer/js/recording.js';
import {createFailure} from '../apps/explorer/js/failure.js';

// --- the browser, as far as this module can tell -------------------------------------------

function track (kind) {
	return {kind: kind, enabled: true, stopped: false, onended: null,
		stop: function () { this.stopped = true; }};
}

function mediaStream (video, audio) {
	var tracks = video.concat(audio);
	return {
		getVideoTracks: function () { return video; },
		getAudioTracks: function () { return audio; },
		getTracks: function () { return tracks; }
	};
}

// MediaRecorder.stop() does not fire onstop before it returns — the recorder still has a
// chunk to hand over. Modelling it as synchronous would let a stop that tears the streams
// down too early still pass, which is the one thing this file most needs to catch.
function fakeRecorderClass (log) {
	return function FakeRecorder (stream, options) {
		this.stream = stream;
		this.options = options;
		this.state = 'inactive';
		this.startedWith = null;
		this.onstop = null;
		this.ondataavailable = null;
		var self = this;
		this.start = function (timeslice) {
			self.state = 'recording';
			self.startedWith = timeslice;
			log.push('recorder.start');
		};
		this.stop = function () {
			log.push('recorder.stop');
			self.state = 'inactive';
			self.stopPending = true;
		};
		// What the browser does a moment later, once the last chunk is out.
		this.fireStop = function () { self.stopPending = false; return self.onstop(); };
	};
}

function button () {
	var classes = new Set();
	return {
		title: null,
		classList: {
			add: function (c) { classes.add(c); },
			remove: function (c) { classes.delete(c); },
			toggle: function (c, on) { if (on) { classes.add(c); } else { classes.delete(c); } },
			has: function (c) { return classes.has(c); }
		}
	};
}

// `{video: false}` is not something getDisplayMedia will do, so the module asks for an audio
// container instead when there is no video track — and which one it can have is the browser's
// answer, not ours. A list of what this browser supports makes that answer testable.
function withTypeSupport (Recorder, supported) {
	Recorder.isTypeSupported = function (mime) {
		return supported ? supported.indexOf(mime) !== -1 : true;
	};
	return Recorder;
}

function harness (options) {
	options = options || {};
	var log = [];
	var written = [];
	var failures = [];
	var notes = [];
	var dialogs = [];
	var infos = [];
	var timers = [];
	var clockNow = 1000;

	var screenStream = options.screenStream !== undefined ? options.screenStream
		: mediaStream([track('video')], options.sysAudio ? [track('audio')] : []);
	var micStream = options.micStream !== undefined ? options.micStream
		: mediaStream([], [track('audio')]);

	function FakeDate () {
		this.getFullYear = function () { return 2026; };
		this.getMonth = function () { return 8; };
		this.getDate = function () { return 12; };
		this.getHours = function () { return 7; };
		this.getMinutes = function () { return 5; };
	}
	FakeDate.now = function () { return clockNow; };

	var audioGraph = [];
	function FakeAudioContext () {
		var destination = {stream: mediaStream([], [track('audio')])};
		this.resume = function () { audioGraph.push('resume'); return Promise.resolve(); };
		this.createMediaStreamDestination = function () { return destination; };
		this.createMediaStreamSource = function (stream) {
			audioGraph.push('source:' + (stream === screenStream ? 'system' : 'mic'));
			return {connect: function (node) { return node; }};
		};
		this.createGain = function () {
			var gain = {gain: {value: null}};
			gain.connect = function (node) {
				audioGraph.push('connect->' + (node === destination ? 'destination' : 'gain'));
				return node;
			};
			return gain;
		};
	}

	var composed = null;
	var win = {
		Date: FakeDate,
		MediaStream: function () {
			composed = {
				tracks: [],
				addTrack: function (t) { this.tracks.push(t); },
				getTracks: function () { return this.tracks; }
			};
			return composed;
		},
		MediaRecorder: withTypeSupport(options.recorderThrows
			? function () { throw new Error('unsupported mimeType'); }
			: fakeRecorderClass(log), options.supportedTypes),
		AudioContext: FakeAudioContext,
		Blob: function (chunks, opts) { this.chunks = chunks; this.type = opts.type; this.isBlob = true; },
		setInterval: function (fn, ms) { timers.push({fn: fn, ms: ms, cleared: false}); return timers.length; },
		clearInterval: function (id) { if (timers[id - 1]) { timers[id - 1].cleared = true; } },
		ysFixWebmDuration: options.fixWebm,
		addEventListener: function () {}
	};

	var nav = {
		mediaDevices: {
			getDisplayMedia: function (constraints) {
				log.push('getDisplayMedia');
				win.lastDisplayConstraints = constraints;
				return options.screenRefused ? Promise.reject(new Error('NotAllowedError'))
					: Promise.resolve(screenStream);
			},
			getUserMedia: function (constraints) {
				log.push('getUserMedia');
				win.lastMicConstraints = constraints;
				return options.micRefused ? Promise.reject(new Error('NotAllowedError'))
					: Promise.resolve(micStream);
			}
		}
	};

	var state = {recording: null, dialog: 'something'};
	var ui = {
		recordingTime: {textContent: null},
		recordingMicBtn: button(),
		recordingSysBtn: button(),
		recordingIndicator: {hidden: true}
	};
	ui.recordingMicBtn.hidden = false;
	ui.recordingSysBtn.hidden = false;

	// The real guard, so the label a failure is reported under is the real one too. It
	// reports through the shell, which is a different path from the module's own
	// reportFailure — both are watched separately below.
	var failure = createFailure({
		shell: {notify: function (note) { notes.push(note); }},
		win: win,
		doc: {addEventListener: function () {}},
		nav: nav,
		openInfoDialog: function () {}
	});

	var recording = createRecording({
		state: state,
		ui: ui,
		win: win,
		nav: nav,
		reportFailure: function (label, err) { failures.push(label + ': ' + err.message); },
		guarded: failure.guarded,
		readableActionName: failure.readableActionName,
		renderOverlays: function () { log.push('renderOverlays'); },
		openDialog: function (dialog) { dialogs.push(dialog); },
		openInfoDialog: function (title, message) { infos.push(title + ': ' + message); },
		onFileHandler: function (file) {
			written.push(file);
			return new Promise(function (resolve) { setTimeout(resolve, 0); });
		},
		blobToFile: function (blob, name) { return {blob: blob, name: name}; }
	});

	return {
		recording: recording, state: state, ui: ui, win: win, log: log, written: written,
		failures: failures, notes: notes, dialogs: dialogs, infos: infos, timers: timers,
		audioGraph: audioGraph, screenStream: screenStream, micStream: micStream,
		composed: function () { return composed; },
		advance: function (ms) { clockNow += ms; }
	};
}

var WEBM = {recordVideo: true, resolution: '1080', recordSysAudio: true, recordMic: true,
	mimeType: 'video/webm;codecs=vp9', videoBitrate: '8000000'};

function settings (over) {
	return Object.assign({}, WEBM, over || {});
}

// --- the way in ----------------------------------------------------------------------------

{
	const h = harness();
	h.recording.startScreenRecording();
	check('Screen Recording opens the options dialog', h.dialogs.length, 1);
	check('and it is the options dialog', h.dialogs[0].type, 'screenRecordingOptions');
	check('whose answer is what starts the recording', typeof h.dialogs[0].onSubmit, 'function');
	check('nothing has asked for a screen yet', h.log.indexOf('getDisplayMedia'), -1);
}

{
	const h = harness();
	h.state.recording = {};
	h.recording.startScreenRecording();
	check('a second Screen Recording says one is already running',
		h.infos, ['Screen Recording: Recording is already in progress.']);
	check('and does not open a second options dialog', h.dialogs.length, 0);
}

// --- what the options ask the browser for --------------------------------------------------

{
	const h = harness();
	await h.recording.doStartScreenRecording(settings());
	check('the dialog is put away before the permission prompt', h.state.dialog, null);
	check('and the overlays are redrawn, or it stays on screen', h.log[0], 'renderOverlays');
	check('1080 is asked for as an ideal, not a demand',
		h.win.lastDisplayConstraints.video, {width: {ideal: 1920}, height: {ideal: 1080}});
	check('self-capture is offered, or PixOS cannot record itself',
		h.win.lastDisplayConstraints.selfBrowserSurface, 'include');
	check('system audio asks for no processing at all',
		h.win.lastDisplayConstraints.audio,
		{echoCancellation: false, noiseSuppression: false, autoGainControl: false});
	check('the microphone asks for all three, because it is a voice',
		h.win.lastMicConstraints.audio,
		{echoCancellation: true, noiseSuppression: true, autoGainControl: true});
	check('the bitrate reaches the recorder as a number',
		h.state.recording.mediaRecorder.options.videoBitsPerSecond, 8000000);
	check('and the mime type it was given', h.state.recording.mediaRecorder.options.mimeType,
		'video/webm;codecs=vp9');
	check('chunks are asked for every second, not held to the end',
		h.state.recording.mediaRecorder.startedWith, 1000);
}

{
	const h = harness();
	await h.recording.doStartScreenRecording(settings({resolution: '720'}));
	check('720 maps to 1280x720', h.win.lastDisplayConstraints.video, {width: {ideal: 1280}, height: {ideal: 720}});
}

{
	const h = harness();
	await h.recording.doStartScreenRecording(settings({resolution: '4320'}));
	check('a resolution nothing maps to asks for video and lets the browser choose',
		h.win.lastDisplayConstraints.video, true);
}

// --- with the video turned off -------------------------------------------------------------
//
// getDisplayMedia has no audio-only mode: `{video: false}` is not a smaller ask, it is a
// rejected one. This whole option used to answer *Could not start screen capture / Not
// supported* and never record anything.

{
	const h = harness({sysAudio: true});
	await h.recording.doStartScreenRecording(settings({recordVideo: false}));
	// Read through a guard: a mutation that stops the picker opening at all would otherwise
	// crash this file rather than fail a line of it.
	check('video off still opens the screen picker', h.log.indexOf('getDisplayMedia') !== -1, true);
	var asked = h.win.lastDisplayConstraints || {};
	check('and asks for video, because system audio only comes attached to it', asked.video, true);
	check('and still asks for the audio', !!asked.audio, true);
	check('the recording started', h.state.recording !== null, true);
	check('nothing was reported as a failure', h.failures, []);
	check('but no video track was handed to the recorder',
		h.composed().tracks.filter(t => t.kind === 'video').length, 0);
	check('the audio track was', h.composed().tracks.filter(t => t.kind === 'audio').length, 1);
	check('and the container asked for is an audio one',
		h.state.recording.mediaRecorder.options.mimeType, 'audio/webm;codecs=opus');
	check('a bitrate for a video that is not being written is not sent',
		h.state.recording.mediaRecorder.options.videoBitsPerSecond, undefined);
}

{
	// The video track is asked for and then left out of the mix -- but not stopped. It is
	// what the browser's Stop sharing bar hangs on, and in Chrome it takes the audio with it.
	const h = harness({sysAudio: true});
	await h.recording.doStartScreenRecording(settings({recordVideo: false}));
	check('the unused video track is still live',
		h.screenStream.getVideoTracks()[0].stopped, false);
	check('and it is still what the Stop sharing bar is watched through',
		typeof h.screenStream.getVideoTracks()[0].onended, 'function');
}

{
	const h = harness({sysAudio: true, supportedTypes: ['audio/mp4']});
	await h.recording.doStartScreenRecording(settings({recordVideo: false, mimeType: 'video/mp4;codecs=avc1,mp4a.40.2'}));
	check('an mp4 recording with no video asks for an mp4 audio container',
		h.state.recording.mediaRecorder.options.mimeType, 'audio/mp4');
	h.state.recording.mediaRecorder.fireStop();
	await new Promise(r => setTimeout(r, 0));
	check('and the file is named for what is in it, not for what was picked in the dialog',
		h.written[0].name.endsWith('.m4a'), true);
}

{
	const h = harness({sysAudio: true, supportedTypes: []});
	await h.recording.doStartScreenRecording(settings({recordVideo: false}));
	check('with a browser that admits to supporting nothing, webm is still the answer',
		h.state.recording.mediaRecorder.options.mimeType, 'audio/webm');
}

{
	// Microphone only: nothing is being taken off the screen, so nobody should be asked to
	// choose a screen.
	const h = harness();
	// Caught rather than awaited bare: with no screen stream there is a whole class of
	// mutation here that reaches for one anyway, and a throw that escapes would end this
	// file instead of failing a check in it.
	let escaped = null;
	try { await h.recording.doStartScreenRecording(settings({recordVideo: false, recordSysAudio: false})); }
	catch (err) { escaped = err.message; }
	check('nothing escaped the start', escaped, null);
	check('microphone only never opens the screen picker', h.log.indexOf('getDisplayMedia'), -1);
	check('it does ask for the microphone', h.log.indexOf('getUserMedia') !== -1, true);
	check('and it records', h.state.recording !== null, true);
	check('the system-audio button is hidden, having nothing to mute', h.ui.recordingSysBtn.hidden, true);
	check('the microphone button is not', h.ui.recordingMicBtn.hidden, false);
	// No Stop sharing bar exists for this one. The device going away is the only thing that
	// can end it from outside.
	check('the microphone track is what is watched for ending instead',
		typeof h.micStream.getAudioTracks()[0].onended, 'function');
}

{
	const h = harness({micRefused: true});
	await h.recording.doStartScreenRecording(settings({recordVideo: false, recordSysAudio: false}));
	check('a refused microphone with nothing else to record is reported, not ignored',
		h.failures, ['Could not start the microphone: NotAllowedError']);
	check('and nothing is left recording', h.state.recording, null);
}

{
	const h = harness({micRefused: true, sysAudio: true});
	await h.recording.doStartScreenRecording(settings());
	check('a refused microphone alongside a screen is still optional', h.failures, []);
	check('the recording runs without it', h.state.recording !== null, true);
	check('and its button is hidden rather than left lying', h.ui.recordingMicBtn.hidden, true);
}

{
	// Video off, system audio on, and the user shared a surface without ticking the audio
	// box: there is nothing at all to record. The recorder's own complaint about an empty
	// stream says far less than this does.
	const h = harness({sysAudio: false});
	await h.recording.doStartScreenRecording(settings({recordVideo: false, recordMic: false}));
	check('an empty capture is refused with something worth reading',
		h.failures.length === 1 && h.failures[0].indexOf('shared without audio') !== -1, true);
	check('nothing is left recording', h.state.recording, null);
	check('and every track that was opened is stopped',
		h.screenStream.getTracks().every(t => t.stopped), true);
}

{
	const h = harness();
	await h.recording.doStartScreenRecording(settings({recordVideo: false, recordSysAudio: false, recordMic: false}));
	check('nothing selected at all is a question answered, not a permission prompt',
		h.infos.length, 1);
	check('nothing was captured', h.log.indexOf('getDisplayMedia'), -1);
	check('nor asked for', h.log.indexOf('getUserMedia'), -1);
	check('and nothing is recording', h.state.recording, null);
}

{
	const h = harness();
	await h.recording.doStartScreenRecording(settings({recordSysAudio: false, recordMic: false}));
	check('with neither audio source, the microphone is never asked for',
		h.log.indexOf('getUserMedia'), -1);
	check('and no audio graph is built for silence', h.audioGraph, []);
	check('the recording is still running', h.state.recording !== null, true);
}

// --- the audio graph -----------------------------------------------------------------------
//
// One recorder takes one stream, so two audio sources have to be summed into one track
// before it sees them. Two audio tracks on one MediaStream is not a mix.

{
	const h = harness({sysAudio: true});
	await h.recording.doStartScreenRecording(settings());
	check('both sources are read', h.audioGraph.filter(s => s.startsWith('source:')),
		['source:system', 'source:mic']);
	check('and both land on the one destination',
		h.audioGraph.filter(s => s === 'connect->destination').length, 2);
	check('the context is resumed, or a suspended one records silence',
		h.audioGraph[0], 'resume');
	check('the recorder is given one video track and one mixed audio track',
		h.composed().tracks.map(t => t.kind), ['video', 'audio']);
}

{
	const h = harness({sysAudio: false});
	await h.recording.doStartScreenRecording(settings());
	check('a screen that granted no audio track still mixes the microphone',
		h.audioGraph.filter(s => s.startsWith('source:')), ['source:mic']);
}

{
	const h = harness({sysAudio: true, micRefused: true});
	await h.recording.doStartScreenRecording(settings());
	check('a refused microphone is not a failed recording', h.state.recording !== null, true);
	check('and is not reported, because the mic is optional', h.failures, []);
	check('the system audio is mixed on its own',
		h.audioGraph.filter(s => s.startsWith('source:')), ['source:system']);
}

// --- the ways a start fails ----------------------------------------------------------------

{
	const h = harness({screenRefused: true});
	await h.recording.doStartScreenRecording(settings());
	check('a refused screen is reported', h.failures, ['Could not start screen capture: NotAllowedError']);
	check('and nothing is left recording', h.state.recording, null);
	check('the indicator stays put away', h.ui.recordingIndicator.hidden, true);
	check('and the microphone was never asked for', h.log.indexOf('getUserMedia'), -1);
}

{
	const h = harness({sysAudio: true, recorderThrows: true});
	await h.recording.doStartScreenRecording(settings());
	check('a recorder that will not build is reported',
		h.failures, ['Could not start the recording: unsupported mimeType']);
	check('and nothing is left recording', h.state.recording, null);
	// The permission prompt has already been answered at this point. Leaving the tracks
	// running leaves the browser's own capture indicator lit over a window that has no idea.
	check('every screen track is stopped', h.screenStream.getTracks().every(t => t.stopped), true);
	check('and every microphone track with it', h.micStream.getTracks().every(t => t.stopped), true);
}

// --- the timer -----------------------------------------------------------------------------

{
	const h = harness();
	await h.recording.doStartScreenRecording(settings());
	check('the clock starts at zero', h.ui.recordingTime.textContent, '00:00:00');
	check('and ticks once a second', h.timers[0].ms, 1000);
	h.advance(3661000);
	h.timers[0].fn();
	check('an hour, a minute and a second, zero-padded', h.ui.recordingTime.textContent, '01:01:01');
	h.advance(9 * 3600 * 1000);
	h.timers[0].fn();
	check('and it does not wrap at ten hours', h.ui.recordingTime.textContent, '10:01:01');
}

{
	const h = harness();
	h.recording.updateRecordingTimer();
	check('the timer draws nothing when nothing is recording', h.ui.recordingTime.textContent, null);
}

// --- stopping, in two passes ---------------------------------------------------------------

{
	const h = harness();
	await h.recording.doStartScreenRecording(settings());
	const recorder = h.state.recording.mediaRecorder;

	h.recording.stopScreenRecording();
	check('the first stop only asks the recorder to stop', h.log[h.log.length - 1], 'recorder.stop');
	// Everything below is what must NOT have happened yet: the recorder still has a chunk
	// to hand over, and a torn-down stream loses the end of the file.
	check('the recording is still on the books', h.state.recording !== null, true);
	check('the screen tracks are still running', h.screenStream.getTracks().some(t => t.stopped), false);
	check('the timer is still ticking', h.timers[0].cleared, false);
	check('and the indicator is still showing', h.ui.recordingIndicator.hidden, false);
	check('nothing has been written yet', h.written.length, 0);

	await recorder.fireStop();
	check('the file is written when the recorder says it is done', h.written.length, 1);
	check('the timer is cleared', h.timers[0].cleared, true);
	check('every screen track is stopped', h.screenStream.getTracks().every(t => t.stopped), true);
	check('every microphone track is stopped', h.micStream.getTracks().every(t => t.stopped), true);
	check('the indicator is put away', h.ui.recordingIndicator.hidden, true);
	check('and nothing is recording any more', h.state.recording, null);
}

{
	const h = harness();
	h.recording.stopScreenRecording();
	check('stopping when nothing is recording does nothing at all', h.log, []);
}

// --- the file that comes out ---------------------------------------------------------------

{
	const h = harness();
	await h.recording.doStartScreenRecording(settings());
	const recorder = h.state.recording.mediaRecorder;
	recorder.ondataavailable({data: {size: 12, type: 'video/webm'}});
	recorder.ondataavailable({data: {size: 0, type: 'video/webm'}});
	recorder.ondataavailable({data: null});
	check('an empty chunk is not kept', h.state.recording.chunks.length, 1);
	await recorder.fireStop();
	check('the name is the local date and time to the minute',
		h.written[0].name, '2026-09-12-07-05.webm');
	check('and the blob takes its type from the chunks, not from the setting',
		h.written[0].blob.type, 'video/webm');
}

{
	const h = harness();
	await h.recording.doStartScreenRecording(settings({mimeType: 'video/mp4'}));
	const recorder = h.state.recording.mediaRecorder;
	await recorder.fireStop();
	check('an mp4 recording is written as .mp4', h.written[0].name, '2026-09-12-07-05.mp4');
	check('and with no chunks, the blob falls back to the requested type',
		h.written[0].blob.type, 'video/mp4');
}

// A webm from MediaRecorder carries no duration — it is a live stream as far as the
// container knows — so a player shows 0:00 and will not seek. The length is patched in
// afterwards, and only this side knows what it was.
{
	let asked = null;
	const h = harness({fixWebm: function (blob, duration) { asked = duration; return Promise.resolve({fixed: true}); }});
	await h.recording.doStartScreenRecording(settings());
	h.advance(42000);
	await h.state.recording.mediaRecorder.fireStop();
	check('the webm duration is patched with the elapsed time', asked, 42000);
	check('and the patched blob is the one written', h.written[0].blob, {fixed: true});
}

{
	const h = harness({mimeType: 'video/mp4', fixWebm: function () { throw new Error('should not run'); }});
	await h.recording.doStartScreenRecording(settings({mimeType: 'video/mp4'}));
	h.advance(42000);
	await h.state.recording.mediaRecorder.fireStop();
	check('an mp4 is not put through the webm fix', h.written[0].blob.isBlob, true);
}

{
	const h = harness({fixWebm: function () { return Promise.reject(new Error('corrupt header')); }});
	await h.recording.doStartScreenRecording(settings());
	h.advance(42000);
	await h.state.recording.mediaRecorder.fireStop();
	check('a fix that fails writes the original rather than nothing', h.written[0].blob.isBlob, true);
	check('and is not reported — the file is still playable, just not seekable', h.failures, []);
}

{
	const h = harness({fixWebm: undefined});
	await h.recording.doStartScreenRecording(settings());
	await h.state.recording.mediaRecorder.fireStop();
	check('and with the fix not loaded at all, the recording still lands', h.written.length, 1);
}

// --- the browser's own Stop sharing bar -----------------------------------------------------
//
// It fires nothing of ours. Without this the window keeps a dead stream and an indicator
// that will not go away.

{
	const h = harness();
	await h.recording.doStartScreenRecording(settings());
	const video = h.screenStream.getVideoTracks()[0];
	check('the video track is watched for ended', typeof video.onended, 'function');
	video.onended();
	check('and ending it stops the recorder', h.log[h.log.length - 1], 'recorder.stop');
	await h.state.recording.mediaRecorder.fireStop();
	check('which finishes the recording like any other stop', h.state.recording, null);
	check('and writes the file', h.written.length, 1);
}

{
	const h = harness();
	await h.recording.doStartScreenRecording(settings());
	const video = h.screenStream.getVideoTracks()[0];
	await h.state.recording.mediaRecorder.fireStop();
	const before = h.log.length;
	video.onended();
	check('ending it again after the stop does nothing', h.log.length, before);
}

// --- muting ---------------------------------------------------------------------------------

{
	const h = harness({sysAudio: true});
	await h.recording.doStartScreenRecording(settings());
	const mic = h.micStream.getAudioTracks()[0];
	const sys = h.screenStream.getAudioTracks()[0];

	h.recording.toggleMicMute();
	// Muting the track, not the gain node, is what also turns the browser's own microphone
	// indicator off — a gain of zero is still a live microphone as far as it is concerned.
	check('muting the mic disables its track', mic.enabled, false);
	check('the button says so', h.ui.recordingMicBtn.classList.has('Explorer__recordingBtn--muted'), true);
	check('and offers the way back', h.ui.recordingMicBtn.title, 'Unmute microphone');
	check('the system audio is untouched', sys.enabled, true);

	h.recording.toggleMicMute();
	check('unmuting re-enables it', mic.enabled, true);
	check('and clears the button', h.ui.recordingMicBtn.classList.has('Explorer__recordingBtn--muted'), false);
	check('with the title back', h.ui.recordingMicBtn.title, 'Mute microphone');

	h.recording.toggleSysMute();
	check('muting system audio disables the screen stream track', sys.enabled, false);
	check('the microphone is untouched', mic.enabled, true);
	check('and its button says so', h.ui.recordingSysBtn.title, 'Unmute system audio');
}

{
	const h = harness();
	h.recording.toggleMicMute();
	h.recording.toggleSysMute();
	check('muting with nothing recording touches no button',
		[h.ui.recordingMicBtn.title, h.ui.recordingSysBtn.title], [null, null]);
}

{
	const h = harness({micRefused: true});
	await h.recording.doStartScreenRecording(settings());
	h.recording.toggleMicMute();
	check('the mic button still works with no microphone', h.ui.recordingMicBtn.title, 'Unmute microphone');
	check('and the recording survives it', h.state.recording !== null, true);
}

// --- the guard on the callback --------------------------------------------------------------
//
// index.html wraps every entry in `actions`, so a stop the user asked for is reported under
// its own name. The stop inside onstop is reached from a MediaRecorder callback instead,
// where nothing is holding a catch — so it carries its own guard, or a failure during
// cleanup comes out as the generic Explorer error with no idea what was being done.

{
	const h = harness();
	await h.recording.doStartScreenRecording(settings());
	h.state.recording.screenStream = {getTracks: function () { throw new Error('stream is gone'); }};
	let escaped = null;
	try { await h.state.recording.mediaRecorder.fireStop(); }
	catch (err) { escaped = err.message; }
	check('a cleanup that throws does not escape the callback', escaped, null);
	check('it is reported instead of swallowed', h.notes.length, 1);
	check('under the name of the action it was doing', h.notes[0].title, 'Stop screen recording failed');
}

// --- the wiring in index.html ----------------------------------------------------------------

import fsMod from 'fs';
const html = fsMod.readFileSync(new URL('../apps/explorer/index.html', import.meta.url), 'utf8');

check('index.html builds the recording module', /createRecording\(\{/.test(html), true);
check('and hands it the window rather than letting it reach for the global',
	/createRecording\(\{[\s\S]{0,400}win: window,[\s\S]{0,400}nav: navigator,/.test(html), true);
[['startScreenRecording', 'startScreenRecording: startScreenRecording,'],
	['stopScreenRecording', 'stopScreenRecording: stopScreenRecording,'],
	['toggleMicMute', 'toggleMicMute: toggleMicMute,'],
	['toggleSysMute', 'toggleSysMute: toggleSysMute,']].forEach(function (entry) {
	// Named in `actions` rather than called through it, so the guard loop at the bottom of
	// that object still wraps them — which is where the label on a reported failure comes from.
	check(entry[0] + ' is an action, so it is guarded like every other one',
		html.includes(entry[1]), true);
});
check('and none of the recorder is left behind in index.html',
	/function doStartScreenRecording|var resolutionMap/.test(html), false);

process.exit(report('explorer-recording'));
