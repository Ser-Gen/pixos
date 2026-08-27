# PixOS

A desktop-like OS in the browser: a BrowserFS filesystem, a windowed shell, and apps that
run in iframes. Pure static site — no build step, no backend.

## Structure

- `index.html` — the shell: BrowserFS setup, window manager, app launching, file open/save,
  extension→app associations. Everything global lives here on `window`.
- `sw.js` — service worker serving the virtual filesystem under `/__browserfs__/...`.
- `js/app-registry.js` — install / update / scan apps. `js/mount-manager.js` — zip, iso,
  native-dir and files3 mounts.
- `apps/<id>/` — one folder per app, each with `index.html` + `pixos.app.json`.
  `apps/explorer`, `apps/app-manager` are system apps; `apps/registry.json` is generated.
- `scripts/generate-apps-catalog.js` — the manifest/registry generator.
- `docs/*.ru.md` — architecture and how-to docs (Russian).
- `files3/` — remote storage backend, mountable via `mount-manager`.

## Commands

    npm run generate-apps                 # rebuild every app manifest + registry.json
    npm run generate-apps -- --only=<id>  # just one app
    python3 -m http.server 8000           # serve the repo root; a service worker needs http

Run the generator after changing anything inside `apps/`.

## Not-so-simple aspects

**Everything is served through the service worker.** App URLs look like
`/__browserfs__/apps/<id>/index.html`. `sw.js` strips query strings before serving, and the
shell's iframes carry none — so an app cannot read its own `?params`. Anything an app needs
must arrive through the JS API below.

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
MUST: keep this file in English and update it when the project structure changes
MUST NOT: use git — see `AGENTS.md`
