// Dialogs: the node every modal is built into, the wiring that makes Enter and Cancel work,
// where the focus lands, and the two calls that set or clear a default app. Lifted out of
// openExplorer by phase 21.
//
// `state` is the context object, by reference -- `state.dialog` is the live dialog, and it is
// written from the other side too. There is no `ui`: a dialog is drawn into the overlay layer,
// so this asks for a redraw and never holds a node.
//
// **Every dialog in Explorer opens through `openDialog`, and that is not a style preference.**
// It wraps every `on*`-shaped callback on the dialog in `guarded`, because a submit handler
// runs long after the action that opened the dialog has returned -- the wrapper around
// `actions` is off the stack by then, and a rejection in there used to escape into nothing at
// all. It wraps whatever is on*-shaped rather than a list of the callbacks that exist today,
// because a list is a thing to forget to add to.
//
// `buildArchiveDialog` and `buildCompressDialog` come in as parameters, and that is a real
// cycle rather than an oversight: the general machinery draws the archive dialogs, and the
// archive module opens them through this one. index.html breaks it at one point, and only one.

export function createDialogs (deps) {
	var state = deps.state;
	var doc = deps.doc;
	var win = deps.win;
	// The shell -- the parent window when Explorer runs inside PixOS, and `win` when it does
	// not, the same comparison js/failure.js turns on.
	var shell = deps.shell;
	var guarded = deps.guarded;
	var readableActionName = deps.readableActionName;
	var renderOverlays = deps.renderOverlays;
	var escapeHtml = deps.escapeHtml;
	var escapeAttr = deps.escapeAttr;
	var basenameEnd = deps.basenameEnd;
	var getDefaultAppRows = deps.getDefaultAppRows;
	var getInstalledAppsForPicker = deps.getInstalledAppsForPicker;
	var isAppCompatibleWithExtension = deps.isAppCompatibleWithExtension;
	var normalizeExtensionInput = deps.normalizeExtensionInput;
	var buildArchiveDialog = deps.buildArchiveDialog;
	var buildCompressDialog = deps.buildCompressDialog;

	function buildDialogNode (dialog) {
		var modal = doc.createElement('div');
		modal.className = 'Modal';

		var panel = doc.createElement('div');
		panel.className = 'Modal__panel';
		modal.append(panel);

		if (dialog.type === 'rename') {
			panel.innerHTML = `
				<div class="Modal__title">Rename</div>
				<div class="Modal__field"><label>New name</label><input class="Dialog__input" data-select-basename value="${escapeAttr(dialog.oldName)}"></div>
				<div class="Modal__buttons"><button class="Dialog__cancel">Cancel</button><button class="Dialog__submit">Rename</button></div>
			`;
			wireSimpleDialog(panel, function () {
				var input = panel.querySelector('.Dialog__input');
				var value = input.value.trim();
				if (!value) {
					// Declined, not submitted: keep the dialog and the focus rather than
					// closing on a name that cannot be used.
					input.focus();
					return false;
				}
				dialog.onSubmit(value);
			});
		}
		else if (dialog.type === 'newFile') {
			panel.innerHTML = `
				<div class="Modal__title">Create file</div>
				<div class="Modal__field"><label>File name</label><input class="Dialog__name" data-select-basename value="new.txt"></div>
				<div class="Modal__field"><label>Content</label><textarea class="Dialog__content">a,b,c,d</textarea></div>
				<div class="Modal__buttons"><button class="Dialog__cancel">Cancel</button><button class="Dialog__submit">Create</button></div>
			`;
			wireSimpleDialog(panel, function () {
				var nameInput = panel.querySelector('.Dialog__name');
				if (!nameInput.value.trim()) {
					nameInput.focus();
					return false;
				}
				dialog.onSubmit({
					name: nameInput.value.trim(),
					content: panel.querySelector('.Dialog__content').value
				});
			});
		}
		else if (dialog.type === 'newFolder') {
			panel.innerHTML = `
				<div class="Modal__title">Create folder</div>
				<div class="Modal__field"><label>Folder name</label><input class="Dialog__input" value="new-folder"></div>
				<div class="Modal__buttons"><button class="Dialog__cancel">Cancel</button><button class="Dialog__submit">Create</button></div>
			`;
			wireSimpleDialog(panel, function () {
				var folderInput = panel.querySelector('.Dialog__input');
				if (!folderInput.value.trim()) {
					folderInput.focus();
					return false;
				}
				dialog.onSubmit(folderInput.value.trim());
			});
		}
		else if (dialog.type === 'onlineFile') {
			panel.innerHTML = `
				<div class="Modal__title">Add online file</div>
				<div class="Modal__field"><label>URL</label><input class="Dialog__url" placeholder="https://..."></div>
				<div class="Modal__field"><label>Optional file name override</label><input class="Dialog__name" placeholder="leave empty"></div>
				<div class="Modal__buttons"><button class="Dialog__cancel">Cancel</button><button class="Dialog__submit">Add</button></div>
			`;
			wireSimpleDialog(panel, function () {
				var urlInput = panel.querySelector('.Dialog__url');
				if (!urlInput.value.trim()) {
					urlInput.focus();
					return false;
				}
				dialog.onSubmit({
					url: urlInput.value.trim(),
					name: panel.querySelector('.Dialog__name').value.trim()
				});
			});
		}
		else if (dialog.type === 'confirmDelete') {
			var names = dialog.items.map(function (item) {
				return '<div>' + escapeHtml(item.name) + '</div>';
			}).join('');

			panel.innerHTML = `
				<div class="Modal__title">Delete ${dialog.items.length} item(s)?</div>
				<div class="Modal__list">${names}</div>
				<div class="Modal__buttons"><button class="Dialog__cancel">Cancel</button><button class="Dialog__submit Explorer__danger">Delete</button></div>
			`;
			wireSimpleDialog(panel, dialog.onSubmit);
		}
		else if (dialog.type === 'defaultAppsManager') {
			var associationRows = dialog.rows.length ? dialog.rows.map(function (row) {
				var options = row.apps.map(function (app) {
					return '<option value="' + escapeAttr(app.id) + '"' + (app.id === row.appId ? ' selected' : '') + '>' + escapeHtml(app.label) + '</option>';
				}).join('');
				return `
					<div class="Modal__field" data-ext-row="${escapeAttr(row.extension)}">
						<label>.${escapeHtml(row.extension)}</label>
						<select class="Dialog__defaultRowApp">${options}</select>
						<button class="Dialog__rowSave" data-extension="${escapeAttr(row.extension)}">Save</button>
						<button class="Dialog__rowClear" data-extension="${escapeAttr(row.extension)}">Clear</button>
					</div>
				`;
			}).join('') : '<div class="Modal__list">No default apps configured</div>';

			var addOptions = dialog.addableApps.map(function (app) {
				return '<option value="' + escapeAttr(app.id) + '">' + escapeHtml(app.label) + '</option>';
			}).join('');

			panel.innerHTML = `
				<div class="Modal__title">Default Apps</div>
				${associationRows}
				<div class="Modal__field">
					<label>Add association</label>
					<input class="Dialog__defaultExt" placeholder="png" value="${escapeAttr(dialog.prefillExtension || '')}">
					<select class="Dialog__defaultApp"${dialog.addableApps.length ? '' : ' disabled'}>
						${addOptions || '<option value="">No installed apps</option>'}
					</select>
					<button class="Dialog__defaultAdd"${dialog.addableApps.length ? '' : ' disabled'}>Add</button>
				</div>
				<div class="Modal__buttons"><button class="Dialog__cancel">Close</button></div>
			`;

			panel.querySelectorAll('.Dialog__rowSave').forEach(function (node) {
				node.onclick = function () {
					var row = node.closest('[data-ext-row]');
					dialog.onSave(row.dataset.extRow, row.querySelector('.Dialog__defaultRowApp').value);
				};
			});
			panel.querySelectorAll('.Dialog__rowClear').forEach(function (node) {
				node.onclick = function () {
					dialog.onClear(node.dataset.extension);
				};
			});
			var addBtn = panel.querySelector('.Dialog__defaultAdd');
			if (addBtn) {
				addBtn.onclick = function () {
					dialog.onAdd(
						panel.querySelector('.Dialog__defaultExt').value.trim(),
						panel.querySelector('.Dialog__defaultApp').value
					);
				};
			}
			var cancelBtn = panel.querySelector('.Dialog__cancel');
			if (cancelBtn) {
				cancelBtn.onclick = function () {
					state.dialog = null;
					renderOverlays();
				};
			}
		}
		else if (dialog.type === 'archive') {
			panel.append(buildArchiveDialog(dialog));
		}
		else if (dialog.type === 'compress') {
			panel.append(buildCompressDialog(dialog));
		}
		else if (dialog.type === 'ffmpegOptions') {
			panel.innerHTML = `
				<div class="Modal__title">FFmpeg options</div>
				<div class="Modal__field">
					<label>Arguments between input and output file</label>
					<input class="Dialog__args" value="${escapeAttr(dialog.defaultArgs)}">
				</div>
				<div class="Modal__buttons"><button class="Dialog__cancel">Cancel</button><button class="Dialog__submit">Run</button></div>
			`;
			wireSimpleDialog(panel, function () {
				dialog.onSubmit(panel.querySelector('.Dialog__args').value.trim());
			});
		}
		else if (dialog.type === 'files3Mount') {
			panel.innerHTML = `
				<div class="Modal__title">Mount Files3 Storage</div>
				<div class="Modal__list">If no token is saved, an authorization window will open on the storage server.</div>
				<div class="Modal__field">
					<label>Base URL API</label>
					<input class="Dialog__files3BaseUrl" type="url" value="${escapeAttr(dialog.baseUrl || '')}" placeholder="https://storage.example.com/api" style="width:100%">
				</div>
				<div class="Modal__field">
					<label>Root Folder ID</label>
					<input class="Dialog__files3RootFolderId" type="number" min="1" value="${escapeAttr(String(dialog.rootFolderId || ''))}" placeholder="42" style="width:100%">
				</div>
				<div class="Modal__field">
					<label>localStorage ID (token key)</label>
					<input class="Dialog__files3LocalStorageId" type="text" value="${escapeAttr(dialog.localStorageId || '')}" placeholder="files3_token_demo" style="width:100%">
				</div>
				<div class="Modal__field">
					<label>Mount point</label>
					<input class="Dialog__files3MountPoint" type="text" value="${escapeAttr(dialog.mountPoint || '')}" placeholder="/mnt/files3" style="width:100%">
				</div>
				<div class="Modal__buttons"><button class="Dialog__cancel">Cancel</button><button class="Dialog__submit">Connect</button></div>
			`;
			wireSimpleDialog(panel, function () {
				dialog.onSubmit({
					baseUrl: panel.querySelector('.Dialog__files3BaseUrl').value.trim(),
					rootFolderId: panel.querySelector('.Dialog__files3RootFolderId').value.trim(),
					localStorageId: panel.querySelector('.Dialog__files3LocalStorageId').value.trim(),
					mountPoint: panel.querySelector('.Dialog__files3MountPoint').value.trim()
				});
			});
		}
		else if (dialog.type === 'prompt') {
			panel.innerHTML = `
				<div class="Modal__title">${escapeHtml(dialog.title)}</div>
				<div class="Modal__list">${escapeHtml(dialog.message)}</div>
				<div class="Modal__field"><input class="Dialog__input" value="${escapeAttr(dialog.defaultValue || '')}"><div class="Modal__refusal" hidden></div></div>
				<div class="Modal__buttons"><button class="Dialog__cancel">Cancel</button><button class="Dialog__submit">OK</button></div>
			`;
			wireSimpleDialog(panel, function () {
				return submitPrompt(dialog, panel.querySelector('.Dialog__input'), panel.querySelector('.Modal__refusal'));
			});
		}
		else if (dialog.type === 'info') {
			panel.innerHTML = `
				<div class="Modal__title">${escapeHtml(dialog.title)}</div>
				<div class="Modal__list">${escapeHtml(dialog.message).replace(/\n/g, '<br>')}</div>
				<div class="Modal__buttons"><button class="Dialog__submit">OK</button></div>
			`;
			panel.querySelector('.Dialog__submit').onclick = function () {
				state.dialog = null;
				renderOverlays();
			};
		}
		else if (dialog.type === 'copyText') {
			panel.innerHTML = `
				<div class="Modal__title">${escapeHtml(dialog.title)}</div>
				<div class="Modal__list">Your browser did not let PixOS write to the clipboard. Press ${escapeHtml(copyChordLabel())} to copy it yourself.</div>
				<div class="Modal__field"><textarea class="Dialog__copyText" readonly rows="${Math.min(8, dialog.text.split('\n').length)}" style="width:100%">${escapeHtml(dialog.text)}</textarea></div>
				<div class="Modal__buttons"><button class="Dialog__submit">Close</button></div>
			`;
			var copyArea = panel.querySelector('.Dialog__copyText');
			copyArea.focus();
			copyArea.select();
			panel.querySelector('.Dialog__submit').onclick = function () {
				state.dialog = null;
				renderOverlays();
			};
		}
		else if (dialog.type === 'screenRecordingOptions') {
			var recFormats = [
				{mime: 'video/mp4;codecs=avc1,mp4a.40.2', label: 'MP4 (H.264 + AAC)'},
				{mime: 'video/webm;codecs=vp9,opus',      label: 'WebM VP9 + Opus'},
				{mime: 'video/webm;codecs=vp8,opus',      label: 'WebM VP8 + Opus'},
				{mime: 'video/webm',                      label: 'WebM'}
			].filter(function (f) { return win.MediaRecorder.isTypeSupported(f.mime); });
			if (!recFormats.length) recFormats = [{mime: 'video/webm', label: 'WebM'}];
			var recFormatOptions = recFormats.map(function (f) {
				return '<option value="' + escapeAttr(f.mime) + '">' + escapeHtml(f.label) + '</option>';
			}).join('');
			panel.innerHTML = `
				<div class="Modal__title">Screen Recording</div>
				<div class="Modal__field"><label>Format</label><select class="Dialog__recFormat">${recFormatOptions}</select></div>
				<div class="Modal__field"><label>Resolution</label><select class="Dialog__recResolution">
					<option value="">Native (full screen)</option>
					<option value="1080">1080p (1920×1080)</option>
					<option value="720">720p (1280×720)</option>
					<option value="480">480p (854×480)</option>
				</select></div>
				<div class="Modal__field"><label>Quality</label><select class="Dialog__recQuality">
					<option value="">Auto (browser default)</option>
					<option value="8000000">High (8 Mbps)</option>
					<option value="2500000">Medium (2.5 Mbps)</option>
					<option value="1000000">Low (1 Mbps)</option>
				</select></div>
				<div class="Modal__field"><label><input type="checkbox" class="Dialog__recVideo" checked> Record screen video</label></div>
				<div class="Modal__field"><label><input type="checkbox" class="Dialog__recSysAudio" checked> Record system audio</label></div>
				<div class="Modal__field"><label><input type="checkbox" class="Dialog__recMicAudio" checked> Record microphone</label></div>
				<div class="Modal__buttons"><button class="Dialog__cancel">Cancel</button><button class="Dialog__submit">Start Recording</button></div>
			`;
			// The resolution and the bitrate of a video that is not being recorded are not a
			// choice, and leaving them live suggests an audio-only file still has a size to
			// pick. Format stays: it is what decides the container the audio ends up in.
			var recVideoBox = panel.querySelector('.Dialog__recVideo');
			var videoOnlyFields = [panel.querySelector('.Dialog__recResolution'), panel.querySelector('.Dialog__recQuality')];
			recVideoBox.onchange = function () {
				videoOnlyFields.forEach(function (field) { field.disabled = !recVideoBox.checked; });
			};

			wireSimpleDialog(panel, function () {
				var mimeType = panel.querySelector('.Dialog__recFormat').value;
				var resolution = panel.querySelector('.Dialog__recResolution').value;
				var videoBitrate = panel.querySelector('.Dialog__recQuality').value;
				var recordVideo = panel.querySelector('.Dialog__recVideo').checked;
				var recordSysAudio = panel.querySelector('.Dialog__recSysAudio').checked;
				var recordMic = panel.querySelector('.Dialog__recMicAudio').checked;
				dialog.onSubmit({mimeType: mimeType, resolution: resolution, videoBitrate: videoBitrate, recordVideo: recordVideo, recordSysAudio: recordSysAudio, recordMic: recordMic});
			});
		}
		else if (dialog.type === 'pasteConflict') {
			panel.innerHTML = `
				<div class="Modal__title">File already exists</div>
				<div class="Modal__list">
					<div>${escapeHtml(dialog.message)}</div>
				</div>
				<div class="Modal__buttons">
					<button class="Dialog__cancel">Cancel</button>
					<button class="Dialog__rename">Save as new name</button>
					<button class="Dialog__submit"${dialog.canReplace ? '' : ' disabled'}>Replace</button>
				</div>
			`;
			panel.querySelector('.Dialog__cancel').onclick = function () {
				dialog.onSubmit('cancel');
			};
			panel.querySelector('.Dialog__rename').onclick = function () {
				dialog.onSubmit('rename');
			};
			panel.querySelector('.Dialog__submit').onclick = function () {
				if (!dialog.canReplace) return;
				dialog.onSubmit('replace');
			};
		}

		return modal;
	}

	// A prompt may carry `refuse(value)`, answering with the reason a value cannot be used or
	// with nothing. A refused value keeps the dialog open with the reason under the field --
	// closing on it would take away what was typed along with the chance to fix it. Named so
	// that `openDialog` does not wrap it: it answers synchronously, and the wrapper answers a
	// promise, which is never a string and so would refuse nothing.
	function submitPrompt (dialog, input, refusal) {
		var value = input.value.trim();
		var reason = typeof dialog.refuse === 'function' ? dialog.refuse(value) : null;
		if (reason) {
			refusal.textContent = reason;
			refusal.hidden = false;
			input.focus();
			return false;
		}
		refusal.hidden = true;
		dialog.onSubmit(value);
	}

	function wireSimpleDialog (panel, onSubmit) {
		var submitted = false;
		function submitOnce () {
			if (submitted) return;
			submitted = true;
			// `false` means the handler declined -- an empty filename, say -- and left the
			// dialog open. The latch has to release, or every later click and Enter is
			// swallowed and the dialog is dead with no way out but Cancel.
			if (onSubmit() === false) {
				submitted = false;
			}
		}
		var cancel = panel.querySelector('.Dialog__cancel');
		if (cancel) {
			cancel.onclick = function () {
				state.dialog = null;
				renderOverlays();
			};
		}
		var submit = panel.querySelector('.Dialog__submit');
		if (submit) {
			submit.onclick = submitOnce;
		}
		panel.onkeydown = function (e) {
			if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
				e.preventDefault();
				// preventDefault stops the default action, not the bubble. Without this the
				// event still reached the document handler above, which opened the path the
				// dialog had just renamed away from.
				e.stopPropagation();
				submitOnce();
			}
		};
	}

	// The first field of a dialog, focused with its value selected -- except on a filename
	// field, where the extension is left out of the selection: typing straight over
	// "report" should keep ".final.pdf", which is what makes the autofocus useful rather
	// than something to undo first.
	//
	// A dialog with no field at all focuses its default button instead, so Enter confirms
	// it rather than falling through to the window behind.
	function focusDialogInput (root) {
		// Never a checkbox: it cannot be typed into, and focusing the first one in a list
		// of them buries the field -- or the button -- that the dialog is actually asking
		// you to use. The archive dialog is a list of checkboxes and made this visible.
		var input = root.querySelector('input:not([type="checkbox"]), textarea, select');
		if (!input) {
			var submit = root.querySelector('.Dialog__submit');
			if (submit) {
				submit.focus();
			}
			return;
		}
		input.focus();
		if (input.tagName !== 'INPUT') {
			return;
		}
		try {
			if (input.dataset.selectBasename !== undefined) {
				input.setSelectionRange(0, basenameEnd(input.value));
			}
			else {
				input.select();
			}
		}
		catch (err) {
			// Some input types refuse setSelectionRange. Focused is still better than not.
		}
	}

	// Everything a dialog does happens after the action that opened it has already
	// returned, so the wrapper around `actions` is long gone by the time a submit handler
	// runs. A rejection in there escaped into nothing: a rename onto a file another window
	// had just deleted reported itself as "Uncaught (in promise)" in a console nobody has
	// open, and as absolutely nothing on screen. The callbacks are wrapped here for the
	// same reason the actions are -- so that a dialog added later gets it too.
	// Every on*-shaped function on the dialog, rather than a list of the ones that exist
	// today: a list is a thing to forget to add to, and forgetting is the failure this is
	// here to prevent.
	function isCallbackName (name) {
		return /^on[A-Z]/.test(name);
	}

	function openDialog (dialog) {
		if (dialog) {
			Object.keys(dialog).forEach(function (name) {
				if (isCallbackName(name) && typeof dialog[name] === 'function') {
					dialog[name] = guarded(dialog[name], readableActionName(dialog.type || 'dialog'));
				}
			});
		}
		state.dialog = dialog;
		renderOverlays();
	}

	function closeDialog (result) {
		if (!state.dialog) return;
		var dialog = state.dialog;
		state.dialog = null;
		renderOverlays();
		if (dialog.type === 'pasteConflict' && dialog.onSubmit) {
			dialog.onSubmit(result || 'cancel');
		}
	}

	function openInfoDialog (title, message) {
		openDialog({type: 'info', title: title, message: message});
	}

	async function buildDefaultAppsManagerDialog (prefillExtension) {
		return {
			type: 'defaultAppsManager',
			rows: await getDefaultAppRows(),
			addableApps: getInstalledAppsForPicker(),
			prefillExtension: prefillExtension || '',
			onSave: async function (extension, appId) {
				if (await saveDefaultAppAssociation(extension, appId)) {
					openDialog(await buildDefaultAppsManagerDialog(extension));
				}
			},
			onClear: async function (extension) {
				if (await clearDefaultAppAssociation(extension)) {
					openDialog(await buildDefaultAppsManagerDialog(''));
				}
			},
			onAdd: async function (extension, appId) {
				if (await saveDefaultAppAssociation(extension, appId)) {
					openDialog(await buildDefaultAppsManagerDialog(extension));
				}
			}
		};
	}

	async function saveDefaultAppAssociation (extension, appId) {
		var normalizedExt = normalizeExtensionInput(extension);
		if (!normalizedExt) {
			openInfoDialog('Default apps', 'Extension is required');
			return false;
		}
		if (!appId) {
			openInfoDialog('Default apps', 'Application is required');
			return false;
		}
		if (!await isAppCompatibleWithExtension(appId, normalizedExt)) {
			openInfoDialog('Default apps', 'Selected app does not support .' + normalizedExt);
			return false;
		}
		if (typeof shell.setDefaultAppForExtension !== 'function') {
			openInfoDialog('Default apps', 'Default app storage is unavailable');
			return false;
		}
		await shell.setDefaultAppForExtension(normalizedExt, appId);
		return true;
	}

	async function clearDefaultAppAssociation (extension) {
		var normalizedExt = normalizeExtensionInput(extension);
		if (!normalizedExt || typeof shell.clearDefaultAppForExtension !== 'function') {
			return false;
		}
		await shell.clearDefaultAppForExtension(normalizedExt);
		return true;
	}

	return {
		buildDialogNode: buildDialogNode,
		wireSimpleDialog: wireSimpleDialog,
		submitPrompt: submitPrompt,
		focusDialogInput: focusDialogInput,
		isCallbackName: isCallbackName,
		openDialog: openDialog,
		closeDialog: closeDialog,
		openInfoDialog: openInfoDialog,
		buildDefaultAppsManagerDialog: buildDefaultAppsManagerDialog,
		saveDefaultAppAssociation: saveDefaultAppAssociation,
		clearDefaultAppAssociation: clearDefaultAppAssociation
	};
}
