// New, Rename, Delete, Download and SHA1: apps/explorer/js/item-actions.js.
//
// Almost every one of these opens a dialog and does its work in `onSubmit`, so most of what is
// asserted here is order — the dialog is closed and drawn away *before* anything that might open
// another one (a conflict question), the write happens only after the answer, and the listing is
// refreshed only after the write. And what an ordinary refusal looks like:
//
//   * a name that is taken is asked about **before** the write, with the folder's *Replace* greyed;
//   * renaming to the same name closes, the way Cancel would;
//   * a 404 or a refused fetch is reported, and the dialog does not just close on nothing;
//   * a delete that is refused leaves the selection alone, and an error from any of them reaches
//     the guard unchanged rather than being turned into a dialog by hand.
//
// The platform is a fake window, and its `fetch` refuses to be called detached from it — which is
// what a browser does and node does not.

import {webcrypto} from 'crypto';
import {check, report} from './assert.mjs';
import {createItemActions} from '../apps/explorer/js/item-actions.js';

const pathStub = {
	dirname: p => {
		const i = String(p).lastIndexOf('/');
		return i <= 0 ? '/' : String(p).slice(0, i);
	}
};

function harness (options) {
	options = options || {};
	const h = {
		state: {
			cwd: options.cwd || '/home',
			selectedPaths: new Set(options.selected || []),
			// Something open, so a test can see the action close it.
			dialog: {type: 'whatever opened this'}
		},
		items: options.items || [],
		dialogs: [],
		infos: [],
		calls: [],
		downloads: [],
		fetchFailures: []
	};
	const refuse = (list, p) => list && list.includes(p);

	const win = {
		File: class {
			constructor (parts, name) { this.parts = parts; this.name = name; }
			// String() on each part, as the real one does: `new File([undefined])` holds "undefined".
			async arrayBuffer () { return new TextEncoder().encode(this.parts.map(String).join('')).buffer; }
		},
		Blob: class {
			constructor (parts) { this.parts = parts; }
		},
		fetch: function (url) {
			if (this !== win) {
				throw new TypeError('Illegal invocation');
			}
			h.calls.push(['fetch', url]);
			if (options.fetch) {
				return options.fetch(url);
			}
			return Promise.resolve({
				ok: true,
				status: 200,
				arrayBuffer: async () => new TextEncoder().encode('REMOTE BYTES').buffer
			});
		},
		crypto: webcrypto
	};

	h.actions = createItemActions({
		state: h.state,
		path: pathStub,
		Buffer: Buffer,
		win: win,
		getItemByPath: p => h.items.find(i => i.path === p) || null,
		getSelectedItems: () => h.items.filter(i => h.state.selectedPaths.has(i.path)),
		getNameByPath: p => String(p).split('/').pop(),
		openDialog: dialog => { h.dialogs.push(dialog); },
		openInfoDialog: (title, message) => { h.infos.push([title, message]); },
		renderOverlays: () => { h.calls.push(['overlays', h.state.dialog]); },
		resolveIncomingDestination: async (name, folder, verb, isDirectory) => {
			h.calls.push(['ask', name, folder, verb, isDirectory]);
			const answer = options.answer || 'free';
			if (answer === 'cancel') { return null; }
			const base = folder === '/' ? '' : folder;
			if (answer === 'keep') { return {destPath: base + '/' + name.replace(/(\.[^.]*)?$/, '-1$1'), replaceExisting: false}; }
			return {destPath: base + '/' + name, replaceExisting: answer === 'replace'};
		},
		writeNewFile: async (folder, name, buffer) => {
			h.calls.push(['write', folder, name, Buffer.isBuffer(buffer) ? buffer.toString() : '<not a Buffer>']);
			if (options.writeThrows) { throw new Error('quota'); }
		},
		mkdir: async p => { h.calls.push(['mkdir', p]); },
		unlink: async p => {
			h.calls.push(['unlink', p]);
			if (refuse(options.unlinkRefuses, p)) { throw new Error('EPERM: ' + p); }
		},
		fsRename: async (from, to) => {
			h.calls.push(['rename', from, to]);
			if (options.renameThrows) { throw options.renameThrows; }
		},
		readFile: async p => Buffer.from(options.contents && p in options.contents ? options.contents[p] : 'BYTES:' + p),
		downloadBlob: (blob, name) => { h.downloads.push([name, String(blob.parts[0])]); },
		reportFetchFailure: (url, outcome) => {
			h.fetchFailures.push([url, outcome.error ? 'error: ' + outcome.error.message : 'status ' + outcome.response.status]);
		},
		refreshCurrentDir: async keepSelection => { h.calls.push(['refresh', keepSelection]); }
	});
	return h;
}

