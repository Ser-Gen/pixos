// The Settings window (phase 27, pass 1): js/shell/settings.js, on a small DOM made of plain objects.
// What it has to get right: the pages in the sidebar's order whoever added them, opening where it was
// asked or where it was left, a page's `enter` and what it returns paired one to one, a redraw that
// arrives after its page stopped being shown doing nothing, a refresh held back while a field is being
// typed in and only then, and the focus put back where it was rather than dropped onto the page.

import {check, report} from './assert.mjs';

import {element, doc, all, byClass} from './fake-dom.mjs';

const settings = await import('../js/shell/settings.js');

// --- the pure half ---------------------------------------------------------------------------------

const page = id => ({id, label: id});
check('the sidebar order, whoever added what first', settings.orderPages([page('location'), page('mine'), page('display'), page('background')])
	.map(p => p.id), ['display', 'background', 'location', 'mine']);
check('pages nobody ordered keep the order they were added in', settings.orderPages([page('b'), page('a'), page('privacy')]).map(p => p.id),
	['privacy', 'b', 'a']);

const three = [page('background'), page('screensaver'), page('location')];
check('the page asked for', settings.pickPage(three, 'location', 'screensaver').id, 'location');
check('else the one last shown', settings.pickPage(three, undefined, 'screensaver').id, 'screensaver');
check('a page that is not there is the one last shown', settings.pickPage(three, 'network', 'location').id, 'location');
check('and with none shown yet, the first', [settings.pickPage(three, 'network', null).id, settings.pickPage(three, null, 'gone').id],
	['background', 'background']);
check('no pages, no page', settings.pickPage([], 'location', null), null);

check('down and up, wrapping', ['ArrowDown', 'ArrowUp'].map(key => settings.stepPage(three, 'location', key).id), ['background', 'screensaver']);
check('right and left too, for the row it becomes on a narrow screen',
	['ArrowRight', 'ArrowLeft'].map(key => settings.stepPage(three, 'background', key).id), ['screensaver', 'location']);
check('Home and End', ['Home', 'End'].map(key => settings.stepPage(three, 'screensaver', key).id), ['background', 'location']);
check('any other key is not a step', settings.stepPage(three, 'background', 'Enter'), null);
check('and with no pages there is nowhere to go', ['ArrowDown', 'Home', 'End'].map(key => settings.stepPage([], 'x', key) === null), [true, true, true]);

const field = Object.assign(element('input'), {type: 'text'});
const box = Object.assign(element('input'), {type: 'checkbox'});
const slider = Object.assign(element('input'), {type: 'range'});
const area = element('textarea');
const plain = element('button');
const panel = element('div');
panel.append(field, box, slider, area, plain);
check('typing is a text field or a textarea with the focus, inside the page', [field, area].map(n => settings.typingIn(panel, n)), [true, true]);
check('a checkbox, a slider or a button with the focus is not', [box, slider, plain].map(n => settings.typingIn(panel, n)), [false, false, false]);
check('nor is a field somewhere else, or nothing', [settings.typingIn(panel, Object.assign(element('input'), {type: 'text'})),
	settings.typingIn(panel, null)], [false, false]);

// --- the window ------------------------------------------------------------------------------------

const host = element('div');
settings.init({host});
check('with no pages it does not open', [settings.open(), settings.isOpen()], [null, false]);

const log = [];
let draws = {};
let typed = null;
const ctxs = {};
function addPage (id, extra) {
	settings.addPage(Object.assign({
		id,
		label: id[0].toUpperCase() + id.slice(1),
		enter (ctx) {
			ctxs[id] = ctx;
			log.push('enter ' + id);
			return () => log.push('leave ' + id);
		},
		render (body) {
			draws[id] = (draws[id] || 0) + 1;
			const input = Object.assign(element('input'), {type: 'text'});
			input.dataset.key = 'field';
			const button = element('button');
			button.dataset.key = 'button';
			const unkeyed = element('button');
			body.append(input, button, unkeyed);
			typed = {input, button, unkeyed};
		}
	}, extra));
}
addPage('location');
addPage('background');
addPage('screensaver');
settings.addPage({id: 'location', label: 'Location', render (body) { body.append(element('p')); }, enter (ctx) { ctxs.location = ctx; log.push('enter location'); }});

const win = settings.open();
check('it opens, in the host', [settings.isOpen(), host.children[0] === win], [true, true]);
check('a dialog, named', [win.getAttribute('role'), win.getAttribute('aria-label')], ['dialog', 'Settings']);
const tabs = byClass(win, 'PixSettings__page');
check('the sidebar lists the pages in its order, once each, an id added again replacing the first',
	tabs.map(t => t.textContent), ['Background', 'Screensaver', 'Location']);
