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
  `start-menu.js` + `command-palette.js` launchers, `overview.js` the all-windows
  overlay, `file-search.js` the tree walk behind it, `open-with.js` the chooser for a
  file with no default app, `bookmarks.js` the shell's half of `/settings/links.json`,
  `session.js` desktops/windows persistence, `tabs.js` (which tab may write the settings),
  `peers.js` the connection to another PixOS + `peers-panel.js` where one is made +
  `call-bar.js` the one surface a call is drawn on + `peer-fs.js` a shared folder as a
  BrowserFS backend,
  `fullscreen.js`, `app-icons.js`, `context-menu.js`. `js/goldenlayout/` and `js/peerjs/`
  hold only vendor bundles.
- `js/app-registry.js` — install / update / scan apps. `js/mount-manager.js` — zip, iso,
  native-dir and files3 mounts.
- `apps/7z/` — not an app: the archive engine Explorer uses. `js/parse.js` is pure (which
  files are archives, what 7-Zip's output means), `js/archive.js` runs it, `vendor/` holds
  JS7z with a `README.md` recording where it came from and why it is the single-threaded
  build.
- `apps/<id>/` — one folder per app, each with `index.html` + `pixos.app.json`; two also
  have a `vendor/` holding a whole library plus a `README.md` recording its provenance.
  `apps/explorer`, `apps/app-manager` are system apps; `apps/registry.json` and
  `apps/app-catalog.js` are both generated.
  `apps/calendar` (read-only month/year view) and `apps/system-info` (what this browser
  will say about the machine) are the destinations the desktop widgets lead to, and each
  keeps its logic in a pure module beside it — `js/calendar.js`, `js/probe.js` — because
  neither can be tested through its own DOM. `apps/filmoskop` is the slide app: a deck is a
  markdown file, `js/deck.js` holds everything that is not the DOM, and `vendor/` carries
  the comark parser and Prism. Its block palette is built in and extended by whatever is in
  `/settings/filmoskop-blocks`.
- `settings/preinstall.json` + `templates/` — what a fresh system is made of, served over
  HTTP rather than read from BrowserFS. See *Boot is data-driven* in
  `docs/not-so-simple.md`.
- `scripts/generate-apps-catalog.js` — writes every app manifest, `apps/registry.json`
  and `apps/app-catalog.js` (the fallback catalog) from one pass over `apps/`.
- `tests/` — plain node, no framework, no dependencies. `npm test`.
- `docs/*.ru.md` — architecture and how-to docs (Russian); the newer plans are `.md` English.
- **`docs/not-so-simple.md` — how this system actually behaves**, in fifteen sections: the
  things you would not predict from the code, each written after somebody lost an afternoon
  to it. Not loaded with this file, so it has to be opened; see below for what is in it.
- **`docs/backlog.md` — every open idea, with the reasoning.** Anything raised and not
  scheduled goes there, including things deliberately rejected and why. Read it before
  proposing work; move an item into a plan rather than copying it.
- `docs/ux-improvements-plan.md` (phases 1–5, built) and `docs/reliability-plan.md`
  (phases 6–19, all built) are the scheduled work, each phase with a browser
  checklist beside it (`docs/shell-phase<n>-checklist.md`).
- `files3/` — remote storage backend, mountable via `mount-manager`.

## Commands

    npm run generate-apps                 # rebuild every app manifest + registry.json
    npm run generate-apps -- --only=<id>  # just one app
    npm test                              # shell unit tests (node, no browser)
    python3 -m http.server 8000           # serve the repo root; a service worker needs http

Run the generator after changing anything inside `apps/`. It never writes manifests for
reserved ids (`explorer`, `app-manager`) — those are maintained by hand.

## Not-so-simple aspects

**They live in [`docs/not-so-simple.md`](docs/not-so-simple.md), and this file no longer
repeats them.** That is the reference for behaviour you would not predict from the code —
around forty paragraphs, each one written because somebody already lost an afternoon to it.
It is not loaded automatically the way this file is, so it has to be opened deliberately.

**Read the section covering whatever you are about to change, before you change it.** The
sections, and the kind of thing each one will catch:

- *Serving, offline, and saying when something failed* — the service worker and its query
  strings, the notification surface and its three layers in Explorer, `failure.js`,
  `needsNetwork` and the four record builders that keep dropping it, why the precache is
  network-first and what it follows rather than lists, and the error reporter the worker
  injects into every app document so a window that dies before its own script runs still
  says so.
- *Apps that carry their own engine* — 7-Zip's exit codes and staging rules, filmoskop's
  parser boundary and its two editors, and the two apps whose folder is not their id.
- *The desktop and its widgets* — peeks, widgets as doors, and who knows the desktop is
  visible.
- *Windows, desktops and sessions* — the five layers, why an iframe is never reparented,
  one windows container for every desktop, and what a session actually persists.
- *Getting around* — one model behind three launchers, keystroke bridging into iframes, the
  overview, and the file-search deadline.
- *Launching, and the app contract* — `launch(descriptor)`, `openFile`/`markDirty`/
  `saveFileLocal`, `autosave`, one tab owning the session, and `Ctrl/Cmd+W`.
- *Storage, and what the browser will not keep* — eviction, the 128 MiB ceiling on a file,
  what a refused write does and does not tell you, and one spelling of a size.
- *Manifests, boot, and what a fresh system is made of* — generated manifests, the two the
  generator skips in silence, and `preinstall.json`.
- *Frames that are not apps* — `launch({url})` and why every cross-origin iframe needs
  `credentialless`.
- *Frontmatter, parsed twice* — and why that is deliberate.
- *Peers: another machine* — the closed wire protocol, chat as a file, a call and its bar,
  and a shared folder as a mount.
- *The app system* — catalog versus local apps, the generated fallback catalog, why
  uninstalling is not install reversed, and how a renamed app keeps answering to its old
  name.
- *Opening a file* — the chooser, defaults, and the self-opening extensions.
- *The bookmarks document* — two writers, one owner, and a seeded starter.
- *Two smaller traps* — a clipboard that can refuse, and candidate-based extension matching.

## Boundaries

MUST: regenerate manifests (`npm run generate-apps`) after changing files under `apps/`
MUST: hand-update `apps/explorer/pixos.app.json` (hash + `version`) after changing
`apps/explorer/**` — the generator skips reserved ids and says nothing. `apps/app-manager`
has no manifest at all: it is copied in by `preinstall.json` with `refresh: true` on every
boot, so editing it needs nothing
MUST NOT: hand-edit `apps/registry.json` or `apps/app-catalog.js` — both are generated,
and the second rotted for a year because it was not
MUST: keep `npm test` green
MUST: read the matching section of `docs/not-so-simple.md` before changing an area it
covers — it is not loaded with this file, and every paragraph in it exists because the
obvious change breaks something that is not obvious
MUST: keep this file and `docs/not-so-simple.md` in English; update this one when the
project structure changes, and that one when the behaviour it describes does
MUST NOT: use git — see `AGENTS.md`
