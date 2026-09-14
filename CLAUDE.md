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
  `fs-events.js` the change signal every stale window
  needed (one wrap of the shared `fs`, coalesced),
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
  `apps/app-catalog.js` are both generated. Explorer is being taken apart by phase 21: its
  stylesheet is `apps/explorer/explorer.css`, and `apps/explorer/js/` holds the modules
  lifted out of `openExplorer` so far — `format.js` (pure: names, paths, sizes, escaping),
  `fs-helpers.js` (every promise wrapper around BrowserFS), `failure.js` (`report`,
  `guarded`, the errno translation and the two last-resort listeners), `open-with.js`
  (which app can open this file, and which one does by default), `context-menu.js` (drawing
  and placing a menu, not what is in one), `selection.js` (what is selected, and the rubber
  band), `dnd.js` (dragging rows onto a folder, and the three racing paths that must
  produce exactly one move — its timers are parameters so a test can move that clock by
  hand) and `recording.js` (screen recording: the audio graph that sums system sound and the
  microphone into one track, the two-pass stop, and the teardown that must reach every track
  on every route out — `getDisplayMedia`, `MediaRecorder`, `AudioContext` and the clock are
  all parameters, which is the only reason a recording can be driven with no browser) and
  `archive-ui.js` (the two archive dialogs and the operations behind them — when the 1.4 MB
  engine is fetched, what a wrong password does, and why extraction always makes a folder of
  its own; `importEngine` is a parameter because a dynamic import of a path literal is the one
  dependency a test cannot hand in) and `dialogs.js` (the node every modal is built into, the
  submit latch, where the focus lands, and the two default-app writes — **every dialog opens
  through its `openDialog`**, which wraps each `on*`-shaped callback, because a submit handler
  runs long after the action that opened it has returned) and `file-ops.js` (everything that
  puts a file somewhere: the move and copy loops, the staged replacement, and the one question
  they all ask when the name is taken — **asked before the write, never after**, because
  neither `writeFile` nor `fsRename` refuses an occupied name, so there is no error to catch,
  and for a dropped folder asked **once, about the root**, because that folder arrives one call
  per file and the question would otherwise be asked a few hundred times)
  and `menu-items.js` (what is *in* a context menu, as opposed to `context-menu.js`, which
  draws one: four builders returning an array of entries, with everything the shell owns —
  peers, bookmarks, the wallpaper — offered only when there is a shell to own it)
  and `view.js` (everything Explorer draws of itself: the one template `renderLayout` writes and
  the thirty nodes it then looks up in it by class, the order the rows go in, and the four
  redraws that follow a change in `state`) and `sidebar.js` (`renderSidebar` alone — the only
  render that draws something Explorer does not own, and the only one whose output is
  clickable) and `mounts.js` (the four mount actions and the one setting any of them remembers —
  `js/mount-manager.js` owns what a mount *is*, this owns what asking for one looks like: which
  dialog, what a refusal says, and the two steps every success takes **in that order**, draw the
  sidebar then go there). Nothing in `apps/explorer/js/`
  decides whether a file *is* an archive — that is `apps/7z/js/parse.js`, which is pure and is
  imported directly. `dialogs.js` and `archive-ui.js` genuinely need each other — the general
  machinery draws the archive dialogs and the archive module opens them through it — and
  `index.html` breaks that cycle at one point, by passing the two archive builders in
  late-bound; `failure.js` takes `openInfoDialog` the same way, being built first. `view.js` and
  `selection.js` are the second such pair, and the cycle is inherent rather than accidental —
  changing what is selected asks for a redraw and the redraw reads what is selected — so
  selection is built first and takes `renderStatus` and `renderToolbarState` late-bound.
  `mounts.js` and `sidebar.js` are the third pair, and the same shape: the sidebar draws the
  mounts and every mount action redraws the sidebar, so `mounts.js` — which `actions` is built
  from, and `sidebar.js` reads `actions` — takes `renderSidebar` late-bound.
  **`renderOverlays` stayed in `index.html`** although it is a render: it is the junction where
  context-menu and dialogs meet, and five modules call it, so moving it would mean five thunks
  to tidy seventeen lines. The
  construction order in `openExplorer` is load-bearing for one more reason: `file-ops.js` goes
  after `dialogs.js` (the conflict question is a dialog) and before `dnd.js`, `archive-ui.js`
  and `recording.js`, each of which writes a file through it — which is why none of those three
  needs a thunk.
  Each is a factory taking its dependencies as parameters — `fs`, `path`,
  `shell`, `win`, `nav`, `doc`, `rootElem` — and that is the whole reason any of them can be
  tested. **The context object is `state` and `ui`, passed by reference and nothing else**:
  they are the shared mutable pair, and a module writing `state.contextMenu` has to write
  the same object `index.html` reads. Every other dependency stays a named parameter — one
  bag holding everything would re-create the closure this phase exists to take apart. `actions` has not moved and is
  why the rest of the table is harder than these; `menu-items.js` and `sidebar.js` are built *after* it, at the
  bottom of the block rather than the top, because a menu entry reads `actions.copySelected` when
  the menu is built and every mount row carries an unmount button. The window's four boot lines —
  `renderLayout`, `bindEvents`, `watchForChanges`, the first `refreshCurrentDir` — sit below them
  for the same reason: **the window starts when every module exists**, and the first refresh draws
  the sidebar.
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
- `.nojekyll` — empty, one byte, and load-bearing. GitHub Pages runs every file beginning
  with a `---` front-matter block through Jekyll and publishes it as `.html`, which is how
  two of the four files in `templates/` came to 404 on a server that had them. Do not
  delete it; `tests/precache.test.mjs` checks it is there.
