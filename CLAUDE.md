# PixOS

A desktop-like OS in the browser: a BrowserFS filesystem, a windowed shell, and apps that
run in iframes. Pure static site — no build step, no backend.

## Structure

- `index.html` — the shell: BrowserFS setup, the layer stack, app launching, file open/save,
  extension→app associations. Everything global lives here on `window`.
- `sw.js` — service worker serving the virtual filesystem under `/__browserfs__/...`.
- `js/shell/` — the shell's own modules (ES modules, loaded directly): `wm.js` window
  manager, `desktop.js` desktop layer, `wallpaper.js` background providers,
  `context-menu.js`. `js/goldenlayout/` holds only the vendor bundle now.
- `js/app-registry.js` — install / update / scan apps. `js/mount-manager.js` — zip, iso,
  native-dir and files3 mounts.
- `apps/<id>/` — one folder per app, each with `index.html` + `pixos.app.json`.
  `apps/explorer`, `apps/app-manager` are system apps; `apps/registry.json` is generated.
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

**The shell is four stacked layers**, `#desktop` / `#root` / `#windows` / `#overlays`, and
z-index is the whole contract between them. GoldenLayout renders into `#root`, but the
iframes live in `#windows` and are positioned from the rects of empty placeholders inside
the layout. That indirection exists for one reason: **reparenting an iframe reloads it**, so
anything that hides, moves or rearranges a window must do it without touching the DOM node.
`#windows` is `position:fixed` at the viewport origin because those rects are viewport
coordinates — a transform or an offset parent there misplaces every window.

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
