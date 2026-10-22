// The Display page of Settings, and the taskbar's quick panel, which draws the page's three sliders
// again with a way to the page. Phase 27 pass 2; docs/settings-plan.md. The values are
// js/shell/system-settings.js's and js/shell/display.js draws them; this only asks.
//
// **A slider shows while it is dragged and is set when it is let go.** `input` goes to
// display.preview, which draws and keeps nothing; `change` goes to the settings, which apply it and,
// in the tab that owns the session, write the file -- once per drag, not sixty times a second.

import {DISPLAY, SCALES, MOTION} from './system-settings.js';
import {section, note, button} from './settings.js';

var STYLE_ID = 'pixos-display-page-style';

export var SLIDERS = [
	{name: 'brightness', label: 'Brightness'},
	{name: 'contrast', label: 'Contrast'},
	{name: 'saturation', label: 'Saturation'}
];

var MOTION_LABELS = {system: 'As the system says', on: 'On', off: 'Off'};
// Counts the sliders drawn, so that each label is tied to its own, the page's and the panel's alike.
var drawn = 0;

var CSS = `
.PixSlider {
	display: grid;
	grid-template-columns: 84px minmax(0, 1fr) 44px;
	gap: 10px;
	align-items: center;
}

.PixSlider + .PixSlider {
	margin-top: 8px;
}

.PixSlider input {
	width: 100%;
	margin: 0;
	accent-color: #4f9dff;
}

.PixSlider output {
	text-align: right;
	font-variant-numeric: tabular-nums;
	color: #fff;
}

.PixDisplay__reset {
	margin-top: 10px;
}

.PixChoices {
	display: flex;
	flex-wrap: wrap;
	gap: 6px 14px;
}

.PixQuick {
	position: absolute;
	width: 300px;
	box-sizing: border-box;
	padding: 12px 14px 12px;
	background: #23262b;
	border: 1px solid #434850;
	box-shadow: 0 12px 30px rgba(0, 0, 0, .55);
	font-family: Arial, Helvetica, sans-serif;
	font-size: 12px;
	color: #e4e4e4;
}

.PixQuick:focus {
	outline: none;
}

.PixQuick__foot {
	display: flex;
	justify-content: space-between;
	gap: 8px;
	margin-top: 12px;
}

.PixQuick .PixButton:focus-visible {
	outline: 2px solid #4f9dff;
	outline-offset: -2px;
}
`;

function ensureStyle () {
	if (document.getElementById(STYLE_ID)) {
		return;
	}
	var style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.append(style);
}

// --- the pure half, exported for the tests ---------------------------------------------------------

export function percentText (value) {
	return value + '%';
}

// What the three sliders are when they are reset.
export function resetPatch () {
	var patch = {};
	SLIDERS.forEach(function (slider) {
		patch[slider.name] = 100;
	});
	return patch;
}

// Whether the three sliders are where they started.
export function isNeutral (values) {
	return SLIDERS.every(function (slider) {
		return values[slider.name] === 100;
	});
}

// What the Reduce motion section says under its choices.
export function motionNote (setting, systemReduces) {
	var effect = 'The shell\'s own transitions stop, and an animated background or screensaver moves for '
		+ 'eight seconds each time it is seen and then holds still, as it does on battery.';
	if (setting === 'on') {
		return 'On. ' + effect;
	}
	if (setting === 'off') {
		return 'Off, whatever the system asks for.';
	}
	return systemReduces ? 'The system asks for less motion, so it is on. ' + effect
		: 'The system does not ask for less motion, so it is off. Turned on: ' + effect.charAt(0).toLowerCase() + effect.slice(1);
}

// --- what both draw --------------------------------------------------------------------------------

