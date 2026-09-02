// How to open a file the system has no default for.
//
// Until now the answer was silent and it was the worst one available: `launch()` falls
// back to using the path itself as the iframe src, so double-clicking a `.csv` handed you
// the browser's idea of a csv rather than any of the apps that can actually read it. The
// fallback is not wrong -- it is how a bare html page opens -- it was just never a choice.
//
// So it becomes one. The list is built from the same compatibility machinery Explorer's
// own *Open with...* uses, plus the two routes that always exist: the browser's own viewer
// in a tab, and the raw file in a window. Nothing here knows how to open anything; `open()`
// resolves with what was picked and the shell acts on it.
//
// The core is pure so the ordering and the keys can be tested without a DOM, and because
// the one rule that is easy to get wrong -- *you cannot make "a browser tab" the default
// app for .csv* -- is a function, not a branch buried in a click handler.

import * as icons from './app-icons.js';

var STYLE_ID = 'pixos-open-with-style';

var CSS = `
.PixOpenWith {
	position: absolute;
	left: 50%;
	top: 16vh;
	transform: translateX(-50%);
	width: min(520px, calc(100vw - 32px));
	background: #23262b;
	border: 1px solid #434850;
	box-shadow: 0 30px 80px rgba(0, 0, 0, .6);
	font-family: Arial, Helvetica, sans-serif;
	color: #e4e4e4;
	display: flex;
	flex-direction: column;
	max-height: 70vh;
	outline: none;
}

.PixOpenWith__head {
	padding: 14px 16px 10px;
	border-bottom: 1px solid #383c44;
}

.PixOpenWith__title {
	font-size: 14px;
}

.PixOpenWith__path {
	font-size: 11px;
	color: #8a919c;
	margin-top: 3px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	direction: rtl;
	text-align: left;
}

.PixOpenWith__list {
	list-style: none;
	margin: 0;
	padding: 6px;
	overflow-y: auto;
	overflow-x: hidden;
}

.PixOpenWith__group {
	padding: 8px 10px 4px;
	font-size: 10px;
	text-transform: uppercase;
	letter-spacing: .09em;
	color: #767d88;
}

.PixOpenWith__item {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 7px 10px;
	cursor: pointer;
	min-width: 0;
	overflow: hidden;
}

.PixOpenWith__item:hover {
	background: #2b2f36;
}

.PixOpenWith__item--active,
.PixOpenWith__item--active:hover {
	background: #333840;
}

/* These are spans, so display:block is what stacks the label above the hint rather than
   running the two together on one line -- and min-width:0 is what lets a flex child
   shrink below its own content, without which a long hint widens the dialog instead of
   ellipsising and the whole window scrolls sideways. */
.PixOpenWith__text {
	min-width: 0;
	flex: 1;
	display: block;
	overflow: hidden;
}

.PixOpenWith__label {
	display: block;
	font-size: 13px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.PixOpenWith__hint {
	display: block;
	font-size: 11px;
	color: #8a919c;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.PixOpenWith__badge {
	flex: none;
	font-size: 10px;
	text-transform: uppercase;
	letter-spacing: .06em;
	color: #767d88;
}

.PixOpenWith__number {
	flex: none;
	width: 16px;
	text-align: center;
	font-size: 11px;
	color: #767d88;
}

.PixOpenWith__glyph {
	flex: none;
	width: 22px;
	height: 22px;
	border-radius: 4px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 12px;
	background: #2c3038;
	color: #c6ccd6;
	overflow: hidden;
}

.PixOpenWith__glyph img {
	width: 100%;
	height: 100%;
	object-fit: contain;
}

.PixOpenWith__foot {
	border-top: 1px solid #383c44;
	padding: 10px 16px;
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 10px;
	font-size: 11px;
	color: #8a919c;
}

.PixOpenWith__remember {
	display: flex;
	align-items: center;
	gap: 6px;
	cursor: pointer;
	/* Grows to push the buttons right, but wraps to its own line rather than squeezing
	   them when the caller adds two of its own. */
	flex: 1 1 220px;
	min-width: 0;
}

.PixOpenWith__remember--off {
	opacity: .45;
	cursor: default;
}

.PixOpenWith__button {
	background: #2c3038;
	border: 1px solid #434850;
	color: #e4e4e4;
	font: inherit;
	padding: 4px 12px;
	cursor: pointer;
}
`;

