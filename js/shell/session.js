// Session persistence: desktops, their names, their layouts, and the windows on them.
//
// What is saved is the *launch descriptor* of each window plus GoldenLayout's own config
// for each desktop. Restoring reopens the windows with the same ids, then rebuilds the
// layouts around them, so the arrangement comes back rather than just the list.
//
// What is NOT saved is anything inside an app: an unsaved buffer in ace, a dirty
// workbook in luckySheet, a scroll position. Restore reopens the file, not the edit.

var BOOT_FLAG = 'pixos-session-booting';
var SAVE_DELAY = 800;

var wm = null;
var options = {};
var saveTimer = null;
var saving = false;
var enabled = false;

export function init (cfg) {
	wm = cfg.wm;
	options = cfg;
}

// True when the previous boot set the flag and never cleared it -- meaning the shell did
// not survive long enough to be usable. Restoring the same session again would loop, so
// this boot starts clean.
function previousBootFailed () {
	try {
		return !!window.localStorage.getItem(BOOT_FLAG);
	}
	catch (err) {
		// Private mode, or storage disabled: no guard, but no crash either.
		return false;
	}
}

function markBooting (on) {
	try {
		if (on) {
			window.localStorage.setItem(BOOT_FLAG, String(Date.now()));
		}
		else {
			window.localStorage.removeItem(BOOT_FLAG);
		}
	}
	catch (err) {
		// Nothing to do: the guard is a convenience, not a requirement.
	}
}

// Returns {restored, reason}. `restored` is how many windows came back.
export async function restore () {
	if (options.clean) {
		markBooting(false);
		await clear();
		return {restored: 0, reason: 'clean start requested'};
	}
	if (previousBootFailed()) {
		markBooting(false);
		// Set aside rather than deleted: a session that took the shell down once is not
		// something to reload automatically, but it is also not ours to destroy.
		var failed = await options.read();
		if (failed && options.writeAside) {
			await options.writeAside(failed);
		}
		await clear();
		return {restored: 0, reason: 'the previous session did not finish loading; it has been set aside as /settings/session-failed.json'};
	}

	var saved = await options.read();
	if (!saved || !Array.isArray(saved.workspaces) || !saved.workspaces.length) {
		return {restored: 0, reason: 'nothing saved'};
	}

	markBooting(true);

	var restored = 0;
	var created = {};

	// The first desktop already exists, so the first saved one adopts it instead of
	// leaving an empty stray behind.
	var existing = wm.listWorkspaces();
	saved.workspaces.forEach(function (workspace, index) {
		if (index === 0 && existing.length === 1) {
			wm.renameWorkspace(existing[0].id, workspace.name);
			created[workspace.id] = existing[0].id;
			return;
		}
		created[workspace.id] = wm.createWorkspace({name: workspace.name}).id;
	});

	for (var i = 0; i < saved.workspaces.length; i++) {
		var workspace = saved.workspaces[i];
		var windows = Array.isArray(workspace.windows) ? workspace.windows : [];
		for (var j = 0; j < windows.length; j++) {
			var win = windows[j];
			if (!win || !win.launch) {
				continue;
			}
			try {
				// Detached: the placeholder arrives with the layout, a step below.
				await options.launch(win.launch, {
					id: win.id,
					workspace: created[workspace.id],
					detached: true,
					title: win.title
				});
				restored++;
			}
			catch (err) {
				// One window that cannot come back must not cost you the rest of them.
				console.error('Could not restore ' + (win.path || win.appId || 'a window'), err);
			}
		}
	}

	saved.workspaces.forEach(function (workspace) {
		if (workspace.layout) {
			wm.applySavedLayout(created[workspace.id], workspace.layout);
		}
	});

	// Binds anything the layouts did not claim and lifts the detached flag, so the
	// geometry sweep starts policing these windows like any others.
	wm.finishRestore();

	if (saved.activeWorkspace && created[saved.activeWorkspace]) {
		wm.switchTo(created[saved.activeWorkspace]);
	}

	// Cleared the moment restore returns, with no grace period. An earlier version held
	// the flag for five seconds so that a window taking the page down just afterwards
	// would still count as a failed boot -- but that makes any reload within five
	// seconds look like a crash, which is a completely ordinary thing to do and cost
	// people their session.
	//
	// What survives is the guard that matters: if restore never returns at all -- a hang,
	// a hard crash inside it -- the flag is still set on the next boot and that boot
	// starts clean. A page that dies *after* a successful restore will now be retried,
	// and `?clean=1` or the palette's "Start clean session" is the way out of that.
	markBooting(false);

	return {restored: restored, reason: null};
}

// Autosaving starts only after a restore has finished, or the empty state mid-restore
// would be written over the session being restored.
export function start () {
	enabled = true;
	wm.on('changed', schedule);
	wm.on('workspaces-changed', schedule);
	// Splitter drags and tab rearrangement, which change no window record at all.
	wm.on('layout-changed', schedule);
	schedule();
}

export function stop () {
	enabled = false;
	clearTimeout(saveTimer);
}

function schedule () {
	if (!enabled) {
		return;
	}
	clearTimeout(saveTimer);
	saveTimer = setTimeout(save, SAVE_DELAY);
}

export async function save () {
	if (!enabled || saving) {
		return;
	}
	// A second tab of PixOS shares this file, and last writer wins. Only the tab that owns
	// the session writes it -- see js/shell/tabs.js. Skipped rather than queued: what the
	// follower would write is a different desktop, not a later version of this one.
	if (options.canWrite && !options.canWrite()) {
		return;
	}
	saving = true;
	try {
		await options.write(wm.serialize());
	}
	catch (err) {
		console.error('Could not save the session', err);
	}
	finally {
		saving = false;
	}
}

export async function clear () {
	var wasEnabled = enabled;
	enabled = false;
	clearTimeout(saveTimer);
	try {
		await options.write({version: 1, activeWorkspace: null, workspaces: []});
	}
	catch (err) {
		console.error('Could not clear the session', err);
	}
	enabled = wasEnabled;
}
