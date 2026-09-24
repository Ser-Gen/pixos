// Screen recording, lifted out of openExplorer by phase 21: the options a recording starts
// with, the graph that mixes system audio and the microphone into one track, the timer in
// the foot (the toolbar until phase 24 moved the commands onto a rail too narrow for a clock),
// and the four things the indicator's buttons do.
//
// Every platform object comes off `win` and `nav` rather than out of the ambient global --
// `nav.mediaDevices`, `win.MediaRecorder`, `win.AudioContext`, `win.Blob`, `win.MediaStream`,
// even `win.Date` and the two timer functions. That is not ceremony. Until this moved, no
// part of a recording could be run outside a browser that had been granted a screen: a test
// now hands in fakes and drives a whole recording, start to written file, with none.
//
// `state` and `ui` are the context object, by reference. The live recording is
// `state.recording` -- null, or the record below -- and it is the only flag anything reads
// to know whether one is running.

export function createRecording (deps) {
	var state = deps.state;
	var ui = deps.ui;
	var win = deps.win;
	var nav = deps.nav;
	var reportFailure = deps.reportFailure;
	var guarded = deps.guarded;
	var readableActionName = deps.readableActionName;
	var renderOverlays = deps.renderOverlays;
	var openDialog = deps.openDialog;
	var openInfoDialog = deps.openInfoDialog;
	var onFileHandler = deps.onFileHandler;
	var blobToFile = deps.blobToFile;

	var resolutionMap = {
		'1080': {width: 1920, height: 1080},
		'720':  {width: 1280, height: 720},
		'480':  {width: 854,  height: 480}
	};

	function updateRecordingTimer () {
		if (!state.recording) return;
		var elapsed = win.Date.now() - state.recording.startTime;
		var totalSec = Math.floor(elapsed / 1000);
		var h = Math.floor(totalSec / 3600);
		var m = Math.floor((totalSec % 3600) / 60);
		var s = totalSec % 60;
		var pad = function (n) { return String(n).padStart(2, '0'); };
		ui.recordingTime.textContent = pad(h) + ':' + pad(m) + ':' + pad(s);
	}

	// Two ways in, and only one of them is a button: the user picks *Screen Recording*, or
	// the dialog they were given calls back here with what they chose.
	function startScreenRecording () {
		if (state.recording) {
			openInfoDialog('Screen Recording', 'Recording is already in progress.');
			return;
		}
		openDialog({type: 'screenRecordingOptions', onSubmit: doStartScreenRecording});
	}

	// getDisplayMedia has no audio-only mode. `{video: false}` is not a smaller ask, it is a
	// rejected one -- NotSupportedError, which is exactly what *Could not start screen
	// capture / Not supported* was. So "record screen video: off" is one of two different
	// requests, and which one it is depends on system audio:
	//   * system audio wanted -- still open the picker asking for video, because a tab's or
	//     a screen's sound only ever comes attached to one, and simply leave the video track
	//     out of what the recorder is handed. The track stays live rather than being
	//     stopped: it is what the browser's *Stop sharing* bar and the `ended` watch below
	//     hang on, and stopping it takes the audio down with it.
	//   * system audio not wanted -- do not call getDisplayMedia at all. Nothing is being
	//     taken off the screen, so nothing should ask the user to choose one.
	//
	// With no video track in the stream, the format has to change too: a video mime is not
	// an over-ask, it is a wrong one -- the recorder is being told to write a vp9 track it
	// will never be given.
	function audioOnlyFormat (mimeType) {
		var candidates = mimeType.indexOf('mp4') !== -1
			? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
			: ['audio/webm;codecs=opus', 'audio/webm'];
		for (var i = 0; i < candidates.length; i++) {
			if (win.MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
		}
		return 'audio/webm';
	}

	async function doStartScreenRecording (settings) {
		state.dialog = null;
		renderOverlays();

		var wantsScreen = settings.recordVideo || settings.recordSysAudio;
		if (!wantsScreen && !settings.recordMic) {
			openInfoDialog('Screen Recording',
				'Nothing is selected to record. Turn on screen video, system audio or the microphone.');
			return;
		}

		var screenStream = null;
		if (wantsScreen) {
			var videoConstraint;
			if (!settings.recordVideo) {
				// Asked for and then never encoded. The resolution options are about the
				// file, and there is no video in this one, so they do not apply.
				videoConstraint = true;
			} else if (settings.resolution && resolutionMap[settings.resolution]) {
				var res = resolutionMap[settings.resolution];
				videoConstraint = {width: {ideal: res.width}, height: {ideal: res.height}};
			} else {
				videoConstraint = true;
			}

			var sysAudioConstraint = settings.recordSysAudio
				? {echoCancellation: false, noiseSuppression: false, autoGainControl: false}
				: false;

			try {
				screenStream = await nav.mediaDevices.getDisplayMedia({
					video: videoConstraint,
					audio: sysAudioConstraint,
					selfBrowserSurface: 'include'
				});
			}
			catch (err) {
				reportFailure('Could not start screen capture', err);
				return;
			}
		}

		var micStream = null;
		if (settings.recordMic) {
			try {
				micStream = await nav.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}});
			}
			catch (err) {
				// The microphone is optional when something else is being captured. When it
				// is the only source, a refused prompt means there is nothing to record, and
				// saying so here is the difference between an answer and a dead button.
				if (!screenStream) {
					reportFailure('Could not start the microphone', err);
					return;
				}
			}
		}

		var composedStream = new win.MediaStream();
		if (settings.recordVideo && screenStream) {
			screenStream.getVideoTracks().forEach(function (track) {
				composedStream.addTrack(track);
			});
		}

		var mimeType = settings.recordVideo ? settings.mimeType : audioOnlyFormat(settings.mimeType);

		var audioContext, audioDestination, mediaRecorder;
		try {
			// One recorder takes one stream, so system audio and the microphone have to be
			// summed before it sees them -- two audio tracks on one MediaStream is not a
			// mix, it is two tracks, and what gets written is whichever one the container
			// decides to keep.
			var hasAudio = (settings.recordSysAudio && screenStream && screenStream.getAudioTracks().length > 0) ||
				(micStream && micStream.getAudioTracks().length > 0);

			if (hasAudio) {
				audioContext = new win.AudioContext();
				await audioContext.resume();
				audioDestination = audioContext.createMediaStreamDestination();

				if (settings.recordSysAudio && screenStream && screenStream.getAudioTracks().length > 0) {
					var systemSource = audioContext.createMediaStreamSource(screenStream);
					var systemGain = audioContext.createGain();
					systemGain.gain.value = 1.0;
					systemSource.connect(systemGain).connect(audioDestination);
				}

				if (micStream && micStream.getAudioTracks().length > 0) {
					var micSource = audioContext.createMediaStreamSource(micStream);
					var micGain = audioContext.createGain();
					micGain.gain.value = 1.0;
					micSource.connect(micGain).connect(audioDestination);
				}

				audioDestination.stream.getAudioTracks().forEach(function (track) {
					composedStream.addTrack(track);
				});
			}

			if (!composedStream.getTracks().length) {
				// Video off, and the surface that was picked came without sound. Chrome only
				// offers *Share tab audio* for a tab or a whole screen, and it is a checkbox
				// the user can leave unticked -- so there is genuinely nothing to record, and
				// the recorder's own complaint about it says far less than this does.
				throw new Error('The selected screen or tab was shared without audio, and there is nothing else to record.');
			}

			var recorderOptions = {mimeType: mimeType};
			if (settings.recordVideo && settings.videoBitrate) {
				recorderOptions.videoBitsPerSecond = parseInt(settings.videoBitrate, 10);
			}
			mediaRecorder = new win.MediaRecorder(composedStream, recorderOptions);
		}
		catch (err) {
			// Both streams are already live at this point: the permission prompt has been
			// answered. Failing here without stopping them leaves the browser's own capture
			// indicator lit over an Explorer that thinks nothing is recording.
			if (screenStream) screenStream.getTracks().forEach(function (t) { t.stop(); });
			if (micStream) micStream.getTracks().forEach(function (t) { t.stop(); });
			reportFailure('Could not start the recording', err);
			return;
		}

		var isWebm = mimeType.indexOf('webm') !== -1;
		var ext = isWebm ? '.webm' : (settings.recordVideo ? '.mp4' : '.m4a');
		var chunks = [];

		mediaRecorder.ondataavailable = function (e) {
			if (e.data && e.data.size > 0) chunks.push(e.data);
		};

		mediaRecorder.onstop = async function () {
			var blob = new win.Blob(chunks, {type: chunks[0] ? chunks[0].type : mimeType});
			// A webm written by MediaRecorder carries no duration -- it is a live stream as
			// far as the container is concerned -- so a player shows it as 0:00 and cannot
			// seek. The fix patches the header afterwards, and the length it needs is the
			// one only this side knows.
			var duration = state.recording ? win.Date.now() - state.recording.startTime : 0;
			if (isWebm && duration > 0 && typeof win.ysFixWebmDuration === 'function') {
				try { blob = await win.ysFixWebmDuration(blob, duration); } catch (e) { /* use original blob */ }
			}
			var now = new win.Date();
			var pad = function (n) { return String(n).padStart(2, '0'); };
			var name = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + '-' + pad(now.getHours()) + '-' + pad(now.getMinutes()) + ext;
			// Awaited: onFileHandler can prompt, and stopScreenRecording re-renders the
			// overlays -- which would tear the prompt down before it was answered.
			await onFileHandler(blobToFile(blob, name));
			// Guarded here and nowhere else in this module. index.html wraps every entry in
			// `actions`, so a stop the user asked for is reported under its own name; this
			// one is reached from a MediaRecorder callback, where nothing is holding a catch
			// and a failure would otherwise surface as the generic Explorer error.
			guardedStop(true);
		};

		// Auto-stop when the user closes the browser's own "Stop sharing" bar. That bar fires
		// nothing of ours, so the track it belongs to is watched instead -- and with video
		// off there is still a video track to watch, which is half of why it was asked for.
		// A microphone-only recording has no bar at all; the one thing that can end under it
		// is the device going away.
		var endWatch = screenStream ? screenStream.getVideoTracks() : micStream.getAudioTracks();
		endWatch.forEach(function (track) {
			track.onended = function () {
				if (state.recording && state.recording.mediaRecorder.state !== 'inactive') {
					state.recording.mediaRecorder.stop();
				}
			};
		});

		try {
			mediaRecorder.start(1000);
		}
		catch (err) {
			if (screenStream) screenStream.getTracks().forEach(function (t) { t.stop(); });
			if (micStream) micStream.getTracks().forEach(function (t) { t.stop(); });
			reportFailure('Could not start the recorder', err);
			return;
		}

		state.recording = {
			mediaRecorder: mediaRecorder,
			chunks: chunks,
			startTime: win.Date.now(),
			timerInterval: win.setInterval(updateRecordingTimer, 1000),
			screenStream: screenStream,
			micStream: micStream,
			micMuted: false,
			sysMuted: false
		};

		ui.recordingTime.textContent = '00:00:00';
		// A button for a track that is not there is a button that lies: pressing it toggles a
		// style and mutes nothing at all.
		ui.recordingMicBtn.hidden = !micStream;
		ui.recordingSysBtn.hidden = !(screenStream && screenStream.getAudioTracks().length > 0);
		ui.recordingMicBtn.classList.remove('Explorer__recordingBtn--muted');
		ui.recordingMicBtn.title = 'Mute microphone';
		ui.recordingSysBtn.classList.remove('Explorer__recordingBtn--muted');
		ui.recordingSysBtn.title = 'Mute system audio';
		ui.recordingIndicator.hidden = false;
	}

	// Called twice for one stop, and that is the design rather than an accident. The first
	// call -- from the button, from the menu, from anywhere a person asked -- only asks the
	// recorder to stop, because the last chunk has not been handed over yet and tearing the
	// streams down here would lose it. The recorder's own `onstop` calls back with
	// `fromOnstop` once the file is written, and that pass does the cleanup.
	function stopScreenRecording (fromOnstop) {
		if (!state.recording) return;
		if (!fromOnstop && state.recording.mediaRecorder.state !== 'inactive') {
			state.recording.mediaRecorder.stop();
			// onstop will call stopScreenRecording(true) to finish cleanup
			return;
		}
		win.clearInterval(state.recording.timerInterval);
		// Every track, on every route out, or the browser's capture indicator stays lit
		// over a window that has already put its own indicator away.
		if (state.recording.screenStream) {
			state.recording.screenStream.getTracks().forEach(function (t) { t.stop(); });
		}
		if (state.recording.micStream) {
			state.recording.micStream.getTracks().forEach(function (t) { t.stop(); });
		}
		ui.recordingIndicator.hidden = true;
		state.recording = null;
	}

	var guardedStop = guarded(stopScreenRecording, readableActionName('stopScreenRecording'));

	// Muting is done on the tracks, not on the gain nodes, so that a muted microphone is
	// muted for the browser too -- the indicator in the tab strip goes with it.
	function toggleMicMute () {
		if (!state.recording) return;
		state.recording.micMuted = !state.recording.micMuted;
		if (state.recording.micStream) {
			state.recording.micStream.getAudioTracks().forEach(function (t) {
				t.enabled = !state.recording.micMuted;
			});
		}
		ui.recordingMicBtn.classList.toggle('Explorer__recordingBtn--muted', state.recording.micMuted);
		ui.recordingMicBtn.title = state.recording.micMuted ? 'Unmute microphone' : 'Mute microphone';
	}

	function toggleSysMute () {
		if (!state.recording) return;
		state.recording.sysMuted = !state.recording.sysMuted;
		if (state.recording.screenStream) {
			state.recording.screenStream.getAudioTracks().forEach(function (t) {
				t.enabled = !state.recording.sysMuted;
			});
		}
		ui.recordingSysBtn.classList.toggle('Explorer__recordingBtn--muted', state.recording.sysMuted);
		ui.recordingSysBtn.title = state.recording.sysMuted ? 'Unmute system audio' : 'Mute system audio';
	}

	return {
		updateRecordingTimer: updateRecordingTimer,
		startScreenRecording: startScreenRecording,
		doStartScreenRecording: doStartScreenRecording,
		stopScreenRecording: stopScreenRecording,
		toggleMicMute: toggleMicMute,
		toggleSysMute: toggleSysMute
	};
}