// --- the part with rules ----------------------------------------------------------------

// Two routes exist for any file at all, whatever is installed, and they are the reason
// this dialog can never be empty: the browser's own viewer, and the file as a window.
// They come last because they are what you fall back to, not what you meant.
export var BROWSER_TAB = 'browser-tab';
export var RAW_WINDOW = 'raw-window';

export function plan (cfg) {
	var request = cfg || {};
	var apps = Array.isArray(request.apps) ? request.apps : [];
	var choices = [];

	apps.forEach(function (app) {
		if (!app || !app.id) {
			return;
		}
		choices.push({
			kind: 'app',
			id: 'app:' + app.id,
			appId: app.id,
			label: String(app.label || app.id),
			// An app that is not on disk yet is still worth offering -- picking it is what
			// installs it -- but saying so beforehand is the difference between a pause
			// and a hang.
			install: !app.installed,
			hint: app.installed ? '' : 'Not installed yet — picking it installs it first',
			group: app.installed ? 'Apps' : 'Available to install'
		});
	});

	// A folder is neither of these -- the browser has no viewer for one, and there is no
	// file to put in a window -- so the caller says whether they apply. For a folder the
	// apps are always there anyway, so the list is still never empty.
	if (request.universal !== false) {
		choices.push({
			kind: BROWSER_TAB,
			id: BROWSER_TAB,
			appId: null,
			install: false,
			label: 'Open in a browser tab',
			hint: "The browser's own viewer, outside PixOS",
			group: 'Always available'
		});
		choices.push({
			kind: RAW_WINDOW,
			id: RAW_WINDOW,
			appId: null,
			install: false,
			label: 'Open as a plain file in a window',
			hint: 'The browser renders it inside PixOS, with no app around it',
			group: 'Always available'
		});
	}

	return choices.map(function (choice, index) {
		return Object.assign({number: index < 9 ? index + 1 : null}, choice);
	});
}

// A default association maps an extension to an *app id*, so the two universal routes
// cannot be one however the checkbox is left. Without this the checkbox would appear to
// work and then silently store nothing, which is the worst of the three options.
export function canSetDefault (choice, extension) {
	return !!(choice && choice.kind === 'app' && choice.appId && extension);
}

// What the checkbox should look like for the row under the highlight, given what the
// person has already asked for. The intent and the row are separate on purpose: moving
// onto *Open in a browser tab* has to clear the tick, and moving back off it has to put
// it back — clearing it for good would silently undo the thing they just asked for while
// they were only looking around.
export function rememberState (choice, extension, wanted) {
	var allowed = canSetDefault(choice, extension);
	return {enabled: allowed, checked: allowed && wanted === true};
}

export function rememberLabel (extension) {
	return extension
		? 'Always open .' + extension + ' files this way'
		: 'Always open files like this this way';
}

// Same contract as the overview's: null for anything not ours, so the handler prevents
// the default of what it claimed and nothing else.
export function resolveKey (e, count) {
	if (e.key === 'Escape') {
		return {action: 'cancel'};
	}
	if (e.key === 'Enter' || e.key === ' ') {
		return {action: 'activate'};
	}
	if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
		return {action: 'move', delta: 1};
	}
	if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
		return {action: 'move', delta: -1};
	}
	if (!e.ctrlKey && !e.metaKey && !e.altKey && /^Digit[1-9]$/.test(e.code || '')) {
		var index = Number(e.code.slice(5)) - 1;
		return index < count ? {action: 'pick', index: index} : {action: 'ignore'};
	}
	return null;
}

