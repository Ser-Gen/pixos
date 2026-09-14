// *FFmpeg* in the Tools menu: converting the selected files with ffmpeg.wasm, one after another,
// into the folder being shown. The last entry of Explorer's action table to leave index.html.
//
// **Nothing installs the engine.** `apps/ffmpeg.0.12.10` (31 MB) has no manifest and no install
// route (docs/backlog.md), and index.html only loads its `ffmpeg.js` if the file happens to exist
// in BrowserFS -- which is where `win.FFmpeg` comes from. On an ordinary system the answer to
// every press is "FFmpeg is not installed", and this module is mostly that sentence. The backlog
// also records what this code gets wrong once the engine *is* there -- two things for certain and
// one assumption, found while moving it. They are pinned by the tests as they are and left alone
// here, because a pass that promised no behaviour change is not the place to change code nobody
// can reach to check.
//
// The engine instance is cached on `win.ffmpeg`, as it always was: one per Explorer window, made
// on the first press and reused after. Files go through it strictly one at a time -- every run
// writes `input` and reads `output.mp4` in the same virtual filesystem -- and each result is
// written through file-ops' `writeNewFile`, so a name that is taken is asked about like any other.
//
// The platform is `win`: `FFmpeg`, the cached `ffmpeg`, `fileTypeFromBuffer` (from the file-type
// script index.html loads) and `location`.

export function createConvert (deps) {

	var state = deps.state;
	var path = deps.path;
	var Buffer = deps.Buffer;
	var win = deps.win;
	var getSelectedItems = deps.getSelectedItems;
	var readFile = deps.readFile;
	var writeNewFile = deps.writeNewFile;
	var openDialog = deps.openDialog;
	var openInfoDialog = deps.openInfoDialog;
	var renderOverlays = deps.renderOverlays;
	var refreshCurrentDir = deps.refreshCurrentDir;

	async function ffmpeg () {
		var defaultArgs = '-c:v libx264 -movflags faststart -crf 30 -preset superfast';
		openDialog({
			type: 'ffmpegOptions',
			defaultArgs: defaultArgs,
			onSubmit: async function (argsRaw) {
				state.dialog = null;
				renderOverlays();
				if (!await ensureFfmpegLoaded()) return;

				var targets = getSelectedItems().filter(function (item) { return !item.isDirectory; });
				var args = splitCommandLine(argsRaw || defaultArgs);

				for (var i = 0; i < targets.length; i++) {
					var src = targets[i];
					var file = await readFile(src.path);
					await win.ffmpeg.writeFile('input', new Uint8Array(file.buffer));
					await win.ffmpeg.exec(['-i', 'input'].concat(args, ['output.mp4']));
					var out = await win.ffmpeg.readFile('output.mp4');
					var fileType = await win.fileTypeFromBuffer(out);
					var name = path.basename(src.path) + '.' + (fileType && fileType.ext ? fileType.ext : 'mp4');
					await writeNewFile(state.cwd, name, Buffer.from(out));
				}
				await refreshCurrentDir(false);
			}
		});
	}

	async function ensureFfmpegLoaded () {
		if (!win.FFmpeg) {
			openInfoDialog('FFmpeg', 'FFmpeg is not installed');
			return false;
		}
		if (!win.ffmpeg) {
			win.ffmpeg = new win.FFmpeg();
			win.ffmpeg.on('log', function (ev) {
				console.log(ev.message);
			});
			win.ffmpeg.on('progress', function (ev) {
				console.log((ev.progress * 100) + ' %');
			});
			await win.ffmpeg.load({
				coreURL: win.location.href + '../ffmpeg.0.12.10/ffmpeg-core.js'
			});
		}
		return true;
	}

	// Whitespace separates, double quotes group. No escapes and no single quotes: it is a
	// field in a dialog, not a shell.
	function splitCommandLine (line) {
		if (!line) return [];
		var re = /[^\s"]+|"([^"]*)"/g;
		var out = [];
		var match;
		while ((match = re.exec(line)) !== null) {
			out.push(match[1] !== undefined ? match[1] : match[0]);
		}
		return out;
	}

	return {
		ffmpeg: ffmpeg,
		ensureFfmpegLoaded: ensureFfmpegLoaded,
		splitCommandLine: splitCommandLine
	};
}
