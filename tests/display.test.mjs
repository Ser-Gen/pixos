// The display settings applied (phase 27, pass 2): js/shell/display.js, with <html>, #shell, the
// browser's reduced-motion query and the WM made of plain objects. What it has to get right: no filter
// at all for an untouched screen, the scale handed to CSS and to Golden Layout's header, *System*
// following the browser and following it changing, the shell told only when motion changes, and a
// preview that draws without keeping.

import {check, report} from './assert.mjs';

const display = await import('../js/shell/display.js');

// --- the pure half ---------------------------------------------------------------------------------

check('an untouched screen has no filter at all', display.filterFor({brightness: 100, contrast: 100, saturation: 100}), '');
check('nor does nothing', display.filterFor(undefined), '');
check('one changed is one function, as a fraction', display.filterFor({brightness: 80, contrast: 100, saturation: 100}), 'brightness(0.8)');
check('all three, in that order, saturation spelled the CSS way', display.filterFor({brightness: 150, contrast: 50, saturation: 0}),
	'brightness(1.5) contrast(0.5) saturate(0)');
check('a missing one is 100', display.filterFor({contrast: 120}), 'contrast(1.2)');

check('reduce motion on is on, whatever the system says', [display.isReduced('on', false), display.isReduced('on', true)], [true, true]);
check('off is off, whatever the system says', [display.isReduced('off', false), display.isReduced('off', true)], [false, false]);
check('as the system says follows it', [display.isReduced('system', false), display.isReduced('system', true)], [false, true]);

check('Golden Layout\'s header at each scale offered, in whole pixels', [80, 90, 100, 110, 125, 150].map(display.headerHeight),
	[16, 18, 20, 22, 25, 30]);

// --- applying it -----------------------------------------------------------------------------------

function world (matches) {
	const head = {children: [], append (node) { head.children.push(node); }};
	const ownerDocument = {
		head,
		createElement: tag => ({tagName: tag, id: '', textContent: ''}),
		getElementById: id => head.children.find(node => node.id === id) || null
	};
	const w = {
		head,
		classes: new Set(),
		props: {},
		headers: [],
		told: [],
		media: {
			matches: !!matches,
			listeners: [],
			addEventListener (type, fn) { w.media.listeners.push([type, fn]); },
			change (to) { w.media.matches = to; w.media.listeners.forEach(([type, fn]) => type === 'change' && fn()); }
		}
	};
	w.root = {
		ownerDocument,
		style: {setProperty: (name, value) => { w.props[name] = value; }},
		classList: {toggle: (name, on) => { if (on) { w.classes.add(name); } else { w.classes.delete(name); } }}
	};
	w.shell = {style: {filter: 'unset'}};
	w.display = display.createDisplay({
		root: w.root,
		shell: w.shell,
		media: w.media,
		setHeaderHeight: px => w.headers.push(px),
		onMotion: reduced => w.told.push(reduced)
	});
	return w;
}

const plain = {brightness: 100, contrast: 100, saturation: 100, scale: 100, reduceMotion: 'system'};
{
	const w = world(false);
	check('its stylesheet is added once', w.head.children.map(node => node.id), ['pixos-display-style']);
	check('which zooms the chrome by the scale and never the windows', [/#taskbar,\s*#overlays,/.test(w.head.children[0].textContent),
		/zoom: var\(--pixos-scale, 1\)/.test(w.head.children[0].textContent), /#windows/.test(w.head.children[0].textContent)], [true, true, false]);
	check('and Golden Layout\'s tabs, controls and tab list inside the header, not the header itself',
		['.lm_header > .lm_tabs,', '.lm_header > .lm_controls,', '.lm_header > .lm_tabdropdown_list {'].map(rule => w.head.children[0].textContent.includes(rule))
			.concat(/\.lm_header\s*[,{]/.test(w.head.children[0].textContent)), [true, true, true, false]);
	check('and takes every transition and animation away under its class', /html\.PixReduceMotion \*,[\s\S]*transition: none !important;\s*animation: none !important;/
		.test(w.head.children[0].textContent), true);
	display.createDisplay({root: w.root, shell: {style: {}}, media: null, setHeaderHeight: () => {}, onMotion: () => {}});
	check('and not again by a second display in the same document', w.head.children.length, 1);
	check('nothing is drawn before it is applied', [w.shell.style.filter, w.props, w.headers], ['unset', {}, []]);

	w.display.apply(plain);
	check('applied untouched: no filter, scale 1, the header its own', [w.shell.style.filter, w.props['--pixos-scale'], w.headers], ['', '1', [20]]);
	check('motion is not reduced, and the shell is not told so', [w.classes.has('PixReduceMotion'), w.told, w.display.reduced()], [false, [], false]);

	w.display.apply(Object.assign({}, plain, {brightness: 70, scale: 125}));
	check('a changed setting is drawn', [w.shell.style.filter, w.props['--pixos-scale'], w.headers.slice(-1)], ['brightness(0.7)', '1.25', [25]]);

	w.display.preview({brightness: 40});
	check('a preview is drawn over what is applied', [w.shell.style.filter, w.props['--pixos-scale']], ['brightness(0.4)', '1.25']);
	w.display.preview({contrast: 110});
	check('and is not kept: the next one starts from what is applied', w.shell.style.filter, 'brightness(0.7) contrast(1.1)');

	w.display.apply(Object.assign({}, plain, {reduceMotion: 'on'}));
	check('reduce motion on: the class, and the shell told once', [w.classes.has('PixReduceMotion'), w.told, w.display.reduced()], [true, [true], true]);
	w.display.apply(Object.assign({}, plain, {reduceMotion: 'on', brightness: 90}));
	check('a change that leaves motion as it was tells the shell nothing', w.told, [true]);
	w.display.apply(plain);
	check('back to as the system says, which does not ask: off again, told', [w.classes.has('PixReduceMotion'), w.told], [false, [true, false]]);

	w.media.change(true);
	check('the system asking for less motion, under as the system says, turns it on', [w.classes.has('PixReduceMotion'), w.told, w.display.systemReduces()],
		[true, [true, false, true], true]);
	w.display.apply(Object.assign({}, plain, {reduceMotion: 'off'}));
	check('off is off with the system asking', [w.classes.has('PixReduceMotion'), w.told.slice(-1)], [false, [false]]);
	w.media.change(false);
	w.media.change(true);
	check('and the system changing its mind under off changes nothing', [w.classes.has('PixReduceMotion'), w.told.length], [false, 4]);
}
{
	// A slider dragged before the settings have arrived: drawn over the defaults.
	const w = world(false);
	w.display.preview({brightness: 50});
	const one = [w.shell.style.filter, w.props['--pixos-scale'], w.headers.slice()];
	w.display.preview({contrast: 50});
	check('a preview before anything is applied starts from every default', [one, w.shell.style.filter],
		[['brightness(0.5)', '1', [20]], 'contrast(0.5)']);
}
{
	const w = world(true);
	w.display.apply(plain);
	check('a system that asks already, at the first apply: on, and told', [w.classes.has('PixReduceMotion'), w.told], [true, [true]]);
}
{
	// A browser with no matchMedia: as the system says is off.
	const w = world(false);
	const bare = display.createDisplay({root: w.root, shell: w.shell, media: null, setHeaderHeight: () => {}, onMotion: r => w.told.push(r)});
	bare.apply(plain);
	check('no query at all: as the system says is off', [bare.reduced(), bare.systemReduces(), w.told], [false, false, []]);
}

process.exit(report('display') ? 1 : 0);
