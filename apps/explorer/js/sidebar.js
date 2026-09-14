// The quick-access list down the left, the mounts under it, and the two buttons that add
// one. It is a render like the ones in js/view.js and was written beside them, but it is the
// only one that reaches outside `state` for what it draws -- `mountManager.listMounts()` is
// the shell's answer, not Explorer's -- and the only one whose output is clickable, which is
// what keeps it in a file of its own.
//
// That is also why it is built at the very bottom of the block, after `actions`: every mount
// row carries an unmount button and the two footer buttons call `mountNativeDir` and
// `mountFiles3`, so the table has to exist. js/menu-items.js is there for the same reason.
//
// A window with no shell has no `mountManager`, and then there are no mounts and no way to
// make one: the quick-access list is drawn and the rest of the function does not run.

export function createSidebar (deps) {

	var state = deps.state;
	var ui = deps.ui;
	var document = deps.doc;
	var window = deps.win;
	var mountManager = deps.mountManager;
	var actions = deps.actions;
	var navigateTo = deps.navigateTo;
	var getParentPath = deps.getParentPath;

	function renderSidebar () {
		var quickItems = [
			{label: 'Root', path: '/'},
			{label: 'Apps', path: '/apps'},
			{label: 'Current', path: state.cwd},
			{label: 'Parent', path: getParentPath(state.cwd)}
		];

		ui.sidebar.innerHTML = '<div class="Explorer__sidebarTitle">Quick access</div>';
		quickItems.forEach(function (item) {
			if (!item.path) return;
			var node = document.createElement('div');
			node.className = 'Explorer__sidebarItem' + (item.path === state.cwd ? ' Explorer__sidebarItem--active' : '');
			node.dataset.path = item.path;
			node.textContent = item.path === '/' ? '📁 ' + item.label : '📂 ' + item.label + ' (' + item.path + ')';
			ui.sidebar.append(node);
		});

		// Mounts section
		if (mountManager) {
			var mounts = mountManager.listMounts();
			if (mounts.length > 0) {
				var mountTitle = document.createElement('div');
				mountTitle.className = 'Explorer__sidebarTitle';
				mountTitle.textContent = 'Mounts';
				ui.sidebar.append(mountTitle);

				mounts.forEach(function (m) {
					var typeIcon = m.type === 'native' ? '💻' : (m.type === 'iso' ? '💿' : (m.type === 'files3' ? '☁️' : '📦'));
					var roLabel = m.readOnly ? ' [ro]' : '';
					var row = document.createElement('div');
					row.className = 'Explorer__sidebarItem' + (m.mountPoint === state.cwd ? ' Explorer__sidebarItem--active' : '');
					row.style.display = 'flex';
					row.style.justifyContent = 'space-between';
					row.style.alignItems = 'center';

					var label = document.createElement('span');
					label.dataset.path = m.mountPoint;
					label.style.cursor = 'pointer';
					label.textContent = typeIcon + ' ' + m.name + ' (' + m.mountPoint + ')' + roLabel;
					label.style.flex = '1';
					label.style.overflow = 'hidden';
					label.style.textOverflow = 'ellipsis';
					label.onclick = function () { navigateTo(m.mountPoint); };

					var umountBtn = document.createElement('button');
					umountBtn.textContent = '⏏';
					umountBtn.title = 'Unmount';
					umountBtn.style.cssText = 'background:none;border:none;color:inherit;cursor:pointer;padding:2px 4px;font-size:14px;flex-shrink:0;';
					umountBtn.onclick = function (e) {
						e.stopPropagation();
						actions.umount(m.mountPoint);
					};

					row.append(label);
					row.append(umountBtn);
					ui.sidebar.append(row);
				});
			}

			// Mount local folder button
			if (typeof window.showDirectoryPicker === 'function') {
				var mountLocalBtn = document.createElement('div');
				mountLocalBtn.className = 'Explorer__sidebarItem';
				mountLocalBtn.style.cursor = 'pointer';
				mountLocalBtn.textContent = '📂 Mount local folder...';
				mountLocalBtn.onclick = function () { actions.mountNativeDir(); };
				ui.sidebar.append(mountLocalBtn);
			}

			var mountFiles3Btn = document.createElement('div');
			mountFiles3Btn.className = 'Explorer__sidebarItem';
			mountFiles3Btn.style.cursor = 'pointer';
			mountFiles3Btn.textContent = '☁️ Mount Files3 storage...';
			mountFiles3Btn.onclick = function () { actions.mountFiles3(); };
			ui.sidebar.append(mountFiles3Btn);
		}
	}

	return {
		renderSidebar: renderSidebar
	};
}
