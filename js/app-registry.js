/* global BrowserFS */
(function (global) {
	'use strict';

	var RESERVED_IDS = ['base', 'explorer', 'app-manager', 'app-catalog'];
	var LOCAL_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_\-]*$/;

	var deps = {};
	var appRegistry = {};
	var catalogIds = new Set();
	var localIds = new Set();
	var installedStateCache = {};
	var buildRegistryPromise = null;

	function init (options) {
		deps = options || {};
	}

	function getFs () {
		return deps.fs;
	}

	function getPath () {
		return deps.path;
	}

	function getScope () {
		return deps.scope || '';
	}

	function promisify (fn) {
		return function () {
			var args = Array.prototype.slice.call(arguments);
			return new Promise(function (resolve, reject) {
				args.push(function (err, result) {
					if (err) {
						reject(err);
					}
					else {
						resolve(result);
					}
				});
				fn.apply(null, args);
			});
		};
	}

	function fsStat (filePath) {
		return new Promise(function (resolve) {
			getFs().stat(filePath, function (err, stats) {
				resolve(!err && !!stats);
			});
		});
	}

	function fsReaddir (dirPath) {
		return new Promise(function (resolve, reject) {
			getFs().readdir(dirPath, function (err, list) {
				if (err) {
					reject(err);
				}
				else {
					resolve(list || []);
				}
			});
		});
	}

	function fsReadFile (filePath) {
		return new Promise(function (resolve, reject) {
			getFs().readFile(filePath, function (err, content) {
				if (err) {
					reject(err);
				}
				else {
					resolve(content);
				}
			});
		});
	}

	function fsRename (from, to) {
		return new Promise(function (resolve, reject) {
			getFs().rename(from, to, function (err) {
				if (err) {
					reject(err);
				}
				else {
					resolve();
				}
			});
		});
	}

	function fsIsDirectory (dirPath) {
		return new Promise(function (resolve) {
			getFs().stat(dirPath, function (err, stats) {
				resolve(!err && !!stats && typeof stats.isDirectory === 'function' && stats.isDirectory());
			});
		});
	}

	function fsUnlink (filePath) {
		return new Promise(function (resolve, reject) {
			getFs().unlink(filePath, function (err) {
				if (err) {
					reject(err);
				}
				else {
					resolve();
				}
			});
		});
	}

	function fsRmdir (dirPath) {
		return new Promise(function (resolve, reject) {
			getFs().rmdir(dirPath, function (err) {
				if (err) {
					reject(err);
				}
				else {
					resolve();
				}
			});
		});
	}

	// Depth first, because BrowserFS has no recursive remove and rmdir refuses a folder
	// with anything in it.
	async function removeTree (targetPath) {
		if (await fsIsDirectory(targetPath)) {
			var entries = await fsReaddir(targetPath);
			for (var i = 0; i < entries.length; i++) {
				await removeTree(getPath().join(targetPath, entries[i]));
			}
			await fsRmdir(targetPath);
			return;
		}
		if (await fsStat(targetPath)) {
			await fsUnlink(targetPath);
		}
	}

	function normalizeManifest (raw, defaults) {
		if (!raw || !raw.id) {
			return null;
		}
		var files = [];
		if (Array.isArray(raw.files)) {
			files = raw.files.map(function (item) {
				if (typeof item === 'string') {
					return { path: item, hash: null };
				}
				return {
					path: item.path,
					hash: item.hash || null
				};
			}).filter(function (item) {
				return !!item.path;
			});
		}
		var supportedExtensions = [];
		if (raw.supported && Array.isArray(raw.supported.extensions)) {
			supportedExtensions = raw.supported.extensions.slice();
		}
		else if (Array.isArray(raw.supportedExtensions)) {
			supportedExtensions = raw.supportedExtensions.slice();
		}
		return {
			id: raw.id,
			name: raw.name || raw.label || defaults && defaults.name || raw.id,
			version: raw.version || '1.0.0',
			entryPath: raw.entryPath || (defaults && defaults.entryPath) || null,
			icon: raw.icon || (defaults && defaults.icon) || null,
			needsNetwork: !!raw.needsNetwork,
			autosave: !!raw.autosave,
			files: files,
			supportedExtensions: supportedExtensions,
			supportedMimeTypes: Array.isArray(raw.supportedMimeTypes) ? raw.supportedMimeTypes.slice() : [],
			supportsText: !!raw.supportsText,
			update: raw.update || null,
			manifestPath: defaults && defaults.manifestPath || null
		};
	}

	async function loadAppManifest (manifestPath, source) {
		if (!manifestPath) {
			return null;
		}
		try {
			if (source === 'local') {
				var content = await fsReadFile(manifestPath);
				return normalizeManifest(JSON.parse(content.toString()), { manifestPath: manifestPath });
			}
			var url = getPath().join(getScope(), manifestPath) + '?' + Math.random();
			var text = await fetch(url).then(function (r) {
				if (!r.ok) {
					throw new Error('HTTP ' + r.status);
				}
				return r.text();
			});
			return normalizeManifest(JSON.parse(text), { manifestPath: manifestPath });
		}
		catch (err) {
			console.error('loadAppManifest failed:', manifestPath, err);
			return null;
		}
	}

	function legacyCatalogToManifest (id, raw) {
		if (!raw) {
			return null;
		}
		var files = Array.isArray(raw.files) ? raw.files.map(function (item) {
			return { path: item, hash: null };
		}) : [];
		var entryPath = raw.entryPath || null;
		if (!entryPath && id !== 'base') {
			var indexFile = files.find(function (item) {
				return /\/index\.html$/.test(item.path);
			});
			entryPath = indexFile ? indexFile.path : null;
		}
		return normalizeManifest({
			id: id,
			name: raw.label || raw.name || id,
			version: raw.version || '1.0.0',
			entryPath: entryPath,
			files: files,
			supportedExtensions: raw.supportedExtensions,
			supportedMimeTypes: raw.supportedMimeTypes,
			supportsText: raw.supportsText
		});
	}

	async function loadCatalogFromRegistry () {
		var out = [];
		try {
			var registryUrl = getPath().join(getScope(), '/apps/registry.json') + '?' + Math.random();
			var registry = await fetch(registryUrl).then(function (r) {
				if (!r.ok) {
					throw new Error('HTTP ' + r.status);
				}
				return r.json();
			});
			var entries = Array.isArray(registry.apps) ? registry.apps : [];
			var manifests = await Promise.all(entries.map(function (entry) {
				var id = typeof entry === 'string' ? entry : entry.id;
				var manifestPath = typeof entry === 'object' && entry.manifestPath
					? entry.manifestPath
					: '/apps/' + id + '/pixos.app.json';
				return loadAppManifest(manifestPath, 'catalog').then(function (manifest) {
					if (!manifest) {
						return null;
					}
					manifest.source = 'catalog';
					manifest.manifestPath = manifestPath;
					return manifest;
				});
			}));
			out = manifests.filter(Boolean);
		}
		catch (err) {
			console.warn('registry.json unavailable, using legacy catalog', err);
		}
		return out;
	}

	function loadCatalogFromLegacy () {
		var catalog = deps.legacyCatalog || {};
		return Object.keys(catalog).map(function (id) {
			var manifest = legacyCatalogToManifest(id, catalog[id]);
			if (manifest) {
				manifest.source = 'catalog';
			}
			return manifest;
		}).filter(Boolean);
	}

	async function buildFilesListFromFs (appDir, appId) {
		var files = [];
		async function walk (dir, prefix) {
			var names = await fsReaddir(dir);
			for (var i = 0; i < names.length; i++) {
				var name = names[i];
				var full = getPath().join(dir, name);
				if (await isDirectory(full)) {
					await walk(full, prefix ? getPath().join(prefix, name) : name);
					continue;
				}
				var rel = prefix ? getPath().join(prefix, name) : name;
				var webPath = ('/apps/' + appId + '/' + rel).replace(/\\/g, '/');
				files.push({ path: webPath, hash: null });
			}
		}
		await walk(appDir, '');
		return files;
	}

	async function isDirectory (filePath) {
		return new Promise(function (resolve) {
			getFs().stat(filePath, function (err, stats) {
				resolve(!err && stats && stats.isDirectory && stats.isDirectory());
			});
		});
	}

	function catalogInstallFolders (catalogManifests) {
		var folders = new Set();
		(catalogManifests || []).forEach(function (manifest) {
			(manifest.files || []).forEach(function (entry) {
				var itemPath = typeof entry === 'string' ? entry : entry.path;
				var match = itemPath && itemPath.match(/^\/apps\/([^/]+)/);
				if (match) {
					folders.add(match[1]);
				}
			});
			if (manifest.entryPath) {
				var entryMatch = manifest.entryPath.match(/^\/apps\/([^/]+)/);
				if (entryMatch) {
					folders.add(entryMatch[1]);
				}
			}
		});
		return folders;
	}

	async function scanLocalAppsInFs (options) {
		options = options || {};
		var skipFolders = options.skipFolders || new Set();
		var appsDir = '/apps';
		var names;
		try {
			names = await fsReaddir(appsDir);
		}
		catch (err) {
			return [];
		}

		var records = await Promise.all(names.map(async function (folder) {
			if (skipFolders.has(folder) || RESERVED_IDS.indexOf(folder) > -1) {
				return null;
			}
			var dirPath = getPath().join(appsDir, folder);
			if (!(await isDirectory(dirPath))) {
				return null;
			}
			var manifestPath = getPath().join(dirPath, 'pixos.app.json');
			var indexPath = getPath().join(dirPath, 'index.html');
			var hasManifest = await fsStat(manifestPath);
			var hasIndex = await fsStat(indexPath);
			if (!hasManifest && !hasIndex) {
				return null;
			}
			var manifest = null;
			if (hasManifest) {
				manifest = await loadAppManifest(manifestPath, 'local');
			}
			var appId = (manifest && manifest.id) || folder;
			var entryPath = (manifest && manifest.entryPath) || getPath().join('/apps', appId, 'index.html');
			if (!(await fsStat(entryPath))) {
				return {
					id: appId,
					folder: folder,
					source: 'local',
					name: (manifest && manifest.name) || folder,
					icon: (manifest && manifest.icon) || null,
					version: (manifest && manifest.version) || '1.0.0',
					entryPath: entryPath,
					files: [],
					supportedExtensions: manifest ? manifest.supportedExtensions : [],
					supportedMimeTypes: manifest ? manifest.supportedMimeTypes : [],
					supportsText: manifest ? manifest.supportsText : false,
					needsNetwork: !!(manifest && manifest.needsNetwork),
				autosave: !!(manifest && manifest.autosave),
					autosave: !!(manifest && manifest.autosave),
					manifestPath: hasManifest ? manifestPath : null,
					localStatus: 'broken',
					status: 'broken'
				};
			}
			var files = manifest && manifest.files.length
				? manifest.files
				: await buildFilesListFromFs(dirPath, appId);
			return {
				id: appId,
				folder: folder,
				source: 'local',
				name: (manifest && manifest.name) || folder,
				icon: (manifest && manifest.icon) || null,
				version: (manifest && manifest.version) || '1.0.0',
				entryPath: entryPath,
				files: files,
				supportedExtensions: manifest ? manifest.supportedExtensions : [],
				supportedMimeTypes: manifest ? manifest.supportedMimeTypes : [],
				supportsText: manifest ? manifest.supportsText : false,
				// The third place a manifest field has to be listed by hand. Leaving it out
				// here means the shell sees the flag on a *catalog* app and not on the
				// installed copy -- which is every app you actually run.
				needsNetwork: !!(manifest && manifest.needsNetwork),
				manifestPath: hasManifest ? manifestPath : null,
				localStatus: 'active',
				status: 'active'
			};
		}));

		return records.filter(Boolean);
	}

	function manifestToAppRecord (manifest) {
		var supportedFilePath = (manifest.files || []).map(function (item) {
			return typeof item === 'string' ? item : item.path;
		}).find(function (item) {
			return /\/pixos_supported$/.test(item);
		}) || null;
		return {
			id: manifest.id,
			source: manifest.source || 'catalog',
			label: manifest.name || manifest.id,
			// Same value as `label`, which App Manager reads. Everything else in the
			// shell asks for `name`, and this record is the only thing it ever sees.
			name: manifest.name || manifest.id,
			icon: manifest.icon || null,
			// Enumerated, like every other field here -- this record is all the shell ever
			// sees of a manifest, and a field left out of this list silently does not exist.
			needsNetwork: !!manifest.needsNetwork,
			autosave: !!manifest.autosave,
			version: manifest.version || '1.0.0',
			entryPath: manifest.entryPath,
			files: manifest.files || [],
			manifestPath: manifest.manifestPath || null,
			manifest: manifest,
			supportedExtensions: manifest.supportedExtensions || [],
			supportedMimeTypes: manifest.supportedMimeTypes || [],
			supportsText: !!manifest.supportsText,
			supportedFilePath: supportedFilePath,
			folder: manifest.folder || manifest.id,
			localStatus: manifest.localStatus || null,
			status: manifest.status || 'catalog',
			supportStatus: (manifest.supportedExtensions && manifest.supportedExtensions.length) ? 'ready' : 'idle'
		};
	}

	async function buildAppRegistry () {
		if (buildRegistryPromise) {
			return buildRegistryPromise;
		}
		buildRegistryPromise = (async function () {
			var catalogManifests = await loadCatalogFromRegistry();
			if (!catalogManifests.length) {
				catalogManifests = loadCatalogFromLegacy();
			}
			var seenCatalogIds = {};
			catalogManifests.forEach(function (manifest) {
				seenCatalogIds[manifest.id] = manifest;
			});

			var catalogFolders = catalogInstallFolders(catalogManifests);
			var localApps = await scanLocalAppsInFs({ skipFolders: catalogFolders });
			var merged = {};
			catalogIds = new Set();
			localIds = new Set();

			catalogManifests.forEach(function (manifest) {
				if (manifest.id === 'base' || !manifest.entryPath) {
					return;
				}
				catalogIds.add(manifest.id);
				merged[manifest.id] = manifestToAppRecord(manifest);
				merged[manifest.id].status = 'catalog';
			});

			localApps.forEach(function (local) {
				localIds.add(local.id);
				if (seenCatalogIds[local.id]) {
					local.localStatus = 'id_conflict';
					local.status = 'id_conflict';
					var conflictKey = local.id + '::local';
					merged[conflictKey] = manifestToAppRecord(local);
					merged[conflictKey].id = local.id;
					merged[conflictKey].registryKey = conflictKey;
					return;
				}
				if (merged[local.id]) {
					return;
				}
				merged[local.id] = manifestToAppRecord(local);
			});

			appRegistry = merged;
			return appRegistry;
		})().finally(function () {
			buildRegistryPromise = null;
		});
		return buildRegistryPromise;
	}

	function getRegistryApps () {
		return Object.keys(appRegistry).map(function (key) {
			return appRegistry[key];
		});
	}

	function getApp (id, options) {
		options = options || {};
		if (appRegistry[id]) {
			return appRegistry[id];
		}
		if (options.includeLocalConflict) {
			var conflictKey = id + '::local';
			if (appRegistry[conflictKey]) {
				return appRegistry[conflictKey];
			}
		}
		return null;
	}

	function getCatalogApp (id) {
		var app = appRegistry[id];
		if (app && app.source === 'catalog') {
			return app;
		}
		var legacy = deps.legacyCatalog && deps.legacyCatalog[id];
		if (legacy) {
			var manifest = legacyCatalogToManifest(id, legacy);
			return manifest ? manifestToAppRecord(manifest) : null;
		}
		return null;
	}

	function getCatalogApps () {
		return getRegistryApps().filter(function (app) {
			return app.source === 'catalog' && !app.registryKey;
		});
	}

	function getInstallableApps () {
		return getRegistryApps().filter(function (app) {
			if (!app.entryPath) {
				return false;
			}
			if (app.source === 'catalog' && !app.registryKey) {
				return true;
			}
			if (app.source === 'local' && app.localStatus === 'active' && !app.registryKey) {
				return true;
			}
			return false;
		});
	}

	function getManagerApps () {
		return getRegistryApps().filter(function (app) {
			if (app.id === 'base') {
				return false;
			}
			return !!app.entryPath || app.localStatus === 'id_conflict' || app.localStatus === 'broken';
		}).map(function (app) {
			return Object.assign({}, app);
		});
	}

	function installedStatePath (appId) {
		return '/settings/installed-apps/' + appId + '.json';
	}

	async function loadInstalledState (appId) {
		if (installedStateCache[appId]) {
			return installedStateCache[appId];
		}
		var state = await deps.readJsonFile(installedStatePath(appId), null);
		if (state) {
			installedStateCache[appId] = state;
		}
		return state;
	}

	async function saveInstalledState (appId, state) {
		installedStateCache[appId] = state;
		await deps.ensureDir('/settings/installed-apps');
		await deps.writeFile(
			installedStatePath(appId),
			global.Buffer.from(JSON.stringify(state, null, 2))
		);
	}

	async function sha256Buffer (buffer) {
		var view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
		var digest = await global.crypto.subtle.digest('SHA-256', view);
		return 'sha256:' + Array.from(new Uint8Array(digest)).map(function (b) {
			return b.toString(16).padStart(2, '0');
		}).join('');
	}

	async function sha256FilePath (filePath) {
		var content = await fsReadFile(filePath);
		return sha256Buffer(content);
	}

	function fileListPaths (files) {
		return (files || []).map(function (item) {
			return typeof item === 'string' ? item : item.path;
		});
	}

	async function scanInstalledApps () {
		var records = await Promise.all(getRegistryApps().map(async function (app) {
			if (app.registryKey) {
				return null;
			}
			if (app.source === 'local') {
				if (app.localStatus !== 'active') {
					return null;
				}
				if (!app.entryPath || !(await fsStat(app.entryPath))) {
					return null;
				}
				var seededLocal = Array.isArray(app.supportedExtensions) ? app.supportedExtensions.slice() : [];
				var hasSupportFile = !!app.supportedFilePath;
				return {
					id: app.id,
					source: 'local',
					installed: true,
					version: app.version,
					// The fourth place this field has to be named by hand, and the second
					// one to have dropped it silently. These records are `window.apps`,
					// which is what the shell reads before launching anything.
					needsNetwork: !!app.needsNetwork,
					autosave: !!app.autosave,
					supportedExtensions: seededLocal.length ? seededLocal : null,
					supportStatus: seededLocal.length || !hasSupportFile ? 'ready' : 'idle',
					localStatus: app.localStatus
				};
			}
			if (!app.entryPath || !(await fsStat(app.entryPath))) {
				return null;
			}
			var state = await loadInstalledState(app.id);
			var seeded = Array.isArray(app.supportedExtensions) ? app.supportedExtensions.slice() : [];
			var hasSupport = !!app.supportedFilePath;
			return {
				id: app.id,
				source: 'catalog',
				installed: true,
				needsNetwork: !!app.needsNetwork,
				version: state && state.installedVersion ? state.installedVersion : app.version,
				installedVersion: state && state.installedVersion ? state.installedVersion : null,
				supportedExtensions: seeded.length ? seeded : null,
				supportStatus: seeded.length || !hasSupport ? 'ready' : 'idle',
				localModified: false,
				updateStatus: 'idle'
			};
		}));
		return records.filter(Boolean);
	}

	function validateLocalAppId (newId, oldId) {
		var errors = [];
		if (!newId || !LOCAL_ID_RE.test(newId)) {
			errors.push('ID must match ' + LOCAL_ID_RE);
		}
		if (newId && RESERVED_IDS.indexOf(newId) > -1) {
			errors.push('ID is reserved');
		}
		if (newId && catalogIds.has(newId)) {
			errors.push('ID conflicts with catalog app');
		}
		if (newId && localIds.has(newId) && newId !== oldId) {
			errors.push('ID is already used by another local app');
		}
		return {
			valid: errors.length === 0,
			errors: errors
		};
	}

	async function renameLocalApp (oldId, newId) {
		var validation = validateLocalAppId(newId, oldId);
		if (!validation.valid) {
			throw new Error(validation.errors.join('; '));
		}
		var localApp = getApp(oldId, { includeLocalConflict: true });
		if (!localApp || localApp.source !== 'local') {
			var conflict = appRegistry[oldId + '::local'];
			if (!conflict) {
				throw new Error('Local app not found: ' + oldId);
			}
			localApp = conflict;
		}
		var folder = localApp.folder || oldId;
		var fromDir = getPath().join('/apps', folder);
		var toDir = getPath().join('/apps', newId);
		if (await fsStat(toDir)) {
			throw new Error('Target folder already exists');
		}
		await fsRename(fromDir, toDir);
		var manifestPath = getPath().join(toDir, 'pixos.app.json');
		if (await fsStat(manifestPath)) {
			var manifestRaw = JSON.parse((await fsReadFile(manifestPath)).toString());
			manifestRaw.id = newId;
			if (manifestRaw.entryPath) {
				manifestRaw.entryPath = manifestRaw.entryPath.replace('/apps/' + oldId + '/', '/apps/' + newId + '/');
			}
			if (manifestRaw.files) {
				manifestRaw.files = manifestRaw.files.map(function (item) {
					if (typeof item === 'string') {
						return item.replace('/apps/' + oldId + '/', '/apps/' + newId + '/');
					}
					return Object.assign({}, item, {
						path: item.path.replace('/apps/' + oldId + '/', '/apps/' + newId + '/')
					});
				});
			}
			await deps.writeFile(manifestPath, global.Buffer.from(JSON.stringify(manifestRaw, null, 2)));
		}
		if (typeof deps.updateDefaultAppAssociations === 'function') {
			await deps.updateDefaultAppAssociations(oldId, newId);
		}
		await buildAppRegistry();
		return { id: newId, name: localApp.label };
	}

	async function installAppById (appId) {
		var app = getCatalogApp(appId);
		if (!app) {
			throw new Error('Unknown app: ' + appId);
		}
		if (!app.entryPath) {
			throw new Error('App ' + appId + ' is not installable');
		}
		var fileHashes = {};
		var paths = fileListPaths(app.files);
		for (var i = 0; i < paths.length; i++) {
			var itemPath = paths[i];
			var ab = await fetch(getPath().join(getScope(), itemPath) + '?' + Math.random()).then(function (r) {
				return r.arrayBuffer();
			});
			var buf = global.Buffer.from(ab);
			await deps.writeFile(itemPath, buf);
			var manifestEntry = (app.files || []).find(function (entry) {
				return (typeof entry === 'string' ? entry : entry.path) === itemPath;
			});
			var expectedHash = manifestEntry && typeof manifestEntry !== 'string' ? manifestEntry.hash : null;
			fileHashes[itemPath] = expectedHash || await sha256Buffer(buf);
		}
		var manifestUrl = null;
		if (app.manifest && app.manifest.update && app.manifest.update.url) {
			manifestUrl = app.manifest.update.url;
		}
		else if (app.manifestPath) {
			manifestUrl = getPath().join(getScope(), app.manifestPath);
		}
		await saveInstalledState(appId, {
			id: appId,
			installedVersion: app.version,
			installedAt: new Date().toISOString(),
			manifestUrl: manifestUrl,
			fileHashes: fileHashes
		});
		return {
			id: appId,
			name: app.label,
			version: app.version
		};
	}

	// Which folder an app occupies. Not `dirname(entryPath)` -- an entry point one level
	// down would make that a *subfolder*, and this deletes what it is given. Always
	// /apps/<one segment>, and anything else is refused rather than guessed at.
	function appFolderFor (app) {
		var entry = String((app && app.entryPath) || '');
		var match = /^\/apps\/([^/]+)\//.exec(entry);
		return match ? '/apps/' + match[1] : null;
	}

	// The counterpart to installAppById, and the thing App Manager had no button for: the
	// only way to remove an app was to delete its folder in Explorer, which left the
	// registry believing it was still there until the next Rescan -- an app that had
	// stopped working and could not be got rid of.
	//
	// What it deliberately does not touch is /settings/preinstalled.json. That file
	// records what preinstall has already done, and the rule is that anything it put there
	// and the user then removed stays removed; clearing the record here would put the app
	// back on the next boot, which is the opposite of what was asked for.
	async function uninstallAppById (appId) {
		if (RESERVED_IDS.indexOf(appId) > -1) {
			throw new Error(appId + ' is part of PixOS itself and cannot be uninstalled');
		}
		var app = getApp(appId) || getCatalogApp(appId);
		if (!app) {
			throw new Error('Unknown app: ' + appId);
		}
		var folder = appFolderFor(app);
		if (!folder) {
			throw new Error('Cannot tell which folder ' + appId + ' occupies, so nothing '
				+ 'was removed. Delete it in Explorer and press Rescan apps.');
		}

		await removeTree(folder);
		await removeTree(installedStatePath(appId));
		delete installedStateCache[appId];

		// An association pointing at an app that is gone turns "open this file" into a
		// window that cannot load. Dropped rather than kept for a possible reinstall: the
		// file opens through the chooser again, which is a question, not a failure.
		if (typeof deps.updateDefaultAppAssociations === 'function') {
			await deps.updateDefaultAppAssociations(appId, null);
		}

		await buildAppRegistry();

		return {
			id: appId,
			name: app.label || app.name || appId,
			folder: folder
		};
	}

	async function detectLocalModifications (appId) {
		var state = await loadInstalledState(appId);
		if (!state || !state.fileHashes) {
			return { localModified: false, changedFiles: [] };
		}
		var changedFiles = [];
		var keys = Object.keys(state.fileHashes);
		for (var i = 0; i < keys.length; i++) {
			var filePath = keys[i];
			if (!(await fsStat(filePath))) {
				changedFiles.push(filePath);
				continue;
			}
			var currentHash = await sha256FilePath(filePath);
			if (currentHash !== state.fileHashes[filePath]) {
				changedFiles.push(filePath);
			}
		}
		return {
			localModified: changedFiles.length > 0,
			changedFiles: changedFiles
		};
	}

	async function checkAppUpdate (appId) {
		var app = getCatalogApp(appId);
		if (!app) {
			throw new Error('Unknown catalog app: ' + appId);
		}
		var state = await loadInstalledState(appId);
		if (!state) {
			return {
				updateAvailable: false,
				installedVersion: null,
				remoteVersion: null,
				localModified: false
			};
		}
		var updateUrl = (app.manifest && app.manifest.update && app.manifest.update.url)
			|| state.manifestUrl
			|| (app.manifestPath ? getPath().join(getScope(), app.manifestPath) : null);
		if (!updateUrl) {
			return {
				updateAvailable: false,
				installedVersion: state.installedVersion,
				remoteVersion: null,
				localModified: (await detectLocalModifications(appId)).localModified
			};
		}
		var remoteManifest;
		try {
			remoteManifest = await fetch(updateUrl + (updateUrl.indexOf('?') > -1 ? '&' : '?') + Math.random())
				.then(function (r) {
					return r.json();
				});
		}
		catch (err) {
			console.error(err);
			throw new Error('Failed to fetch update manifest');
		}
		var localMods = await detectLocalModifications(appId);
		return {
			updateAvailable: remoteManifest.version !== state.installedVersion,
			installedVersion: state.installedVersion,
			remoteVersion: remoteManifest.version,
			remoteManifest: remoteManifest,
			localModified: localMods.localModified,
			changedFiles: localMods.changedFiles
		};
	}

	async function updateAppById (appId, options) {
		options = options || {};
		var check = await checkAppUpdate(appId);
		if (!check.updateAvailable && !options.force) {
			return { updated: false, reason: 'no-update' };
		}
		if (check.localModified && !options.force) {
			return {
				updated: false,
				reason: 'local-modified',
				changedFiles: check.changedFiles
			};
		}
		var remote = check.remoteManifest;
		if (!remote) {
			throw new Error('No remote manifest for update');
		}
		var app = getCatalogApp(appId);
		var files = Array.isArray(remote.files) ? remote.files : [];
		var fileHashes = {};
		for (var i = 0; i < files.length; i++) {
			var entry = files[i];
			var itemPath = typeof entry === 'string' ? entry : entry.path;
			var ab = await fetch(getPath().join(getScope(), itemPath) + '?' + Math.random()).then(function (r) {
				return r.arrayBuffer();
			});
			var buf = global.Buffer.from(ab);
			await deps.writeFile(itemPath, buf);
			fileHashes[itemPath] = (typeof entry !== 'string' && entry.hash) || await sha256Buffer(buf);
		}
		var manifestUrl = (remote.update && remote.update.url)
			|| (app.manifest && app.manifest.update && app.manifest.update.url)
			|| stateManifestUrl(app);
		await saveInstalledState(appId, {
			id: appId,
			installedVersion: remote.version,
			installedAt: new Date().toISOString(),
			manifestUrl: manifestUrl,
			fileHashes: fileHashes
		});
		if (remote.supported && Array.isArray(remote.supported.extensions) && app) {
			app.supportedExtensions = remote.supported.extensions.slice();
		}
		return {
			updated: true,
			version: remote.version
		};
	}

	function stateManifestUrl (app) {
		if (app.manifest && app.manifest.update && app.manifest.update.url) {
			return app.manifest.update.url;
		}
		if (app.manifestPath) {
			return getPath().join(getScope(), app.manifestPath);
		}
		return null;
	}

	async function checkAllAppUpdates () {
		var results = {};
		var apps = getCatalogApps();
		for (var i = 0; i < apps.length; i++) {
			var app = apps[i];
			var installed = await fsStat(app.entryPath);
			if (!installed) {
				continue;
			}
			try {
				results[app.id] = await checkAppUpdate(app.id);
			}
			catch (err) {
				results[app.id] = { error: err.message || String(err) };
			}
		}
		return results;
	}

	global.PixosAppRegistry = {
		init: init,
		buildAppRegistry: buildAppRegistry,
		loadAppManifest: loadAppManifest,
		scanLocalAppsInFs: scanLocalAppsInFs,
		buildFilesListFromFs: buildFilesListFromFs,
		getApp: getApp,
		getCatalogApp: getCatalogApp,
		getCatalogApps: getCatalogApps,
		getInstallableApps: getInstallableApps,
		getManagerApps: getManagerApps,
		scanInstalledApps: scanInstalledApps,
		installAppById: installAppById,
		uninstallAppById: uninstallAppById,
		checkAppUpdate: checkAppUpdate,
		detectLocalModifications: detectLocalModifications,
		updateAppById: updateAppById,
		checkAllAppUpdates: checkAllAppUpdates,
		validateLocalAppId: validateLocalAppId,
		renameLocalApp: renameLocalApp,
		loadInstalledState: loadInstalledState,
		getReservedIds: function () {
			return RESERVED_IDS.slice();
		}
	};
}(typeof window !== 'undefined' ? window : global));