const file = p => ({path: p, name: p.split('/').pop(), isDirectory: false});
const folder = p => ({path: p, name: p.split('/').pop(), isDirectory: true});
const kinds = h => h.calls.map(c => c[0]);
const submit = (h, value) => h.dialogs[h.dialogs.length - 1].onSubmit(value);

async function rejects (promise) {
	try {
		await promise;
		return null;
	}
	catch (err) {
		return err;
	}
}

// --- New File ------------------------------------------------------------------------------------

{
	const h = harness();
	h.actions.createFile();
	check('New File opens its dialog and writes nothing yet',
		[h.dialogs.map(d => d.type), h.calls], [['newFile'], []]);

	await submit(h, {name: 'notes.txt', content: 'hello'});
	check('on submit: the dialog is closed and drawn away, the file written into the folder you are in, then the listing',
		h.calls, [['overlays', null], ['write', '/home', 'notes.txt', 'hello'], ['refresh', false]]);
}

{
	const h = harness();
	h.actions.createFile();
	await submit(h, {name: 'empty.txt'});
	check('with no content it is an empty file, not one saying "undefined"',
		h.calls[1], ['write', '/home', 'empty.txt', '']);
}

{
	const h = harness({writeThrows: true});
	h.actions.createFile();
	const err = await rejects(submit(h, {name: 'big.bin', content: 'x'}));
	check('a refused write reaches the guard', err && err.message, 'quota');
	check('and nothing is refreshed after it', kinds(h).includes('refresh'), false);
}

// --- New Folder ---------------------------------------------------------------------------------

{
	const h = harness();
	h.actions.createFolder();
	check('New Folder opens its dialog', h.dialogs.map(d => d.type), ['newFolder']);
	await submit(h, 'photos');
	// The dialog has to be gone before the question, or the conflict dialog would have to be drawn
	// over one that is still open -- there is exactly one `state.dialog`.
	check('its dialog closes, the name is asked about as a folder, then it is made, then the listing',
		h.calls, [['overlays', null], ['ask', 'photos', '/home', 'create folder', true],
			['mkdir', '/home/photos'], ['refresh', false]]);
}

{
	const h = harness({answer: 'keep'});
	h.actions.createFolder();
	await submit(h, 'photos');
	check('Keep both makes the folder under the name the question chose, not the one typed',
		h.calls.find(c => c[0] === 'mkdir'), ['mkdir', '/home/photos-1']);
}

{
	const h = harness({answer: 'cancel'});
	h.actions.createFolder();
	const err = await rejects(submit(h, 'photos'));
	check('Cancel on the question makes nothing, refreshes nothing and throws nothing',
		[err, kinds(h)], [null, ['overlays', 'ask']]);
}

// --- Add Online File ------------------------------------------------------------------------------

{
	const h = harness();
	h.actions.addOnlineFile();
	check('Add Online File opens its dialog', h.dialogs.map(d => d.type), ['onlineFile']);
	await submit(h, {url: 'https://files.example/data.csv', name: 'mine.csv'});
	check('fetches -- on the window, which is the only way a browser allows it -- and writes what came back',
		h.calls, [['overlays', null], ['fetch', 'https://files.example/data.csv'],
			['write', '/home', 'mine.csv', 'REMOTE BYTES'], ['refresh', false]]);
	check('reporting nothing', h.fetchFailures, []);
}

