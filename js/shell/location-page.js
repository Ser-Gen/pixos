// The Location page of Settings, and the row that sets the place -- drawn on the page, and under the
// gallery while Sky is the choice (js/shell/wallpaper-dialog.js), which is where it was in phase 26.
// Phase 27; docs/settings-plan.md. js/shell/location.js holds the place; this only asks it.

import {parseCoordinate} from './location.js';
import {section, note, button} from './settings.js';

// --- the pure half, exported for the tests ---------------------------------------------------------

// What the two fields say: a location, or which field is wrong and why.
export function readLocationFields (latitudeText, longitudeText) {
	var latitude = parseCoordinate(latitudeText, 90);
	if (latitude === null) {
		return {error: 'Latitude is a number from -90 to 90, north positive.', field: 'latitude'};
	}
	var longitude = parseCoordinate(longitudeText, 180);
	if (longitude === null) {
		return {error: 'Longitude is a number from -180 to 180, east positive.', field: 'longitude'};
	}
	return {location: {latitude: latitude, longitude: longitude}};
}

// What the Follow me row says, from whether it is on and what the browser says about being asked.
export function followNote (on, permission) {
	if (permission === 'unsupported') {
		return 'This browser cannot say where it is, or will not say whether it may, so the place is typed.';
	}
	if (permission === 'denied') {
		return on ? 'On, but the browser was told not to say where this is, so nothing is found at start. '
			+ 'The site\'s settings in the browser can change that.'
			: 'The browser was told not to say where this is. The site\'s settings in the browser can change that.';
	}
	if (on) {
		return permission === 'granted' ? 'Found again each time PixOS starts.'
			: 'On, but the browser would ask first, and PixOS never asks at start. Use my location once to let it.';
	}
	return permission === 'granted' ? 'Each time PixOS starts, ask the browser again. It will not ask you.'
		: 'Each time PixOS starts, ask the browser again. Turning it on asks once now, and never at start.';
}

// --- the page --------------------------------------------------------------------------------------

// The row that sets the place: two fields, Set, and Use my location. `place` is location.js's;
// `onChange` is called once anything was saved, to draw the page again. A typed place turns Follow me
// off, since the next start would put the found one back over it.
export function locationRow (place, label, onChange) {
	var element = section(label);
	var row = document.createElement('div');
	row.className = 'PixDialog__row';
	var current = place.get();
	var field = function (name, value) {
		var input = document.createElement('input');
		input.type = 'text';
		input.inputMode = 'decimal';
		input.value = String(value);
		input.placeholder = name;
		input.setAttribute('aria-label', name);
		input.addEventListener('keydown', function (e) {
			if (e.key === 'Enter') {
				set.click();
			}
		});
		return input;
	};
	var latitude = field('Latitude', current.latitude);
	var longitude = field('Longitude', current.longitude);
	var set = button('Set');
	var find = button('Use my location');
	var status = note('');
	status.setAttribute('role', 'status');
	status.hidden = true;
	var say = function (text) {
		status.textContent = text;
		status.hidden = !text;
	};
	var show = function (where) {
		latitude.value = String(where.latitude);
		longitude.value = String(where.longitude);
	};
	var save = function (where, options) {
		return place.set(where, options).then(function (saved) {
			show(saved);
			if (onChange) {
				onChange();
			}
		}, function (err) {
			show(place.get());
			say('Shown, but not saved: ' + ((err && err.message) || err));
		});
	};
	set.onclick = function () {
		var read = readLocationFields(latitude.value, longitude.value);
		latitude.setAttribute('aria-invalid', read.field === 'latitude' ? 'true' : 'false');
		longitude.setAttribute('aria-invalid', read.field === 'longitude' ? 'true' : 'false');
		say(read.error || '');
		if (read.location) {
			latitude.blur();
			longitude.blur();
			save(read.location, {follow: false});
		}
	};
	// Asked in the click, which the browser's prompt needs.
	find.onclick = function () {
		find.disabled = true;
		say('Finding where this is…');
		place.locate().then(function (where) {
			say('');
			return save(where);
		}, function (err) {
			say((err && err.message) || String(err));
		}).then(function () {
			find.disabled = false;
		});
	};
	row.append(latitude, longitude, set, find);
	element.append(row, status);
	return element;
}

// cfg: settings (js/shell/settings.js), location (location.js's).
export function addLocationPage (cfg) {
	var place = cfg.location;
	// What the browser said last time it was asked, so the page draws at once and then corrects itself.
	var permission = 'prompt';

	cfg.settings.addPage({
		id: 'location',
		label: 'Location',
		enter: function (ctx) {
			var stop = place.subscribe(function () {
				ctx.refresh();
			});
			place.permission().then(function (state) {
				if (state !== permission) {
					permission = state;
					ctx.refresh();
				}
			});
			return stop;
		},
		render: function (body, ctx) {
			var where = locationRow(place, 'Where this machine is', ctx.render);
			where.append(note(place.isSet()
				? 'North and east are positive. A typed place keeps four decimals, a found one two: about a kilometre.'
				: 'Not set, so Riga stands in. North and east are positive. A found place keeps two decimals: about a kilometre.'));

			var follow = section('Follow me');
			var label = document.createElement('label');
			label.className = 'PixDialog__check';
			var box = document.createElement('input');
			box.type = 'checkbox';
			box.checked = place.isFollowing();
			box.disabled = permission === 'unsupported' || (permission === 'denied' && !box.checked);
			box.dataset.key = 'follow';
			var status = note('');
			status.setAttribute('role', 'status');
			status.hidden = true;
			box.onchange = function () {
				var on = box.checked;
				box.disabled = true;
				if (on) {
					status.hidden = false;
					status.textContent = 'Finding where this is…';
				}
				// In the click: turning it on is when the browser may ask.
				place.follow(on).then(function () {
					return place.permission();
				}).then(function (state) {
					permission = state;
					ctx.render();
				}, function (err) {
					box.checked = !on;
					box.disabled = false;
					status.hidden = false;
					status.textContent = (err && err.message) || String(err);
				});
			};
			label.append(box, 'Find this place again each time PixOS starts');
			follow.append(label, status, note(followNote(box.checked, permission)));

			var used = section('What uses it');
			used.append(note('Sky draws the sun, the moon, the planets and the stars as seen from here, as the background '
				+ 'and as the screensaver alike. A page that wants it asks PixOS for it rather than reading the file.'));

			body.append(where, follow, used);
		}
	});
}
