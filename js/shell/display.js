// The display settings, applied: brightness, contrast and saturation over the whole screen, the
// interface scale, and reduce motion. Phase 27 pass 2; docs/settings-plan.md. The values are
// js/shell/system-settings.js's; this only draws them.
//
// **One filter on #shell**, not a layer on top. Measured in Chrome 155 on an M1 before it was built
// (tests/browser/p27-2-display-measure.mjs): a filter makes #shell the containing block of every fixed
// box inside it, but #shell is itself fixed at the viewport's origin and full-screen, so nothing moved
// -- a window's frame stayed on its placeholder to the pixel -- and the shell kept 60 frames a second
// with Aurora drawing under it, as it did with a backdrop-filter layer instead. Everything is under
// it: the windows, the desktop, the taskbar, the menus and the screensaver, like a monitor's buttons.
//
// **The scale is CSS `zoom` on the shell's chrome, never on the windows.** Since Chrome 128 `zoom`
// scales a box's own `left` and `top` and the `vw` it is given (measured with
// docs/checks/zoom-and-filter.html: a box at `left: 100px` in a layer zoomed by 1.25 is drawn at 125,
// and `100vw` is 1.25 screens wide). So:
//   - #taskbar and #overlays are zoomed whole. Their boxes placed from a pointer or a rect, a menu
//     say, divide by `currentCSSZoom`, and a size in `vw` or `vh` inside them divides by
//     --pixos-scale (context-menu.js, start-menu.js and the dialogs' CSS).
//   - Golden Layout's tabs are zoomed inside a header it is told is taller (`wm.setHeaderHeight`),
//     because it lays the window out below the height it was given, not the one drawn.
//   - #windows is never zoomed: it is placed from the placeholders' rects, and an app's content keeps
//     its own size. Browser zoom is still the way to scale everything.
// --pixos-taskbar-height stays the taskbar's own unzoomed 38 px. Inside #overlays that is right as it
// is, the layer being zoomed like the taskbar; #root, which is not, multiplies it by the scale.
//
// **Reduce motion is two things**: the shell's own transitions and animations go (a class on <html>,
// which reaches the shell's document only -- an app is its own), and animated backgrounds are held
// still the way they are on battery, which index.html does with `reduced()`. *System* follows the
// browser's `prefers-reduced-motion`, and follows it changing.

var STYLE_ID = 'pixos-display-style';
export var MOTION_CLASS = 'PixReduceMotion';
// Golden Layout's own header, 20 px in its dark theme.
export var HEADER_HEIGHT = 20;

var CSS = `
#taskbar,
#overlays,
.PixWidgets,
.PixWebView__bar,
.lm_header > .lm_tabs,
.lm_header > .lm_controls,
.lm_header > .lm_tabdropdown_list {
	zoom: var(--pixos-scale, 1);
}

html.${MOTION_CLASS} *,
html.${MOTION_CLASS} *::before,
html.${MOTION_CLASS} *::after {
	transition: none !important;
	animation: none !important;
}
`;

// --- the pure half, exported for the tests ---------------------------------------------------------

// The CSS filter for brightness, contrast and saturation in percent; none at all when all three are
// 100, so an untouched display costs nothing.
export function filterFor (values) {
	var parts = [];
	[['brightness', 'brightness'], ['contrast', 'contrast'], ['saturation', 'saturate']].forEach(function (pair) {
		var value = values && typeof values[pair[0]] === 'number' ? values[pair[0]] : 100;
		if (value !== 100) {
			parts.push(pair[1] + '(' + value / 100 + ')');
		}
	});
	return parts.join(' ');
}

// Whether motion is reduced: the setting, and what the browser says the system wants for *System*.
export function isReduced (setting, systemReduces) {
	return setting === 'on' || (setting !== 'off' && !!systemReduces);
}

// Golden Layout's header for a scale in percent, in whole pixels.
export function headerHeight (scale) {
	return Math.round(HEADER_HEIGHT * scale / 100);
}

// --- applying it -----------------------------------------------------------------------------------

// deps: root (<html>), shell (#shell), media (matchMedia('(prefers-reduced-motion: reduce)'), or null
// where there is none), setHeaderHeight(px) (the WM's), onMotion(reduced) (called when it changes).
export function createDisplay (deps) {
	var applied = {brightness: 100, contrast: 100, saturation: 100, scale: 100, reduceMotion: 'system'};
	var reduced = false;

	if (deps.root.ownerDocument && !deps.root.ownerDocument.getElementById(STYLE_ID)) {
		var style = deps.root.ownerDocument.createElement('style');
		style.id = STYLE_ID;
		style.textContent = CSS;
		deps.root.ownerDocument.head.append(style);
	}

	function draw (values) {
		deps.shell.style.filter = filterFor(values);
		deps.root.style.setProperty('--pixos-scale', String(values.scale / 100));
		deps.setHeaderHeight(headerHeight(values.scale));
	}

	function motion () {
		var now = isReduced(applied.reduceMotion, deps.media && deps.media.matches);
		deps.root.classList.toggle(MOTION_CLASS, now);
		if (now !== reduced) {
			reduced = now;
			deps.onMotion(reduced);
		}
	}

	if (deps.media && typeof deps.media.addEventListener === 'function') {
		deps.media.addEventListener('change', motion);
	}

	return {
		// The settings as they are: drawn, and kept as what a preview falls back to.
		apply: function (values) {
			applied = {
				brightness: values.brightness,
				contrast: values.contrast,
				saturation: values.saturation,
				scale: values.scale,
				reduceMotion: values.reduceMotion
			};
			draw(applied);
			motion();
		},
		// A slider being dragged: drawn, not kept and not written. The `change` at its end sets it.
		preview: function (patch) {
			draw(Object.assign({}, applied, patch));
		},
		reduced: function () {
			return reduced;
		},
		// What the browser says the system wants, whatever the setting.
		systemReduces: function () {
			return !!(deps.media && deps.media.matches);
		}
	};
}
