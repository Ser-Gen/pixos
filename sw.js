/**@license
 *   ___ ___ _____  __      __   _      _____              _           _
 *  / __|_ _|_   _| \ \    / /__| |__  |_   _|__ _ _ _ __ (_)_ _  __ _| |
 * | (_ || |  | |    \ \/\/ / -_) '_ \   | |/ -_) '_| '  \| | ' \/ _` | |
 *  \___|___| |_|     \_/\_/\___|_.__/   |_|\___|_| |_|_|_|_|_||_\__,_|_|
 *
 * this is service worker and it's part of GIT Web terminal
 *
 * Copyright (c) 2018 Jakub Jankiewicz <http://jcubic.pl/me>
 * Released under the MIT license
 *
 */
/* global BrowserFS, Response, setTimeout, fetch, Blob, Headers */
// self.importScripts('https://cdn.jsdelivr.net/npm/browserfs');
// self.importScripts('browserfs.1.4.3.js');
self.importScripts('browserfs.js');

// Mount points known to the SW — paths that should bypass local IndexedDB
// and go directly to the main thread via MessageChannel.
var mountPoints = [];

// Whether a request has actually failed, as opposed to what navigator.onLine believes.
// The two are not the same thing and the difference is visible: navigator.onLine reports
// whether the machine has a link, and under DevTools offline emulation it can still read
// `true` on the load immediately after the emulation is applied -- which is exactly the
// reload where the tray most needs to be right. A fetch that failed is not a belief.
var lastFetchFailed = false;

function setNetworkState (failed) {
	if (lastFetchFailed === failed) {
		return;
	}
	lastFetchFailed = failed;
	self.clients.matchAll({type: 'window'}).then(function (clients) {
		clients.forEach(function (client) {
			client.postMessage({type: 'pixos:network', online: !failed});
		});
	});
}

self.addEventListener('message', function(event) {
	if (event.data && event.data.type === 'mountPoints') {
		mountPoints = event.data.list || [];
	}
	// Asked once at boot, over a MessageChannel, because a page that loaded from the cache
	// missed the broadcast that said so -- it did not exist yet.
	if (event.data && event.data.type === 'pixos:network?' && event.ports && event.ports[0]) {
		event.ports[0].postMessage({type: 'pixos:network', online: !lastFetchFailed});
	}
});

function isOnMount(path) {
	for (var i = 0; i < mountPoints.length; i++) {
		if (path === mountPoints[i] || path.indexOf(mountPoints[i] + '/') === 0) {
			return true;
		}
	}
	return false;
}

function parseRangeHeader(rangeHeader, size) {
	var match = /^bytes=(\d+)-(\d*)$/i.exec((rangeHeader || '').trim());
	if (!match) {
		return null;
	}
	var start = parseInt(match[1], 10);
	var end = match[2] ? parseInt(match[2], 10) : size - 1;
	if (isNaN(start) || start >= size) {
		return null;
	}
	end = Math.min(end, size - 1);
	if (end < start) {
		return null;
	}
	return { start: start, end: end };
}

function bufferByteLength(buffer) {
	return buffer.byteLength !== undefined ? buffer.byteLength : buffer.length;
}

function sliceBuffer(buffer, start, end) {
	if (buffer.subarray) {
		return buffer.subarray(start, end + 1);
	}
	return buffer.slice(start, end + 1);
}

function isolationHeaders(extra) {
	var headers = extra || new Headers();
	if (!(headers instanceof Headers)) {
		headers = new Headers(headers);
	}
	headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
	headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	return headers;
}

function withIsolationResponse(response) {
	if (!response || response.status === 0) {
		return response;
	}
	var headers = isolationHeaders(new Headers(response.headers));
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: headers
	});
}

function isAudioProxyRequest(requestUrl) {
	try {
		var pathname = new URL(requestUrl).pathname;
		return pathname === '/api/audio' || pathname.slice(-10) === '/api/audio';
	} catch (e) {
		return false;
	}
}

