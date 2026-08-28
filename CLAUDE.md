# PixOS

A desktop-like OS in the browser: a BrowserFS filesystem, a windowed shell, and apps that
run in iframes. Pure static site — no build step, no backend.

## Structure

- `index.html` — the shell: BrowserFS setup, the layer stack, app launching, file open/save,
  extension→app associations. Everything global lives here on `window`.
- `sw.js` — service worker serving the virtual filesystem under `/__browserfs__/...`.
- `js/shell/` — the shell's own modules (ES modules, loaded directly): `wm.js` window
  manager, `desktop.js` desktop layer, `taskbar.js`, `widgets.js`, `system-stats.js`
  (one poller for clock/storage/battery), `about.js` (`/home/about.md` for the About
  widget), `wallpaper.js` + `wallpaper-shader.js` background providers, `apps-model.js` +
  `start-menu.js` + `command-palette.js` launchers, `session.js` desktops/windows
  persistence, `app-icons.js`, `context-menu.js`. `js/goldenlayout/` holds only the vendor
  bundle now.
- `js/app-registry.js` — install / update / scan apps. `js/mount-manager.js` — zip, iso,
  native-dir and files3 mounts.
- `apps/<id>/` — one folder per app, each with `index.html` + `pixos.app.json`.
  `apps/explorer`, `apps/app-manager` are system apps; `apps/registry.json` is generated.
- `settings/preinstall.json` + `templates/` — what a fresh system is made of, served over
  HTTP rather than read from BrowserFS. See *Boot is data-driven* below.
- `scripts/generate-apps-catalog.js` — the manifest/registry generator.
- `tests/` — plain node, no framework, no dependencies. `npm test`.
- `docs/*.ru.md` — architecture and how-to docs (Russian); the newer plans are `.md` English.
- `files3/` — remote storage backend, mountable via `mount-manager`.

## Commands

    npm run generate-apps                 # rebuild every app manifest + registry.json
    npm run generate-apps -- --only=<id>  # just one app
    npm test                              # shell unit tests (node, no browser)
    python3 -m http.server 8000           # serve the repo root; a service worker needs http

Run the generator after changing anything inside `apps/`. It never writes manifests for
reserved ids (`explorer`, `app-manager`) — those are maintained by hand.

## Not-so-simple aspects

**Everything is served through the service worker.** App URLs look like
`/__browserfs__/apps/<id>/index.html`. `sw.js` strips the query string before *looking the
file up*, but the iframe's document URL keeps it — so an app can read its own `?params`, and
`treemap` (`?path=`), `media-player` (`?initPlaylist=`) and `transcriber` (`?audio=`) all do.
A directory URL without a trailing slash gets a redirect first, so relative `../` references
inside an app resolve either way.

**A peek ends the moment a window would be needed.** `desktop.js` drops the peek on the
WM's `opened` event, and the taskbar routes a window-button click through the shell's
`onShowWindow` rather than calling `focusWindow` directly. Without both, launching or
switching from any surface that stays reachable during a peek — the desktop menu, a
widget, the taskbar — puts a window behind the peek and reads as a dead click.

**The shell is five stacked layers**, `#desktop` / `#root` / `#windows` / `#taskbar` /
`#overlays`, and
z-index is the whole contract between them. GoldenLayout renders into `#root`, but the
iframes live in `#windows` and are positioned from the rects of empty placeholders inside
the layout. That indirection exists for one reason: **reparenting an iframe reloads it**, so
anything that hides, moves or rearranges a window must do it without touching the DOM node.
`#windows` is `position:fixed` at the viewport origin because those rects are viewport
coordinates — a transform or an offset parent there misplaces every window. `#root` is
inset at the bottom by `--pixos-taskbar-height`, which `taskbar.js` publishes.

**Desktops share one windows container.** Each desktop is its own GoldenLayout in its own
`.PixWorkspace` inside `#root`, but every iframe lives in the single `#windows`. Switching
hides one layout and shows another; moving a window between desktops moves its
*placeholder* and leaves the iframe alone. Nothing reloads either way. Two consequences to
respect: `syncGeometry` must skip windows on inactive desktops (a hidden layout reports a
zero rect, and writing it would lose the size), and anything that destroys a layout has to
set `wm.rebuilding` first — `destroy()` emits `itemDestroyed` for every pane, which is
otherwise indistinguishable from the user closing them all.

**Sessions persist ids, not just descriptors.** `session.js` saves each desktop's
GoldenLayout `toConfig()` alongside every window's launch descriptor, and the config
carries window ids — so restore reopens windows with their *saved* ids
(`openWindow({id, detached: true})`), then rebuilds the layout around them. Order matters:
records first, layout second, or the component factory runs before the records exist and
nothing binds. Restore reopens files, never in-app state. A `pixos-session-booting` flag in
`localStorage` guards against a restore that never *returns* (a hang or hard crash inside
it) — cleared the instant restore finishes, deliberately with no grace period, since any
delay makes an ordinary fast reload look like a crash. A session it rejects is moved to
`/settings/session-failed.json`, never deleted. `?clean=1` and the palette's *Start clean
session* are the manual escapes.

