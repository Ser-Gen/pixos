// Which app can open this file, and which one does by default. Lifted out of openExplorer
// by phase 21: like js/failure.js it reads neither `state` nor `ui`, so it moved without
// the context object the rest of the split needs.
//
// Every real answer here comes from the shell -- the installed list, the catalog, the
// extension-to-profile mapping, the compatibility verdict. What is actually Explorer's own
// is the arithmetic on top: the intersection across a multi-selection, the row for a
// default pointing at an app that is no longer installed, and the two directory-only
// entries that are not apps in the registry at all. Every shell call is guarded by a
// typeof check, because Explorer opened directly in a tab has no shell and must still
// answer something -- that path is what the tests drive.

export function createOpenWith (deps) {
	var shell = deps.shell;
	var path = deps.path;

	async function getOpenWithApps (item) {
		if (item.isDirectory) {
			var dirApps = [
				{id: 'explorer', label: 'explorer', installed: true},
				{id: 'new explorer', label: 'new explorer', installed: true},
				{id: 'terminal', label: 'terminal', installed: true}
			];
			var treemapInstalled = (shell.apps || []).some(function (entry) {
				return entry.id === 'treemap';
			});
			var treemapCatalog = typeof shell.getInstallableApps === 'function'
				? shell.getInstallableApps().some(function (entry) { return entry.id === 'treemap'; })
				: false;
			if (treemapInstalled || treemapCatalog) {
				dirApps.push({
					id: 'treemap',
					label: getCatalogLabel('treemap') || 'Disk Treemap',
					installed: treemapInstalled
				});
			}
			return dirApps;
		}
		var profile = await getCompatibilityProfileForItem(item.path);
		var installedApps = [];
		var installedIds = new Set();
		for (var i = 0; i < (shell.apps || []).length; i++) {
			var app = shell.apps[i];
			if (await isAppCompatibleWithProfile(app.id, profile)) {
				installedIds.add(app.id);
				installedApps.push({
					id: app.id,
					label: getCatalogLabel(app.id) || app.id,
					installed: true
				});
			}
		}
		var installableApps = [];
		var catalogApps = typeof shell.getInstallableApps === 'function' ? shell.getInstallableApps() : [];
		for (var j = 0; j < catalogApps.length; j++) {
			var catalogApp = catalogApps[j];
			if (installedIds.has(catalogApp.id)) continue;
			if (!await isAppCompatibleWithProfile(catalogApp.id, profile)) continue;
			installableApps.push({
				id: catalogApp.id,
				label: catalogApp.label,
				installed: false
			});
		}
		return installedApps.concat(installableApps);
	}

	async function getOpenWithAppsForItems (items) {
		if (!items || !items.length) {
			return [];
		}
		if (items.length === 1) {
			return getOpenWithApps(items[0]);
		}
		if (items.some(function (item) { return item.isDirectory; })) {
			return [];
		}
		var appsPerItem = await Promise.all(items.map(function (item) {
			return getOpenWithApps(item);
		}));
		var commonIds = null;
		appsPerItem.forEach(function (apps) {
			var ids = new Set(apps.map(function (app) { return app.id; }));
			if (commonIds === null) {
				commonIds = ids;
			}
			else {
				commonIds.forEach(function (id) {
					if (!ids.has(id)) {
						commonIds.delete(id);
					}
				});
			}
		});
		if (!commonIds || !commonIds.size) {
			return [];
		}
		return appsPerItem[0].filter(function (app) {
			return commonIds.has(app.id);
		});
	}

	function getCatalogLabel (appId) {
		var app = typeof shell.getInstallableApps === 'function'
			? shell.getInstallableApps().find(function (item) { return item.id === appId; })
			: null;
		return app ? app.label : '';
	}

	async function getDefaultAppRows () {
		var associations = typeof shell.getAllDefaultAppAssociations === 'function'
			? shell.getAllDefaultAppAssociations()
			: {};
		var rows = [];
		var extensions = Object.keys(associations).sort();
		for (var i = 0; i < extensions.length; i++) {
			var extension = extensions[i];
			var appId = associations[extension];
			var apps = await getInstalledCompatibleAppsForExtension(extension);
			if (appId && !apps.some(function (app) { return app.id === appId; })) {
				apps = [{
					id: appId,
					label: (getCatalogLabel(appId) || appId) + ' (not installed)',
					invalid: true
				}].concat(apps);
			}
			rows.push({
				extension: extension,
				appId: appId,
				apps: apps
			});
		}
		return rows;
	}

	function getInstalledAppsForPicker () {
		return (shell.apps || [])
			.map(function (entry) {
				return {
					id: entry.id,
					label: getCatalogLabel(entry.id) || entry.id
				};
			});
	}

	async function getInstalledCompatibleAppsForExtension (extension) {
		var profile = getCompatibilityProfileForExtension(extension);
		var apps = [];
		for (var i = 0; i < (shell.apps || []).length; i++) {
			var entry = shell.apps[i];
			if (!await isAppCompatibleWithProfile(entry.id, profile)) continue;
			apps.push({
				id: entry.id,
				label: getCatalogLabel(entry.id) || entry.id
			});
		}
		return apps;
	}

	function getDefaultAppIdForExtension (extension) {
		if (!extension || typeof shell.getDefaultAppForExtension !== 'function') {
			return null;
		}
		return shell.getDefaultAppForExtension(extension);
	}

	function normalizeExtensionInput (extension) {
		return String(extension || '').trim().replace(/^\./, '').toLowerCase();
	}

	function getNormalizedExtension (filePath) {
		return normalizeExtensionInput(path.extname(filePath));
	}

	// Most specific extension for a path: 'book.fb2.zip' -> 'fb2.zip'.
	// Used for app association; mount logic keeps the trailing extension.
	function getSpecificExtension (filePath) {
		if (typeof shell.getExtensionCandidates === 'function') {
			return shell.getExtensionCandidates(filePath)[0] || '';
		}
		return getNormalizedExtension(filePath);
	}

	async function isAppCompatibleWithExtension (appId, extension) {
		return await isAppCompatibleWithProfile(appId, getCompatibilityProfileForExtension(extension));
	}

	async function getCompatibilityProfileForItem (itemPath) {
		if (typeof shell.getFileCompatibilityProfile === 'function') {
			return await shell.getFileCompatibilityProfile(itemPath);
		}
		return getCompatibilityProfileForExtension(getSpecificExtension(itemPath));
	}

	function getCompatibilityProfileForExtension (extension) {
		if (typeof shell.getExtensionCompatibilityProfile === 'function') {
			return shell.getExtensionCompatibilityProfile(extension);
		}
		return {
			extension: normalizeExtensionInput(extension),
			mimeType: null,
			isText: false
		};
	}

	async function isAppCompatibleWithProfile (appId, profile) {
		if (typeof shell.isAppCompatibleWithProfile === 'function') {
			return await shell.isAppCompatibleWithProfile(appId, profile);
		}
		return false;
	}

	return {
		getOpenWithApps: getOpenWithApps,
		getOpenWithAppsForItems: getOpenWithAppsForItems,
		getCatalogLabel: getCatalogLabel,
		getDefaultAppRows: getDefaultAppRows,
		getInstalledAppsForPicker: getInstalledAppsForPicker,
		getInstalledCompatibleAppsForExtension: getInstalledCompatibleAppsForExtension,
		getDefaultAppIdForExtension: getDefaultAppIdForExtension,
		normalizeExtensionInput: normalizeExtensionInput,
		getNormalizedExtension: getNormalizedExtension,
		getSpecificExtension: getSpecificExtension,
		isAppCompatibleWithExtension: isAppCompatibleWithExtension,
		getCompatibilityProfileForItem: getCompatibilityProfileForItem,
		getCompatibilityProfileForExtension: getCompatibilityProfileForExtension,
		isAppCompatibleWithProfile: isAppCompatibleWithProfile
	};
}
