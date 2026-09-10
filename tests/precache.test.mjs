// What the service worker keeps so the shell survives losing the network.
//
// A hand-written list of asset paths has exactly one failure mode, and it is silent: a
// file gets renamed, added or moved, the list still names the old one, and nobody notices
// until someone pulls the plug and the shell will not boot. Nothing at runtime can catch
// that — a missing entry is a file that quietly is not there when it is needed — so it is
// caught here instead, against the real index.html and the real directory listing.

import fs from 'fs';
import {check, report} from './assert.mjs';

const root = new URL('../', import.meta.url);
const sw = fs.readFileSync(new URL('sw.js', root), 'utf8');
const shell = fs.readFileSync(new URL('index.html', root), 'utf8');

const listed = (sw.match(/var PRECACHE = \[([\s\S]*?)\n\];/) || [, ''])[1]
	.split('\n')
	.map(line => (line.match(/'([^']+)'/) || [])[1])
	.filter(Boolean);

check('the list was found at all', listed.length > 10, true);

// --- everything named exists ---------------------------------------------------------

const missing = listed
	.filter(entry => entry !== './')
	.filter(entry => !fs.existsSync(new URL(entry.replace(/^\.\//, ''), root)));
check('every precached path is a file that exists', missing, []);

check('the scope root is cached, so a bare "/" navigation resolves offline',
	listed.includes('./'), true);

// --- everything the shell loads is named ----------------------------------------------

const referenced = [
	...shell.matchAll(/<script[^>]+src="([^"]+)"/g),
	...shell.matchAll(/<link[^>]+href="([^"]+)"/g)
].map(match => match[1])
	.filter(url => !/^https?:/.test(url));

const unlisted = referenced.filter(url => !listed.includes('./' + url.replace(/^\.?\//, '')));
check('every script and stylesheet index.html loads is precached', unlisted, []);

// The module graph, which no <script src> mentions: index.html imports ten of these and
// they import each other. Listing the directory is the only way to stay honest about it.
const shellModules = fs.readdirSync(new URL('js/shell/', root))
	.filter(name => name.endsWith('.js'))
	.map(name => './js/shell/' + name);
check('and every module in js/shell/', shellModules.filter(m => !listed.includes(m)), []);

// --- the files boot reads over HTTP every time ------------------------------------------
//
// preinstall.json is fetched on every boot because on a first boot BrowserFS is empty, and
// its `refresh: true` entries are re-copied every boot to track the served repo. Offline,
// each of those is a failed fetch — survivable, since the boot logs and carries on, but
// only because the copy already in the filesystem is good. Caching them keeps a *first*
// offline boot after an update from silently running yesterday's system apps.

const preinstall = JSON.parse(fs.readFileSync(new URL('settings/preinstall.json', root), 'utf8'));
// Every one of them, not only the `refresh: true` ones. A file copied in *when missing*
// is the worse case offline, not the better one: the copy fails, the retry next boot fails
// the same way, and the system stays without it until the network comes back — which is
// what left a first offline boot unable to extract an archive.
const preinstalled = preinstall.files.map(entry => '.' + entry.path);
check('every file preinstall copies into an empty filesystem is precached',
	preinstalled.filter(path => !listed.includes(path)), []);
check('the archive engine included, which used to be left out on bad arithmetic',
	listed.includes('./apps/7z/vendor/js7z.wasm'), true);

const seeds = preinstall.seed.map(entry => '.' + entry.from);
check('and every template it seeds from', seeds.filter(path => !listed.includes(path)), []);

// The other direction, which nothing checked: a `from` that names a file the repo does not
// have. A missing seed does not cost you a file, it costs you a folder -- /home exists only
// because a seed is written into it -- and until the note added on 2026-09-10 it cost you
// nothing visible at all.
check('and every template it names actually exists',
	preinstall.seed.filter(entry => !fs.existsSync(new URL('.' + entry.from, root))).map(entry => entry.from),
	[]);

// GitHub Pages runs Jekyll, and Jekyll's rule is about the *content*, not the extension:
// a file beginning with a `---` front-matter block is a page to be rendered, and a rendered
// markdown page is published as .html. That is why templates/about.md and
// templates/talk.deck.md 404'd on a server that had them, while thanks.block.md (no front
// matter) and links.json were served untouched -- and why /home did not exist on that
// machine at all. `.nojekyll` in the published root turns the whole processing step off.
//
// Renaming the extension is NOT a fix and is checked here so nobody tries it: Jekyll
// processes any extension once front matter is present, and *strips the front-matter block*
// from what it publishes. The URL would answer 200 with the half of about.md the About
// widget actually reads deleted -- a silent failure in place of a loud one.
const fenced = preinstall.seed
	.map(entry => entry.from)
	.filter(from => /^---(\r?\n)/.test(fs.readFileSync(new URL('.' + from, root), 'utf8')));
check('a template a Jekyll host would swallow is protected by .nojekyll',
	fenced.length === 0 || fs.existsSync(new URL('.nojekyll', root)), true);

check('preinstall.json itself is there', listed.includes('./settings/preinstall.json'), true);

// --- the preinstalled apps are followed too --------------------------------------------------
//
// A first boot with no network used to give you a shell and no apps: preinstall names five
// catalog apps, and installing one fetches every file in its manifest over HTTP. The
// manifests were cached and the files they name were not, which is the least useful half.
//
// Not a hand list, for the same reason the manifests are not: it would rot the first time
// somebody preinstalled a different app.
check('the worker follows preinstall.json to the apps it installs',
	/function precachePreinstalledApps/.test(sw), true);
check('and reads each manifest for the files to keep',
	/function precacheAppFiles[\s\S]{0,400}manifest\.files/.test(sw), true);
check('it runs as part of the install, not on a later boot',
	/precacheCatalogManifests\(cache\);[\s\S]{0,120}precachePreinstalledApps\(cache\)/.test(sw), true);
check('none of those app files is listed by hand either', preinstall.apps
	.filter(id => listed.some(entry => entry.indexOf('./apps/' + id + '/') === 0)), []);
// A failure there must not take the whole install down with it: a shell that cached forty
// of its forty-five files is worth immeasurably more than one that cached none.
check('and a manifest it cannot read is a warning, not the end of the install',
	/precache: ' \+ id \+ ' skipped'/.test(sw), true);

// --- catalog manifests are followed, not listed -------------------------------------------
//
// Twenty-five of them, one per app, and a twenty-sixth the day someone adds an app. The
// worker reads apps/registry.json at install time and follows it instead.

const catalogIds = JSON.parse(fs.readFileSync(new URL('apps/registry.json', root), 'utf8')).apps;
check('there are enough manifests that listing them by hand would rot',
	catalogIds.length > 10, true);
check('so none of them is listed by hand',
	listed.filter(entry => /pixos\.app\.json$/.test(entry)), []);
check('and the worker follows the registry instead',
	/precacheCatalogManifests/.test(sw), true);

// --- the versioning that makes any of this safe ---------------------------------------------
//
// skipWaiting() + clients.claim() hand control to a new worker immediately. With a cache
// and an unversioned name that is a new worker serving the previous worker's assets, which
// no reload can fix.

check('the cache name carries a version', /var SHELL_CACHE = 'pixos-shell-v\d+'/.test(sw), true);
check('and activate deletes every cache that is not it',
	/caches\.keys\(\)[\s\S]{0,300}name !== SHELL_CACHE[\s\S]{0,200}caches\.delete/.test(sw), true);

// Network first, deliberately: this repo is served straight off disk with no build step and
// no content hashing, so cache-first would serve a stale shell after every edit.
check('the cache is only read when a fetch fails',
	/return fetch\(request\)\.then[\s\S]{0,900}\}\)\.catch\(function \(err\) \{[\s\S]{0,200}caches\.open\(SHELL_CACHE\)/.test(sw),
	true);
check('the query string is dropped from cache keys, or every boot would store a new copy',
	/function cacheKey[\s\S]{0,200}parsed\.search = '';/.test(sw), true);
check('the virtual filesystem is left alone', /if \(!\/__browserfs__\/\.test\(event\.request\.url\)\)/.test(sw), true);

// --- the worker is also the only honest source on whether the network is there ----------
//
// navigator.onLine reports whether the machine has a link, and on a reload under DevTools
// offline emulation it can still read `true` — which is the one moment the tray cannot be
// corrected by an event afterwards. The worker knows whether a request actually failed.

check('a failed fetch is recorded, not just recovered from',
	/\.catch\(function \(err\) \{\s*if \(isSameOrigin\(request\.url\)\) \{\s*setNetworkState\(true\)/.test(sw), true);
check('and a successful one clears it', /setNetworkState\(false\)/.test(sw), true);
check('a page that booted from the cache can ask, having missed the broadcast',
	/'pixos:network\?'/.test(sw), true);
const systemStats = fs.readFileSync(new URL('js/shell/system-stats.js', root), 'utf8');
check('and the shell asks it', /'pixos:network\?'/.test(systemStats), true);

// The probe: how the shell finds out the network is back when nothing tells it. Switching
// DevTools throttling off does not reliably fire `online`, so waiting to be told left the
// tray stuck on OFFLINE until something else happened to be downloaded.
check('the shell probes while it believes it is offline', /__pixos-probe=/.test(systemStats), true);
check('and the worker refuses to answer a probe from the cache',
	/if \(probe\) \{\s*return Promise\.reject\(err\);/.test(sw), true);
check('or to store one', /if \(probe\) \{\s*return withIsolationResponse\(response\);/.test(sw), true);

// --- no app loads itself from a CDN without saying so ------------------------------------
//
// `needsNetwork` is a promise made to the user: launch this offline and you will be told
// why it will not work. The other half of that promise is that an app *without* the flag
// really does work offline — and an app can break it by having a single <script src> added
// to it, with nothing at all to notice. So the two are checked against each other here.

const appsDir = new URL('apps/', root);
const offenders = [];
for (const name of fs.readdirSync(appsDir)) {
	const index = new URL(name + '/index.html', appsDir);
	const manifest = new URL(name + '/pixos.app.json', appsDir);
	if (!fs.existsSync(index) || !fs.existsSync(manifest)) {
		continue;
	}
	if (JSON.parse(fs.readFileSync(manifest, 'utf8')).needsNetwork) {
		continue;
	}
	// Explorer's peerjs is the one deliberate exception: only its file-sharing feature
	// needs it, so flagging the app would warn on every offline boot for a feature most
	// sessions never touch. See docs/backlog.md.
	if (name === 'explorer') {
		continue;
	}
	const remote = [...fs.readFileSync(index, 'utf8')
		.matchAll(/<(?:script|link)[^>]+(?:src|href)="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
	if (remote.length) {
		offenders.push(name + ' -> ' + remote[0]);
	}
}
check('an app with no needsNetwork flag loads nothing from the internet', offenders, []);

// The two this phase vendored. Named explicitly, because the check above would also pass
// if someone simply added the flag back instead of keeping the files.
for (const app of ['monaco-cdn', 'tinymce-cdn']) {
	const manifest = JSON.parse(fs.readFileSync(new URL('apps/' + app + '/pixos.app.json', root), 'utf8'));
	check(app + ' is not flagged as needing the network', !manifest.needsNetwork, true);
	check('and ships its own copy of what it loads',
		manifest.files.filter(entry => entry.path.includes('/vendor/')).length > 50, true);
	check(app + ' records where that copy came from',
		fs.existsSync(new URL('apps/' + app + '/vendor/README.md', root)), true);
}

process.exit(report('precache') ? 1 : 0);
