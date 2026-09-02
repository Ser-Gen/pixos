// Reading 7-Zip's own output, and deciding what it means.
//
// Everything here is pure, and it exists because the interesting part of an archive is
// what happens when it does not work. 7-Zip says so in words, on stdout and stderr, and
// its exit code is far too coarse to act on: a wrong password and a truncated file are
// both exit code 2, and they send you to completely different next steps. So the words
// are the interface, and they are recorded in tests/archive.test.mjs exactly as 7-Zip
// 25.01 produced them.

// What the engine will be offered for. 7-Zip reads far more than this -- it is a long
// list and most of it is obscure -- but every entry here is one somebody plausibly has.
export var ARCHIVE_EXTENSIONS = [
	'7z', 'zip', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'tbz', 'tbz2', 'xz', 'txz',
	'zst', 'tzst', 'lz', 'lzma', 'lz4', 'lzh', 'lha', 'z', 'cab', 'arj', 'cpio',
	'iso', 'wim', 'swm', 'esd', 'dmg', 'rpm', 'deb', 'msi', 'chm', 'vhd', 'vhdx',
	'apk', 'jar', 'war', 'xpi', 'epub', 'crx', 'nupkg', 'whl', 'udf', 'squashfs'
];

// A compressed tarball is two archives, and 7-Zip only ever unwraps one at a time --
// extracting `x.tar.gz` gives you `x.tar` and a second job to do by hand. These are the
// names that mean "there is a tar inside".
var TARBALL = /\.(tar\.(gz|bz2|bz|xz|zst|lz|lzma|lz4|z)|tgz|tbz2?|txz|tzst|tlz)$/i;

export function isTarball (name) {
	return TARBALL.test(String(name || ''));
}

export function extensionOf (name) {
	var match = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
	return match ? match[1].toLowerCase() : '';
}

export function isArchiveName (name) {
	if (isTarball(name)) {
		return true;
	}
	return ARCHIVE_EXTENSIONS.indexOf(extensionOf(name)) !== -1;
}

// `archive.tar.gz` -> `archive`, `photos.zip` -> `photos`. Both extensions come off a
// tarball, or extracting one would leave you with a folder called `holiday.tar`.
export function baseNameFor (name) {
	var text = String(name || 'archive');
	if (isTarball(text)) {
		return text.replace(TARBALL, '');
	}
	return text.replace(/\.[A-Za-z0-9]+$/, '') || text;
}

// Where the contents go. Never over the top of something that is already there: the
// second extraction of the same archive is a very ordinary thing to do, and silently
// merging into a folder somebody has since put their own files in is not recoverable.
export function destinationFor (name, taken) {
	var base = baseNameFor(name);
	var exists = taken || function () { return false; };
	if (!exists(base)) {
		return base;
	}
	for (var n = 2; n < 1000; n++) {
		if (!exists(base + '-' + n)) {
			return base + '-' + n;
		}
	}
	return base + '-' + Date.now();
}

// `l -slt` prints a block per entry, separated by blank lines, after a `----------` line.
// Everything before that line describes the archive itself -- including a `Path =` of its
// own, which is why the marker matters rather than being tidiness.
export function parseListing (text) {
	var lines = String(text || '').split(/\r?\n/);
	var start = lines.indexOf('----------');
	if (start === -1) {
		return [];
	}

	var entries = [];
	var current = null;

	for (var i = start + 1; i < lines.length; i++) {
		var line = lines[i];
		var pair = /^([A-Za-z][A-Za-z0-9 ]*) = ?(.*)$/.exec(line);
		if (!pair) {
			// A blank line ends a block. Anything else at this point is the summary
			// 7-Zip prints when it has finished, and there are no more entries after it.
			current = null;
			continue;
		}
		var key = pair[1];
		var value = pair[2];
		if (key === 'Path') {
			current = {
				path: value,
				size: 0,
				packed: 0,
				modified: '',
				isDirectory: false,
				encrypted: false,
				method: ''
			};
			entries.push(current);
			continue;
		}
		if (!current) {
			continue;
		}
		if (key === 'Size') { current.size = toNumber(value); }
		else if (key === 'Packed Size') { current.packed = toNumber(value); }
		else if (key === 'Modified') { current.modified = value.trim(); }
		else if (key === 'Folder') { current.isDirectory = value.trim() === '+'; }
		else if (key === 'Attributes') { current.isDirectory = current.isDirectory || /^D/.test(value.trim()); }
		else if (key === 'Encrypted') { current.encrypted = value.trim() === '+'; }
		else if (key === 'Method') { current.method = value.trim(); }
	}

	return entries;
}

function toNumber (value) {
	var n = parseInt(String(value).trim(), 10);
	return isFinite(n) ? n : 0;
}

export function isEncryptedListing (entries) {
	return (entries || []).some(function (entry) {
		return entry.encrypted;
	});
}