function fetchAudioProxy(request) {
	var requestUrl = new URL(request.url);
	var target = requestUrl.searchParams.get('url');
	if (!target) {
		return Promise.resolve(new Response('Missing url query parameter', {
			status: 400,
			headers: isolationHeaders()
		}));
	}
	var parsed;
	try {
		parsed = new URL(target);
	} catch (e) {
		return Promise.resolve(new Response('Invalid url', {
			status: 400,
			headers: isolationHeaders()
		}));
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return Promise.resolve(new Response('Only http/https URLs are allowed', {
			status: 400,
			headers: isolationHeaders()
		}));
	}
	return fetch(parsed.toString(), { credentials: 'omit' }).then(function (upstream) {
		var headers = isolationHeaders(new Headers(upstream.headers));
		headers.set('Access-Control-Allow-Origin', '*');
		return new Response(upstream.body, {
			status: upstream.status,
			statusText: upstream.statusText,
			headers: headers
		});
	}).catch(function () {
		return new Response('Proxy error', { status: 502, headers: isolationHeaders() });
	});
}

// ---------------------------------------------------------------------------------------
// Surviving the network being gone.
//
// Everything under /__browserfs__ was never on the network, so the filesystem has always
// worked offline. The shell that reads it did not: index.html and every module it imports
// came off the server, so pulling the plug meant PixOS did not degrade, it did not load.
//
// The strategy is **network first, cache second**, which is the opposite of the usual
// advice and deliberate. This repo is served straight off disk with no build step and no
// content hashing, so a cache-first worker would hand back yesterday's index.html after
// every edit and no reload would fix it. The cache here exists to survive the network
// being gone, not to be fast -- so it is only ever read when a fetch actually fails.
//
// The version in the cache name is the whole risk: skipWaiting() + clients.claim() means a
// new worker takes over immediately, and without a versioned name that would be a new
// worker serving a previous worker's assets. `activate` deletes every cache but this one.
var SHELL_CACHE = 'pixos-shell-v1';

// The shell itself. Catalog manifests are not listed -- there are twenty-five of them and
// the list would rot the first time an app was added -- they are read out of
// apps/registry.json at install time instead.
var PRECACHE = [
	'./',
	'./index.html',
	'./favicon.png',
	'./browserfs.js',
	'./js/jquery-1.11.1.min.js',
	'./js/mount-manager.js',
	'./js/app-registry.js',
	'./js/goldenlayout/goldenlayout.min.js',
	'./js/goldenlayout/goldenlayout-base.css',
	'./js/goldenlayout/goldenlayout-dark-theme.css',
	'./js/shell/about.js',
	'./js/shell/app-icons.js',
	'./js/shell/apps-model.js',
	'./js/shell/bookmarks.js',
	'./js/shell/command-palette.js',
	'./js/shell/context-menu.js',
	'./js/shell/desktop.js',
	'./js/shell/failure.js',
	'./js/shell/file-search.js',
	'./js/shell/fullscreen.js',
	'./js/shell/notifications.js',
	'./js/shell/open-with.js',
	'./js/shell/overview.js',
	'./js/shell/session.js',
	'./js/shell/start-menu.js',
	'./js/shell/system-stats.js',
	'./js/shell/tabs.js',
	'./js/shell/taskbar.js',
	'./js/shell/wallpaper-shader.js',
	'./js/shell/wallpaper.js',
	'./js/shell/widgets.js',
	'./js/shell/wm.js',
	'./apps/app-catalog.js',
	'./apps/file-type.19.0.0.js',
	'./apps/registry.json',
	// Boot reads these over HTTP every time, because on a first boot BrowserFS is empty.
	'./settings/preinstall.json',
	'./templates/about.md',
	'./templates/talk.deck.md',
	'./templates/thanks.block.md',
	'./apps/explorer/index.html',
	'./apps/explorer/favicon.svg',
	'./apps/app-manager/index.html',
	'./apps/app-manager/favicon.svg',
	// The archive rules, which preinstall re-copies on every boot so a fix reaches an
	// existing system. The engine beside them (vendor/js7z.wasm, 1.4 MB) is deliberately
	// not here: it is copied in once, when missing, and precaching it would put a
	// megabyte and a half into every boot for something most sessions never open.
	'./apps/7z/js/parse.js',
	'./apps/7z/js/archive.js'
];