{
	const h = harness();
	h.actions.addOnlineFile();
	await submit(h, {url: 'https://files.example/docs/my%20report.pdf'});
	check('with no name given, the decoded last segment of the URL',
		h.calls.find(c => c[0] === 'write'), ['write', '/home', 'my report.pdf', 'REMOTE BYTES']);
}

{
	const h = harness({fetch: () => Promise.reject(new TypeError('Failed to fetch'))});
	h.actions.addOnlineFile();
	const err = await rejects(submit(h, {url: 'https://blocked.example/x'}));
	check('a refused fetch -- CORS, no network -- is reported with the error', h.fetchFailures,
		[['https://blocked.example/x', 'error: Failed to fetch']]);
	check('handled here, so it does not also reach the guard as a second report', err, null);
	check('and nothing is written or refreshed', kinds(h), ['overlays', 'fetch']);
}

{
	const h = harness({fetch: async () => ({ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0)})});
	h.actions.addOnlineFile();
	await submit(h, {url: 'https://files.example/gone'});
	check('a 404 is reported with the response, not written as an empty file',
		[h.fetchFailures, kinds(h)], [[['https://files.example/gone', 'status 404']], ['overlays', 'fetch']]);
}

// --- Rename ------------------------------------------------------------------------------------------

{
	const h = harness({items: [file('/home/a.txt')]});
	h.actions.rename('/home/missing.txt');
	check('renaming something that is not in the listing opens nothing', h.dialogs, []);

	h.state.selectedPaths = new Set(['/home/a.txt']);
	h.actions.rename();
	check('with no row, the selected item, and the dialog knows its old name',
		h.dialogs.map(d => [d.type, d.oldName]), [['rename', 'a.txt']]);
}

{
	const h = harness({items: [file('/home/a.txt')]});
	h.actions.rename('/home/a.txt');
	await submit(h, 'a.txt');
	check('the same name closes the dialog, as Cancel would, and asks and renames nothing',
		h.calls, [['overlays', null]]);

	h.calls.length = 0;
	h.state.dialog = {type: 'rename'};
	await submit(h, '');
	check('so does an empty one', h.calls, [['overlays', null]]);
}

{
	const h = harness({cwd: '/home', items: [file('/home/sub/a.txt')]});
	h.actions.rename('/home/sub/a.txt');
	await submit(h, 'b.txt');
	check('a new name is asked about in the item\'s own folder, not the one being looked at, then renamed',
		h.calls, [['overlays', null], ['ask', 'b.txt', '/home/sub', 'rename', false],
			['rename', '/home/sub/a.txt', '/home/sub/b.txt'], ['refresh', false]]);
}

{
	const h = harness({items: [folder('/home/pics')]});
	h.actions.rename('/home/pics');
	await submit(h, 'photos');
	check('a folder is asked about as a folder, which greys Replace out',
		h.calls.find(c => c[0] === 'ask'), ['ask', 'photos', '/home', 'rename', true]);
}

{
	const h = harness({answer: 'replace', items: [file('/home/a.txt')]});
	h.actions.rename('/home/a.txt');
	await submit(h, 'b.txt');
	check('Replace removes what is there first, then renames onto the name',
		kinds(h), ['overlays', 'ask', 'unlink', 'rename', 'refresh']);
	check('the file removed is the one being replaced, not the one being renamed',
		h.calls[2], ['unlink', '/home/b.txt']);
}

{
	const h = harness({answer: 'cancel', items: [file('/home/a.txt')]});
	h.actions.rename('/home/a.txt');
	const err = await rejects(submit(h, 'b.txt'));
	check('Cancel on the question renames nothing, removes nothing and throws nothing',
		[err, kinds(h)], [null, ['overlays', 'ask']]);
}