- `scripts/generate-apps-catalog.js` — writes every app manifest, `apps/registry.json`
  and `apps/app-catalog.js` (the fallback catalog) from one pass over `apps/`.
- `tests/` — plain node, no framework, no dependencies. `npm test`.
- `docs/*.ru.md` — architecture and how-to docs (Russian); the newer plans are `.md` English.
- **`docs/not-so-simple.md` — how this system actually behaves**, in sixteen sections: the
  things you would not predict from the code, each written after somebody lost an afternoon
  to it. Not loaded with this file, so it has to be opened; see below for what is in it.
- **`docs/backlog.md` — every open idea, with the reasoning.** Anything raised and not
  scheduled goes there, including things deliberately rejected and why. Read it before
  proposing work; move an item into a plan rather than copying it.
- `docs/ux-improvements-plan.md` (phases 1–5, built), `docs/reliability-plan.md`
  (phases 6–20, all built) and `docs/explorer-plan.md` (phases 21–24, planned) are the
  scheduled work, each phase with a browser checklist beside it
  (`docs/shell-phase<n>-checklist.md`).
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
  network-first and what it follows rather than lists, the error reporter the worker
  injects into every app document so a window that dies before its own script runs still
  says so, and the progress note a long operation draws in that same stack.
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
- *When a file changes underneath a window* — why no writer is asked to announce a
  write, the one `fs` that is wrapped instead and the one writer that cannot be,
  quiet-plus-maxWait coalescing, what a truncated batch is allowed to answer,
  `affects` versus `touches`, and why `watchFiles` takes the app's own window.
- *Storage, and what the browser will not keep* — eviction, the 128 MiB ceiling on a file,
  what a refused write does and does not tell you, and one spelling of a size.
- *Manifests, boot, and what a fresh system is made of* — generated manifests, the two the
  generator skips in silence, `preinstall.json`, and what a boot says on screen when it
  cannot fetch what it is made of.
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
`apps/explorer/**` — the generator skips reserved ids and says nothing. **Adding a file
under `apps/explorer/` means naming it in four lists**, none of which fails loudly:
that manifest, `settings/preinstall.json`, `PRECACHE` in `sw.js` (bump `SHELL_CACHE` too),
and `FALLBACK_PREINSTALL` in the shell's `index.html`. `tests/explorer-modules.test.mjs`
is what actually enforces it. `apps/app-manager`
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
