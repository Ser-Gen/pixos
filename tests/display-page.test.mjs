// The Display page of Settings and the taskbar's quick panel (phase 27, pass 2): js/shell/display-page.js,
// drawn on tests/fake-dom.mjs, over the real system-settings.js with its file in memory and display.js's
// half made of a plain object. What it has to get right: a slider drawn while dragged and set only when
// let go; Reset, the scale and reduce motion each set what they say; a write that fails said on the page;
// a change made elsewhere drawn where it stands; and the panel placed above its button in the layer's
// own pixels, closed by a press outside it, by Escape and by its way to the page, and letting go of
// everything it listened to.

import {check, report} from './assert.mjs';
import {element, doc, all, byClass} from './fake-dom.mjs';

globalThis.window = {innerWidth: 1280, innerHeight: 800};

const settings = await import('../js/shell/settings.js');
const sys = await import('../js/shell/system-settings.js');
const page = await import('../js/shell/display-page.js');

// --- the pure half ---------------------------------------------------------------------------------

check('a value is shown as a percentage', page.percentText(85), '85%');
check('the sliders, in their order', page.SLIDERS.map(s => s.name), ['brightness', 'contrast', 'saturation']);
check('reset puts the three back at 100, and nothing else', page.resetPatch(), {brightness: 100, contrast: 100, saturation: 100});
check('neutral only with all three at 100', [
	page.isNeutral({brightness: 100, contrast: 100, saturation: 100, scale: 150}),
	page.isNeutral({brightness: 95, contrast: 100, saturation: 100}),
	page.isNeutral({brightness: 100, contrast: 105, saturation: 100}),
	page.isNeutral({brightness: 100, contrast: 100, saturation: 0})
], [true, false, false, false]);
const motionNotes = [page.motionNote('on', false), page.motionNote('off', true), page.motionNote('system', true), page.motionNote('system', false)];
check('each reduce-motion state says something of its own', new Set(motionNotes).size, 4);
check('on says what it does', motionNotes[0], 'On. The shell\'s own transitions stop, and an animated background or screensaver moves for '
	+ 'eight seconds each time it is seen and then holds still, as it does on battery.');
