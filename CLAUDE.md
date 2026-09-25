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
  widget), `wallpaper.js` + `wallpaper-shader.js` + `wallpaper-page.js` background providers (a
  colour, gradient, image, shader or screensaver page; each mount is a handle that pauses and
  unloads it), `wallpaper-dialog.js` the dialog that chooses the background and the screensaver
  (two tabs, one gallery; Explorer's *Preview* and *Set as…* go through it too), `screensaver.js` (when nobody is there — Chrome's idle detection or the
  input PixOS sees — and the layer that shows one and swallows the input that ends it), `apps-model.js` +
  `start-menu.js` + `command-palette.js` launchers, `overview.js` the all-windows
  overlay, `file-search.js` the tree walk behind it, `open-with.js` the chooser for a
  file with no default app, `bookmarks.js` the shell's half of `/settings/links.json` (every edit made to it from outside
  the Bookmarks app, one at a time, on `window` as `addBookmark`, `listBookmarks`, `removeBookmark`,
  `moveBookmark`, `renameBookmark` and `ensureBookmarkGroup`),
  `fs-events.js` the change signal every stale window
  needed (one wrap of the shared `fs`, coalesced),
  `session.js` desktops/windows persistence, `mount-table.js` (the mount table written to
  `/settings/mounts.json` and brought back at boot, before the session), `tabs.js` (which tab
  may write the settings),
  `peers.js` the connection to another PixOS + `peers-panel.js` where one is made +
  `call-bar.js` the one surface a call is drawn on + `peer-fs.js` a shared folder as a
  BrowserFS backend,
  `fullscreen.js`, `app-icons.js`, `context-menu.js`, `shortcuts.js` (every shell chord spelled
  once, read both by the hotkey handler and by the *Keyboard shortcuts* sheet it draws, and written
  for the machine — `⌘K` on a Mac, `Ctrl+K` elsewhere). `js/goldenlayout/` and `js/peerjs/`
  hold only vendor bundles.
- `js/app-registry.js` — install / update / scan apps. `js/mount-manager.js` — zip, iso, native-dir and files3 mounts; an archive is mounted
  by path (`mountZipFile`, `mountIsoFile`), because a mount made from bytes names no file to read
  again after a reload and so cannot be written down.
