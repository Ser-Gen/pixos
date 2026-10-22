// Where this machine is, for anything that draws the sky: `/settings/location.json`,
// `{"latitude": 56.9496, "longitude": 24.1052}`. Phase 26, the Sky pass; docs/screensavers-plan.md.
//
// **One place for all of PixOS**, the user's choice over keeping it in each screensaver's address,
// the way the slideshow keeps its folder: set once, in Settings, and both the background
// and the screensaver -- and anything later that wants sunrise times -- see the same one. **Riga until
// it is set.**
//
// **A page asks the shell, not the file** (`parent.watchLocation(window, handler)`, in index.html).
// A tab that does not own the session applies a change without writing it (js/shell/tabs.js), so a
// page reading the file there would never see the change it was just shown being made. The shell
// holds the one current value, reads the file at boot and again when it changes (another tab's
// write arrives as a change too), and tells every subscriber.
//
// *Use my location* asks the browser once, in the click that asks for it, and keeps two decimals --
// about a kilometre, more than the sky needs, and less than a house.
//
// **Follow me** (phase 27, the Settings window's Location page) finds it again at every boot, and
// only when the browser's permission is already *granted*: a boot never shows a prompt. It is
// turned on in a click, which finds the place once there and then -- that is when the browser may
// ask -- and is kept in the same file, as `"follow": true`, written only while it is on. Typing a
// place turns it off: the next boot would otherwise put back the place that was just typed over.
//
// createLocation(deps) -- deps: readText(path) resolving to the file's text and rejecting when there
// is none; writeText(path, text); canWrite() (this tab owns the session); geolocation (the browser's,
// or null); permissions (navigator.permissions, or null); timeout (ms, for finding it).

export var LOCATION_FILE = '/settings/location.json';

// Riga. js/sky.js in the Sky screensaver has the same default; tests/sky.test.mjs ties the two.
export var DEFAULT_LOCATION = {latitude: 56.9496, longitude: 24.1052};

// Four decimals is eleven metres: what a typed coordinate keeps.
var TYPED_PLACES = 4;
// Two decimals is about a kilometre: what a found one keeps.
var FOUND_PLACES = 2;
var TIMEOUT = 15000;

export function roundTo (value, places) {
	var factor = Math.pow(10, places);
	return Math.round(value * factor) / factor;
}

// A location as stored, or null when it is not one.
export function readLocation (doc) {
	if (!doc || typeof doc !== 'object') {
		return null;
	}
	var latitude = doc.latitude;
	var longitude = doc.longitude;
	if (typeof latitude !== 'number' || typeof longitude !== 'number' || !isFinite(latitude) || !isFinite(longitude)
		|| Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
		return null;
	}
	return {latitude: latitude, longitude: longitude};
}

// A coordinate as typed: "56.9496", "56,9496" (a decimal comma), "-24.1". Null when it is not a
// number or is further than `limit` from zero -- 90 for a latitude, 180 for a longitude.
export function parseCoordinate (text, limit) {
	var trimmed = String(text === undefined || text === null ? '' : text).trim().replace(',', '.');
	if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) {
		return null;
	}
	var value = Number(trimmed);
	return isFinite(value) && Math.abs(value) <= limit ? value : null;
}

// Whether a stored location follows the browser. Only `true` is: an old file has no such field.
export function readFollow (doc) {
	return !!doc && typeof doc === 'object' && doc.follow === true;
}

// What the file holds for a location, following or not. `follow` is left out while it is off, so
// a file nobody turned it on for is what it always was.
export function locationDoc (location, follow) {
	var doc = {latitude: location.latitude, longitude: location.longitude};
	if (follow) {
		doc.follow = true;
	}
	return doc;
}

export function sameLocation (a, b) {
	return !!a && !!b && a.latitude === b.latitude && a.longitude === b.longitude;
}

// What a geolocation error means to someone who pressed the button.
export function describeGeolocationError (error) {
	var code = error && error.code;
	if (code === 1) {
		return 'The browser was not allowed to say where this is. Type the coordinates instead, '
			+ 'or allow location for this site in the browser\'s settings.';
	}
	if (code === 3) {
		return 'Finding the location took too long. Try again, or type the coordinates.';
	}
	return 'The browser could not work out where this is. Type the coordinates instead.';
}

