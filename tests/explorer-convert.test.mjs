// FFmpeg in Explorer's Tools menu: apps/explorer/js/convert.js.
//
// The engine is 31 MB of WebAssembly that nothing installs, so the whole of this runs against a
// fake one, and most of what it checks is order: the options dialog is closed before anything is
// loaded, the engine is made once per window and reused, files go through it one at a time, and
// each result is written through `writeNewFile` into the folder being shown.
//
// Three checks near the bottom pin behaviour docs/backlog.md records as wrong, or possibly wrong,
// once the engine is really there -- recorded while the code was moved rather than changed by the
// move. Fixing any of them should turn its check red on purpose.

import {check, report} from './assert.mjs';
import {createConvert} from '../apps/explorer/js/convert.js';

const DEFAULTS = ['-c:v', 'libx264', '-movflags', 'faststart', '-crf', '30', '-preset', 'superfast'];

function harness (options) {
	options = options || {};
	const h = {
		state: {cwd: options.cwd || '/home', dialog: {type: 'whatever was open'}},
		items: options.items || [],
		selected: new Set(options.selected || []),
		dialogs: [],
		infos: [],
		calls: [],
		engines: []
	};

	class FFmpeg {
		constructor () {
			this.events = [];
			h.engines.push(this);
			h.calls.push(['construct']);
		}
		on (event) { this.events.push(event); }
		async load (config) {
			h.calls.push(['load', config.coreURL]);
			if (options.loadFails) { throw new Error('network'); }
		}
		async writeFile (name, data) { h.calls.push(['ffWrite', name, Buffer.from(data).toString()]); }
		async exec (args) {
			h.calls.push(['exec', args]);
			if (options.execFails) { throw new Error('exit 1'); }
		}
		async readFile (name) {
			h.calls.push(['ffRead', name]);
			return new TextEncoder().encode('CONVERTED ' + h.calls.filter(c => c[0] === 'exec').length);
		}
	}

	h.win = {
		FFmpeg: options.notInstalled ? undefined : FFmpeg,
		location: {href: options.href || 'https://pixos.example/__browserfs__/apps/explorer/'},
		fileTypeFromBuffer: async () => options.fileType
	};

	h.convert = createConvert({
		state: h.state,
		path: {basename: p => String(p).split('/').pop()},
		Buffer: Buffer,
		win: h.win,
		getSelectedItems: () => h.items.filter(i => h.selected.has(i.path)),
		readFile: async p => {
			h.calls.push(['read', p]);
			// A Buffer over an ArrayBuffer of its own. Built from the ArrayBuffer and not from the
			// Uint8Array on purpose: node takes a small Buffer.from(Uint8Array) out of a shared 8 KB
			// pool, whose `.buffer` is the whole pool -- the very case the last check below is about.
			return Buffer.from(new TextEncoder().encode('SOURCE ' + p).buffer);
		},
		writeNewFile: async (folder, name, data) => {
			h.calls.push(['write', folder, name, Buffer.isBuffer(data) ? data.toString() : '<not a Buffer>']);
		},
		openDialog: dialog => { h.dialogs.push(dialog); },
		openInfoDialog: (title, message) => { h.infos.push([title, message]); },
		renderOverlays: () => { h.calls.push(['overlays', h.state.dialog]); },
		refreshCurrentDir: async keep => { h.calls.push(['refresh', keep]); }
	});
	return h;
}

const file = p => ({path: p, name: p.split('/').pop(), isDirectory: false});
const folder = p => ({path: p, name: p.split('/').pop(), isDirectory: true});
const submit = (h, value) => h.dialogs[h.dialogs.length - 1].onSubmit(value);
const kinds = h => h.calls.map(c => c[0]);

async function rejects (promise) {
	try {
		await promise;
		return null;
	}
	catch (err) {
		return err.message;
	}
}

// --- the command line ------------------------------------------------------------------------

{
	const {splitCommandLine} = harness().convert;
	check('nothing is no arguments', [splitCommandLine(''), splitCommandLine(null)], [[], []]);
	check('whitespace of any width separates', splitCommandLine('  -an\t -y  '), ['-an', '-y']);
	check('double quotes group, and are not kept',
		splitCommandLine('-vf "scale=640:-1, fps=30" -an'), ['-vf', 'scale=640:-1, fps=30', '-an']);
	check('an empty quoted argument is still an argument', splitCommandLine('-metadata ""'), ['-metadata', '']);
}

// --- the dialog, and an engine that is not there -------------------------------------------------

{
	const h = harness({notInstalled: true, items: [file('/home/a.mov')], selected: ['/home/a.mov']});
	await h.convert.ffmpeg();
	check('FFmpeg opens its options dialog with the defaults in it, and loads nothing yet',
		[h.dialogs.map(d => [d.type, d.defaultArgs]), h.calls],
		[[['ffmpegOptions', '-c:v libx264 -movflags faststart -crf 30 -preset superfast']], []]);

	const failure = await rejects(submit(h, ''));
	check('with no engine installed, the dialog closes and says so -- and reads nothing, and throws nothing',
		[h.calls, h.infos, failure], [[['overlays', null]], [['FFmpeg', 'FFmpeg is not installed']], null]);
}

// --- converting --------------------------------------------------------------------------------------