// --- the overlay ---------------------------------------------------------------------------

var host = null;
var element = null;
var listElement = null;
var rememberInput = null;
var choices = [];
var activeIndex = 0;
var extension = '';
var settle = null;
var getApp = null;
// What the person asked for, as opposed to what the highlighted row allows. Moving onto
// *Open in a browser tab* has to clear the box -- there is no app id to remember -- but
// moving back off it must put the tick back, or ticking it and then looking at the other
// entries silently undoes the thing you just asked for.
var rememberWanted = false;

function ensureStyle () {
	if (document.getElementById(STYLE_ID)) {
		return;
	}
	var style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.append(style);
}

// cfg: {host, getApp}
export function init (cfg) {
	host = cfg.host;
	getApp = cfg.getApp || null;
	ensureStyle();
}

export function isOpen () {
	return !!element;
}

// Resolving with null is the answer to "the user closed it": every caller has to handle
// being told nothing was chosen, and a promise that never settles would leave `openFile`
// hanging forever on an Esc.
export function close () {
	if (!element) {
		return;
	}
	window.removeEventListener('keydown', onKeyDown, true);
	element.remove();
	element = null;
	listElement = null;
	rememberInput = null;
	choices = [];
	rememberWanted = false;
	var done = settle;
	settle = null;
	if (done) {
		done(null);
	}
}

// request: {title, subtitle, extension, universal, apps: [{id, label, installed}],
//           extras: [{label, run}]}
// Resolves with {choice, setDefault} or null.
export function open (request) {
	close();
	var cfg = request || {};
	extension = String(cfg.extension || '');
	choices = plan(cfg);
	activeIndex = 0;
	rememberWanted = false;

	element = document.createElement('div');
	element.className = 'PixOpenWith';
	// The window in front is almost always an app iframe, and a keystroke inside one never
	// reaches this document -- so without taking focus the arrows and numbers below would
	// be dead for everyone who opened a file from Explorer, which is everyone.
	element.tabIndex = -1;

	var head = document.createElement('div');
	head.className = 'PixOpenWith__head';
	var title = document.createElement('div');
	title.className = 'PixOpenWith__title';
	title.textContent = cfg.title || (extension
		? 'No app is set for .' + extension + ' files'
		: 'No app is set for this file');
	var pathLine = document.createElement('div');
	pathLine.className = 'PixOpenWith__path';
	pathLine.textContent = String(cfg.subtitle || '');
	head.append(title, pathLine);

	listElement = document.createElement('ul');
	listElement.className = 'PixOpenWith__list';

	var foot = document.createElement('div');
	foot.className = 'PixOpenWith__foot';
	var remember = document.createElement('label');
	remember.className = 'PixOpenWith__remember';
	rememberInput = document.createElement('input');
	rememberInput.type = 'checkbox';
	rememberInput.onchange = function () {
		rememberWanted = rememberInput.checked;
	};
	var rememberText = document.createElement('span');
	rememberText.textContent = rememberLabel(extension);
	remember.append(rememberInput, rememberText);
	foot.append(remember);

	// Whatever else the caller wants to reach from here -- Explorer's App Manager and
	// Manage Defaults, which are its dialogs and not the shell's. Choosing one is
	// choosing nothing, so the promise resolves null the same as Cancel does.
	(cfg.extras || []).forEach(function (extra) {
		var button = document.createElement('button');
		button.className = 'PixOpenWith__button';
		button.textContent = extra.label;
		button.onclick = function () {
			close();
			extra.run();
		};
		foot.append(button);
	});

	var cancel = document.createElement('button');
	cancel.className = 'PixOpenWith__button';
	cancel.textContent = 'Cancel';
	cancel.onclick = function () {
		close();
	};
	foot.append(cancel);

	element.append(head, listElement, foot);
	host.append(element);
	render();
	element.focus();
	window.addEventListener('keydown', onKeyDown, true);

	return new Promise(function (resolve) {
		settle = resolve;
	});
}

