// The context menu: opening one, closing it, and building the nodes. Lifted out of
// openExplorer by phase 21.
//
// This is the first module in the split that needs the context object, and the shape that
// was settled on is deliberately narrow: `state` is passed by reference -- it is the one
// genuinely shared mutable thing, and a module that writes `state.contextMenu` has to write
// the same object index.html reads -- while everything else stays a named parameter. A
// single ctx bag holding all of `state`, `ui` and every function would re-create the closure
// this phase exists to take apart, only with a prefix in front of it.
//
// What did NOT move: the three item builders. They are saturated with `actions`, and
// `actions` stays in index.html until the modules around it exist -- moving them now would
// mean moving them twice. So this module knows how to draw a menu and nothing about what
// is in one.

export function createContextMenu (deps) {
	var state = deps.state;
	var doc = deps.doc;
	var win = deps.win;
	var renderOverlays = deps.renderOverlays;

	function openContextMenu (payload) {
		state.contextMenu = payload;
		renderOverlays();
	}

	function closeContextMenu () {
		if (!state.contextMenu) return;
		state.contextMenu = null;
		renderOverlays();
	}

	// index.html closes the menu on a click anywhere in *this* document. A click outside the
	// iframe never reaches it -- the desktop, the taskbar and every other window are a
	// different document -- so a menu left open stayed open over a window that no longer had
	// the focus, and the next click somewhere else did not dismiss it either. Losing the focus
	// is the only signal an app in an iframe gets that the click was somewhere else, so the
	// menu closes on that too. Reported while walking the phase 21 checklist.
	win.addEventListener('blur', closeContextMenu);

	function buildContextMenuNode (items, x, y) {
		var menu = doc.createElement('div');
		menu.className = 'ContextMenu';
		menu.style.left = x + 'px';
		menu.style.top = y + 'px';
		menu.onclick = function (e) {
			e.stopPropagation();
		};
		menu.oncontextmenu = function (e) {
			e.preventDefault();
		};

		menu.append(buildContextMenuList(items));
		return menu;
	}

	function positionContextMenuNode (menu, x, y) {
		win.requestAnimationFrame(function () {
			var margin = 6;
			var rect = menu.getBoundingClientRect();
			var left = Math.min(x, Math.max(margin, win.innerWidth - rect.width - margin));
			var top = Math.min(y, Math.max(margin, win.innerHeight - rect.height - margin));
			menu.style.left = left + 'px';
			menu.style.top = top + 'px';
		});
	}

	function buildContextMenuList (items) {
		var ul = doc.createElement('ul');
		ul.className = 'ContextMenu__list';
		items.forEach(function (item) {
			if (item.separator) {
				var sep = doc.createElement('li');
				sep.className = 'ContextMenu__separator';
				ul.append(sep);
				return;
			}

			var li = doc.createElement('li');
			li.className = 'ContextMenu__item' + (item.disabled ? ' ContextMenu__item--disabled' : '');
			li.textContent = item.label;

			if (item.submenu && item.submenu.length) {
				var marker = doc.createElement('span');
				marker.textContent = '›';
				li.append(marker);
				var sub = doc.createElement('div');
				sub.className = 'ContextMenu__submenu';
				sub.append(buildContextMenuList(item.submenu));
				li.onmouseenter = function () {
					positionSubmenuNode(sub, li);
				};
				li.append(sub);
			}

			if (!item.disabled && item.action) {
				li.onclick = function (e) {
					e.stopPropagation();
					closeContextMenu();
					item.action();
				};
			}

			ul.append(li);
		});
		return ul;
	}

	function positionSubmenuNode (submenu, parentItem) {
		var margin = 6;
		var previousDisplay = submenu.style.display;
		var previousVisibility = submenu.style.visibility;
		submenu.style.visibility = 'hidden';
		submenu.style.display = 'block';

		var submenuRect = submenu.getBoundingClientRect();
		var itemRect = parentItem.getBoundingClientRect();
		var opensLeft = itemRect.right + submenuRect.width - 6 > win.innerWidth - margin;
		var desiredTop = -6;
		var minTop = margin - itemRect.top;
		var maxTop = win.innerHeight - margin - itemRect.top - submenuRect.height;
		var top = Math.max(minTop, Math.min(desiredTop, maxTop));

		submenu.style.left = opensLeft ? (-(submenuRect.width - 6)) + 'px' : (parentItem.offsetWidth - 6) + 'px';
		submenu.style.top = top + 'px';
		submenu.style.right = 'auto';
		submenu.style.display = previousDisplay;
		submenu.style.visibility = previousVisibility;
	}

	return {
		openContextMenu: openContextMenu,
		closeContextMenu: closeContextMenu,
		buildContextMenuNode: buildContextMenuNode,
		positionContextMenuNode: positionContextMenuNode,
		buildContextMenuList: buildContextMenuList,
		positionSubmenuNode: positionSubmenuNode
	};
}
