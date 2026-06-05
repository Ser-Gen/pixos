/**
 * Mount Manager — manages dynamic filesystem mounts (ZipFS, IsoFS, FileSystemAccess)
 * on top of BrowserFS MountableFileSystem.
 *
 * Usage:
 *   var mm = new MountManager(BrowserFS, fs);
 *   mm.mountZip(buffer, '/mnt/archive', 'myfile.zip', cb);
 *   mm.mountIso(buffer, '/mnt/disc', 'image.iso', cb);
 *   mm.mountNativeDir(handle, '/mnt/local', 'Projects', cb);
 *   mm.mountFiles3(config, '/mnt/files3', 'Storage', cb);
 *   mm.umount('/mnt/archive');
 *   mm.listMounts(); // [{mountPoint, type, name, readOnly}]
 */

(function (root) {
	'use strict';

	function MountManager (BrowserFS, fs) {
		this._BrowserFS = BrowserFS;
		this._fs = fs;
		this._mounts = {}; // mountPoint -> {type, name, readOnly}
		this._pendingMounts = {}; // mountPoint -> true while mount in progress
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

	MountManager.prototype._beginMount = function (mountPoint, cb) {
		if (this._mounts[mountPoint]) {
			return cb(new Error('Mount point ' + mountPoint + ' is already in use'));
		}
		if (this._pendingMounts[mountPoint]) {
			return cb(new Error('Mount point ' + mountPoint + ' is already being mounted'));
		}
		this._pendingMounts[mountPoint] = true;
		return null;
	};

	MountManager.prototype._finishMount = function (mountPoint) {
		delete this._pendingMounts[mountPoint];
	};

	MountManager.prototype.mountZip = function (zipBuffer, mountPoint, name, cb) {
		var self = this;
		var beginErr = self._beginMount(mountPoint, cb);
		if (beginErr !== null) return;
		var BFS = self._BrowserFS;
		self._ensureMntDir(mountPoint, function (dirErr) {
			if (dirErr) {
				self._finishMount(mountPoint);
				return cb(dirErr);
			}
			BFS.FileSystem.ZipFS.Create({zipData: zipBuffer}, function (err, zipFs) {
				if (err) {
					self._finishMount(mountPoint);
					return cb(err);
				}
				try {
					self._getRootFS().mount(mountPoint, zipFs);
					self._mounts[mountPoint] = {type: 'zip', name: name || 'zip', readOnly: true};
					self._notifySW();
					self._finishMount(mountPoint);
					cb(null);
				} catch (e) {
					self._finishMount(mountPoint);
					cb(e);
				}
			});
		});
	};

	MountManager.prototype.mountIso = function (isoBuffer, mountPoint, name, cb) {
		var self = this;
		var beginErr = self._beginMount(mountPoint, cb);
		if (beginErr !== null) return;
		var BFS = self._BrowserFS;
		self._ensureMntDir(mountPoint, function (dirErr) {
			if (dirErr) {
				self._finishMount(mountPoint);
				return cb(dirErr);
			}
			BFS.FileSystem.IsoFS.Create({data: isoBuffer}, function (err, isoFs) {
				if (err) {
					self._finishMount(mountPoint);
					return cb(err);
				}
				try {
					self._getRootFS().mount(mountPoint, isoFs);
					self._mounts[mountPoint] = {type: 'iso', name: name || 'iso', readOnly: true};
					self._notifySW();
					self._finishMount(mountPoint);
					cb(null);
				} catch (e) {
					self._finishMount(mountPoint);
					cb(e);
				}
			});
		});
	};

	MountManager.prototype.mountFiles3 = function (config, mountPoint, name, cb) {
		var self = this;
		var beginErr = self._beginMount(mountPoint, cb);
		if (beginErr !== null) return;
		var BFS = self._BrowserFS;
		if (!BFS.FileSystem.Files3) {
			self._finishMount(mountPoint);
			return cb(new Error('Files3 backend is not available'));
		}
		var baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
		var rootFolderId = Number(config.rootFolderId);
		var localStorageId = config.localStorageId;
		var callbackUrl = config.callbackUrl;
		var onUnauthorized = config.onUnauthorized;

		if (!baseUrl) {
			self._finishMount(mountPoint);
			return cb(new Error('baseUrl is required'));
		}
		if (!rootFolderId || rootFolderId < 1) {
			self._finishMount(mountPoint);
			return cb(new Error('rootFolderId must be a positive number'));
		}
		if (!localStorageId) {
			self._finishMount(mountPoint);
			return cb(new Error('localStorageId is required'));
		}
		if (!callbackUrl) {
			self._finishMount(mountPoint);
			return cb(new Error('callbackUrl is required'));
		}

		var auth = new BFS.FileSystem.Files3.Auth({
			baseUrl: baseUrl,
			localStorageId: localStorageId
		});

		self._ensureMntDir(mountPoint, function (dirErr) {
			if (dirErr) {
				self._finishMount(mountPoint);
				return cb(dirErr);
			}

			auth.ensureToken({
				usePopup: true,
				callbackUrl: callbackUrl
			}).then(function () {
				BFS.FileSystem.Files3.Create({
					baseUrl: baseUrl,
					rootFolderId: rootFolderId,
					getToken: function () { return auth.getToken() || ''; },
					verifyToken: true,
					onUnauthorized: function () {
						auth.clearToken();
						if (typeof onUnauthorized === 'function') {
							onUnauthorized(mountPoint);
						}
					}
				}, function (err, files3Fs) {
					if (err) {
						self._finishMount(mountPoint);
						return cb(err);
					}
					try {
						self._getRootFS().mount(mountPoint, files3Fs);
						self._mounts[mountPoint] = {
							type: 'files3',
							name: name || 'Files3',
							readOnly: false,
							auth: auth,
							config: config
						};
						self._notifySW();
						self._finishMount(mountPoint);
						cb(null);
					} catch (e) {
						self._finishMount(mountPoint);
						cb(e);
					}
				});
			}).catch(function (err) {
				self._finishMount(mountPoint);
				cb(err instanceof Error ? err : new Error(String(err)));
			});
		});
	};

	MountManager.prototype.mountNativeDir = function (handle, mountPoint, name, cb) {
		var self = this;
		var beginErr = self._beginMount(mountPoint, cb);
		if (beginErr !== null) return;
		var BFS = self._BrowserFS;
		if (!BFS.FileSystem.FileSystemAccess) {
			self._finishMount(mountPoint);
			return cb(new Error('FileSystemAccess backend is not available'));
		}
		self._ensureMntDir(mountPoint, function (dirErr) {
			if (dirErr) {
				self._finishMount(mountPoint);
				return cb(dirErr);
			}
			BFS.FileSystem.FileSystemAccess.Create({handle: handle}, function (err, nativeFs) {
				if (err) {
					self._finishMount(mountPoint);
					return cb(err);
				}
				try {
					self._getRootFS().mount(mountPoint, nativeFs);
					self._mounts[mountPoint] = {type: 'native', name: name || 'local', readOnly: false};
					self._notifySW();
					self._finishMount(mountPoint);
					cb(null);
				} catch (e) {
					self._finishMount(mountPoint);
					cb(e);
				}
			});
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