function render () {
	if (!listElement) {
		return;
	}
	listElement.textContent = '';
	var group = null;
	choices.forEach(function (choice, index) {
		if (choice.group !== group) {
			group = choice.group;
			var heading = document.createElement('li');
			heading.className = 'PixOpenWith__group';
			heading.textContent = group;
			listElement.append(heading);
		}
		var row = document.createElement('li');
		row.className = 'PixOpenWith__item' + (index === activeIndex ? ' PixOpenWith__item--active' : '');
		row.append(glyphFor(choice), numberFor(choice), textFor(choice));
		if (choice.install) {
			var badge = document.createElement('span');
			badge.className = 'PixOpenWith__badge';
			badge.textContent = 'install';
			row.append(badge);
		}
		// Deliberately no hover-to-select. The palette does that and it is right there,
		// but here the highlighted row decides whether the remember-this box is usable --
		// so a pointer travelling down to Cancel would sweep across the two entries that
		// disable it and untick what you had just asked for, and you would have to steer
		// around them. Hover is a CSS state; the highlight moves on keys and on a click.
		row.onclick = function () {
			activeIndex = index;
			activate();
		};
		listElement.append(row);
	});
	syncRemember();
}

function glyphFor (choice) {
	if (choice.kind === 'app') {
		var app = getApp ? getApp(choice.appId) : null;
		return icons.render(app || {id: choice.appId, name: choice.label}, 22);
	}
	var glyph = document.createElement('span');
	glyph.className = 'PixOpenWith__glyph';
	glyph.textContent = choice.kind === BROWSER_TAB ? '↗' : '□';
	return glyph;
}

function numberFor (choice) {
	var number = document.createElement('span');
	number.className = 'PixOpenWith__number';
	number.textContent = choice.number == null ? '' : String(choice.number);
	return number;
}

function textFor (choice) {
	var text = document.createElement('span');
	text.className = 'PixOpenWith__text';
	var label = document.createElement('span');
	label.className = 'PixOpenWith__label';
	label.textContent = choice.label;
	text.append(label);
	if (choice.hint) {
		var hint = document.createElement('span');
		hint.className = 'PixOpenWith__hint';
		hint.textContent = choice.hint;
		text.append(hint);
	}
	return text;
}

// The checkbox tracks the highlighted row rather than sitting there enabled, because what
// it means changes as you move: there is no such thing as making a browser tab the
// default app for an extension.
function syncRemember () {
	if (!rememberInput) {
		return;
	}
	var state = rememberState(choices[activeIndex], extension, rememberWanted);
	rememberInput.disabled = !state.enabled;
	rememberInput.checked = state.checked;
	rememberInput.parentElement.className = 'PixOpenWith__remember'
		+ (state.enabled ? '' : ' PixOpenWith__remember--off');
}

function move (delta) {
	if (!choices.length) {
		return;
	}
	activeIndex = (activeIndex + delta + choices.length) % choices.length;
	render();
}

function activate () {
	var choice = choices[activeIndex];
	if (!choice) {
		return;
	}
	var payload = {
		choice: choice,
		setDefault: !!(rememberWanted && canSetDefault(choice, extension))
	};
	var done = settle;
	settle = null;
	close();
	if (done) {
		done(payload);
	}
}

function onKeyDown (e) {
	if (!element) {
		return;
	}
	var action = resolveKey(e, choices.length);
	if (!action) {
		return;
	}
	e.preventDefault();
	e.stopImmediatePropagation();
	if (action.action === 'cancel') {
		close();
		return;
	}
	if (action.action === 'move') {
		move(action.delta);
		return;
	}
	if (action.action === 'pick') {
		activeIndex = action.index;
		activate();
		return;
	}
	if (action.action === 'activate') {
		activate();
	}
}