// Both the boot sequence and the app registry append `?<random>` to defeat the HTTP cache,
// so keying on the full URL would store a fresh copy of every file on every boot and never
// find one again. The query string is dropped on the way in and on the way out.
function cacheKey (url) {
	var parsed = new URL(url, self.location.href);
	parsed.search = '';
	parsed.hash = '';
	return parsed.toString();
}

function isSameOrigin (url) {
	try {
		return new URL(url, self.location.href).origin === self.location.origin;
	} catch (e) {
		return false;
	}
}

function precacheCatalogManifests (cache) {
	return fetch(new Request('./apps/registry.json', {cache: 'reload'})).then(function (response) {
		if (!response.ok) {
			throw new Error('registry.json: HTTP ' + response.status);
		}
		return response.json();
	}).then(function (registry) {
		var entries = Array.isArray(registry.apps) ? registry.apps : [];
		return Promise.all(entries.map(function (entry) {
			var manifestPath = (entry && entry.manifestPath)
				|| ('/apps/' + (typeof entry === 'string' ? entry : entry.id) + '/pixos.app.json');
			return cacheOne(cache, '.' + manifestPath);
		}));
	}).catch(function (err) {
		console.warn('precache: catalog manifests skipped', err);
	});
}

// One at a time, and a failure is a warning rather than the end of the install: cache.addAll
// rejects the whole batch if a single path 404s, and a shell that cached forty of its
// forty-five files is worth immeasurably more than one that cached none.
function cacheOne (cache, url) {
	return fetch(new Request(url, {cache: 'reload'})).then(function (response) {
		if (!response.ok) {
			throw new Error('HTTP ' + response.status);
		}
		return cache.put(cacheKey(url), response);
	}).catch(function (err) {
		console.warn('precache: ' + url + ' failed', err);
	});
}

// Network first. The cache is consulted only when the fetch itself fails, which is the
// only signal a page has that it is offline for real.
function isProbe (url) {
	return url.indexOf('__pixos-probe=') > -1;
}

function shellFetch (request) {
	// The shell asks this question directly while it believes it is offline, because
	// nothing else will tell it the network is back if the browser does not fire the
	// `online` event. A probe answered out of the cache would answer "online" forever, so
	// it is never cached and never falls back.
	var probe = isProbe(request.url);

	return fetch(request).then(function (response) {
		if (isSameOrigin(request.url)) {
			setNetworkState(false);
		}
		if (probe) {
			return withIsolationResponse(response);
		}
		if (request.method === 'GET' && isSameOrigin(request.url)
			&& response && response.ok && response.type !== 'opaque') {
			var copy = response.clone();
			caches.open(SHELL_CACHE).then(function (cache) {
				return cache.put(cacheKey(request.url), copy);
			}).catch(function () {
				// A full quota is not a reason to fail the request that is already served.
			});
		}
		return withIsolationResponse(response);
	}).catch(function (err) {
		if (isSameOrigin(request.url)) {
			setNetworkState(true);
		}
		if (probe) {
			return Promise.reject(err);
		}
		return caches.open(SHELL_CACHE).then(function (cache) {
			return cache.match(cacheKey(request.url)).then(function (hit) {
				if (hit) {
					return withIsolationResponse(hit);
				}
				// A navigation to a URL the cache has never seen -- '/?clean=1' handled by
				// the key, but also '/' when only './index.html' was stored. The shell is
				// the right answer to any navigation into it.
				if (request.mode === 'navigate') {
					return cache.match(cacheKey('./index.html')).then(function (shell) {
						return shell ? withIsolationResponse(shell) : Promise.reject(err);
					});
				}
				return Promise.reject(err);
			});
		});
	});
}