// One slider: its label, the range, and the value beside it. `preview(name, value)` on every move,
// `set(name, value)` when it is let go. Returns the row, with `update(value)` for a change made elsewhere.
export function sliderRow (slider, value, preview, set) {
	ensureStyle();
	var limits = DISPLAY[slider.name];
	var row = document.createElement('div');
	row.className = 'PixSlider';
	var id = 'pixos-display-' + slider.name + '-' + (++drawn);
	var label = document.createElement('label');
	label.textContent = slider.label;
	label.htmlFor = id;
	var input = document.createElement('input');
	input.type = 'range';
	input.id = id;
	input.min = String(limits.min);
	input.max = String(limits.max);
	input.step = '5';
	input.value = String(value);
	input.dataset.key = slider.name;
	var output = document.createElement('output');
	output.htmlFor = id;
	output.textContent = percentText(value);
	input.oninput = function () {
		output.textContent = percentText(Number(input.value));
		preview(slider.name, Number(input.value));
	};
	input.onchange = function () {
		set(slider.name, Number(input.value));
	};
	row.append(label, input, output);
	row.input = input;
	row.update = function (next) {
		input.value = String(next);
		output.textContent = percentText(next);
	};
	return row;
}

// --- the page --------------------------------------------------------------------------------------

// cfg: settings (js/shell/settings.js), system (system-settings.js's), display (display.js's).
export function addDisplayPage (cfg) {
	var system = cfg.system;
	var display = cfg.display;
	// What the last save said when it failed. Kept here, not on the node: the settings apply a change
	// before they write it, so the page has been drawn again by the time a write is refused.
	var problem = '';

	cfg.settings.addPage({
		id: 'display',
		label: 'Display',
		enter: function (ctx) {
			return system.subscribe(function () {
				ctx.refresh();
			});
		},
		render: function (body, ctx) {
			var values = system.get();
			var status = note(problem);
			status.setAttribute('role', 'status');
			status.hidden = !problem;
			var save = function (patch) {
				return system.set(patch).then(function () {
					problem = '';
					ctx.render();
				}, function (err) {
					// Applied here and not written, or refused outright: either way the screen is drawn
					// from what the settings hold, not from the slider.
					display.apply(system.get());
					problem = 'Not saved: ' + ((err && err.message) || err);
					ctx.render();
				});
			};

			var screen = section('Brightness, contrast and saturation');
			SLIDERS.forEach(function (slider) {
				screen.append(sliderRow(slider, values[slider.name], function (name, value) {
					var patch = {};
					patch[name] = value;
					display.preview(patch);
				}, function (name, value) {
					var patch = {};
					patch[name] = value;
					save(patch);
				}));
			});
			var reset = button('Reset these three', function () {
				save(resetPatch());
			});
			reset.dataset.key = 'reset';
			reset.disabled = isNeutral(values);
			var resetRow = note('The whole screen, as a monitor\'s own buttons would: the windows, the desktop, the '
				+ 'taskbar and the screensaver. Above 100% brightness washes white out rather than making anything '
				+ 'brighter, since a page cannot reach the backlight; it goes no lower than '
				+ percentText(DISPLAY.brightness.min) + ', so the quick panel in the taskbar can always be read to undo it.');
			screen.append(resetRow);
			var resetLine = document.createElement('div');
			resetLine.className = 'PixDialog__row PixDisplay__reset';
			resetLine.append(reset);
			screen.append(resetLine);

			var scale = section('Interface scale');
			var choices = document.createElement('div');
			choices.className = 'PixChoices';
			choices.setAttribute('role', 'radiogroup');
			choices.setAttribute('aria-label', 'Interface scale');
			SCALES.forEach(function (each) {
				choices.append(radio('pixos-display-scale', percentText(each), each === values.scale, 'scale-' + each, function () {
					save({scale: each});
				}));
			});
			scale.append(choices, note('The taskbar, the menus, the dialogs and the windows\' tabs. What is inside a window '
				+ 'keeps its own size; the browser\'s own zoom scales everything.'));

			var motion = section('Reduce motion');
			var motionChoices = document.createElement('div');
			motionChoices.className = 'PixChoices';
			motionChoices.setAttribute('role', 'radiogroup');
			motionChoices.setAttribute('aria-label', 'Reduce motion');
			MOTION.forEach(function (each) {
				motionChoices.append(radio('pixos-display-motion', MOTION_LABELS[each], each === values.reduceMotion, 'motion-' + each, function () {
					save({reduceMotion: each});
				}));
			});
			motion.append(motionChoices, note(motionNote(values.reduceMotion, display.systemReduces())));

			body.append(screen, scale, motion, status);
		}
	});
}