check('on says the same with the system asking or not', page.motionNote('on', true), motionNotes[0]);
check('off says it holds whatever the system asks', motionNotes[1], 'Off, whatever the system asks for.');
check('as the system says, asking: on, and why', /^The system asks for less motion, so it is on\./.test(motionNotes[2]), true);
check('as the system says, not asking: off, and what on would do', /^The system does not ask for less motion, so it is off\. Turned on: the shell's/.test(motionNotes[3]), true);

// --- the page --------------------------------------------------------------------------------------

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const file = {text: undefined, writes: 0, refuse: false};
const real = sys.createSystemSettings({
	readText: () => file.text === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(file.text),
	writeText: (path, text) => {
		if (file.refuse) {
			return Promise.reject(new Error('QuotaExceededError'));
		}
		file.writes++;
		file.text = text;
		return Promise.resolve();
	},
	canWrite: () => true
});
// The real thing, with its subscribers counted.
const system = {
	listening: 0,
	get: real.get,
	set: real.set,
	subscribe (fn) {
		system.listening++;
		const stop = real.subscribe(fn);
		return () => { system.listening--; stop(); };
	}
};
const display = {
	previews: [],
	applied: [],
	reduces: false,
	preview (patch) { display.previews.push(patch); },
	apply (values) { display.applied.push(values); },
	systemReduces () { return display.reduces; }
};
const stored = () => JSON.parse(file.text);

const host = element('div');
settings.init({host});
page.addDisplayPage({settings, system, display});
settings.addPage({id: 'background', label: 'Background', render () {}});

settings.open('display');
const win = () => host.children[0];
const body = () => byClass(win(), 'PixSettings__body')[0];
const ranges = () => all(body(), n => n.tagName === 'INPUT' && n.type === 'range');
const radios = name => all(body(), n => n.tagName === 'INPUT' && n.type === 'radio' && n.name === name);
const outputs = () => all(body(), n => n.tagName === 'OUTPUT').map(n => n.textContent);
const buttonNamed = text => all(body(), n => n.tagName === 'BUTTON' && n.textContent === text)[0];
const notesOf = () => byClass(body(), 'PixDialog__note').filter(n => !n.hidden).map(n => n.textContent);

check('its stylesheet is added, once, for the sliders and the panel alike', doc.head.children.filter(n => n.id === 'pixos-display-page-style')
	.map(n => /\.PixSlider \{[\s\S]*\.PixQuick \{/.test(n.textContent)), [true]);
check('the page comes first in the sidebar, named', byClass(win(), 'PixSettings__page').map(t => t.textContent), ['Display', 'Background']);
check('its three sections', byClass(body(), 'PixDialog__label').map(l => l.textContent),
	['Brightness, contrast and saturation', 'Interface scale', 'Reduce motion']);
check('three sliders, each with its range, its value and its key', ranges().map(r => [r.min, r.max, r.step, r.value, r.dataset.key]),
	[['30', '150', '5', '100', 'brightness'], ['50', '150', '5', '100', 'contrast'], ['0', '200', '5', '100', 'saturation']]);
check('each a row of its own, labelled, the label and the value tied to it', ranges().map(r => [r.parent.className, r.parent.children[0].textContent,
	r.parent.children[0].htmlFor === r.id, r.parent.children[2].htmlFor === r.id]),
	[['PixSlider', 'Brightness', true, true], ['PixSlider', 'Contrast', true, true], ['PixSlider', 'Saturation', true, true]]);
check('every slider drawn has an id of its own', new Set(ranges().map(r => r.id)).size, 3);
check('which says which slider it is', ranges().map(r => r.id.startsWith('pixos-display-' + r.dataset.key + '-')), [true, true, true]);
check('the note under them, with the floor that keeps the panel readable',
	notesOf().some(n => /^The whole screen, as a monitor's own buttons would: .* Above 100% brightness washes white out .* no lower than 30%, so the quick panel/.test(n)), true);
check('reset on a row of its own under them', buttonNamed('Reset these three').parent.className, 'PixDialog__row PixDisplay__reset');
const status = () => all(body(), n => n.getAttribute('role') === 'status')[0];
check('a status line, hidden while there is nothing to say', [!!status(), status().hidden], [true, true]);
check('the values beside them', outputs(), ['100%', '100%', '100%']);
check('showing the page listens to the settings', system.listening, 1);
check('reset has nothing to do yet', buttonNamed('Reset these three').disabled, true);

// Dragging, then letting go.
let brightness = ranges()[0];
brightness.value = '70';
brightness.oninput();
check('dragged: drawn through the display, the value beside it', [display.previews, outputs()[0]], [[{brightness: 70}], '70%']);
check('and nothing set or written', [system.get().brightness, file.writes], [100, 0]);
brightness.value = '60';
brightness.oninput();
brightness.onchange();
await tick();
check('let go: set, and written once', [system.get().brightness, stored().brightness, file.writes], [60, 60, 1]);
check('the page drawn again from it, reset now offered', [ranges()[0].value, outputs()[0], buttonNamed('Reset these three').disabled], ['60', '60%', false]);

ranges()[2].value = '0';
ranges()[2].onchange();
await tick();
buttonNamed('Reset these three').focus();
buttonNamed('Reset these three').click();
await tick();
check('reset sets the three back at once', [system.get().brightness, system.get().saturation, stored().brightness, stored().saturation],
	[100, 100, 100, 100]);
check('and has nothing to do again', buttonNamed('Reset these three').disabled, true);
check('the focus stays on it, drawn again', doc.activeElement === buttonNamed('Reset these three'), true);

// The scale.
check('the choices are radio groups, named', byClass(body(), 'PixChoices').map(g => [g.getAttribute('role'), g.getAttribute('aria-label')]),
	[['radiogroup', 'Interface scale'], ['radiogroup', 'Reduce motion']]);
check('each choice a labelled radio', radios('pixos-display-scale').concat(radios('pixos-display-motion')).every(r => r.parent.className === 'PixDialog__check'), true);
check('the scales as choices, the one in use chosen', radios('pixos-display-scale').map(r => [r.parent.textContent, r.checked]),
	[['80%', false], ['90%', false], ['100%', true], ['110%', false], ['125%', false], ['150%', false]]);
let scale125 = radios('pixos-display-scale')[4];
scale125.focus();
scale125.checked = true;
scale125.onchange();
await tick();
check('picking one sets it', [system.get().scale, stored().scale, radios('pixos-display-scale')[4].checked], [125, 125, true]);
check('and the focus stays on that choice, drawn again', [doc.activeElement === radios('pixos-display-scale')[4], doc.activeElement.dataset.key],
	[true, 'scale-125']);

// Reduce motion.
check('reduce motion\'s three, as the system says chosen', radios('pixos-display-motion').map(r => [r.parent.textContent, r.checked]),
	[['As the system says', true], ['On', false], ['Off', false]]);
check('and what that means here now', notesOf().includes(page.motionNote('system', false)), true);
display.reduces = true;
settings.refresh();
check('with the system asking, it says so', notesOf().includes(page.motionNote('system', true)), true);
const on = radios('pixos-display-motion')[1];
on.focus();
on.checked = true;
on.onchange();
await tick();
check('on sets it, and says what it does', [system.get().reduceMotion, stored().reduceMotion, notesOf().includes(page.motionNote('on', true))],
	['on', 'on', true]);
check('the focus stays on it too', doc.activeElement.dataset.key, 'motion-on');
const off = radios('pixos-display-motion')[2];
off.checked = false;
off.onchange();
check('a radio unchecked sets nothing', system.get().reduceMotion, 'on');

// A change made somewhere else: the quick panel, another tab.
await system.set({contrast: 130});
check('a change made elsewhere is drawn on the open page', [ranges()[1].value, outputs()[1]], ['130', '130%']);

// A write that fails.
file.refuse = true;
const appliedBefore = display.applied.length;
brightness = ranges()[0];
brightness.value = '80';
brightness.onchange();
await tick();
check('a refused write is said on the page', notesOf().some(n => /^Not saved: QuotaExceededError/.test(n)), true);
check('and the screen drawn from what the settings hold', [display.applied.length - appliedBefore, display.applied.slice(-1)[0].brightness], [1, 80]);
file.refuse = false;
ranges()[0].onchange();
await tick();
check('and gone once one is saved', notesOf().some(n => /^Not saved/.test(n)), false);

settings.open('background');
check('leaving the page lets the settings go', system.listening, 0);
settings.close();

// --- the quick panel -------------------------------------------------------------------------------

await system.set({brightness: 100, contrast: 100, saturation: 100, scale: 100, reduceMotion: 'system'});
const overlays = element('div');
// #overlays, zoomed by the scale: what is drawn in it is 300 x 150 on the screen, at 1.25.
const append = overlays.append;
overlays.append = (...nodes) => {
	nodes.forEach(node => { node.currentCSSZoom = 1.25; node.rect = {left: 0, top: 0, right: 300, bottom: 150, width: 300, height: 150}; });
	append(...nodes);
};
const opened = [];
const closed = [];
const panel = page.createQuickPanel({
	host: overlays,
	system,
	display,
	openSettings: () => opened.push('display'),
	onClose: () => closed.push(true)
});
const anchor = element('button');
const anchorRect = {left: 1150, right: 1200, top: 762, bottom: 800, width: 50, height: 38};
const panelRanges = () => all(overlays, n => n.tagName === 'INPUT' && n.type === 'range');
const panelButton = text => all(overlays, n => n.tagName === 'BUTTON' && n.textContent === text)[0];

check('closed to begin with', [panel.isOpen(), overlays.children.length], [false, 0]);
panel.toggle(anchorRect, anchor);
const box = overlays.children[0];
check('opened from its button: a dialog named Display, in the layer', [panel.isOpen(), box.className, box.getAttribute('role'), box.getAttribute('aria-label')],
	[true, 'PixQuick', 'dialog', 'Display']);
check('the three sliders, the focus on the first', [panelRanges().map(r => r.dataset.key), doc.activeElement === panelRanges()[0]],
	[['brightness', 'contrast', 'saturation'], true]);
check('above the button, right edges together, in the zoomed layer\'s own pixels', [box.style.left, box.style.top], [900 / 1.25 + 'px', (762 - 150 - 4) / 1.25 + 'px']);
check('it listens to the settings, and to presses anywhere before anything else hears them', [system.listening, (doc.listeners.pointerdown || []).map(l => l.capture)],
	[1, [true]]);
check('it can be given the focus, its foot laid out as one', [box.tabIndex, panelButton('Reset').parent.className], [-1, 'PixQuick__foot']);
check('reset has nothing to do', panelButton('Reset').disabled, true);

const slider = panelRanges()[0];
slider.value = '45';
slider.oninput();
check('dragged: drawn, not set', [display.previews.slice(-1)[0], system.get().brightness], [{brightness: 45}, 100]);
slider.onchange();
await tick();
check('let go: set and written', [system.get().brightness, stored().brightness], [45, 45]);
check('the same slider stays, reset now offered', [panelRanges()[0] === slider, panelButton('Reset').disabled], [true, false]);
await system.set({saturation: 150});
check('a change from the page moves its slider where it stands', [panelRanges()[2].value, all(overlays, n => n.tagName === 'OUTPUT')[2].textContent],
	['150', '150%']);
panelButton('Reset').click();
await tick();
check('reset puts all three back', [system.get().brightness, system.get().saturation, panelRanges()[0].value, panelButton('Reset').disabled],
	[100, 100, '100', true]);

file.refuse = true;
const before = display.applied.length;
panelRanges()[1].value = '70';
panelRanges()[1].onchange();
await tick();
await tick();
check('a refused write draws the screen from what the settings hold', display.applied.length - before, 1);
file.refuse = false;

doc.press(slider);
check('a press inside it leaves it open', panel.isOpen(), true);
doc.press(anchor);
check('so does one on its button, which toggles it itself', panel.isOpen(), true);
doc.press(element('div'));
check('a press anywhere else closes it, and says so', [panel.isOpen(), overlays.children.length, closed.length], [false, 0, 1]);
check('letting go of everything it listened to', [system.listening, (doc.listeners.pointerdown || []).length], [0, 0]);

panel.open(anchorRect, anchor);
const e = overlays.children[0].key('Escape');
check('Escape closes it, goes no further, and gives the focus back to its button', [panel.isOpen(), e.stopped, doc.activeElement === anchor],
	[false, true, true]);

panel.toggle(anchorRect, anchor);
panel.toggle(anchorRect, anchor);
check('its button pressed again closes it', panel.isOpen(), false);

panel.open(anchorRect, anchor);
panel.open(anchorRect, anchor);
check('opened again while open, it is still one panel', [overlays.children.length, system.listening, (doc.listeners.pointerdown || []).length], [1, 1, 1]);
panelButton('Display settings…').click();
check('its way to the page closes it and opens Settings there', [panel.isOpen(), opened], [false, ['display']]);
panel.close();
check('closing it closed is nothing', closed.length, 5);

panel.open({left: 1260, right: 1279, top: 762, bottom: 800, width: 19, height: 38}, anchor);
check('a button at the very edge: kept a margin inside the screen', overlays.children[0].style.left, (1280 - 300 - 6) / 1.25 + 'px');
panel.close();

{
	// No anchor at all: bottom right of the screen, in a layer that is not zoomed.
	const plain = element('div');
	const append2 = plain.append;
	plain.append = (...nodes) => { nodes.forEach(node => { node.rect = {left: 0, top: 0, right: 300, bottom: 150, width: 300, height: 150}; }); append2(...nodes); };
	const bare = page.createQuickPanel({host: plain, system, display, openSettings () {}});
	bare.open();
	check('with no button: bottom right, a margin in', [plain.children[0].style.left, plain.children[0].style.top], [(1280 - 300 - 6) + 'px', (800 - 6 - 150 - 4) + 'px']);
	bare.close();
}

process.exit(report('display-page') ? 1 : 0);
