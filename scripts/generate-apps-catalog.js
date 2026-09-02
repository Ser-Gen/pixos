#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var REPO_ROOT = path.resolve(__dirname, '..');
var APPS_DIR = path.join(REPO_ROOT, 'apps');
var CONFIG_PATH = path.join(__dirname, 'apps-catalog.config.json');
var CATALOG_JS = path.join(APPS_DIR, 'app-catalog.js');
var REGISTRY_PATH = path.join(APPS_DIR, 'registry.json');
var SKIP_FILE_NAMES = {
	'.DS_Store': true,
	'Thumbs.db': true,
	'desktop.ini': true
};

function parseCliArgs () {
	var only = null;
	var argv = process.argv.slice(2);
	for (var i = 0; i < argv.length; i++) {
		var arg = argv[i];
		if (arg === '--only' && argv[i + 1]) {
			only = argv[++i].split(',').map(function (s) { return s.trim(); }).filter(Boolean);
		}
		else if (arg.indexOf('--only=') === 0) {
			only = arg.slice('--only='.length).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
		}
	}
	return { only: only };
}

function shouldSkipFile (fileName) {
	return !!SKIP_FILE_NAMES[fileName];
}

function loadConfig () {
	var defaults = {
		baseUrl: '',
		exclude: ['app-manager'],
		reservedIds: ['base', 'explorer', 'app-manager', 'app-catalog'],
		hashAlgorithm: 'sha256'
	};
	if (!fs.existsSync(CONFIG_PATH)) {
		return defaults;
	}
	return Object.assign(defaults, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
}

function loadLegacyCatalog () {
	if (!fs.existsSync(CATALOG_JS)) {
		return {};
	}
	var sandbox = { window: {} };
	var code = fs.readFileSync(CATALOG_JS, 'utf8');
	vmRun(code, sandbox);
	return sandbox.window.PIXOS_APP_CATALOG || {};
}

function vmRun (code, sandbox) {
	var vm = require('vm');
	vm.runInNewContext(code, sandbox);
}

function sha256File (filePath) {
	var data = fs.readFileSync(filePath);
	return 'sha256:' + crypto.createHash('sha256').update(data).digest('hex');
}

function posixJoin () {
	var parts = Array.prototype.slice.call(arguments).filter(Boolean);
	return '/' + parts.join('/');
}

function toWebPath (absPath) {
	var rel = path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
	if (!rel.startsWith('/')) {
		rel = '/' + rel;
	}
	return rel;
}

function parsePixosSupported (filePath) {
	if (!fs.existsSync(filePath)) {
		return [];
	}
	return fs.readFileSync(filePath, 'utf8')
		.split(/\n/)
		.map(function (line) {
			line = line.trim();
			if (!line || line.charAt(0) === '#') {
				return '';
			}
			return line.replace(/^\./, '').toLowerCase();
		})
		.filter(Boolean);
}

function walkFiles (dir, list) {
	var entries = fs.readdirSync(dir, { withFileTypes: true });
	entries.forEach(function (entry) {
		if (shouldSkipFile(entry.name)) {
			return;
		}
		var full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walkFiles(full, list);
		}
		else if (entry.isFile()) {
			list.push(full);
		}
	});
}

