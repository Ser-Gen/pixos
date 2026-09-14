// Explorer's clipboards: apps/explorer/js/clipboard.js.
//
// Two of them, and the tests are about the rules that are not visible in the few lines each
// action takes:
//
//   * **A folder and something inside it are copied once**, as the folder. Otherwise the paste
//     makes the folder and then raises a conflict about its own contents.
//   * **A paste works on a snapshot of the clipboard**, and **a cut is forgotten only when the
//     move succeeded** — a refused move leaves it there to try again. The toolbar is redrawn on
//     every route out, including the failing one, or *Paste* stays greyed or lit wrongly.
//   * **Copy path never silently does nothing.** The system clipboard can refuse an iframe; the
//     fallback is a dialog with the text in it.

import {check, report} from './assert.mjs';
import {createClipboard} from '../apps/explorer/js/clipboard.js';

function harness (options) {
	options = options || {};
	const h = {
		state: {
			cwd: options.cwd || '/home',
			selectedPaths: new Set(options.selected || []),
			clipboard: options.clipboard || null,
			dialog: null
		},
		items: options.items || [],
		calls: [],
		handed: null,
		dialogs: [],
		copied: []
	};
	h.clip = createClipboard({
		state: h.state,
		normalizePath: p => ('/' + String(p)).replace(/\/+/g, '/').replace(/(.)\/$/, '$1'),
		getSelectedItems: () => h.items.filter(item => h.state.selectedPaths.has(item.path)),
		copyItemsToFolder: async (paths, destination) => {
			h.handed = paths;
			h.calls.push(['copy', paths.slice(), destination]);
			if (options.during) { options.during(h); }
			if (options.copyThrows) { throw new Error('disk full'); }
		},
		moveItemsToFolder: async (paths, destination, opts) => {
			h.handed = paths;
			h.calls.push(['move', paths.slice(), destination, opts]);
			if (options.during) { options.during(h); }
			if (options.moveThrows) { throw new Error('refused'); }
		},
		// Records what the clipboard held at the moment of the redraw, which is the only thing
		// the toolbar reads.
		renderToolbarState: () => {
			h.calls.push(['toolbar', h.state.clipboard ? h.state.clipboard.mode : null]);
		},
		copyTextToClipboard: async text => {
			h.copied.push(text);
			return !options.systemRefuses;
		},
		openDialog: dialog => { h.dialogs.push(dialog); }
	});
	return h;
}

const item = p => ({path: p, name: p.split('/').pop(), isDirectory: false});

async function rejects (promise) {
	try {
		await promise;
		return null;
	}
	catch (err) {
		return err.message;
	}
}

// --- is there anything to paste -------------------------------------------------------------

{
	const h = harness();
	check('an empty clipboard has nothing', h.clip.hasInternalClipboard(), false);
	h.state.clipboard = {mode: 'copy', paths: []};
	check('nor does one holding no paths', h.clip.hasInternalClipboard(), false);
	h.state.clipboard = {mode: 'copy'};
	let answer;
	try {
		answer = h.clip.hasInternalClipboard();
	}
	catch (err) {
		answer = 'threw ' + err.name;
	}
	check('nor one with no path list at all -- and asking does not throw', answer, false);
	h.state.clipboard = {mode: 'cut', paths: ['/home/a']};
	check('one path is something, and the answer is a boolean', h.clip.hasInternalClipboard(), true);
}

// --- the selection that is actually copied --------------------------------------------------

{
	const h = harness({selected: ['/home/a/b', '/home/a', '/home/c']});
	check('a folder and something inside it: the folder, once',
		h.clip.getEffectiveSelectedPaths(), ['/home/a', '/home/c']);

	h.state.selectedPaths = new Set(['/home/a', '/home/a/b/c/d.txt']);
	check('however deep the inner one is', h.clip.getEffectiveSelectedPaths(), ['/home/a']);

	// The `+ '/'` is the whole rule: `/home/ab` starts with `/home/a` and is not inside it.
	h.state.selectedPaths = new Set(['/home/ab', '/home/a']);
	check('a sibling whose name merely starts the same is its own item',
		h.clip.getEffectiveSelectedPaths(), ['/home/a', '/home/ab']);

	h.state.selectedPaths = new Set(['/home//z/', '/home/y']);
	check('paths are normalised and sorted', h.clip.getEffectiveSelectedPaths(), ['/home/y', '/home/z']);

	h.state.selectedPaths = new Set();
	check('nothing selected is an empty list', h.clip.getEffectiveSelectedPaths(), []);
}

// --- Copy and Cut -----------------------------------------------------------------------------

{
	const h = harness({selected: ['/home/a', '/home/a/inner', '/home/b']});
	h.clip.copySelected();
	check('Copy puts the effective selection on the clipboard',
		h.state.clipboard, {mode: 'copy', paths: ['/home/a', '/home/b']});
	check('and redraws the toolbar once, after it has', h.calls, [['toolbar', 'copy']]);

	h.calls.length = 0;
	h.clip.cutSelected();
	check('Cut replaces it with a cut of the same', h.state.clipboard,
		{mode: 'cut', paths: ['/home/a', '/home/b']});
	check('and redraws with the cut already there', h.calls, [['toolbar', 'cut']]);
}