- `apps/7z/` — not an app: the archive engine Explorer uses. `js/parse.js` is pure (which
  files are archives, what 7-Zip's output means), `js/archive.js` runs it, `vendor/` holds
  JS7z with a `README.md` recording where it came from and why it is the single-threaded
  build.
- `apps/<id>/` — one folder per app, each with `index.html` + `pixos.app.json`; two also
  have a `vendor/` holding a whole library plus a `README.md` recording its provenance.
  `apps/explorer`, `apps/app-manager` are system apps; `apps/registry.json` and
  `apps/app-catalog.js` are both generated. Explorer is being taken apart by phase 21: its
  stylesheet is `apps/explorer/explorer.css`, `apps/explorer/fonts/` bundles its two faces (a
  `README.md` says where they came from, and that neither has Cyrillic), and `apps/explorer/js/` holds the modules
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
  `archive-ui.js` (the two archive dialogs and the operations behind them, and the three archive
  entries of the action table beside them — when the 1.4 MB
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
  peers, bookmarks, the wallpaper, the screensaver — offered only when there is a shell to own it)
  and `view.js` (everything Explorer draws of itself, as mockup B since phase 24 — a rail of
  commands, the path as the title, a selection line, a foot with the storage gauge: the one
  template `renderLayout` writes and the forty-three nodes it then looks up in it by class, the order
  the rows go in, and the redraws that follow a change in `state`; every control it had before and
  where each went is `docs/explorer-controls.md`) and `icons.js` (every icon as SVG markup, shared
  by the view and the sidebar, and no emoji anywhere in the chrome) and `keys.js` (every key Explorer
  answers to, written once: the keydown handler answers to it, the shell's shortcuts sheet lists it
  as `window.pixosShortcuts`, and the menus print it beside their commands —
  `tests/explorer-keys.test.mjs` presses every chord on it against the handler) and `sidebar.js` (`renderSidebar` — the only
  render that draws something Explorer does not own, and the only one whose output is
  clickable — and the drawer it is drawn in: a column above 900px that starts the way it was last
  left, an overlay at or below it that always starts closed, and at no width gone) and `places.js`
  (the pinned places, which are the `Places` group of `/settings/links.json`, read and changed only
  through the shell's `listBookmarks` and the edits beside it; Root and Apps are drawn as starters
  until the first edit writes the group with that edit in it, **so opening Explorer never writes
  the bookmarks file**) and `mounts.js` (the four mount actions, the two for a mount the shell could not bring back after a
  reload — `reconnectMount`, `forgetMount` — and the one setting any of them remembers —
  `js/mount-manager.js` owns what a mount *is*, this owns what asking for one looks like: which
  dialog, what a refusal says, and the two steps every success takes **in that order**, draw the
  sidebar then go there) and `clipboard.js` (Explorer's two clipboards, which are not one: the
  internal one holds paths to paste and is the only way a folder is ever copied; the system one
  is only written, by *Copy path*, and can refuse an iframe, so a refusal ends in a dialog with
  the text in it — plus the two rules a paste depends on, **a snapshot of the clipboard** and **a
  cut forgotten only once the move succeeded**) and `item-actions.js` (*New File*, *New Folder*,
  *Add Online File*, *Rename*, *Delete*, *Download*, *Get SHA1* — each asks `file-ops.js`'s
  conflict question before it writes and catches nothing, because the errno translation is one
  level up in the guard; `File`, `Blob`, `fetch` and `crypto` come off `win`, and are called *on*
  it, since a detached `fetch` throws in a browser and not in node) and `shell-actions.js` (*Open*,
  *Open with...*, *Manage Defaults*, *Add to bookmarks*, *Share with peers*, *Stop sharing*, and a
  screensaver's *Preview*, *Show contents*, *Set as wallpaper* and *Set as screensaver* — the
  actions whose work the shell does, keeping only what Explorer knows: a folder is navigated to in
  place, several files open together, a screensaver is shown rather than opened; the chooser's *Manage Defaults* button runs after `openWith`
  has returned, so the module wraps it with the same `guarded` the table's loop uses rather than
  reading the table it is part of) and `convert.js` (*FFmpeg*: the options dialog, one engine
  per window, files converted one at a time and written through `writeNewFile` — for an engine
  nothing installs, which `docs/backlog.md` records along with what this code gets wrong once one
  is there). Nothing in `apps/explorer/js/`
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
  from, and `sidebar.js` reads `actions` — takes `renderSidebar` late-bound, and `places.js` takes it
  late for the same reason. `clipboard.js` and
  `view.js` are the fourth: the toolbar greys out *Paste* by asking the clipboard and every
  clipboard action redraws the toolbar, so the view takes `hasInternalClipboard` late-bound.
  **`renderOverlays` stayed in `index.html`** although it is a render: it is the junction where
  context-menu and dialogs meet, and five modules call it, so moving it would mean five thunks
  to tidy seventeen lines. The
  construction order in `openExplorer` is load-bearing for one more reason: `file-ops.js` goes
  after `dialogs.js` (the conflict question is a dialog) and before `dnd.js`, `archive-ui.js`
  and `recording.js`, each of which writes a file through it — which is why none of those three
  needs a thunk. `clipboard.js`, `item-actions.js`, `shell-actions.js` and `convert.js` go after all of those, a paste being a copy
  or a move and *New Folder* and *Rename* both asking the conflict question.
  Each is a factory taking its dependencies as parameters — `fs`, `path`,
  `shell`, `win`, `nav`, `doc`, `rootElem` — and that is the whole reason any of them can be
  tested. **The context object is `state` and `ui`, passed by reference and nothing else**:
  they are the shared mutable pair, and a module writing `state.contextMenu` has to write
  the same object `index.html` reads. Every other dependency stays a named parameter — one
  bag holding everything would re-create the closure this phase exists to take apart. `actions` is now only names —
  every action lives in a module and is *named* in the table, which is kept because the guard loop
  wraps each entry once and menus, the sidebar and the keyboard all read the wrapped one; `menu-items.js` and `sidebar.js` are built *after* it, at the
  bottom of the block rather than the top, because a menu entry reads `actions.copySelected` when
  the menu is built and every mount row carries an unmount button. The window's boot lines —
  `renderLayout`, `bindEvents`, `watchForChanges`, fitting the drawer, asking for the storage figure, reading the places, the first
  `refreshCurrentDir` — sit below them for the same reason: **the window starts when every module exists**, and the first refresh draws
  the sidebar.
  `apps/calendar` (read-only month/year view) and `apps/system-info` (what this browser
  will say about the machine) are the destinations the desktop widgets lead to, and each
  keeps its logic in a pure module beside it — `js/calendar.js`, `js/probe.js` — because
  neither can be tested through its own DOM. `apps/filmoskop` is the slide app: a deck is a
  markdown file, `js/deck.js` holds everything that is not the DOM, and `vendor/` carries
  the comark parser and Prism. Its block palette is built in and extended by whatever is in
  `/settings/filmoskop-blocks`.
- `apps/screensavers/` — not an app (it has no `index.html` of its own, so neither the generator nor
  the local scan takes it for one): the screensaver pages PixOS ships, `Slideshow.xscr/` so far,
  copied in by `preinstall.json` on every boot.
- `settings/preinstall.json` + `templates/` — what a fresh system is made of, served over
  HTTP rather than read from BrowserFS. See *Boot is data-driven* in
  `docs/not-so-simple.md`.
- `.nojekyll` — empty, one byte, and load-bearing. GitHub Pages runs every file beginning
  with a `---` front-matter block through Jekyll and publishes it as `.html`, which is how
  two of the four files in `templates/` came to 404 on a server that had them. Do not
  delete it; `tests/precache.test.mjs` checks it is there.
- `scripts/generate-apps-catalog.js` — writes every app manifest, `apps/registry.json`
  and `apps/app-catalog.js` (the fallback catalog) from one pass over `apps/`.
- `tests/` — plain node, no framework, no dependencies. `npm test`. `report()` in
  `tests/assert.mjs` sets the exit code, which is all `tests/run.mjs` reads — five files once
  ended without passing it on and could not fail.
- `docs/*.ru.md` — architecture and how-to docs (Russian); the newer plans are `.md` English.
- `docs/checks/` — pages that settled a question only a real browser could answer
  (`hidden-frame.html`: does a hidden frame stop drawing), and fixtures a checklist asks for
  (`Trail.xscr.html`). Not part of the shell, and not precached.
- **`docs/not-so-simple.md` — how this system actually behaves**, in sixteen sections: the
  things you would not predict from the code, each written after somebody lost an afternoon
  to it. Not loaded with this file, so it has to be opened; see below for what is in it.
- **`docs/backlog.md` — every open idea, with the reasoning.** Anything raised and not
  scheduled goes there, including things deliberately rejected and why. Read it before
  proposing work; move an item into a plan rather than copying it.
- `docs/ux-improvements-plan.md` (phases 1–5, built), `docs/reliability-plan.md`
  (phases 6–20, all built), `docs/explorer-plan.md` (phases 21–24, all built),
  `docs/shortcuts-plan.md` (phase 25, keyboard shortcuts shown, built) and
  `docs/screensavers-plan.md` (phase 26, animated backgrounds and screensavers, being built) are the
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
  strings, how it reads a file on a mount (by asking a shell, and which one) and why a shell a
  hard reload left uncontrolled reloads itself once, the notification surface and its three layers in Explorer, `failure.js`,
  `needsNetwork` and the four record builders that keep dropping it, why the precache is
  network-first and what it follows rather than lists, the error reporter the worker
  injects into every app document so a window that dies before its own script runs still
  says so, and the progress note a long operation draws in that same stack.
- *Apps that carry their own engine* — 7-Zip's exit codes and staging rules, filmoskop's
  parser boundary and its two editors, and the two apps whose folder is not their id.
- *The desktop and its widgets* — peeks, widgets as doors, who knows the desktop is
  visible, and animated backgrounds: paused when covered, unloaded after 30 s, a page's frames
  held from outside because hiding a frame does not stop it, and the pointer handed in. The
  screensaver: whose idle counts, what holds it off, the permission asked in a click, and why its
  key listener has to be registered first. Explorer previewing one, and its copy of which names are
  screensavers.
- *Windows, desktops and sessions* — the five layers, why an iframe is never reparented,
  one windows container for every desktop, and what a session actually persists.
- *Getting around* — one model behind three launchers, keystroke bridging into iframes, the
  overview, the file-search deadline, and the shortcuts sheet (one spelling for handler and sheet,
  `Ctrl/Cmd+/` left to a text field, the chords a Mac is not shown).
- *Launching, and the app contract* — `launch(descriptor)`, `openFile`/`markDirty`/
  `saveFileLocal`, `setWindowPath` (where a window that moves inside itself now stands),
  `watchStorage` (the storage figure, passed on only when it changes), `window.pixosShortcuts` (an
  app's keys, read by the shell when its sheet opens), `autosave`, one tab owning
  the session, and `Ctrl/Cmd+W`.
- *When a file changes underneath a window* — why no writer is asked to announce a
  write, the one `fs` that is wrapped instead and the one writer that cannot be,
  quiet-plus-maxWait coalescing, what a truncated batch is allowed to answer,
  `affects` versus `touches`, and why `watchFiles` takes the app's own window.
- *Storage, and what the browser will not keep* — eviction, the 128 MiB ceiling on a file,
  what a refused write does and does not tell you, one spelling of a size, and which mounts
  come back after a reload and which wait for a click.
- *Manifests, boot, and what a fresh system is made of* — generated manifests, the two the
  generator skips in silence, the four lists a file added to Explorer goes in (fonts included),
  `preinstall.json`, and what a boot says on screen when it
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
- *The bookmarks document* — two writers, one owner, a seeded starter, one queue for every
  edit from outside the app, and Explorer's places as a group in it that looking never creates.
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