{
	const refusal = Object.assign(new Error('ENOENT'), {code: 'ENOENT'});
	const h = harness({renameThrows: refusal, items: [file('/home/a.txt')]});
	h.actions.rename('/home/a.txt');
	const err = await rejects(submit(h, 'b.txt'));
	check('a refused rename reaches the guard as the same error, errno and all', err, refusal);
	check('with no refresh after it and no dialog built by hand',
		[kinds(h).includes('refresh'), h.dialogs.length, h.infos], [false, 1, []]);
}

// --- Delete --------------------------------------------------------------------------------------------

{
	const h = harness({items: [file('/home/a.txt')]});
	h.actions.deleteSelected();
	check('Delete with nothing selected asks nothing', h.dialogs, []);
}

{
	const h = harness({
		items: [file('/home/a.txt'), folder('/home/old'), file('/home/keep.txt')],
		selected: ['/home/a.txt', '/home/old']
	});
	h.actions.deleteSelected();
	check('asks, naming the items', h.dialogs.map(d => [d.type, d.items.map(i => i.path)]),
		[['confirmDelete', ['/home/a.txt', '/home/old']]]);

	// What was confirmed is what goes: the question names two items, and a click on another row
	// behind it must not change which two.
	h.state.selectedPaths = new Set(['/home/keep.txt']);
	await submit(h);
	check('and deletes what the question named, even if the selection moved since',
		h.calls, [['overlays', null], ['unlink', '/home/a.txt'], ['unlink', '/home/old'], ['refresh', false]]);
	check('clearing the selection', h.state.selectedPaths.size, 0);
}

{
	const h = harness({
		items: [file('/home/a.txt'), file('/home/locked.txt')],
		selected: ['/home/a.txt', '/home/locked.txt'],
		unlinkRefuses: ['/home/locked.txt']
	});
	h.actions.deleteSelected();
	const err = await rejects(submit(h));
	check('a refused delete reaches the guard', err && err.message, 'EPERM: /home/locked.txt');
	check('the selection is left as it was, and nothing is refreshed',
		[h.state.selectedPaths.size, kinds(h).includes('refresh')], [2, false]);
}

// --- Download --------------------------------------------------------------------------------------

{
	const h = harness({
		items: [file('/home/a.txt'), folder('/home/dir'), file('/home/b.txt')],
		selected: ['/home/a.txt', '/home/dir', '/home/b.txt'],
		contents: {'/home/a.txt': 'alpha', '/home/b.txt': 'beta'}
	});
	await h.actions.downloadSelected();
	check('each selected file is downloaded under its own name with its own bytes, folders skipped',
		h.downloads, [['a.txt', 'alpha'], ['b.txt', 'beta']]);
}

{
	const h = harness({items: [folder('/home/dir')], selected: ['/home/dir']});
	await h.actions.downloadSelected();
	check('only folders selected downloads nothing', h.downloads, []);
}

// --- SHA1 -----------------------------------------------------------------------------------------------

{
	const h = harness({items: [folder('/home/dir')], selected: ['/home/dir']});
	await h.actions.getHashSHA1();
	check('no files selected shows nothing', h.infos, []);
}

{
	// "abc" hashes to a value with a byte under 0x10 in it (…3647 06 81…), which is the only way to
	// see that each byte is padded to two digits rather than written as one.
	const h = harness({
		items: [file('/home/abc.txt'), folder('/home/dir'), file('/home/empty')],
		selected: ['/home/abc.txt', '/home/dir', '/home/empty'],
		contents: {'/home/abc.txt': 'abc', '/home/empty': ''}
	});
	await h.actions.getHashSHA1();
	check('one line per file, name then hex, folders skipped', h.infos, [['SHA1',
		'abc.txt: a9993e364706816aba3e25717850c26c9cd0d89d\n'
		+ 'empty: da39a3ee5e6b4b0d3255bfef95601890afd80709']]);
}

process.exit(report('explorer-item-actions') ? 1 : 0);