{
	const earlier = {mode: 'cut', paths: ['/elsewhere/x']};
	const h = harness({clipboard: earlier});
	h.clip.copySelected();
	h.clip.cutSelected();
	// Pressing Ctrl+C on an empty grid is easy, and it must not throw away what you cut a minute ago.
	check('Copy and Cut with nothing selected leave the clipboard as it was', h.state.clipboard, earlier);
	check('and draw nothing', h.calls, []);
}

// --- Paste ------------------------------------------------------------------------------------

{
	const h = harness();
	const failure = await rejects(h.clip.pasteClipboard());
	check('Paste with nothing on the clipboard does nothing at all, and does not throw',
		[failure, h.calls], [null, []]);
}

{
	const h = harness({clipboard: {mode: 'copy', paths: ['/home/a', '/home/b']}});
	await h.clip.pasteClipboard();
	check('a copy is pasted into the folder you are in',
		h.calls, [['copy', ['/home/a', '/home/b'], '/home'], ['toolbar', 'copy']]);
	check('and stays on the clipboard, to paste again', h.clip.hasInternalClipboard(), true);

	h.calls.length = 0;
	await h.clip.pasteClipboard('/home//sub/');
	check('into a named folder, normalised, when a row was the target',
		h.calls[0], ['copy', ['/home/a', '/home/b'], '/home/sub']);
}

{
	const h = harness({clipboard: {mode: 'cut', paths: ['/home/a']}});
	await h.clip.pasteClipboard('/home/sub');
	check('a cut is a move, and says it came from the clipboard',
		h.calls[0], ['move', ['/home/a'], '/home/sub', {source: 'clipboard-cut'}]);
	check('after which it is gone from the clipboard, before the toolbar is drawn',
		h.calls[1], ['toolbar', null]);
	check('so there is nothing left to paste a second time', h.clip.hasInternalClipboard(), false);
}

{
	const h = harness({clipboard: {mode: 'cut', paths: ['/home/a']}, moveThrows: true});
	const failure = await rejects(h.clip.pasteClipboard('/home/sub'));
	check('a refused move is not swallowed -- the action guard reports it', failure, 'refused');
	check('the cut stays on the clipboard, to try again', h.state.clipboard, {mode: 'cut', paths: ['/home/a']});
	check('and the toolbar is still redrawn on the way out', h.calls[h.calls.length - 1], ['toolbar', 'cut']);
}

{
	const h = harness({clipboard: {mode: 'copy', paths: ['/home/a']}, copyThrows: true});
	const failure = await rejects(h.clip.pasteClipboard());
	check('a failed copy is not swallowed either', failure, 'disk full');
	check('and redraws the toolbar too', h.calls[h.calls.length - 1], ['toolbar', 'copy']);
}

{
	// The move asks conflict questions and so takes as long as a person does. Whatever happens to
	// the clipboard in the meantime, the list the move is working through must not change under it.
	const h = harness({
		clipboard: {mode: 'cut', paths: ['/home/a', '/home/b']},
		during: h => {
			if (h.state.clipboard) {
				h.state.clipboard.paths.push('/home/intruder');
			}
		}
	});
	await rejects(h.clip.pasteClipboard('/home/sub'));
	check('a paste works through a snapshot, not the live clipboard list',
		h.handed, ['/home/a', '/home/b']);
}

// --- Copy path, onto the system clipboard ----------------------------------------------------

{
	const h = harness({
		items: [item('/home/a.txt'), item('/home/b.txt')],
		selected: ['/home/a.txt', '/home/b.txt']
	});
	await h.clip.copyPath('/home/only.txt');
	check('a row menu copies that row\'s path', h.copied, ['/home/only.txt']);
	check('and a clipboard that took it needs no dialog', h.dialogs, []);

	h.copied.length = 0;
	await h.clip.copyPath();
	check('with no row, the selected paths, one per line', h.copied, ['/home/a.txt\n/home/b.txt']);
}

{
	const h = harness();
	await h.clip.copyPath();
	check('nothing selected copies nothing and opens nothing', [h.copied, h.dialogs], [[], []]);
}

{
	const h = harness({systemRefuses: true});
	await h.clip.copyPath('/home/a.txt');
	check('a refused clipboard falls back to a dialog holding the text',
		h.dialogs, [{type: 'copyText', title: 'Copy path', text: '/home/a.txt'}]);
}

{
	const h = harness({
		systemRefuses: true,
		items: [item('/home/a.txt'), item('/home/b.txt')],
		selected: ['/home/a.txt', '/home/b.txt']
	});
	await h.clip.copyPath();
	check('titled in the plural when there are several',
		h.dialogs, [{type: 'copyText', title: 'Copy paths', text: '/home/a.txt\n/home/b.txt'}]);
}

process.exit(report('explorer-clipboard') ? 1 : 0);
