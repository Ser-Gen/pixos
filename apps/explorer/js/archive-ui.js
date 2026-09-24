// Archives: the two dialogs and the operations behind them, lifted out of openExplorer by
// phase 21. Everything here is *7-Zip as Explorer presents it* -- what the dialogs look like
// in each of their states, when the engine is fetched, and what happens to what comes out.
// Nothing in here decides whether a file is an archive; that is `../../7z/js/parse.js`, which
// is pure and is imported directly below.
//
// `state` is the context object, by reference -- `state.dialog` is the live dialog and
// `state.items` is the current listing, and both are written from the other side too. There
// is no `ui`: an archive dialog is drawn into the overlay layer, so this module asks for a
// redraw and never touches a node index.html is holding.
//
// The engine itself is never imported at the top. It is 1.4 MB of WebAssembly and most
// sessions never open an archive, so `loadArchiveEngine` fetches it on the first press and
// the promise is the cache.
//
// The three archive entries of Explorer's action table live here too -- `extract`, `compress` and
// `extractSelected` -- because each is a sentence about which items the dialogs get, and the
// dialogs are here. That is the only reason this module reads the selection: `getItemByPath` and
// `getSelectedItems` come from js/selection.js, which is built before it.

import * as archiveNames from "../../7z/js/parse.js";

