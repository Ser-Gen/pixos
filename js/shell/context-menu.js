// Context menu for the shell.
//
// Explorer has its own copy (apps/explorer/index.html) and keeps it: it renders inside
// the iframe's own coordinate space, so a shared instance in the host would position
// itself against the wrong viewport. This is a port, not an extraction -- keep the two
// in sync by hand if the look changes.

var STYLE_ID = 'pixos-context-menu-style';

var CSS = `
.PixMenu {
	position: absolute;
	min-width: 220px;
	background: #23262b;
	border: 1px solid #434850;
	box-shadow: 0 18px 40px rgba(0, 0, 0, .55);
	padding: 6px;
	font-family: Arial, Helvetica, sans-serif;
	z-index: 10;
}

.PixMenu__list {
	list-style: none;
	margin: 0;
	padding: 0;
}

.PixMenu__item {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 5px 8px;
	font-size: 12px;
	cursor: pointer;
	color: #e4e4e4;
	white-space: nowrap;
}

.PixMenu__item:hover {
	background: #333840;
}

.PixMenu__item--disabled,
.PixMenu__item--disabled:hover {
	opacity: .45;
	cursor: not-allowed;
	background: transparent;
}

.PixMenu__marker {
	opacity: .6;
}

.PixMenu__separator {
	height: 1px;
	background: #424750;
	margin: 6px 4px;
}

.PixMenu__submenu {
	display: none;
	position: absolute;
	left: calc(100% - 6px);
	top: -6px;
	min-width: 220px;
	max-height: 70vh;
	overflow-y: auto;
	background: #23262b;
	border: 1px solid #434850;
	box-shadow: 0 18px 40px rgba(0, 0, 0, .55);
	padding: 6px;
}

.PixMenu__item:hover > .PixMenu__submenu {
	display: block;
}
`;

var host = null;
var current = null;

function ensureStyle () {
	if (document.getElementById(STYLE_ID)) {
		return;
	}
	var style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.append(style);
}

export function setHost (element) {
	host = element;
	ensureStyle();
}

export function isOpen () {
	return !!current;
}

export function close () {
	if (!current) {
		return;
	}
	current.remove();
	current = null;
}

export function open (items, x, y) {
	if (!host) {
		throw new Error('context menu has no host, call setHost first');
	}
	close();
	if (!items || !items.length) {
		return null;
	}

	var menu = document.createElement('div');
	menu.className = 'PixMenu';
	menu.style.left = x + 'px';
	menu.style.top = y + 'px';
	menu.onclick = function (e) {
		e.stopPropagation();
	};
	menu.oncontextmenu = function (e) {
		e.preventDefault();
	};
	menu.append(buildList(items));

	host.append(menu);
	current = menu;
	reposition(menu, x, y);
	return menu;
}

function reposition (menu, x, y) {
	requestAnimationFrame(function () {
		if (menu !== current) {
			return;
		}
		var margin = 6;
		var rect = menu.getBoundingClientRect();
		menu.style.left = Math.min(x, Math.max(margin, window.innerWidth - rect.width - margin)) + 'px';
		menu.style.top = Math.min(y, Math.max(margin, window.innerHeight - rect.height - margin)) + 'px';
	});
}

function buildList (items) {
	var ul = document.createElement('ul');
	ul.className = 'PixMenu__list';

	items.forEach(function (item) {
		if (item.separator) {
			var sep = document.createElement('li');
			sep.className = 'PixMenu__separator';
			ul.append(sep);
			return;
		}

		var li = document.createElement('li');
		li.className = 'PixMenu__item' + (item.disabled ? ' PixMenu__item--disabled' : '');

		var label = document.createElement('span');
		label.textContent = item.label;
		li.append(label);

		if (item.submenu && item.submenu.length) {
			var marker = document.createElement('span');
			marker.className = 'PixMenu__marker';
			marker.textContent = '›';
			li.append(marker);

			var sub = document.createElement('div');
			sub.className = 'PixMenu__submenu';
			sub.append(buildList(item.submenu));
			li.onmouseenter = function () {
				positionSubmenu(sub, li);
			};
			li.append(sub);
		}
		else if (item.hint) {
			var hint = document.createElement('span');
			hint.className = 'PixMenu__marker';
			hint.textContent = item.hint;
			li.append(hint);
		}

		if (!item.disabled && item.action) {
			li.onclick = function (e) {
				e.stopPropagation();
				close();
				item.action();
			};
		}

		ul.append(li);
	});

	return ul;
}

// Measure while hidden, then place: a submenu that would run off the right edge opens
// leftwards, and one that would run off the bottom slides up instead of being clipped.
function positionSubmenu (submenu, parentItem) {
	var margin = 6;
	var previousDisplay = submenu.style.display;
	var previousVisibility = submenu.style.visibility;
	submenu.style.visibility = 'hidden';
	submenu.style.display = 'block';

	var submenuRect = submenu.getBoundingClientRect();
	var itemRect = parentItem.getBoundingClientRect();
	var opensLeft = itemRect.right + submenuRect.width - 6 > window.innerWidth - margin;
	var minTop = margin - itemRect.top;
	var maxTop = window.innerHeight - margin - itemRect.top - submenuRect.height;
	var top = Math.max(minTop, Math.min(-6, maxTop));

	submenu.style.left = opensLeft ? (-(submenuRect.width - 6)) + 'px' : (parentItem.offsetWidth - 6) + 'px';
	submenu.style.top = top + 'px';
	submenu.style.right = 'auto';
	submenu.style.display = previousDisplay;
	submenu.style.visibility = previousVisibility;
}

// A click inside an app iframe never reaches this document, so `blur` is the only
// signal that focus left the shell while a menu was open.
window.addEventListener('mousedown', function (e) {
	if (current && !current.contains(e.target)) {
		close();
	}
}, true);

window.addEventListener('blur', close);

// stopImmediatePropagation, not stopPropagation: the desktop's own Escape handler is
// registered on this same element, and Escape closing a menu should not also drop out
// of peek in the same keystroke.
window.addEventListener('keydown', function (e) {
	if (e.key === 'Escape' && current) {
		e.stopImmediatePropagation();
		close();
	}
}, true);