export function createLocation (deps) {
	var current = {latitude: DEFAULT_LOCATION.latitude, longitude: DEFAULT_LOCATION.longitude};
	var saved = false;
	var following = false;
	var listeners = [];

	function copy () {
		return {latitude: current.latitude, longitude: current.longitude};
	}

	// A listener that throws is its own problem, not the next listener's -- nor the caller's, when it
	// is a page's handler being called for the first time from inside watchLocation.
	function tell (listener) {
		try {
			listener(copy());
		}
		catch (err) {
			console.warn('A location listener failed', err);
		}
	}

	function notify () {
		listeners.slice().forEach(tell);
	}

	function apply (next, isSaved) {
		saved = isSaved;
		if (sameLocation(current, next)) {
			return;
		}
		current = {latitude: next.latitude, longitude: next.longitude};
		notify();
	}

	return {
		get: copy,

		// Whether a location has been set, rather than Riga standing in.
		isSet: function () {
			return saved;
		},

		// The file, again: at boot, and when it changes. A missing or broken file is Riga.
		load: function () {
			return Promise.resolve().then(function () {
				return deps.readText(LOCATION_FILE);
			}).then(function (text) {
				var doc = null;
				try {
					doc = JSON.parse(text);
				}
				catch (err) {
					doc = null;
				}
				var read = readLocation(doc);
				following = !!read && readFollow(doc);
				apply(read || DEFAULT_LOCATION, !!read);
				return copy();
			}, function () {
				following = false;
				apply(DEFAULT_LOCATION, false);
				return copy();
			});
		},

		// Applies at once, here, and writes the file if this tab owns the session. `options.follow`
		// turns following on or off with it; left out, it stays as it is.
		set: function (location, options) {
			var read = readLocation(location);
			if (!read) {
				return Promise.reject(new Error('Not a location: ' + JSON.stringify(location)));
			}
			var rounded = {latitude: roundTo(read.latitude, TYPED_PLACES), longitude: roundTo(read.longitude, TYPED_PLACES)};
			if (options && typeof options.follow === 'boolean') {
				following = options.follow;
			}
			apply(rounded, true);
			if (!deps.canWrite()) {
				return Promise.resolve(copy());
			}
			return Promise.resolve(deps.writeText(LOCATION_FILE, JSON.stringify(locationDoc(rounded, following), null, 2) + '\n')).then(copy);
		},

		isFollowing: function () {
			return following;
		},

		// Turns following on -- finding the place now, in the click, so the browser may ask -- or off.
		// Resolves to the location. Turning it on rejects as locate does, and then nothing changes.
		follow: function (on) {
			var self = this;
			if (on) {
				return self.locate().then(function (where) {
					return self.set(where, {follow: true});
				});
			}
			if (!following) {
				return Promise.resolve(copy());
			}
			return self.set(copy(), {follow: false});
		},

		// What the browser says about being asked where this is: 'granted', 'prompt', 'denied', or
		// 'unsupported' when it will not say.
		permission: function () {
			var permissions = deps.permissions;
			if (!deps.geolocation || !permissions || typeof permissions.query !== 'function') {
				return Promise.resolve('unsupported');
			}
			return Promise.resolve().then(function () {
				return permissions.query({name: 'geolocation'});
			}).then(function (status) {
				return status && status.state ? status.state : 'unsupported';
			}, function () {
				return 'unsupported';
			});
		},

		// At boot: found again if following, and only if the browser would answer without asking.
		// Resolves to {found} or {skipped: why} -- 'off', the permission's state, or 'failed' -- and
		// never rejects: a boot has nobody to tell. Turned off while it was finding, it sets nothing.
		refind: function () {
			var self = this;
			if (!following) {
				return Promise.resolve({skipped: 'off'});
			}
			return self.permission().then(function (state) {
				if (state !== 'granted') {
					return {skipped: state};
				}
				return self.locate().then(function (where) {
					if (!following) {
						return {skipped: 'off'};
					}
					return self.set(where).then(function (set) {
						return {found: set};
					});
				});
			}).catch(function (err) {
				console.warn('Follow me could not find this place', err);
				return {skipped: 'failed'};
			});
		},

		// Asks the browser where this is. Does not set it: the dialog shows it, then sets it.
		locate: function () {
			var geolocation = deps.geolocation;
			if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
				return Promise.reject(new Error('This browser cannot say where it is. Type the coordinates instead.'));
			}
			return new Promise(function (resolve, reject) {
				geolocation.getCurrentPosition(function (position) {
					var coords = position && position.coords;
					var found = coords && readLocation({latitude: coords.latitude, longitude: coords.longitude});
					if (!found) {
						reject(new Error(describeGeolocationError(null)));
						return;
					}
					resolve({latitude: roundTo(found.latitude, FOUND_PLACES), longitude: roundTo(found.longitude, FOUND_PLACES)});
				}, function (error) {
					reject(new Error(describeGeolocationError(error)));
				}, {enableHighAccuracy: false, maximumAge: 600000, timeout: deps.timeout || TIMEOUT});
			});
		},

		// Calls `listener` with the location now and whenever it changes; returns the unsubscribe.
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