self.addEventListener('install', function (event) {
	event.waitUntil(caches.open(SHELL_CACHE).then(function (cache) {
		return Promise.all(PRECACHE.map(function (url) {
			return cacheOne(cache, url);
		})).then(function () {
			return precacheCatalogManifests(cache);
		});
	}));
	self.skipWaiting();
});

self.addEventListener('activate', function (event) {
	event.waitUntil(caches.keys().then(function (names) {
		return Promise.all(names.filter(function (name) {
			return name !== SHELL_CACHE;
		}).map(function (name) {
			return caches.delete(name);
		}));
	}).then(function () {
		return self.clients.claim();
	}));
});

self.addEventListener('fetch', function (event) {
    if (event.request.method === 'GET' && isAudioProxyRequest(event.request.url)) {
        event.respondWith(fetchAudioProxy(event.request));
        return;
    }

    // Somebody else's server: left entirely to the browser.
    //
    // This is not an optimisation, it is the difference between a cross-origin image
    // loading and not. The page is served with COEP: credentialless, and under that rule
    // the *browser* fetches a no-cors cross-origin subresource without credentials and
    // lets it through. A worker that intercepts the same request re-issues it as it
    // stands and hands back an opaque response, which then has to satisfy the stricter
    // check instead -- no CORP header, blocked, and nothing anywhere says why. Every
    // remote image in the system was failing on this.
    //
    // Nothing is lost by standing aside: a cross-origin response is opaque, so it was
    // never cached (see shellFetch), the isolation headers cannot be applied to it, and
    // the offline state is only ever judged from same-origin requests.
    if (!isSameOrigin(event.request.url)) {
        return;
    }

    // Everything that is not the virtual filesystem is the shell and its assets. Handled
    // up here rather than inside the BrowserFS promise below, so that fetching a
    // stylesheet no longer configures a filesystem it will never touch -- and so that
    // there is somewhere for the cache fallback to live.
    if (!/__browserfs__/.test(event.request.url)) {
        // Devtools issue these for sources they already hold. Responding at all turns
        // them into an error, so this one is left to the browser.
        if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') {
            return;
        }
        event.respondWith(shellFetch(event.request));
        return;
    }

    let path = BrowserFS.BFSRequire('path');
    let fs = new Promise(function(resolve, reject) {
        BrowserFS.configure({ fs: 'IndexedDB', options: {
		storeName: 'lol'
		} }, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(BrowserFS.BFSRequire('fs'));
            }
        });
    });
    event.respondWith(fs.then(function(fs) {
        return new Promise(function(resolve, reject) {
            // Ask the main thread to perform a FS operation via MessageChannel.
            // Used as fallback when the SW's own IndexedDB doesn't have the file
            // (e.g. the file is on a mounted ZipFS/IsoFS/FileSystemAccess).
            function askClient(msg) {
                return self.clients.matchAll({type: 'window'}).then(function(clients) {
                    if (!clients.length) {
                        return Promise.reject(new Error('No client available'));
                    }
                    var target = clients.find(function(c) { return c.frameType === 'top-level'; }) || clients[0];
                    return new Promise(function(resolve, reject) {
                        var timeout = setTimeout(function() {
                            reject(new Error('askClient timeout'));
                        }, 5000);
                        var ch = new MessageChannel();
                        ch.port1.onmessage = function(e) {
                            clearTimeout(timeout);
                            if (e.data.error) {
                                reject(new Error(e.data.error));
                            } else {
                                resolve(e.data);
                            }
                        };
                        target.postMessage(msg, [ch.port2]);
                    });
                });
            }

            var request = event.request;

            function makeFileResponse(buffer, filePath) {
                    var ext = filePath.replace(/.*\./, '');
                    var mime = {
                        'html': 'text/html',
                        'json': 'application/json',
                        'js': 'application/javascript',
                        'css': 'text/css',
						'mp4': 'video/mp4',
						'pdf': 'application/pdf',

                        // https://github.com/python/cpython/blob/main/Lib/mimetypes.py#L454
                        'js'     : 'text/javascript',
                        'mjs'    : 'text/javascript',
                        'json'   : 'application/json',
                        'webmanifest': 'application/manifest+json',
                        'doc'    : 'application/msword',
                        'dot'    : 'application/msword',
                        'wiz'    : 'application/msword',
                        'nq'     : 'application/n-quads',
                        'nt'     : 'application/n-triples',
                        'bin'    : 'application/octet-stream',
                        'a'      : 'application/octet-stream',
                        'dll'    : 'application/octet-stream',
                        'exe'    : 'application/octet-stream',
                        'o'      : 'application/octet-stream',
                        'obj'    : 'application/octet-stream',
                        'so'     : 'application/octet-stream',
                        'oda'    : 'application/oda',
                        'pdf'    : 'application/pdf',
                        'p7c'    : 'application/pkcs7-mime',
                        'ps'     : 'application/postscript',
                        'ai'     : 'application/postscript',
                        'eps'    : 'application/postscript',
                        'trig'   : 'application/trig',
                        'm3u'    : 'application/vnd.apple.mpegurl',
                        'm3u8'   : 'application/vnd.apple.mpegurl',
                        'xls'    : 'application/vnd.ms-excel',
                        'xlb'    : 'application/vnd.ms-excel',
                        'ppt'    : 'application/vnd.ms-powerpoint',
                        'pot'    : 'application/vnd.ms-powerpoint',
                        'ppa'    : 'application/vnd.ms-powerpoint',
                        'pps'    : 'application/vnd.ms-powerpoint',
                        'pwz'    : 'application/vnd.ms-powerpoint',
                        'wasm'   : 'application/wasm',
                        'data'   : 'application/octet-stream',
                        'bcpio'  : 'application/x-bcpio',
                        'cpio'   : 'application/x-cpio',
                        'csh'    : 'application/x-csh',
                        'dvi'    : 'application/x-dvi',
                        'gtar'   : 'application/x-gtar',
                        'hdf'    : 'application/x-hdf',
                        'h5'     : 'application/x-hdf5',
                        'latex'  : 'application/x-latex',
                        'mif'    : 'application/x-mif',
                        'cdf'    : 'application/x-netcdf',
                        'nc'     : 'application/x-netcdf',
                        'p12'    : 'application/x-pkcs12',
                        'pfx'    : 'application/x-pkcs12',
                        'ram'    : 'application/x-pn-realaudio',
                        'pyc'    : 'application/x-python-code',
                        'pyo'    : 'application/x-python-code',
                        'sh'     : 'application/x-sh',
                        'shar'   : 'application/x-shar',
                        'swf'    : 'application/x-shockwave-flash',
                        'sv4cpio': 'application/x-sv4cpio',
                        'sv4crc' : 'application/x-sv4crc',
                        'tar'    : 'application/x-tar',
                        'tcl'    : 'application/x-tcl',
                        'tex'    : 'application/x-tex',
                        'texi'   : 'application/x-texinfo',
                        'texinfo': 'application/x-texinfo',
                        'roff'   : 'application/x-troff',
                        't'      : 'application/x-troff',
                        'tr'     : 'application/x-troff',
                        'man'    : 'application/x-troff-man',
                        'me'     : 'application/x-troff-me',
                        'ms'     : 'application/x-troff-ms',
                        'ustar'  : 'application/x-ustar',
                        'src'    : 'application/x-wais-source',
                        'xsl'    : 'application/xml',
                        'rdf'    : 'application/xml',
                        'wsdl'   : 'application/xml',
                        'xpdl'   : 'application/xml',
                        'zip'    : 'application/zip',
                        '3gp'    : 'audio/3gpp',
                        '3gpp'   : 'audio/3gpp',
                        '3g2'    : 'audio/3gpp2',
                        '3gpp2'  : 'audio/3gpp2',
                        'aac'    : 'audio/aac',
                        'adts'   : 'audio/aac',
                        'loas'   : 'audio/aac',
                        'ass'    : 'audio/aac',
                        'au'     : 'audio/basic',
                        'snd'    : 'audio/basic',
                        'mp3'    : 'audio/mpeg',
                        'mp2'    : 'audio/mpeg',
                        'opus'   : 'audio/opus',
                        'aif'    : 'audio/x-aiff',
                        'aifc'   : 'audio/x-aiff',
                        'aiff'   : 'audio/x-aiff',
                        'ra'     : 'audio/x-pn-realaudio',
                        'wav'    : 'audio/x-wav',
                        'avif'   : 'image/avif',
                        'bmp'    : 'image/bmp',
                        'gif'    : 'image/gif',
                        'ief'    : 'image/ief',
                        'jpg'    : 'image/jpeg',
                        'jpe'    : 'image/jpeg',
                        'jpeg'   : 'image/jpeg',
                        'heic'   : 'image/heic',
                        'heif'   : 'image/heif',
                        'png'    : 'image/png',
                        'svg'    : 'image/svg+xml',
                        'tiff'   : 'image/tiff',
                        'tif'    : 'image/tiff',
                        'ico'    : 'image/vnd.microsoft.icon',
                        'webp'   : 'image/webp',
                        'ras'    : 'image/x-cmu-raster',
                        'pnm'    : 'image/x-portable-anymap',
                        'pbm'    : 'image/x-portable-bitmap',
                        'pgm'    : 'image/x-portable-graymap',
                        'ppm'    : 'image/x-portable-pixmap',
                        'rgb'    : 'image/x-rgb',
                        'xbm'    : 'image/x-xbitmap',
                        'xpm'    : 'image/x-xpixmap',
                        'xwd'    : 'image/x-xwindowdump',
                        'eml'    : 'message/rfc822',
                        'mht'    : 'message/rfc822',
                        'mhtml'  : 'message/rfc822',
                        'nws'    : 'message/rfc822',
                        'css'    : 'text/css',
                        'csv'    : 'text/csv',
                        'html'   : 'text/html',
                        'htm'    : 'text/html',
                        'md'     : 'text/markdown',
                        'markdown': 'text/markdown',
                        'n3'     : 'text/n3',
                        'txt'    : 'text/plain',
                        'bat'    : 'text/plain',
                        'c'      : 'text/plain',
                        'h'      : 'text/plain',
                        'ksh'    : 'text/plain',
                        'pl'     : 'text/plain',
                        'srt'    : 'text/plain',
                        'rtx'    : 'text/richtext',
                        'rtf'    : 'text/rtf',
                        'tsv'    : 'text/tab-separated-values',
                        'vtt'    : 'text/vtt',
                        'py'     : 'text/x-python',
                        'rst'    : 'text/x-rst',
                        'etx'    : 'text/x-setext',
                        'sgm'    : 'text/x-sgml',
                        'sgml'   : 'text/x-sgml',
                        'vcf'    : 'text/x-vcard',
                        'xml'    : 'text/xml',
                        'mp4'    : 'video/mp4',
                        'mpeg'   : 'video/mpeg',
                        'm1v'    : 'video/mpeg',
                        'mpa'    : 'video/mpeg',
                        'mpe'    : 'video/mpeg',
                        'mpg'    : 'video/mpeg',
                        'mov'    : 'video/quicktime',
                        'qt'     : 'video/quicktime',
                        'webm'   : 'video/webm',
                        'avi'    : 'video/x-msvideo',
                        'movie'  : 'video/x-sgi-movie',
                        'rtf' : 'application/rtf',
                        'midi': 'audio/midi',
                        'mid' : 'audio/midi',
                        'jpg' : 'image/jpg',
                        'pict': 'image/pict',
                        'pct' : 'image/pict',
                        'pic' : 'image/pict',
                        'xul' : 'text/xul',
                    };
                    var contentType = mime[ext] || 'application/octet-stream';
                    var size = bufferByteLength(buffer);
                    var rangeHeader = request.headers.get('Range');

                    if (rangeHeader) {
                        var range = parseRangeHeader(rangeHeader, size);
                        if (!range) {
                            return new Response(null, {
                                status: 416,
                                headers: isolationHeaders({
                                    'Content-Range': 'bytes */' + size
                                })
                            });
                        }
                        var slice = sliceBuffer(buffer, range.start, range.end);
                        return new Response(slice, {
                            status: 206,
                            headers: isolationHeaders({
                                'Accept-Ranges': 'bytes',
                                'Content-Length': String(range.end - range.start + 1),
                                'Content-Type': contentType,
                                'Content-Range': 'bytes ' + range.start + '-' + range.end + '/' + size
                            })
                        });
                    }

                    return new Response(buffer, {
                        headers: isolationHeaders({
                            'Accept-Ranges': 'bytes',
                            'Content-Length': String(size),
                            'Content-Type': contentType
                        })
                    });
            }

            function sendFileFromClient(path) {
                var decodedPath = decodeURIComponent(path);
                askClient({type: 'readFile', path: decodedPath}).then(function(data) {
                    resolve(makeFileResponse(new Uint8Array(data.buffer), path));
                }).catch(function() {
                    resolve(notFoundResponse(path));
                });
            }
            function sendFile(path) {
                var decodedPath = decodeURIComponent(path);
                if (isOnMount(decodedPath)) {
                    return sendFileFromClient(path);
                }
                fs.readFile(decodedPath, function(err, buffer) {
                    if (err) {
                        // Fallback: ask main thread (file may be on a mounted FS)
                        sendFileFromClient(path);
                        return;
                    }
                    resolve(makeFileResponse(buffer, path));
                });
            }
            var url = event.request.url;
            function redirect_dir() {
                return resolve(Response.redirect(url + '/', 301));
            }
            function serveFromClient(path) {
                var decodedPath = decodeURIComponent(path);
                askClient({type: 'stat', path: decodedPath}).then(function(data) {
                    if (data.isFile) {
                        askClient({type: 'readFile', path: decodedPath}).then(function(d) {
                            resolve(makeFileResponse(new Uint8Array(d.buffer), path));
                        }).catch(function() {
                            resolve(notFoundResponse(path));
                        });
                    } else if (data.isDirectory) {
                        if (path.substr(-1, 1) !== '/') {
                            return redirect_dir();
                        }
                        askClient({type: 'readdir', path: decodedPath}).then(function(d) {
                            if (d.list.includes('index.html')) {
                                serveFromClient(path + 'index.html');
                            } else {
                                resolve(textResponse(fileListingPage(path, d.list)));
                            }
                        }).catch(function() {
                            resolve(notFoundResponse(path));
                        });
                    }
                }).catch(function() {
                    resolve(notFoundResponse(path));
                });
            }
            function serve(path) {
                var decodedPath = decodeURIComponent(path);
                // If path is under a known mount point, skip local IndexedDB entirely
                if (isOnMount(decodedPath)) {
                    return serveFromClient(path);
                }
                fs.stat(decodedPath, function(err, stat) {
                    if (err) {
                        // Fallback: ask main thread for stat (file may be on a mounted FS)
                        askClient({type: 'stat', path: decodedPath}).then(function(data) {
                            if (data.isFile) {
                                sendFile(path);
                            } else if (data.isDirectory) {
                                if (path.substr(-1, 1) !== '/') {
                                    return redirect_dir();
                                }
                                // Ask main thread for readdir too
                                askClient({type: 'readdir', path: decodedPath}).then(function(data) {
                                    if (data.list.includes('index.html')) {
                                        sendFile(path + '/index.html');
                                    } else {
                                        // For directory listings on mounted FS, provide a simple listing
                                        resolve(textResponse(fileListingPage(path, data.list)));
                                    }
                                }).catch(function() {
                                    resolve(notFoundResponse(path));
                                });
                            }
                        }).catch(function() {
                            resolve(notFoundResponse(path));
                        });
                        return;
                    }
                    if (stat.isFile()) {
                        sendFile(path);
                    } else if (stat.isDirectory()) {
                        if (path.substr(-1, 1) !== '/') {
                            return redirect_dir();
                        }
                        fs.readdir(path, function(err, list) {
                            if (err) {
                                err.fn = 'readdir(' + path + ')';
                                return reject(err);
                            }
                            var len = list.length;
                            if (list.includes('index.html')) {
                                sendFile(path + '/index.html');
                            } else {
                                listDirectory({fs, path, list}).then(function(list) {
                                    resolve(textResponse(fileListingPage(path, list)));
                                }).catch(reject);
                            }
                        });
                    }
                });
            }
            var m = url.match(/__browserfs__(.*)/);
            var path = m[1];
            if (path === '') {
                return redirect_dir();
            }
            console.log('serving ' + path + ' from browserfs');
            serve(path.replace(/\?.*$/, ''));
        });
    }));
});
// -----------------------------------------------------------------------------
function listDirectory({fs, path, list}) {
    return new Promise(function(resolve, reject) {
        var items = [];
        (function loop() {
            var item = list.shift();
            if (!item) {
                return resolve(items);
            }
            fs.stat(path + '/' + item, function(err, stat) {
                if (err) {
                    err.fn = 'stat(' + path + '/' + item + ')';
                    return reject(err);
                }
                items.push(stat.isDirectory() ? item + '/' : item);
                loop();
            });
        })();
    });
}

