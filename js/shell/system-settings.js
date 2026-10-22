// The settings that belong to no other file: `/settings/system.json`. Phase 27; docs/settings-plan.md.
//
// Display, date and time, startup and notifications land here as their passes are built; pass 1 made
// the file's owner and nothing to keep in it yet. What exists already stays where it is: the wallpaper
// and the screensaver in desktop.json, the place in location.json, the network in peers.json.
//
// **location.js's rules, for the same reasons.** The shell holds the one current value, read at boot
// and again whenever the file changes (another tab's write arrives as a change); a change applies at
// once in the tab it was made in, and only the tab that owns the session writes it (js/shell/tabs.js).
// A page that wants a value asks the shell rather than reading the file, which in a tab that does not
// own the session would never show the change just made.
//
// **Every field is read through FIELDS**, which says what it is when it is missing and what a value
// has to be. A file edited by hand, or written by a later PixOS, is read for what can be used: a field
// that is not valid is its default, and a field nobody here knows is kept as it was and written back,
// so an older PixOS in another tab does not erase a newer one's settings.
//
// createSystemSettings(deps) -- deps: readText(path) resolving to the text and rejecting when there is
// none; writeText(path, text); canWrite() (this tab owns the session).

export var SYSTEM_FILE = '/settings/system.json';

// name -> {value: the default, valid(value) -> boolean}. Filled in by the passes that use them.
export var FIELDS = {};

// What a stored document means: every field in FIELDS, valid or its default, and anything else as it was.
export function readSystem (doc, fields) {
	var known = fields || FIELDS;
	var source = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
	var read = {};
	Object.keys(known).forEach(function (name) {
		var field = known[name];
		read[name] = has(source, name) && field.valid(source[name]) ? source[name] : field.value;
	});
	Object.keys(source).forEach(function (name) {
		if (!has(known, name)) {
			read[name] = source[name];
		}
	});
	return read;
}

// Own fields only: `constructor` is not a setting because every object has one.
function has (object, name) {
	return Object.prototype.hasOwnProperty.call(object, name);
}

// The fields of `patch` that may be set: known, and valid. Anything else is refused by name.
export function checkPatch (patch, fields) {
	var known = fields || FIELDS;
	var accepted = {};
	var refused = [];
	Object.keys(patch || {}).forEach(function (name) {
		if (has(known, name) && known[name].valid(patch[name])) {
			accepted[name] = patch[name];
		}
		else {
			refused.push(name);
		}
	});
	return {accepted: accepted, refused: refused};
}

function same (a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}

export function createSystemSettings (deps) {
	var fields = deps.fields || FIELDS;
	var current = readSystem(null, fields);
	var listeners = [];

	function copy () {
		return JSON.parse(JSON.stringify(current));
	}

	function tell (listener) {
		try {
			listener(copy());
		}
		catch (err) {
			console.warn('A system settings listener failed', err);
		}
	}

	function apply (next) {
		if (same(current, next)) {
			return;
		}
		current = next;
		listeners.slice().forEach(tell);
	}

	return {
		get: copy,

		// The file, again: at boot, and when it changes. A missing or broken file is every default.
		load: function () {
			return Promise.resolve().then(function () {
				return deps.readText(SYSTEM_FILE);
			}).then(function (text) {
				var doc = null;
				try {
					doc = JSON.parse(text);
				}
				catch (err) {
					doc = null;
				}
				apply(readSystem(doc, fields));
				return copy();
			}, function () {
				apply(readSystem(null, fields));
				return copy();
			});
		},

		// Applies at once, here, and writes the file if this tab owns the session. Rejects, setting
		// nothing, when any field is unknown or not valid.
		set: function (patch) {
			var checked = checkPatch(patch, fields);
			if (checked.refused.length) {
				return Promise.reject(new Error('Not a system setting: ' + checked.refused.join(', ')));
			}
			apply(Object.assign(copy(), checked.accepted));
			if (!deps.canWrite()) {
				return Promise.resolve(copy());
			}
			return Promise.resolve(deps.writeText(SYSTEM_FILE, JSON.stringify(current, null, 2) + '\n')).then(copy);
		},

		// Calls `listener` with the settings now and whenever they change; returns the unsubscribe.
		subscribe: function (listener) {
			listeners.push(listener);
			tell(listener);
			return function () {
				var index = listeners.indexOf(listener);
				if (index > -1) {
					listeners.splice(index, 1);
				}
			};
		}
	};
}
