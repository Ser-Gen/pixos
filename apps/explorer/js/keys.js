// Every key Explorer answers to, written once (phase 25).
//
// Three things read this: the keydown handler in index.html, which answers to these chords; the
// shell's shortcuts sheet (Ctrl/Cmd+/), which lists `SHORTCUTS` for the window in front because
// index.html hands it over as `window.pixosShortcuts`; and the menus and tooltips, which print a
// chord beside the command it runs. **tests/explorer-keys.test.mjs presses every chord listed here
// against the handler**, so a key added to the list and not to the handler, or taken out of the
// handler and left on the list, fails there rather than on somebody's keyboard.
//
// Chords are the shell's spelling (js/shell/shortcuts.js): `Mod` is Cmd or Ctrl. The shell writes
// them for the machine, so this module never does.

// `mac` is the chord printed beside a command on a Mac, where it differs. A Mac laptop has no
// forward-delete key -- its *delete* is Backspace -- so Delete alone would be a key it cannot press,
// and Cmd+Backspace is what Finder uses.
export var KEYS = {
	open: {keys: ['Enter']},
	delete: {keys: ['Delete', 'Mod+Backspace'], mac: 'Mod+Backspace'},
	selectAll: {keys: ['Mod+A']},
	copy: {keys: ['Mod+C']},
	cut: {keys: ['Mod+X']},
	paste: {keys: ['Mod+V']},
	close: {keys: ['Escape']}
};

// What the sheet lists under Explorer. The last two are the pointer, which is not a key, but is the
// one way to build a selection that the keys above act on, and nothing on screen says so.
export var SHORTCUTS = [
	{keys: KEYS.open.keys, label: 'Open the selected item'},
	{keys: KEYS.delete.keys, label: 'Delete the selection'},
	{keys: KEYS.selectAll.keys, label: 'Select everything in this folder'},
	{keys: KEYS.copy.keys, label: 'Copy the selection'},
	{keys: KEYS.cut.keys, label: 'Cut the selection'},
	{keys: KEYS.paste.keys, label: 'Paste into this folder'},
	{keys: KEYS.close.keys, label: 'Close a menu or a dialog'},
	{keys: ['Shift+Click'], label: 'Select from the last item clicked to this one'},
	{keys: ['Mod+Click'], label: 'Add an item to the selection, or take it out'}
];

// The chord to print beside the command `name` -- the Mac one on a Mac -- or null for a name this
// module does not know.
export function chordFor (name, mac) {
	var entry = KEYS[name];
	if (!entry) {
		return null;
	}
	return (mac && entry.mac) || entry.keys[0];
}