// -----------------------------------------------------------------------------
function textResponse(string, status) {
    var blob = new Blob([string], {
        type: 'text/html'
    });
    return new Response(blob, {
        status: status || 200,
        statusText: status === 404 ? 'Not Found' : 'OK',
        headers: isolationHeaders({
            'Content-Type': 'text/html'
        })
    });
}

// A missing file has to answer with a real 404. It used to answer 200 with the page
// below as the body, which meant every fetch() of a filesystem path saw response.ok ===
// true and then tried to parse an HTML error page as its own content -- a first-run
// "file does not exist yet" was indistinguishable from a corrupt file.
function notFoundResponse(path) {
    return textResponse(error404Page(path), 404);
}

// -----------------------------------------------------------------------------
function fileListingPage(path, list) {
    var output = [
        '<!DOCTYPE html>',
        '<html>',
        '<style>',
        'body {background: #333; color: #fff}',
        'a {color: #a6beff}',
        '</style>',
        '<body>',
        `<h1>BrowserFS ${path}</h1>`,
        '<ul>'
    ];
    if (path.match(/^\/(.*\/)/)) {
        output.push('<li><a href="..">..</a></li>');
    }
    list.forEach(function(name) {
        output.push('<li><a href="' + name + '">' + name + '</a></li>');
    });
    output = output.concat(['</ul>', '</body>', '</html>']);
    return output.join('\n');
}

// -----------------------------------------------------------------------------
function error404Page(path) {
    var output = [
        '<!DOCTYPE html>',
        '<html>',
        '<body>',
        '<h1>404 File Not Found</h1>',
        `<p>File ${path} not found in browserfs`,
        '</body>',
        '</html>'
    ];
    return output.join('\n');
}