function radio (name, text, checked, key, onpick) {
	var label = document.createElement('label');
	label.className = 'PixDialog__check';
	var input = document.createElement('input');
	input.type = 'radio';
	input.name = name;
	input.checked = checked;
	input.dataset.key = key;
	input.onchange = function () {
		if (input.checked) {
			onpick();
		}
	};
	label.append(input, text);
	return label;
}

// --- the quick panel -------------------------------------------------------------------------------

// cfg: host (#overlays), system, display, openSettings() (Settings at the Display page), onClose().
export function createQuickPanel (cfg) {
	var element = null;
	var anchor = null;
	var rows = {};
	var reset = null;
	var stop = null;

	function onPointerDown (e) {
		if (element && !element.contains(e.target) && !(anchor && anchor.contains(e.target))) {
			close();
		}
	}

	function onKeyDown (e) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			close();
			if (anchor) {
				anchor.focus();
			}
		}
	}

	function close () {
		if (!element) {
			return;
		}
		stop();
		document.removeEventListener('pointerdown', onPointerDown, true);
		element.remove();
		element = null;
		if (cfg.onClose) {
			cfg.onClose();
		}
	}

	function set (patch) {
		// A refused write was applied first, and the subscription has drawn it; one refused outright
		// was not, and the screen still shows the slider's preview.
		cfg.system.set(patch).catch(function () {
			cfg.display.apply(cfg.system.get());
		});
	}

	function show (values) {
		SLIDERS.forEach(function (slider) {
			if (rows[slider.name]) {
				rows[slider.name].update(values[slider.name]);
			}
		});
		if (reset) {
			reset.disabled = isNeutral(values);
		}
	}

	// Above the button that opened it, its right edge on the button's, kept on screen. The panel is in
	// #overlays, which the interface scale zooms, so a place worked out in the screen's pixels is
	// divided by that zoom before it is written (display.js).
	function place (anchorRect) {
		var margin = 6;
		var zoom = element.currentCSSZoom || 1;
		var rect = element.getBoundingClientRect();
		var right = anchorRect ? anchorRect.right : window.innerWidth;
		var bottom = anchorRect ? anchorRect.top : window.innerHeight - margin;
		var left = Math.max(margin, Math.min(right - rect.width, window.innerWidth - rect.width - margin));
		element.style.left = left / zoom + 'px';
		element.style.top = Math.max(margin, bottom - rect.height - 4) / zoom + 'px';
	}

	function open (anchorRect, anchorElement) {
		close();
		anchor = anchorElement || null;
		element = document.createElement('div');
		element.className = 'PixQuick';
		element.setAttribute('role', 'dialog');
		element.setAttribute('aria-label', 'Display');
		element.tabIndex = -1;
		var values = cfg.system.get();
		var label = section('Display');
		SLIDERS.forEach(function (slider) {
			rows[slider.name] = sliderRow(slider, values[slider.name], function (name, value) {
				var patch = {};
				patch[name] = value;
				cfg.display.preview(patch);
			}, function (name, value) {
				var patch = {};
				patch[name] = value;
				set(patch);
			});
			label.append(rows[slider.name]);
		});
		var foot = document.createElement('div');
		foot.className = 'PixQuick__foot';
		// Disabled or not by the subscription below, which is called at once.
		reset = button('Reset', function () {
			set(resetPatch());
		});
		var more = button('Display settings…', function () {
			close();
			cfg.openSettings();
		});
		foot.append(reset, more);
		label.append(foot);
		element.append(label);
		element.addEventListener('keydown', onKeyDown);
		cfg.host.append(element);
		place(anchorRect);
		document.addEventListener('pointerdown', onPointerDown, true);
		// A change from the Settings page, another tab or Reset moves the sliders where they stand.
		stop = cfg.system.subscribe(show);
		rows[SLIDERS[0].name].input.focus();
		return element;
	}

	return {
		open: open,
		close: close,
		isOpen: function () {
			return !!element;
		},
		toggle: function (anchorRect, anchorElement) {
			if (element) {
				close();
				return;
			}
			open(anchorRect, anchorElement);
		}
	};
}
