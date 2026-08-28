// Session restore, with the WM stubbed down to the calls session.js actually makes.
//
// Most of these exist because something went wrong here: windows reaped mid-restore, a
// boot guard that fired on an ordinary reload, a failed session being deleted outright.

import {check, report} from './assert.mjs';

const store = {};
globalThis.window = {
	localStorage: {
		getItem: key => (key in store ? store[key] : null),
		setItem: (key, value) => { store[key] = String(value); },
		removeItem: key => { delete store[key]; }
	}
};

const session = await import('../js/shell/session.js');

function makeWm () {
	let counter = 0;
	const wm = {
		workspaces: [{id: 'w1', name: 'Desktop 1', active: true, windowCount: 0}],
		opened: [],
		layouts: [],
		finished: 0,
		switched: null,
		handlers: {},
		listWorkspaces: () => wm.workspaces,
		createWorkspace ({name}) {
			const created = {id: 'new' + (++counter), name, active: false, windowCount: 0};
			wm.workspaces.push(created);
			return created;
		},
		renameWorkspace (id, name) {
			wm.workspaces.find(w => w.id === id).name = name;
			return true;
		},
		applySavedLayout (id, layout) { wm.layouts.push([id, layout]); return true; },
		finishRestore () { wm.finished++; },
		switchTo (id) { wm.switched = id; return true; },
		serialize: () => ({version: 1, activeWorkspace: 'w1', workspaces: wm.workspaces}),
		on (event, fn) { (wm.handlers[event] = wm.handlers[event] || []).push(fn); }
	};
	return wm;
}

const SAVED = {
	version: 1,
	activeWorkspace: 'b',
	workspaces: [
		{id: 'a', name: 'Work', layout: {content: []}, windows: [
			{id: 0, title: 'a.txt', appId: 'ace', path: '/a.txt', launch: {appId: 'ace', paths: ['/a.txt']}},
			{id: 1, title: 'b.txt', appId: 'ace', path: '/b.txt', launch: {appId: 'ace', paths: ['/b.txt']}}
		]},
		{id: 'b', name: 'Media', layout: {content: []}, windows: [
			{id: 2, title: 'v.mkv', appId: 'media-player', path: '/v.mkv', launch: {appId: 'media-player', paths: ['/v.mkv']}}
		]}
	]
};

function setup (saved, extra) {
	const wm = makeWm();
	const written = [];
	session.init(Object.assign({
		wm,
		read: async () => saved,
		write: async data => { written.push(data); },
		writeAside: async data => { written.push({asideOf: data}); },
		launch: async (descriptor, restore) => { wm.opened.push({descriptor, restore}); }
	}, extra));
	return {wm, written};
}

// --- a normal restore ---
let {wm, written} = setup(JSON.parse(JSON.stringify(SAVED)));
let result = await session.restore();

check('every saved window is reopened', result.restored, 3);
check('the first desktop is adopted, not duplicated', wm.workspaces.length, 2);
check('desktop names come back in order', wm.workspaces.map(w => w.name), ['Work', 'Media']);
check('windows carry their saved ids', wm.opened.map(o => o.restore.id), [0, 1, 2]);
// Without this the placeholder would be added twice: once here, once by the layout.
check('and are opened detached', wm.opened.every(o => o.restore.detached), true);
check('each goes to the desktop it was on', wm.opened.map(o => o.restore.workspace), ['w1', 'w1', 'new1']);
check('the descriptor is what gets replayed', wm.opened[0].descriptor, {appId: 'ace', paths: ['/a.txt']});
check('layouts are applied once per desktop', wm.layouts.length, 2);
check('and only after the windows exist', wm.finished, 1);
check('the desktop you were on is the one you land on', wm.switched, 'new1');

// The flag exists for a restore that never returns. It must NOT outlive one that does,
// or an ordinary reload a second later looks like a crash and costs you the session.
check('a completed restore leaves no boot flag behind', store['pixos-session-booting'], undefined);

// --- one bad window must not cost the rest ---
({wm, written} = setup(JSON.parse(JSON.stringify(SAVED)), {
	launch: async (descriptor, restore) => {
		if (restore.id === 1) {
			throw new Error('app is gone');
		}
		wm.opened.push({descriptor, restore});
	}
}));
result = await session.restore();
check('a window that cannot be reopened is skipped', result.restored, 2);
check('and the others still come back', wm.opened.map(o => o.restore.id), [0, 2]);

// --- the boot guard ---
({wm, written} = setup(JSON.parse(JSON.stringify(SAVED))));
store['pixos-session-booting'] = String(Date.now());
result = await session.restore();
check('a boot flag from last time skips the restore', result.restored, 0);
check('and says why', /did not finish loading/.test(result.reason), true);
check('the flag is cleared so the next boot tries again', store['pixos-session-booting'], undefined);
// Deleting it outright would destroy work nobody asked to lose.
check('the unrestorable session is set aside, not deleted', written.some(w => w.asideOf), true);

// --- explicit clean start ---
({wm, written} = setup(JSON.parse(JSON.stringify(SAVED)), {clean: true}));
result = await session.restore();
check('a clean start restores nothing', result.restored, 0);
check('and empties the saved session', written[written.length - 1].workspaces, []);
check('without ever opening a window', wm.opened.length, 0);

// --- nothing saved yet ---
({wm} = setup(null));
result = await session.restore();
check('a first ever boot is not an error', result, {restored: 0, reason: 'nothing saved'});

({wm} = setup({version: 1, workspaces: []}));
result = await session.restore();
check('an emptied session is treated the same', result.restored, 0);

process.exit(report('session') ? 1 : 0);