function resolveAppDirFromCatalog (id, entry) {
	if (entry.entryPath) {
		return path.join(REPO_ROOT, path.dirname(entry.entryPath.replace(/^\//, '')));
	}
	var files = Array.isArray(entry.files) ? entry.files : [];
	var indexFile = files.find(function (f) {
		return /\/index\.html$/.test(f);
	});
	if (indexFile) {
		return path.join(REPO_ROOT, path.dirname(indexFile.replace(/^\//, '')));
	}
	var candidate = path.join(APPS_DIR, id);
	if (fs.existsSync(candidate)) {
		return candidate;
	}
	return null;
}

function readStubManifest (appDir, id, legacyEntry, config) {
	var manifestPath = path.join(appDir, 'pixos.app.json');
	var stub = {};
	if (fs.existsSync(manifestPath)) {
		try {
			stub = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
		}
		catch (e) {
			console.warn('Invalid JSON in', manifestPath, e.message);
		}
	}
	var folderId = path.basename(appDir);
	var entryPath = stub.entryPath || (legacyEntry && legacyEntry.entryPath) ||
		posixJoin('apps', folderId, 'index.html');
	if (!stub.id) {
		stub.id = legacyEntry && id !== folderId ? id : folderId;
	}
	if (!stub.name) {
		stub.name = (legacyEntry && (legacyEntry.name || legacyEntry.label)) || stub.id;
	}
	if (!stub.version) {
		stub.version = '1.0.0';
	}
	stub.entryPath = entryPath;
	if (legacyEntry && legacyEntry.supportsText && !stub.supportsText) {
		stub.supportsText = true;
	}
	if (legacyEntry && legacyEntry.supportedMimeTypes && !stub.supportedMimeTypes) {
		stub.supportedMimeTypes = legacyEntry.supportedMimeTypes;
	}
	if (!stub.update && config.baseUrl) {
		stub.update = {
			type: 'manifest',
			url: config.baseUrl.replace(/\/+$/, '') + '/apps/' + folderId + '/pixos.app.json'
		};
	}
	return stub;
}

function buildManifestBody (appDir, stub, config) {
	var manifestPath = path.join(appDir, 'pixos.app.json');
	var manifestWebPath = toWebPath(manifestPath);
	var files = [];
	walkFiles(appDir, files);
	var fileEntries = files
		.filter(function (abs) {
			return toWebPath(abs) !== manifestWebPath;
		})
		.map(function (abs) {
			return {
				path: toWebPath(abs),
				hash: sha256File(abs)
			};
		})
		.sort(function (a, b) {
			return a.path.localeCompare(b.path);
		});

	var supportedPath = path.join(appDir, 'pixos_supported');
	var extensions = parsePixosSupported(supportedPath);
	var manifest = {
		id: stub.id,
		name: stub.name,
		version: stub.version,
		entryPath: stub.entryPath,
		files: fileEntries
	};
	// An icon a hand-written stub declares wins; otherwise take the conventional
	// filename if the app has one. Either way it has to be among the files above, or
	// installing the app would not copy it and the launcher would show a broken image.
	var icon = stub.icon || detectAppIcon(appDir);
	if (icon && fileEntries.some(function (entry) { return entry.path === icon; })) {
		manifest.icon = icon;
	}
	if (extensions.length) {
		manifest.supported = { extensions: extensions };
	}
	if (stub.supportsText) {
		manifest.supportsText = true;
	}
	// Declared by hand in the stub: an app that loads part of itself from the network can
	// never work offline, and the shell would otherwise let it open and fail with a bare
	// "failed to fetch" that says nothing about why.
	if (stub.needsNetwork) {
		manifest.needsNetwork = true;
	}
	if (stub.autosave) {
		manifest.autosave = true;
	}
	if (stub.supportedMimeTypes) {
		manifest.supportedMimeTypes = stub.supportedMimeTypes;
	}
	if (stub.update) {
		manifest.update = stub.update;
	}
	return { manifest: manifest, manifestPath: manifestPath, manifestWebPath: manifestWebPath, fileEntries: fileEntries };
}

var ICON_FILE_NAMES = ['favicon.svg', 'icon.svg', 'favicon.png', 'icon.png'];

// Most-preferred first: SVG scales to whatever size the taskbar and the launcher want.
function detectAppIcon (appDir) {
	for (var i = 0; i < ICON_FILE_NAMES.length; i++) {
		var candidate = path.join(appDir, ICON_FILE_NAMES[i]);
		if (fs.existsSync(candidate)) {
			return toWebPath(candidate);
		}
	}
	return null;
}

function sortFileEntries (entries) {
	return entries.slice().sort(function (a, b) {
		return a.path.localeCompare(b.path);
	});
}

function writeManifestForDir (appDir, stub, config) {
	var built = buildManifestBody(appDir, stub, config);
	var manifest = built.manifest;
	var manifestPath = built.manifestPath;
	var manifestWebPath = built.manifestWebPath;
	var fileEntries = built.fileEntries;

	var selfHash = 'sha256:' + crypto.createHash('sha256')
		.update(JSON.stringify(manifest, null, 2) + '\n')
		.digest('hex');

	for (var pass = 0; pass < 8; pass++) {
		manifest.files = sortFileEntries(fileEntries.concat([{
			path: manifestWebPath,
			hash: selfHash
		}]));
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
		var nextHash = sha256File(manifestPath);
		if (nextHash === selfHash) {
			break;
		}
		selfHash = nextHash;
	}

	return manifest;
}

function shouldProcessApp (meta, onlyFilter) {
	if (!onlyFilter || !onlyFilter.length) {
		return true;
	}
	var folder = meta.id;
	var manifestId = meta.manifestId || folder;
	return onlyFilter.indexOf(folder) >= 0 || onlyFilter.indexOf(manifestId) >= 0;
}

function buildRegistryFromDirs (appDirs) {
	var registryApps = [];
	appDirs.forEach(function (meta, appDir) {
		var manifestPath = path.join(appDir, 'pixos.app.json');
		if (!fs.existsSync(manifestPath)) {
			return;
		}
		var manifest;
		try {
			manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
		}
		catch (e) {
			console.warn('Skipping invalid manifest', manifestPath, e.message);
			return;
		}
		if (manifest.entryPath && fs.existsSync(path.join(REPO_ROOT, manifest.entryPath.replace(/^\//, '')))) {
			registryApps.push({
				id: manifest.id || meta.id,
				manifestPath: toWebPath(manifestPath)
			});
		}
	});
	registryApps.sort(function (a, b) {
		return a.id.localeCompare(b.id);
	});
	return registryApps;
}

function discoverAppDirs (config, legacyCatalog) {
	var dirs = new Map();

	Object.keys(legacyCatalog).forEach(function (id) {
		if (id === 'base') {
			return;
		}
		var entry = legacyCatalog[id];
		var appDir = resolveAppDirFromCatalog(id, entry);
		if (appDir && fs.existsSync(appDir)) {
			dirs.set(appDir, { id: id, legacyEntry: entry });
		}
	});

	fs.readdirSync(APPS_DIR, { withFileTypes: true }).forEach(function (entry) {
		if (!entry.isDirectory()) {
			return;
		}
		if (config.exclude.indexOf(entry.name) >= 0) {
			return;
		}
		var appDir = path.join(APPS_DIR, entry.name);
		var hasIndex = fs.existsSync(path.join(appDir, 'index.html'));
		var hasManifest = fs.existsSync(path.join(appDir, 'pixos.app.json'));
		if (!hasIndex && !hasManifest) {
			return;
		}
		if (!dirs.has(appDir)) {
			dirs.set(appDir, { id: entry.name, legacyEntry: null });
		}
	});

	return dirs;
}

function main () {
	var cli = parseCliArgs();
	var config = loadConfig();
	var legacyCatalog = loadLegacyCatalog();
	var appDirs = discoverAppDirs(config, legacyCatalog);

	appDirs.forEach(function (meta, appDir) {
		var manifestPath = path.join(appDir, 'pixos.app.json');
		if (fs.existsSync(manifestPath)) {
			try {
				meta.manifestId = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).id;
			}
			catch (e) {
				meta.manifestId = meta.id;
			}
		}
		if (!shouldProcessApp(meta, cli.only)) {
			return;
		}
		var stub = readStubManifest(appDir, meta.id, meta.legacyEntry, config);
		var manifest = writeManifestForDir(appDir, stub, config);
		console.log('Wrote', path.relative(REPO_ROOT, manifestPath), '(' + manifest.files.length + ' files)');
	});

	var registryApps = buildRegistryFromDirs(appDirs);
	var registry = { version: 1, apps: registryApps };
	fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
	console.log('Wrote', path.relative(REPO_ROOT, REGISTRY_PATH), '(' + registryApps.length + ' apps)');
}

main();
