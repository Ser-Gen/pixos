/**
 * Mount Manager — manages dynamic filesystem mounts (ZipFS, IsoFS, FileSystemAccess)
 * on top of BrowserFS MountableFileSystem.
 *
 * Usage:
 *   var mm = new MountManager(BrowserFS, fs);
 *   mm.mountZip(buffer, '/mnt/archive', 'myfile.zip', cb);
 *   mm.mountIso(buffer, '/mnt/disc', 'image.iso', cb);
 *   mm.mountNativeDir(handle, '/mnt/local', 'Projects', cb);
 *   mm.umount('/mnt/archive');
 *   mm.listMounts(); // [{mountPoint, type, name, readOnly}]
 */

(function (root) {
	'use strict';

	function MountManager (BrowserFS, fs) {
		this._BrowserFS = BrowserFS;
		this._fs = fs;
		this._mounts = {}; // mountPoint -> {type, name, readOnly}
	}

	MountManager.prototype._getRootFS = function () {
		return this._fs.getRootFS();
	};

	MountManager.prototype._notifySW = function () {
		if (navigator.serviceWorker && navigator.serviceWorker.controller) {
			navigator.serviceWorker.controller.postMessage({
				type: 'mountPoints',
				list: Object.keys(this._mounts)
			});
		}
	};

	MountManager.prototype._ensureMntDir = function (mountPoint, cb) {
		var fs = this._fs;
		var parts = mountPoint.split('/').filter(Boolean);
		var current = '';
		var i = 0;

		function next () {
			if (i >= parts.length) return cb(null);
			current += '/' + parts[i];
			i++;
			fs.stat(current, function (err, stat) {
				if (err) {
					fs.mkdir(current, function (mkErr) {
						if (mkErr && mkErr.code !== 'EEXIST') return cb(mkErr);
						next();
					});
				} else if (stat.isDirectory()) {
					next();
				} else {
					cb(new Error('Path ' + current + ' exists and is not a directory'));
				}
			});
		}
		next();
	};

	MountManager.prototype.mountZip = function (zipBuffer, mountPoint, name, cb) {
		var self = this;
		if (self._mounts[mountPoint]) {
			return cb(new Error('Mount point ' + mountPoint + ' is already in use'));
		}
		var BFS = self._BrowserFS;
		BFS.FileSystem.ZipFS.Create({zipData: zipBuffer}, function (err, zipFs) {
			if (err) return cb(err);
			try {
				self._getRootFS().mount(mountPoint, zipFs);
				self._mounts[mountPoint] = {type: 'zip', name: name || 'zip', readOnly: true};
				self._notifySW();
				cb(null);
			} catch (e) {
				cb(e);
			}
		});
	};

	MountManager.prototype.mountIso = function (isoBuffer, mountPoint, name, cb) {
		var self = this;
		if (self._mounts[mountPoint]) {
			return cb(new Error('Mount point ' + mountPoint + ' is already in use'));
		}
		var BFS = self._BrowserFS;
		BFS.FileSystem.IsoFS.Create({data: isoBuffer}, function (err, isoFs) {
			if (err) return cb(err);
			try {
				self._getRootFS().mount(mountPoint, isoFs);
				self._mounts[mountPoint] = {type: 'iso', name: name || 'iso', readOnly: true};
				self._notifySW();
				cb(null);
			} catch (e) {
				cb(e);
			}
		});
	};

	MountManager.prototype.mountNativeDir = function (handle, mountPoint, name, cb) {
		var self = this;
		if (self._mounts[mountPoint]) {
			return cb(new Error('Mount point ' + mountPoint + ' is already in use'));
		}
		var BFS = self._BrowserFS;
		if (!BFS.FileSystem.FileSystemAccess) {
			return cb(new Error('FileSystemAccess backend is not available'));
		}
		BFS.FileSystem.FileSystemAccess.Create({handle: handle}, function (err, nativeFs) {
			if (err) return cb(err);
			try {
				self._getRootFS().mount(mountPoint, nativeFs);
				self._mounts[mountPoint] = {type: 'native', name: name || 'local', readOnly: false};
				self._notifySW();
				cb(null);
			} catch (e) {
				cb(e);
			}
		});
	};

	MountManager.prototype.umount = function (mountPoint) {
		if (!this._mounts[mountPoint]) {
			throw new Error('Mount point ' + mountPoint + ' is not managed by MountManager');
		}
		this._getRootFS().umount(mountPoint);
		delete this._mounts[mountPoint];
		this._notifySW();
	};

	MountManager.prototype.isMountPoint = function (path) {
		return !!this._mounts[path];
	};

	MountManager.prototype.getMountInfo = function (path) {
		return this._mounts[path] || null;
	};

	MountManager.prototype.listMounts = function () {
		var self = this;
		return Object.keys(self._mounts).map(function (mp) {
			return {
				mountPoint: mp,
				type: self._mounts[mp].type,
				name: self._mounts[mp].name,
				readOnly: self._mounts[mp].readOnly
			};
		});
	};

	MountManager.prototype.suggestMountPoint = function (fileName) {
		var base = fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_\-\.]/g, '_');
		var mp = '/mnt/' + base;
		var suffix = 0;
		while (this._mounts[mp]) {
			suffix++;
			mp = '/mnt/' + base + '_' + suffix;
		}
		return mp;
	};

	root.MountManager = MountManager;
})(typeof window !== 'undefined' ? window : this);