check('on the first, with nothing asked for and nothing shown before', settings.currentPage(), 'background');
check('the heading says which', byClass(win, 'PixSettings__heading')[0].textContent, 'Background');
check('that tab selected, and the only one reached by Tab', tabs.map(t => [t.getAttribute('aria-selected'), t.tabIndex]),
	[['true', 0], ['false', -1], ['false', -1]]);
check('and it has the focus', doc.activeElement === tabs[0], true);
check('drawn once, and entered once', [draws.background, log], [1, ['enter background']]);

tabs[2].click();
check('a tab shows its page, the last one left first', [settings.currentPage(), log], ['location', ['enter background', 'leave background', 'enter location']]);
check('and keeps the focus on the tab', doc.activeElement === tabs[2], true);

const step = tabs[2].key('ArrowDown');
check('an arrow key moves to the next page, wrapping, and is the window\'s', [settings.currentPage(), step.prevented, doc.activeElement === tabs[0]],
	['background', true, true]);
check('a page whose enter returned nothing has nothing to leave', log.slice(-2), ['enter location', 'enter background']);

settings.open('screensaver');
check('opening it again while open goes to that page, in the same window', [settings.currentPage(), host.children.length, settings.isOpen()],
	['screensaver', 1, true]);

// The focus, and the redraws.
const background = ctxs.background;
const screensaver = ctxs.screensaver;
const before = draws.screensaver;
const backgroundBefore = draws.background;
background.render();
background.refresh();
check('a ctx from a page no longer shown does nothing', [draws.screensaver, draws.background, background.isShown(), screensaver.isShown()],
	[before, backgroundBefore, false, true]);

typed.button.focus();
screensaver.render();
check('a redraw puts the focus back on the control it was on, by its key', [draws.screensaver, doc.activeElement === typed.button],
	[before + 1, true]);
typed.unkeyed.focus();
screensaver.render();
check('one with no key gives it to the window, not to the page under it', doc.activeElement === win, true);
doc.activeElement = doc.body;
screensaver.render();
check('focus outside the page is left where it is', doc.activeElement === doc.body, true);

typed.input.focus();
const drawn = draws.screensaver;
screensaver.refresh();
settings.refresh();
check('a refresh waits while a field in the page is being typed in', draws.screensaver, drawn);
screensaver.render();
check('a render does not', [draws.screensaver, doc.activeElement === typed.input], [drawn + 1, true]);
doc.activeElement = doc.body;
settings.refresh();
check('and once nobody is typing, the refresh draws', draws.screensaver, drawn + 2);

// A page that fails to draw says so, in its place.
const errors = [];
const error = console.error;
console.error = (...args) => errors.push(args[0]);
settings.addPage({id: 'broken', label: 'Broken', render () { throw new Error('no (expected)'); }});
settings.close();
settings.open('broken');
console.error = error;
const body = byClass(host.children[0], 'PixSettings__body')[0];
check('a page that throws is a note in its place, not a broken window', [body.children[0].textContent, errors.length],
	['This page could not be drawn: no (expected)', 1]);

// Closing.
settings.open('screensaver');
const leaves = log.filter(line => line === 'leave screensaver').length;
host.children[0].key('Escape');
check('Escape closes it, and leaves the page', [settings.isOpen(), host.children.length, log.filter(l => l === 'leave screensaver').length],
	[false, 0, leaves + 1]);
check('closed, there is no page', settings.currentPage(), null);
const after = draws.screensaver;
ctxs.screensaver.render();
settings.refresh();
check('and nothing draws', draws.screensaver, after);

settings.open();
check('opened with nothing asked for, it is where it was left', settings.currentPage(), 'screensaver');
byClass(host.children[0], 'PixDialog__close')[0].click();
check('the close button closes it', settings.isOpen(), false);

// A page whose enter shows another page -- not something a page should do, but nothing leaks if it does.
let stopped = 0;
settings.addPage({id: 'jumpy', label: 'Jumpy', render () {}, enter () { settings.open('background'); return () => { stopped++; }; }});
settings.open('jumpy');
check('a leave returned after its page was already gone is called at once', [settings.currentPage(), stopped], ['background', 1]);
settings.close();

// The helpers every page draws with.
const s = settings.section('Where');
check('a section has its small heading', [s.className, s.children[0].className, s.children[0].textContent],
	['PixDialog__section', 'PixDialog__label', 'Where']);
check('one with no label has none', settings.section('').children.length, 0);
check('a note', [settings.note('Hi').className, settings.note('Hi').textContent], ['PixDialog__note', 'Hi']);
let pressed = 0;
const b = settings.button('Set', () => { pressed++; });
b.click();
check('a button', [b.className, b.textContent, pressed], ['PixButton', 'Set', 1]);

check('the style is added once', [doc.head.children.length, doc.head.children[0].id], [1, 'pixos-settings-style']);

process.exit(report('settings') ? 1 : 0);