**Three launchers, one model.** The desktop menu, the start menu and the palette
(`Ctrl/Cmd+K`, or `Ctrl+Space`) all read `apps-model.js`, so they cannot disagree about
what exists or in what order. It wraps the shell's `listLaunchableApps()` with recency
(`/settings/recent-apps.json`, written by `openApp`) and a tiered matcher — exact, then
prefix, then word start, then initials, then substring, then subsequence. Add a launch
surface by reading the model, never by re-deriving the list.

**App icons are mostly generated.** `pixos.app.json` gains an `icon` when the generator
finds `favicon.svg` / `icon.svg` / `favicon.png` / `icon.png` in the app folder — and only
if that file is also in `files`, or installing would not copy it. Barely any app ships
one, so `app-icons.js`'s monogram fallback (initials on a colour hashed from the id) is
the normal case, not the exception.

**Every window opens through `launch(descriptor)`** in `index.html`. Per-app quirks live in
the `APP_LAUNCHERS` table (custom URL, extra iframe attributes, a `prepare` step before the
window exists, a `deliver` step on load) rather than as branches. `openFile`, `openFiles`,
`openPath` and `openApp` are wrappers over it. The descriptor is what a session restore will
replay, so anything a window needs in order to come back has to be expressible in it.

**App API.** The shell opens an app in an iframe, then calls
`iframe.contentWindow.openFile(src, name)` — `src` is a `/__browserfs__/...` path, `name` the
basename. To write back, an app calls `parent.saveFileLocal(path, content)`, which returns a
Promise (resolve = written path, reject = BrowserFS error) and needs a `Buffer`, not a Blob —
use the host's `parent.Buffer`. An app that may also run standalone should feature-detect the
parent rather than assume it.

**Manifests are generated, never hand-written.** `pixos.app.json` carries every file with a
SHA-256 hash; only identity fields (`id`, `name`, `version`, `entryPath`) are yours to edit.
Bump `version` or App Manager will not offer the update to existing installs. Known quirk:
the manifest's own self-hash can never converge (writing the hash changes the file), so it
mismatches in every app — that is expected, not a bug to chase.

**Boot is data-driven.** `settings/preinstall.json` — fetched over HTTP, because on a first
boot BrowserFS is empty — says which files to copy in (`refresh: true` re-copies every
boot, for the system apps and `registry.json`; everything else only when missing, so local
edits survive), which catalog apps to install, which user files to seed from `templates/`,
and which extensions get a default app. Seeds and defaults are applied **once** and never
reassert themselves: `/home/about.md` is yours the moment it exists, and a default app the
user changed is not changed back. One rule covers both halves — anything preinstall put
there and the user then removed stays removed: installed apps and seeded paths are both
recorded in `/settings/preinstalled.json` (`{apps, seeded}`; a bare array is the old form
and is still read), so neither an uninstalled app nor a deleted seed comes back. If
the file is unreachable the shell boots on `FALLBACK_PREINSTALL` in `index.html` — the two
system apps and the registry — rather than not at all.

**A window can hold a web page, not just a file.** `launch({url})` — via
`window.openUrl(url, title)`, reachable from any app — is the one launcher whose iframe src
is used verbatim instead of being resolved under `/__browserfs__`, and the only one that
wraps its iframe in a container rather than being one. Only `http(s)` is accepted, because
`openUrl` is callable from inside any app iframe and the shell's origin is not somewhere a
`javascript:` src should land. A site blocked by `X-Frame-Options` still fires `load` and
its document is cross-origin, so a refusal cannot be detected — hence the permanent bar
with an *Open in a browser tab* button rather than a fallback that triggers on a guess.

**Any cross-origin iframe needs `credentialless`.** `sw.js` stamps
`Cross-Origin-Embedder-Policy: credentialless` on every response, and COEP is inherited by
nested frames — so without the attribute a cross-origin frame is blocked before it loads,
reported in the console as *Cross-Origin-Resource-Policy is not set*, whatever the site's
own framing policy says. `apps/photopea` and the `WEB_VIEW` launcher both carry it. The
cost is that such a frame gets no cookies: a site you are signed in to renders signed out.

**Frontmatter is parsed in two places on purpose.** `js/shell/about.js` for the desktop
widget, `apps/markdown-viewer/js/markdown.js` for the app. An app is installed *into*
BrowserFS and must be self-contained, so the shell cannot share a module with one. Both
copies are covered by `npm test`; if you change the accepted syntax, change both.

**Two kinds of app.** *Catalog* apps live in `apps/`, are discovered via `registry.json`, and
must be installed (copied into BrowserFS). *Local* apps are folders the user creates under
`/apps/` inside BrowserFS and are active immediately. Ids must not collide.

**`apps/app-catalog.js` is a legacy fallback** used when `registry.json` is unreachable. The
generator reads it but never writes it, so its file lists rot silently and will install a
broken app. Update the relevant entry by hand when an app gains or loses files.

**Extension matching is candidate-based.** `getExtensionCandidates` in `index.html` expands a
path most-specific-first (`book.fb2.zip` → `['fb2.zip', 'zip']`), so an app can claim a
compound type without hijacking the trailing one, and a specific default beats a generic one.
Explorer keeps the plain trailing extension for archive mounting.

## Boundaries

MUST: regenerate manifests (`npm run generate-apps`) after changing files under `apps/`
MUST: keep `npm test` green
MUST: keep this file in English and update it when the project structure changes
MUST NOT: use git — see `AGENTS.md`
