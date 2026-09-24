// Every icon Explorer draws, as SVG markup, from mockup B (docs/explorer-chrome-mockup-b.html).
//
// Strings rather than nodes, because both places that draw them -- js/view.js's one template and
// js/sidebar.js's buttons -- already build with `innerHTML`, and because an icon that is a string
// can be checked by a test with no DOM. Drawn on a 16-unit square in `currentColor`, so a button
// colours its icon by colouring itself; each is `aria-hidden`, and the button carrying it names
// itself with `title` and `aria-label` instead.
//
// Nothing here is emoji. An emoji is drawn by whichever colour font the system has, at whatever
// size and baseline that font chose, and on a rail of line icons it is the one thing that looks
// pasted in.

// `box` is 16 for everything drawn for Explorer, 24 for the three recording icons it had before.
function svg (body, extra, box) {
	var size = box || 16;
	return '<svg viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true" focusable="false"' + (extra || '') + '>' + body + '</svg>';
}

var LINE = ' fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';

export var ICONS = {
	drawer: svg('<path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11"/>', LINE),
	back: svg('<path d="M10 3L5 8l5 5"/>', LINE),
	forward: svg('<path d="M6 3l5 5-5 5"/>', LINE),
	up: svg('<path d="M8 13V4M4 7.5L8 3.5l4 4"/>', LINE),
	add: svg('<path d="M8 3v10M3 8h10"/>', ' fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"'),
	upload: svg('<path d="M8 11V3M5 6l3-3 3 3M3 13h10"/>', LINE),
	paste: svg('<path d="M5.5 3h5v2h-5zM4 4.5h1.5M10.5 4.5H12v8.5H4V4.5"/>', LINE),
	details: svg('<path d="M3 4.5h10M3 8h10M3 11.5h10"/>', LINE),
	grid: svg('<rect x="3" y="3" width="4" height="4"/><rect x="9" y="3" width="4" height="4"/><rect x="3" y="9" width="4" height="4"/><rect x="9" y="9" width="4" height="4"/>', ' fill="currentColor"'),
	sort: svg('<path d="M4 3v10M2 11l2 2 2-2M9 4.5h5M9 8h4M9 11.5h3"/>', LINE),
	refresh: svg('<path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5V5.5h-3"/>', LINE),
	more: svg('<circle cx="8" cy="3.5" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="8" cy="12.5" r="1.3"/>', ' fill="currentColor"'),
	moreRow: svg('<circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/>', ' fill="currentColor"'),
	close: svg('<path d="M4 4l8 8M12 4l-8 8"/>', ' fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"'),
	eject: svg('<path d="M8 3l4.5 6h-9zM3.5 12.5h9"/>', ' fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"'),
	folder: svg('<path d="M2 12.5v-9h4L7.5 5H14v7.5z"/>', ' fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"'),
	cloud: svg('<path d="M4.5 12a3 3 0 0 1 .4-6 4 4 0 0 1 7.5 1.3A2.6 2.6 0 0 1 11.8 12z"/>', ' fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"'),
	mic: svg('<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V20H9v2h6v-2h-2v-2.08c3.39-.49 6-3.39 6-6.92h-2z"/>', ' fill="currentColor"', 24),
	speaker: svg('<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>', ' fill="currentColor"', 24),
	stop: svg('<path d="M6 6h12v12H6z"/>', ' fill="currentColor"', 24)
};