{
	const h = harness({
		items: [file('/home/a.mov'), folder('/home/clips'), file('/home/b.avi')],
		selected: ['/home/a.mov', '/home/clips', '/home/b.avi'],
		fileType: {ext: 'mp4'}
	});
	await h.convert.ffmpeg();
	await submit(h, '');

	check('the dialog is closed and drawn away before the engine is made and loaded',
		kinds(h).slice(0, 3), ['overlays', 'construct', 'load']);
	check('the engine listens for its log and its progress', h.engines[0].events, ['log', 'progress']);
	check('it is loaded from the ffmpeg app beside Explorer',
		h.calls[2], ['load', 'https://pixos.example/__browserfs__/apps/explorer/../ffmpeg.0.12.10/ffmpeg-core.js']);

	check('each selected file goes through it in turn, folders skipped, and the listing refreshes once at the end',
		kinds(h).slice(3), ['read', 'ffWrite', 'exec', 'ffRead', 'write',
			'read', 'ffWrite', 'exec', 'ffRead', 'write', 'refresh']);
	check('with its own bytes as the input', h.calls[4], ['ffWrite', 'input', 'SOURCE /home/a.mov']);
	check('and the default arguments when none were typed', h.calls[5], ['exec', ['-i', 'input'].concat(DEFAULTS, ['output.mp4'])]);
	check('and what is read back is the output it was told to write, not the input', h.calls[6], ['ffRead', 'output.mp4']);
	check('the result is written into the folder being shown, as a Buffer, named after the source',
		h.calls.filter(c => c[0] === 'write'),
		[['write', '/home', 'a.mov.mp4', 'CONVERTED 1'], ['write', '/home', 'b.avi.mp4', 'CONVERTED 2']]);
	check('then the listing, keeping nothing selected', h.calls[h.calls.length - 1], ['refresh', false]);

	h.calls.length = 0;
	await submit(h, '-an "-y"');
	check('a second press reuses the engine rather than making and loading another',
		[h.engines.length, kinds(h).includes('load')], [1, false]);
	check('and typed arguments replace the defaults', h.calls.find(c => c[0] === 'exec'),
		['exec', ['-i', 'input', '-an', '-y', 'output.mp4']]);
}

{
	const h = harness({items: [file('/home/talk.mov')], selected: ['/home/talk.mov'], fileType: {ext: 'webm'}});
	await h.convert.ffmpeg();
	await submit(h, '-c:v libvpx');
	const g = harness({items: [file('/home/talk.mov')], selected: ['/home/talk.mov'], fileType: undefined});
	await g.convert.ffmpeg();
	await submit(g, '');
	check('the extension is what the output turned out to be, and mp4 when that cannot be told',
		[h.calls.find(c => c[0] === 'write')[2], g.calls.find(c => c[0] === 'write')[2]], ['talk.mov.webm', 'talk.mov.mp4']);
}

{
	const h = harness({items: [file('/home/a.mov'), file('/home/b.mov')], selected: ['/home/a.mov', '/home/b.mov'], execFails: true});
	await h.convert.ffmpeg();
	const failure = await rejects(submit(h, ''));
	check('a failed conversion reaches the guard that wraps every dialog callback', failure, 'exit 1');
	check('and stops there: nothing written, nothing refreshed, the next file not started',
		kinds(h).filter(k => k === 'write' || k === 'refresh' || k === 'read'), ['read']);
}

// --- recorded in docs/backlog.md, pinned as they are -----------------------------------------------

{
	// The core's URL is the page's address with a relative path glued onto the end. Right only when
	// that address ends in a slash: from `.../explorer/index.html?cwd=/home` it names a file inside
	// a folder called `index.html?cwd=/home..`.
	const h = harness({href: 'https://pixos.example/__browserfs__/apps/explorer/index.html?cwd=/home',
		items: [file('/home/a.mov')], selected: ['/home/a.mov']});
	await h.convert.ffmpeg();
	await submit(h, '');
	check('KNOWN (backlog): the core URL is concatenated onto the page address, not resolved against it',
		h.calls.find(c => c[0] === 'load')[1],
		'https://pixos.example/__browserfs__/apps/explorer/index.html?cwd=/home../ffmpeg.0.12.10/ffmpeg-core.js');
}

{
	// The instance is cached before it has loaded, so a load that fails once leaves an unloaded
	// engine in the cache, and every later press skips the load and fails in `exec` instead.
	const h = harness({loadFails: true, items: [file('/home/a.mov')], selected: ['/home/a.mov']});
	await h.convert.ffmpeg();
	const first = await rejects(submit(h, ''));
	check('a failed load reaches the guard', first, 'network');
	let second;
	try {
		second = await h.convert.ensureFfmpegLoaded();
	}
	catch (err) {
		second = 'threw ' + err.message;
	}
	check('KNOWN (backlog): and the unloaded engine stays cached, so the next press does not load again',
		[!!h.win.ffmpeg, second, h.calls.filter(c => c[0] === 'load').length],
		[true, true, 1]);
}

{
	// `new Uint8Array(file.buffer)` is the whole ArrayBuffer under the Buffer, not the Buffer. The
	// same thing for a file of its own; for a Buffer that is a view into a larger one it is not.
	// Whether any BrowserFS backend hands back such a view has not been established -- this pins
	// what happens if one does.
	const h = harness({items: [file('/home/a.mov')], selected: ['/home/a.mov']});
	const pool = new TextEncoder().encode('xxxxSOURCExxxx');
	h.convert = createConvert(Object.assign({}, {
		state: h.state, path: {basename: p => p.split('/').pop()}, Buffer: Buffer, win: h.win,
		getSelectedItems: () => h.items, readFile: async () => Buffer.from(pool.buffer, 4, 6),
		writeNewFile: async () => {}, openDialog: d => { h.dialogs.push(d); }, openInfoDialog: () => {},
		renderOverlays: () => {}, refreshCurrentDir: async () => {}
	}));
	await h.convert.ffmpeg();
	await submit(h, '');
	check('KNOWN (backlog): a Buffer that is a view hands the engine everything under it',
		h.calls.find(c => c[0] === 'ffWrite')[2], 'xxxxSOURCExxxx');
}

process.exit(report('explorer-convert') ? 1 : 0);