export function createArchiveUi (deps) {
	var state = deps.state;
	var doc = deps.doc;
	var win = deps.win;
	var path = deps.path;
	var report = deps.report;
	var reportFailure = deps.reportFailure;
	var formatSize = deps.formatSize;
	var readFile = deps.readFile;
	var writeFile = deps.writeFile;
	var ensureDir = deps.ensureDir;
	var listDirectory = deps.listDirectory;
	var writeNewFile = deps.writeNewFile;
	var openDialog = deps.openDialog;
	var renderOverlays = deps.renderOverlays;
	var refreshCurrentDir = deps.refreshCurrentDir;
	var navigateTo = deps.navigateTo;
	var getItemByPath = deps.getItemByPath;
	var getSelectedItems = deps.getSelectedItems;
	// BrowserFS puts Buffer on the window; a test hands in its own rather than needing one.
	var Buffer = deps.Buffer;
	// The one seam that is not a real dependency. Everything above can be handed a fake, but
	// a dynamic `import()` of a path literal cannot -- and the engine is 1.4 MB of
	// WebAssembly that will not load outside a browser at all. So the fetch itself is
	// overridable, and the caching rule around it is testable because of that.
	var importEngine = deps.importEngine || function () { return import('../../7z/js/archive.js'); };

	// The archive dialog has four states and they are one dialog on purpose: reading it,
	// asking for a password, showing what is inside, and working. Each of the first three
	// is a question you can answer without leaving, and a password that turns out to be
	// wrong comes back here rather than as a note over a dialog that has closed.
	function buildArchiveDialog (dialog) {
		var box = doc.createElement('div');
		var busy = dialog.phase === 'reading' || dialog.phase === 'working';

		var title = doc.createElement('div');
		title.className = 'Modal__title';
		title.textContent = dialog.phase === 'working'
			? 'Extracting ' + dialog.name
			: 'Extract ' + dialog.name;
		box.append(title);

		if (busy) {
			var waiting = doc.createElement('div');
			waiting.className = 'Modal__list';
			// Said plainly because this build of 7-Zip runs on this thread: the window is
			// not going to redraw again until it is done, and a big archive can take a
			// while. Better to say so than to look frozen.
			waiting.textContent = dialog.phase === 'reading'
				? 'Reading the archive…'
				: 'Extracting. A large archive holds everything up while it works.';
			box.append(waiting);
			box.append(archiveButtons([{label: 'Cancel', className: 'Dialog__cancel', disabled: true}]));
			return box;
		}

		if (dialog.phase === 'password') {
			var ask = doc.createElement('div');
			ask.className = 'Modal__list';
			ask.textContent = dialog.error || 'This archive needs a password.';
			box.append(ask);

			var field = doc.createElement('div');
			field.className = 'Modal__field';
			var label = doc.createElement('label');
			label.textContent = 'Password';
			var input = doc.createElement('input');
			input.type = 'password';
			input.className = 'Dialog__input';
			input.style.width = '100%';
			input.value = dialog.password || '';
			input.oninput = function () {
				dialog.onPassword(input.value);
			};
			input.onkeydown = function (e) {
				if (e.key === 'Enter') {
					e.preventDefault();
					e.stopPropagation();
					dialog.onUnlock(input.value);
				}
			};
			field.append(label, input);
			box.append(field);

			var note = doc.createElement('div');
			note.className = 'Modal__list Modal__hint';
			// The distinction the whole classifier exists for, in one line.
			note.textContent = 'Nothing has been written. If the password is right and it '
				+ 'still fails, the archive itself is damaged rather than locked.';
			box.append(note);

			box.append(archiveButtons([
				{label: 'Cancel', className: 'Dialog__cancel'},
				{label: 'Unlock', primary: true, run: function () { dialog.onUnlock(input.value); }}
			]));
			// The field is the only thing here worth typing into.
			win.setTimeout(function () { input.focus(); }, 0);
			return box;
		}

		var files = dialog.entries.filter(function (entry) {
			return !entry.isDirectory;
		});
		var total = files.reduce(function (sum, entry) {
			return sum + (entry.size || 0);
		}, 0);

		var summary = doc.createElement('div');
		summary.className = 'Modal__list';
		summary.textContent = files.length + (files.length === 1 ? ' file' : ' files')
			+ ', ' + formatSize(total) + ' unpacked'
			+ (dialog.unwrapped ? ' — a tar inside a wrapper, and both come off at once.' : '.');
		box.append(summary);

		var list = doc.createElement('div');
		list.className = 'Modal__list Modal__list--tall';

		if (!files.length) {
			list.textContent = 'This archive is empty.';
		}
		files.forEach(function (entry) {
			var row = doc.createElement('label');
			row.style.display = 'flex';
			row.style.gap = '8px';
			row.style.alignItems = 'baseline';
			row.style.padding = '2px 0';

			var box2 = doc.createElement('input');
			box2.type = 'checkbox';
			box2.checked = dialog.selected.has(entry.path);
			box2.onchange = function () {
				dialog.onToggle(entry.path, box2.checked);
				updateExtractButton();
			};

			var name = doc.createElement('span');
			name.textContent = entry.path;
			name.style.flex = '1 1 auto';
			name.style.overflowWrap = 'anywhere';

			var size = doc.createElement('span');
			size.className = 'Modal__hint Modal__hint--nowrap';
			size.textContent = formatSize(entry.size || 0) + (entry.encrypted ? ' · locked' : '');

			row.append(box2, name, size);
			list.append(row);
		});
		box.append(list);

		var where = doc.createElement('div');
		where.className = 'Modal__list';
		where.style.fontSize = '12px';
		where.textContent = 'Into ' + dialog.destination + '/ — a new folder here. Nothing '
			+ 'already in this folder is written over.';
		box.append(where);

		// Contents can be encrypted while the listing is not, so the field is offered
		// before the attempt rather than after it fails.
		var passwordInput = null;
		if (dialog.entries.some(function (entry) { return entry.encrypted; }) || dialog.password) {
			var pfield = doc.createElement('div');
			pfield.className = 'Modal__field';
			var plabel = doc.createElement('label');
			plabel.textContent = 'Password';
			passwordInput = doc.createElement('input');
			passwordInput.type = 'password';
			passwordInput.style.width = '100%';
			passwordInput.value = dialog.password || '';
			passwordInput.oninput = function () {
				dialog.onPassword(passwordInput.value);
			};
			pfield.append(plabel, passwordInput);
			box.append(pfield);
		}

		var buttons = archiveButtons([
			{label: 'Cancel', className: 'Dialog__cancel'},
			{label: 'Extract', primary: true, className: 'Dialog__extract', run: function () {
				if (passwordInput) {
					dialog.onPassword(passwordInput.value);
				}
				var chosen = files.filter(function (entry) {
					return dialog.selected.has(entry.path);
				}).map(function (entry) {
					return entry.path;
				});
				// All of them is not a selection: handing 7-Zip no list lets it keep the
				// empty folders too, and there is nothing to spell wrong.
				dialog.onExtract(chosen.length === files.length ? null : chosen);
			}}
		]);
		box.append(buttons);

		function updateExtractButton () {
			var button = buttons.querySelector('.Dialog__extract');
			var chosen = dialog.selected.size;
			button.disabled = chosen === 0;
			button.textContent = (chosen === files.length || !files.length)
				? 'Extract'
				: 'Extract ' + chosen;
		}
		updateExtractButton();

		return box;
	}

	// Format and preset, and a password when the format can hold one. Everything else
	// 7-Zip can be told -- dictionary size, solid blocks, threads, volumes -- is left out
	// deliberately: it is a dialog that has to teach you what a dictionary is, in front of
	// somebody who wanted to email a folder.
	function buildCompressDialog (dialog) {
		var box = doc.createElement('div');
		var format = archiveNames.formatFor(dialog.format);

		var title = doc.createElement('div');
		title.className = 'Modal__title';
		title.textContent = dialog.items.length === 1
			? 'Compress ' + dialog.items[0].name
			: 'Compress ' + dialog.items.length + ' items';
		box.append(title);

		if (dialog.phase === 'working') {
			var waiting = doc.createElement('div');
			waiting.className = 'Modal__list';
			// The engine runs on this thread, and compressing is where that is felt:
			// there is far more work in `Best` on a folder than in extracting one.
			waiting.textContent = (dialog.progress || 'Working…')
				+ ' The window waits for this.';
			box.append(waiting);
			box.append(archiveButtons([{label: 'Cancel', className: 'Dialog__cancel', disabled: true}]));
			return box;
		}

		var nameField = doc.createElement('div');
		nameField.className = 'Modal__field';
		var nameLabel = doc.createElement('label');
		nameLabel.textContent = 'Archive name';
		var nameInput = doc.createElement('input');
		nameInput.className = 'Dialog__input';
		nameInput.style.width = '100%';
		nameInput.value = dialog.name;
		nameInput.oninput = function () {
			dialog.onName(nameInput.value);
		};
		nameField.append(nameLabel, nameInput);
		box.append(nameField);

		box.append(choiceRow('Format', archiveNames.FORMATS, dialog.format, function (id) {
			dialog.onFormat(id);
		}));
		box.append(hint(format.note));

		box.append(choiceRow('Compression', archiveNames.PRESETS, dialog.preset, function (id) {
			dialog.onPreset(id);
		}));
		box.append(hint(archiveNames.presetFor(dialog.preset).note));

		var passwordField = doc.createElement('div');
		passwordField.className = 'Modal__field';
		var passwordLabel = doc.createElement('label');
		passwordLabel.textContent = 'Password';
		var passwordInput = doc.createElement('input');
		passwordInput.type = 'password';
		passwordInput.style.width = '100%';
		passwordInput.value = dialog.password || '';
		// Not hidden when the format cannot hold one: a field that vanishes looks like a
		// bug, and a disabled one with a reason beside it is the answer to "why can I not
		// put a password on this".
		passwordInput.disabled = !format.password;
		passwordInput.placeholder = format.password ? '' : 'tar.gz cannot hold one';
		passwordInput.oninput = function () {
			dialog.onPassword(passwordInput.value);
		};
		passwordField.append(passwordLabel, passwordInput);
		box.append(passwordField);

		if (format.encryptNames) {
			var namesRow = doc.createElement('label');
			namesRow.className = 'Modal__list';
			namesRow.style.display = 'flex';
			namesRow.style.gap = '8px';
			namesRow.style.alignItems = 'baseline';
			var namesBox = doc.createElement('input');
			namesBox.type = 'checkbox';
			namesBox.checked = dialog.encryptNames === true;
			namesBox.onchange = function () {
				dialog.onEncryptNames(namesBox.checked);
			};
			var namesText = doc.createElement('span');
			// Worth spelling out: in a zip the list of what is inside is readable by
			// anyone holding the file, password or not.
			namesText.textContent = 'Hide the file names too — without this, anyone with '
				+ 'the archive can see what is in it.';
			namesRow.append(namesBox, namesText);
			box.append(namesRow);
		}

		box.append(archiveButtons([
			{label: 'Cancel', className: 'Dialog__cancel'},
			{label: 'Compress', primary: true, run: function () {
				dialog.onName(nameInput.value);
				if (format.password) {
					dialog.onPassword(passwordInput.value);
				}
				dialog.onCompress();
			}}
		]));
		return box;
	}

	function choiceRow (label, options, current, onPick) {
		var row = doc.createElement('div');
		row.className = 'Modal__field';
		var caption = doc.createElement('label');
		caption.textContent = label;
		row.append(caption);

		var buttons = doc.createElement('div');
		buttons.style.display = 'flex';
		buttons.style.gap = '6px';
		buttons.style.flexWrap = 'wrap';
		options.forEach(function (option) {
			var button = doc.createElement('button');
			button.type = 'button';
			button.textContent = option.label;
			button.setAttribute('aria-pressed', String(option.id === current));
			if (option.id === current) {
				button.classList.add('Dialog__submit');
			}
			button.onclick = function () {
				onPick(option.id);
			};
			buttons.append(button);
		});
		row.append(buttons);
		return row;
	}

	function hint (text) {
		var node = doc.createElement('div');
		node.className = 'Modal__list Modal__hint Modal__hint--tucked';
		node.textContent = text;
		return node;
	}

	function archiveButtons (specs) {
		var row = doc.createElement('div');
		row.className = 'Modal__buttons';
		specs.forEach(function (spec) {
			var button = doc.createElement('button');
			button.textContent = spec.label;
			if (spec.className) {
				button.className = spec.className;
			}
			if (spec.primary) {
				button.classList.add('Dialog__submit');
			}
			button.disabled = !!spec.disabled;
			button.onclick = spec.run || function () {
				state.dialog = null;
				renderOverlays();
			};
			row.append(button);
		});
		return row;
	}

	// --- archives -------------------------------------------------------------------
	//
	// The engine is 1.4 MB of WebAssembly and most sessions never open an archive, so it
	// arrives on the first press of *Extract* rather than with Explorer. The rules it
	// needs (../../7z/js/parse.js) are imported at the top of this file, because deciding whether a file
	// is an archive at all must not cost a download.

	var archiveEngine = null;

	function loadArchiveEngine () {
		if (!archiveEngine) {
			archiveEngine = importEngine();
			// A failed load is not the answer for the rest of the session: the next press
			// tries again rather than replaying it.
			archiveEngine.catch(function () {
				archiveEngine = null;
			});
		}
		return archiveEngine;
	}

	// The engine describes its own failures -- a wrong password and a truncated file are
	// the same exit code, and only the text tells them apart -- so its sentence is used
	// where there is one, and only an unexpected exception falls back to the generic
	// reporter.
	function reportArchiveFailure (label, err) {
		if (err && err.failure) {
			report(err.failure.title, err.failure.message, 'warn');
			return;
		}
		reportFailure(label, err);
	}

	async function openArchiveDialog (item) {
		var dialog = {
			type: 'archive',
			name: item.name,
			path: item.path,
			phase: 'reading',
			entries: [],
			selected: null,
			password: '',
			error: '',
			destination: '',
			unwrapped: false,
			bytes: null,
			onUnlock: function (password) {
				readArchive(dialog, password);
			},
			onExtract: function (paths) {
				runExtract(dialog, paths);
			},
			onToggle: function (entryPath, on) {
				if (on) {
					dialog.selected.add(entryPath);
				}
				else {
					dialog.selected.delete(entryPath);
				}
			},
			onPassword: function (value) {
				dialog.password = value;
			}
		};
		openDialog(dialog);
		await readArchive(dialog, '');
	}

	// Listing first, always. Reading an archive to see inside it writes nothing anywhere,
	// which is what makes it safe to do before asking anything.
	async function readArchive (dialog, password) {
		dialog.phase = 'reading';
		dialog.error = '';
		dialog.password = password || '';
		refreshArchiveDialog(dialog);

		var engine = null;
		var listing;
		try {
			engine = await loadArchiveEngine();
			if (!dialog.bytes) {
				dialog.bytes = await readFile(dialog.path);
			}
			listing = await engine.inspect(dialog.bytes, {
				name: dialog.name,
				password: dialog.password
			});
		}
		catch (err) {
			closeArchiveDialog(dialog);
			reportArchiveFailure('Could not read ' + dialog.name, err);
			return;
		}

		// Closed while the engine was working. Its answer is no longer wanted, and
		// reopening the dialog over whatever is on screen now would be worse than useless.
		if (state.dialog !== dialog) {
			return;
		}

		if (listing.needsPassword) {
			dialog.phase = 'password';
			dialog.error = listing.failure ? listing.failure.title : '';
			refreshArchiveDialog(dialog);
			return;
		}
		if (listing.failure) {
			closeArchiveDialog(dialog);
			report(listing.failure.title, listing.failure.message, 'warn');
			return;
		}

		dialog.entries = listing.entries;
		dialog.unwrapped = !!listing.unwrapped;
		dialog.selected = new Set(listing.entries.filter(function (entry) {
			return !entry.isDirectory;
		}).map(function (entry) {
			return entry.path;
		}));
		dialog.destination = engine.destinationFor(dialog.name, function (name) {
			return state.items.some(function (entry) {
				return entry.name === name;
			});
		});
		dialog.phase = 'ready';
		refreshArchiveDialog(dialog);
	}

	async function runExtract (dialog, paths) {
		dialog.phase = 'working';
		dialog.error = '';
		refreshArchiveDialog(dialog);

		var result;
		try {
			var engine = await loadArchiveEngine();
			result = await engine.extract(dialog.bytes, {
				name: dialog.name,
				password: dialog.password,
				// Everything selected is not a selection: without a list 7-Zip keeps the
				// empty folders too, and there is nothing to get wrong.
				paths: paths
			});
		}
		catch (err) {
			var kind = err && err.failure ? err.failure.kind : '';
			// A password is a question, not a failure: the dialog stays open and asks
			// again, with what went wrong above the field.
			if (kind === 'password' || kind === 'password-needed') {
				dialog.phase = 'password';
				dialog.error = err.failure.title;
				refreshArchiveDialog(dialog);
				return;
			}
			closeArchiveDialog(dialog);
			reportArchiveFailure('Could not extract ' + dialog.name, err);
			return;
		}

		closeArchiveDialog(dialog);
		await writeExtracted(dialog.name, result, dialog.destination);
		await refreshCurrentDir(false);
	}

	// Nothing here needs the engine: the names, formats and presets are all in the rules
	// module Explorer already has. The 1.4 MB arrives when Compress is pressed, and not
	// for somebody who opened the dialog to look at it.
	function openCompressDialog (items) {
		var folderName = state.cwd.split('/').filter(Boolean).pop() || 'archive';
		var dialog = {
			type: 'compress',
			items: items,
			folderName: folderName,
			format: '7z',
			preset: 'normal',
			password: '',
			encryptNames: false,
			phase: 'ready',
			progress: '',
			name: ''
		};
		dialog.name = freeArchiveName(items, dialog.format, folderName);

		dialog.onFormat = function (formatId) {
			// The name follows the format rather than being left saying .zip on a 7z.
			var stem = archiveNames.stripExtension(dialog.name, dialog.format);
			dialog.format = formatId;
			dialog.name = freeArchiveName(items, formatId, folderName, stem);
			refreshArchiveDialog(dialog);
		};
		dialog.onPreset = function (presetId) {
			dialog.preset = presetId;
			refreshArchiveDialog(dialog);
		};
		dialog.onName = function (value) {
			dialog.name = value;
		};
		dialog.onPassword = function (value) {
			dialog.password = value;
		};
		dialog.onEncryptNames = function (on) {
			dialog.encryptNames = on;
		};
		dialog.onCompress = function () {
			runCompress(dialog);
		};

		openDialog(dialog);
	}

	function freeArchiveName (items, formatId, folderName, stem) {
		var suggested = stem
			? stem + '.' + archiveNames.formatFor(formatId).extension
			: archiveNames.archiveNameFor(items, formatId, folderName);
		var base = archiveNames.stripExtension(suggested, formatId);
		return archiveNames.uniqueName(base, archiveNames.formatFor(formatId).extension, function (name) {
			return state.items.some(function (entry) {
				return entry.name === name;
			});
		});
	}

	async function runCompress (dialog) {
		dialog.phase = 'working';
		dialog.progress = 'Reading the files…';
		refreshArchiveDialog(dialog);

		var made;
		try {
			var engine = await loadArchiveEngine();
			var source = await collectForArchive(dialog.items);
			dialog.progress = 'Compressing ' + source.files.length
				+ (source.files.length === 1 ? ' file…' : ' files…');
			refreshArchiveDialog(dialog);
			made = await engine.compress({
				name: dialog.name,
				format: dialog.format,
				preset: dialog.preset,
				password: dialog.password,
				encryptNames: dialog.encryptNames,
				files: source.files,
				dirs: source.dirs
			});
		}
		catch (err) {
			closeArchiveDialog(dialog);
			reportArchiveFailure('Could not make ' + dialog.name, err);
			return;
		}

		closeArchiveDialog(dialog);
		try {
			// Through the same funnel every other route that produces a file uses, so a
			// name that has appeared since the dialog opened is asked about rather than
			// written over. The suggested name is already a free one; this is the race.
			var written = await writeNewFile(state.cwd, made.name, Buffer.from(made.data), 'compress');
			if (!written) {
				return;
			}
		}
		catch (err) {
			reportFailure('Writing ' + made.name, err);
			return;
		}
		await refreshCurrentDir(false);
		report('Made ' + made.name, formatSize(made.data.length) + ' from '
			+ dialog.items.length + (dialog.items.length === 1 ? ' item' : ' items') + '.',
			'info');
	}

	// Every file under everything that was selected, with paths relative to this folder --
	// so the archive holds `notes/a.txt` and not the whole path from the root of PixOS.
	// Empty folders are collected separately, because they are part of the shape and
	// nothing else would record them.
	async function collectForArchive (items) {
		var files = [];
		var dirs = [];

		async function walk (item, relative) {
			if (!item.isDirectory) {
				files.push({path: relative, data: await readFile(item.path)});
				return;
			}
			dirs.push(relative);
			var children = await listDirectory(item.path);
			for (var i = 0; i < children.length; i++) {
				await walk(children[i], relative + '/' + children[i].name);
			}
		}

		for (var i = 0; i < items.length; i++) {
			await walk(items[i], items[i].name);
		}
		return {files: files, dirs: dirs};
	}

	// The first render of a dialog goes through openDialog, which wraps its callbacks so a
	// throw inside one is reported rather than lost. Every render after that must not:
	// openDialog wraps again each time it is called, and a dialog with four states would
	// end up several layers deep in its own error handling.
	function refreshArchiveDialog (dialog) {
		if (state.dialog === dialog) {
			renderOverlays();
			return;
		}
		openDialog(dialog);
	}

	function closeArchiveDialog (dialog) {
		if (state.dialog === dialog) {
			state.dialog = null;
			renderOverlays();
		}
	}

	// Straight into a folder beside the archive -- the whole point of the phase. The name
	// is never one that is already taken: extracting the same archive twice is ordinary,
	// and merging into a folder somebody has since put their own files in cannot be undone.
	async function writeExtracted (archiveName, result, destination) {
		var engine = await loadArchiveEngine();
		var folder = destination || engine.destinationFor(archiveName, function (name) {
			return state.items.some(function (entry) {
				return entry.name === name;
			});
		});
		var destPath = path.join(state.cwd, folder);

		try {
			await ensureDir(destPath);
			for (var i = 0; i < result.files.length; i++) {
				await writeFile(path.join(destPath, result.files[i].path),
					Buffer.from(result.files[i].data));
			}
			// An empty folder is part of the archive's shape, and writeFile only makes the
			// ones with something in them.
			for (var d = 0; d < (result.dirs || []).length; d++) {
				await ensureDir(path.join(destPath, result.dirs[d]));
			}
		}
		catch (err) {
			reportFailure('Writing the contents of ' + archiveName, err);
			return;
		}

		var partial = result.failure && result.failure.kind === 'partial';
		report(partial ? 'Extracted part of ' + archiveName : 'Extracted ' + archiveName,
			result.files.length + (result.files.length === 1 ? ' file' : ' files')
				+ ' into ' + folder + '/'
				+ (result.unwrapped ? ' — both layers of it, so there is no .tar left over.' : '')
				+ (partial ? ' ' + result.failure.message : ''),
			partial ? 'warn' : 'info',
			[{label: 'Open ' + folder, run: function () { navigateTo(destPath); }}]);
	}

	// One entry, one dialog, for every format 7-Zip reads. There were two before --
	// *Extract*, which only ever understood zip, and *Extract 7z*, which did not
	// extract at all: it unpacked the archive and re-packed the contents as a zip
	// beside it, leaving you a second job to do by hand.
	async function extract (itemPath) {
		var item = getItemByPath(itemPath || Array.from(state.selectedPaths)[0]);
		if (!item || item.isDirectory) {
			return;
		}
		await openArchiveDialog(item);
	}

	// The other half of the engine. Acts on the selection, or on the row it was
	// opened from -- a folder, a file, or a dozen of both.
	function compress (itemPath) {
		var items = getSelectedItems();
		// `!items.length` says what is meant rather than changing the answer: with an empty
		// selection the row lookup below lands on the same `[]` or the same single row.
		if (!items.length || (itemPath && !state.selectedPaths.has(itemPath))) {
			var single = getItemByPath(itemPath);
			items = single ? [single] : [];
		}
		if (!items.length) {
			return;
		}
		openCompressDialog(items);
	}

	// Several at once: no listing and no subset, because a dialog per archive is not
	// an answer to "extract these five". A locked one is reported rather than
	// silently skipped, and says how to deal with it.
	async function extractSelected () {
		var targets = getSelectedItems().filter(function (item) {
			return !item.isDirectory;
		});
		if (!targets.length) {
			return;
		}
		if (targets.length === 1) {
			await openArchiveDialog(targets[0]);
			return;
		}

		var engine;
		try {
			engine = await loadArchiveEngine();
		}
		catch (err) {
			reportArchiveFailure('The archive engine could not be loaded', err);
			return;
		}

		var done = [];
		var locked = [];
		var failed = [];
		for (var i = 0; i < targets.length; i++) {
			try {
				var bytes = await readFile(targets[i].path);
				var result = await engine.extract(bytes, {name: targets[i].name});
				await writeExtracted(targets[i].name, result);
				done.push(targets[i].name);
			}
			catch (err) {
				var kind = err && err.failure ? err.failure.kind : '';
				if (kind === 'password' || kind === 'password-needed') {
					locked.push(targets[i].name);
				}
				else {
					failed.push(targets[i].name + ' — '
						+ (err && err.failure ? err.failure.title : (err && err.message) || 'failed'));
				}
			}
		}
		await refreshCurrentDir(false);

		var lines = [];
		if (done.length) {
			lines.push(done.length + ' extracted.');
		}
		if (locked.length) {
			lines.push(locked.length + ' need a password: ' + locked.join(', ')
				+ '. Extract those one at a time — the dialog asks.');
		}
		if (failed.length) {
			lines.push(failed.join('; ') + '.');
		}
		report(done.length ? 'Extracted ' + done.length + ' of ' + targets.length
			: 'Nothing was extracted', lines.join(' '),
			(locked.length || failed.length) ? 'warn' : 'info');
	}

	return {
		extract: extract,
		compress: compress,
		extractSelected: extractSelected,
		buildArchiveDialog: buildArchiveDialog,
		buildCompressDialog: buildCompressDialog,
		openArchiveDialog: openArchiveDialog,
		openCompressDialog: openCompressDialog,
		loadArchiveEngine: loadArchiveEngine,
		reportArchiveFailure: reportArchiveFailure,
		writeExtracted: writeExtracted,
		readArchive: readArchive,
		runExtract: runExtract,
		runCompress: runCompress,
		freeArchiveName: freeArchiveName,
		collectForArchive: collectForArchive,
		refreshArchiveDialog: refreshArchiveDialog,
		closeArchiveDialog: closeArchiveDialog,
		archiveNames: archiveNames
	};
}
