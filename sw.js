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

self.addEventListener('install', self.skipWaiting);

self.addEventListener('activate', self.skipWaiting);

self.addEventListener('fetch', function (event) {
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
            function sendFile(path) {
                fs.readFile(decodeURIComponent(path), function(err, buffer) {
                    if (err) {
                        err.fn = 'readFile(' + path + ')';
                        return reject(err);
                    }
                    var ext = path.replace(/.*\./, '');
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
                    var headers = new Headers({
                        'Content-Type': mime[ext],
                        'Cross-Origin-Embedder-Policy': 'require-corp',
                        'Cross-Origin-Opener-Policy': 'same-origin',
                    });
                    resolve(new Response(buffer, {headers}));
                });
            }
            var url = event.request.url;
            function redirect_dir() {
                return resolve(Response.redirect(url + '/', 301));
            }
            function serve(path) {
                fs.stat(decodeURIComponent(path), function(err, stat) {
                    if (err) {
                        return resolve(textResponse(error404Page(path)));
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
            if (m) {
                var path = m[1];
                if (path === '') {
                    return redirect_dir();
                }
                console.log('serving ' + path + ' from browserfs');
                serve(path.replace(/\?.*$/, ''));
            } else {
                if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') {
                    return;
                }
                //request = credentials: 'include'
                fetch(event.request).then(resolve).catch(reject);
            }
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
function textResponse(string, filename) {
    var blob = new Blob([string], {
        type: 'text/html'
    });
    return new Response(blob);
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
