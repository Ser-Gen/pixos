// Where this machine is, for anything that draws the sky: `/settings/location.json`,
// `{"latitude": 56.9496, "longitude": 24.1052}`. Phase 26, the Sky pass; docs/screensavers-plan.md.
//
// **One place for all of PixOS**, the user's choice over keeping it in each screensaver's address,
// the way the slideshow keeps its folder: set once, in the Wallpaper dialog, and both the background
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
// createLocation(deps) -- deps: readText(path) resolving to the file's text and rejecting when there
// is none; writeText(path, text); canWrite() (this tab owns the session); geolocation (the browser's,
// or null); timeout (ms, for finding it).

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
				var read = null;
				try {
					read = readLocation(JSON.parse(text));
				}
				catch (err) {
					read = null;
				}
				apply(read || DEFAULT_LOCATION, !!read);
				return copy();
			}, function () {
				apply(DEFAULT_LOCATION, false);
				return copy();
			});
		},

		// Applies at once, here, and writes the file if this tab owns the session.
		set: function (location) {
			var read = readLocation(location);
			if (!read) {
				return Promise.reject(new Error('Not a location: ' + JSON.stringify(location)));
			}
			var rounded = {latitude: roundTo(read.latitude, TYPED_PLACES), longitude: roundTo(read.longitude, TYPED_PLACES)};
			apply(rounded, true);
			if (!deps.canWrite()) {
				return Promise.resolve(copy());
			}
			return Promise.resolve(deps.writeText(LOCATION_FILE, JSON.stringify(rounded, null, 2) + '\n')).then(copy);
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