// The whole point of the file. `hadPassword` is the caller's, because 7-Zip cannot tell
// the difference between "you gave me nothing" and "you gave me the wrong thing" -- both
// come back as `Wrong password` -- and the sentence a person needs is not the same.
//
// `expect` matters for one reason: `Everything is Ok` is printed when 7-Zip *finishes a
// job*, and listing an archive is not one. A listing that exits 0 has worked.
export function classify (result) {
	var r = result || {};
	var code = r.code;
	var text = [].concat(r.stdout || [], r.stderr || []).join('\n');
	var hadPassword = r.hadPassword === true;
	var listing = r.expect === 'listing';

	// Checked before anything else: a password error also raises the generic error
	// counters, so a later rule would win and say something less useful.
	if (/Cannot open encrypted archive\. Wrong password\?/i.test(text)
		|| /ERROR: Wrong password/i.test(text)) {
		return hadPassword
			? {
				kind: 'password',
				title: 'That password did not work',
				message: 'The archive opened, but nothing in it could be decrypted with '
					+ 'that password. Nothing was written.'
			}
			: {
				kind: 'password-needed',
				title: 'This archive needs a password',
				message: 'Its contents are encrypted. Nothing was written.'
			};
	}

	if (/Cannot open the file as archive|Can't open as archive|Is not archive/i.test(text)) {
		return {
			kind: 'unsupported',
			title: 'This is not an archive 7-Zip can open',
			message: 'Either the file is not an archive at all, or it is in a format this '
				+ 'build does not read. The extension is not what decides it — the '
				+ 'contents are.'
		};
	}

	if (/Unexpected end of archive|Unsupported feature|Headers Error|CRC Failed|Data Error|ERRORS:/i.test(text)) {
		return {
			kind: 'corrupt',
			title: 'The archive is damaged',
			message: describeDamage(text) + ' A partial download is the usual cause, and '
				+ 'the fix is a fresh copy — nothing here can repair it.'
		};
	}

	if (/There is not enough space on the disk/i.test(text)) {
		return {
			kind: 'space',
			title: 'There is not enough room',
			message: 'The archive is bigger than what is left. Free some space and try again.'
		};
	}

	if (code === 8 || /Can not allocate memory|not enough memory/i.test(text)) {
		return {
			kind: 'memory',
			title: 'The archive is too large for this tab',
			message: 'The engine ran out of memory unpacking it. A browser tab has far '
				+ 'less to work with than a desktop.'
		};
	}

	// `Everything is Ok` is 7-Zip's own success line, and for an extraction it is checked
	// *as well as* the exit code: a run that exits 0 having quietly extracted nothing is
	// not a success, and writing an empty folder and calling it done is one of the ways
	// this used to fail.
	if (code === 0 && (listing || /Everything is Ok/i.test(text))) {
		return {kind: 'ok', title: '', message: ''};
	}

	if (code === 1) {
		return {
			kind: 'partial',
			title: 'Some of the archive could not be extracted',
			message: 'Everything 7-Zip could read has been written. ' + lastError(text)
		};
	}

	return {
		kind: 'failed',
		title: 'The archive could not be extracted',
		message: lastError(text) || 'The engine stopped with code ' + code + ' and said nothing.'
	};
}

function describeDamage (text) {
	if (/Unexpected end of archive/i.test(text)) {
		return 'It stops in the middle — the end of the file is missing.';
	}
	if (/CRC Failed/i.test(text)) {
		return 'A file inside it fails its own checksum.';
	}
	if (/Headers Error/i.test(text)) {
		return 'Its table of contents does not read.';
	}
	return 'It does not read as a whole file.';
}

// The last thing 7-Zip actually said, which beats a code every time.
export function lastError (text) {
	var lines = String(text || '').split(/\r?\n/).map(function (line) {
		return line.trim();
	}).filter(Boolean);
	for (var i = lines.length - 1; i >= 0; i--) {
		if (/^ERROR/i.test(lines[i])) {
			return lines[i].replace(/^ERROR:?\s*/i, '');
		}
	}
	return '';
}

// The arguments for one run. Kept here, with the rules, because two of them are not
// obvious and both have teeth:
//
//   -p   is passed *always*, empty if there is no password. Without it 7-Zip asks for one
//        on stdin, and there is no stdin here — the engine simply stops, with no output
//        and no exit, and the extraction hangs forever.
//   -y   answers the overwrite and other prompts, for the same reason.
//   -bd  turns off the progress redraw, which is otherwise thousands of lines of
//        carriage returns in the output this file has to read.
export function extractArgs (options) {
	var cfg = options || {};
	var args = ['x', cfg.archive || '/in/archive', '-o' + (cfg.out || '/out'), '-y', '-bd'];
	args.push('-p' + (cfg.password || ''));
	if (cfg.listFile) {
		// Names come in through a list file rather than on the command line: a path with
		// a space, a quote or a wildcard character in it is otherwise 7-Zip's to
		// misread, and archives are full of them.
		args.push('-scsUTF-8', '@' + cfg.listFile);
	}
	return args;
}

export function listArgs (options) {
	var cfg = options || {};
	return ['l', '-slt', cfg.archive || '/in/archive', '-p' + (cfg.password || '')];
}

// --- making archives ----------------------------------------------------------------
//
// Three formats and three presets, which is the whole surface. 7-Zip exposes dictionary
// sizes, word sizes, solid block sizes and thread counts, and a dialog that offers them
// has to explain them; these are the two choices that change the answer for the people
// making an archive in a file manager.

export var FORMATS = [
	{
		id: '7z',
		label: '7z',
		extension: '7z',
		password: true,
		// Only 7z can encrypt the *names* as well as the contents. In a zip the list of
		// what is inside is always readable, which is worth saying rather than implying.
		encryptNames: true,
		note: 'Smallest. Opens in 7-Zip, and in most archive tools on any system.'
	},
	{
		id: 'zip',
		label: 'zip',
		extension: 'zip',
		password: true,
		encryptNames: false,
		note: 'Opens everywhere with nothing installed. Passwords use AES-256, not the '
			+ 'old zip encryption.'
	},
	{
		id: 'tar.gz',
		label: 'tar.gz',
		extension: 'tar.gz',
		password: false,
		encryptNames: false,
		note: 'The Unix default. Cannot be password-protected — the format has no such '
			+ 'thing.'
	}
];

export var PRESETS = [
	{id: 'store', label: 'Store', level: 0,
		note: 'No compression. Fastest, and the honest choice when the contents are '
			+ 'already compressed — photos, video, other archives.'},
	{id: 'normal', label: 'Normal', level: 5, note: 'The usual trade.'},
	{id: 'best', label: 'Best', level: 9,
		note: 'Slowest, smallest. On a large folder this runs for a while, and the tab '
			+ 'waits for it.'}
];

export function formatFor (id) {
	return FORMATS.find(function (entry) {
		return entry.id === id;
	}) || FORMATS[0];
}

export function presetFor (id) {
	return PRESETS.find(function (entry) {
		return entry.id === id;
	}) || PRESETS[1];
}

// What to call it before anybody types anything. One item takes its own name -- an
// archive of `notes` is `notes.7z` -- and several take the folder they are in, because
// the only thing they have in common is where they were.
export function archiveNameFor (items, formatId, folderName) {
	var list = items || [];
	var extension = formatFor(formatId).extension;
	if (list.length === 1) {
		var only = list[0];
		var base = only.isDirectory ? only.name : baseNameFor(only.name);
		return (base || 'archive') + '.' + extension;
	}
	return (String(folderName || '').trim() || 'archive') + '.' + extension;
}

// `notes.7z`, then `notes-2.7z`. 7-Zip does not replace an archive it is given the name
// of -- it tries to *add* to it, and on anything that is not already an archive of that
// type it stops with "Is not archive". So a free name is a requirement here rather than
// the courtesy it is when extracting.
export function uniqueName (base, extension, taken) {
	var exists = taken || function () { return false; };
	var stem = String(base || 'archive');
	if (!exists(stem + '.' + extension)) {
		return stem + '.' + extension;
	}
	for (var n = 2; n < 1000; n++) {
		if (!exists(stem + '-' + n + '.' + extension)) {
			return stem + '-' + n + '.' + extension;
		}
	}
	return stem + '-' + Date.now() + '.' + extension;
}

export function stripExtension (name, formatId) {
	var extension = formatFor(formatId).extension;
	var text = String(name || '');
	var suffix = '.' + extension;
	return text.slice(-suffix.length).toLowerCase() === suffix
		? text.slice(0, -suffix.length)
		: baseNameFor(text);
}

// One run of the engine per step. A `.tar.gz` is two archives and therefore two steps --
// tar has no compression and gzip has no notion of more than one file -- and because a
// single instance will only ever run `main` once, the second step is a second engine with
// the first one's output written back into it. `fromPrevious` says so.
export function compressSteps (options) {
	var cfg = options || {};
	var format = formatFor(cfg.format);
	var level = presetFor(cfg.preset).level;
	var name = cfg.name || ('archive.' + format.extension);
	var listFile = cfg.listFile || '/list.txt';
	var password = format.password ? String(cfg.password || '') : '';

	function common (args) {
		// -y and -bd for the same reasons extraction passes them: there is no stdin to
		// answer a prompt on, and the progress redraw would bury the output.
		return args.concat(['-y', '-bd', '-scsUTF-8']);
	}

	if (format.id === 'tar.gz') {
		var inner = stripExtension(name, 'tar.gz') + '.tar';
		return [
			{
				// tar takes no level: it does not compress. Passing one would look like
				// it had been applied.
				args: common(['a', '-ttar', '/out/' + inner, '@' + listFile]),
				output: '/out/' + inner,
				name: inner
			},
			{
				args: common(['a', '-tgzip', '-mx' + level, '/out/' + name, '/in/' + inner]),
				output: '/out/' + name,
				name: name,
				fromPrevious: true
			}
		];
	}

	var args = ['a', '-t' + format.id, '-mx' + level, '/out/' + name, '@' + listFile];
	if (password) {
		args.push('-p' + password);
		if (format.id === 'zip') {
			// Without this a zip password is ZipCrypto, which is broken in the sense that
			// there are tools that recover the contents without knowing it.
			args.push('-mem=AES256');
		}
		if (format.id === '7z' && cfg.encryptNames === true) {
			args.push('-mhe=on');
		}
	}
	return [{args: common(args), output: '/out/' + name, name: name}];
}
