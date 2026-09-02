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
  `peers.js` the connection to another PixOS + `peers-panel.js` its one surface +
  `peer-fs.js` a shared folder as a BrowserFS backend,
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
  `apps/explorer`, `apps/app-manager` are system apps; `apps/registry.json` is generated.
  `apps/calendar` (read-only month/year view) and `apps/system-info` (what this browser
  will say about the machine) are the destinations the desktop widgets lead to, and each
  keeps its logic in a pure module beside it — `js/calendar.js`, `js/probe.js` — because
  neither can be tested through its own DOM. `apps/filmoskop` is the slide app: a deck is a
  markdown file, `js/deck.js` holds everything that is not the DOM, and `vendor/` carries
  the comark parser and Prism. Its block palette is built in and extended by whatever is in
  `/settings/filmoskop-blocks`.
- `settings/preinstall.json` + `templates/` — what a fresh system is made of, served over
  HTTP rather than read from BrowserFS. See *Boot is data-driven* below.
- `scripts/generate-apps-catalog.js` — the manifest/registry generator.
- `tests/` — plain node, no framework, no dependencies. `npm test`.
- `docs/*.ru.md` — architecture and how-to docs (Russian); the newer plans are `.md` English.
- **`docs/backlog.md` — every open idea, with the reasoning.** Anything raised and not
  scheduled goes there, including things deliberately rejected and why. Read it before
  proposing work; move an item into a plan rather than copying it.
- `docs/ux-improvements-plan.md` (phases 1–5, built) and `docs/reliability-plan.md`
  (phases 6–17, all built) are the scheduled work, each phase with a browser
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

**Everything is served through the service worker.** App URLs look like
`/__browserfs__/apps/<id>/index.html`. `sw.js` strips the query string before *looking the
file up*, but the iframe's document URL keeps it — so an app can read its own `?params`, and
`treemap` (`?path=`), `media-player` (`?initPlaylist=`) and `transcriber` (`?audio=`) all do.
A directory URL without a trailing slash gets a redirect first, so relative `../` references
inside an app resolve either way.

**Failures have one surface, and it is not the console.** `js/shell/notifications.js`
renders into `#overlays`; `window.notify({level, title, message, actions, source})` is
reachable from any app iframe as `parent.notify`. `source` is always stamped — an app must
never be able to raise a note that reads as the system speaking. `info` auto-dismisses,
`warn` and `error` never do. Identical notes fold into a counter, which is what keeps the
global `unhandledrejection` / `error` handlers in `index.html` usable rather than a flood.
Those handlers only cover the shell: a rejection inside an app fires on *that* window, so
Explorer catches its own, in three layers that each exist because the one before it does
not reach: the `actions` table is wrapped; every `on*` callback on a dialog is wrapped by
`openDialog` (a submit handler runs after the action that opened the dialog has returned,
so the table's wrapper is no longer on the stack); and `unhandledrejection` / `error` on
Explorer's own window catch the rest. All three route through one `report()` — a call site
that reaches for `openInfoDialog` directly gets a modal where the system gives a card, and
skips the errno translation with it, which is how a raw `ENOENT` reached the screen twice.

**`js/shell/failure.js` turns a failure into a sentence**, and is deliberately pure so it
can be tested — `online` and `pageOrigin` are arguments, not reads of `navigator` and
`location`. It exists because `fetch` reports a CORS block, an extension block and a dead
network identically (`TypeError: Failed to fetch`, no status): the browser knows and will
not say, so the wording names what is still ambiguous instead of guessing. Apps cannot
import it — they are installed into BrowserFS — so it is exposed as
`window.describeFetchFailure` / `window.describeError`, and callers degrade when absent.

**`needsNetwork: true` in `pixos.app.json`** marks an app that loads part of itself from a
CDN — `ace` (cdnjs), `treemap` (d3 from jsdelivr) and `emulatorjs`. `monaco` and `tinymce`
were on that list until phase 7 vendored them into `apps/*/vendor` (see below).
Hand-declared in the stub, carried by the generator, and — this is the part that
bites — it must be listed explicitly in **all four** record builders in
`js/app-registry.js`: `normalizeManifest`, `manifestToAppRecord`, `scanLocalAppsInFs`
(twice, one shape per branch) and `scanInstalledApps` (twice again). They enumerate fields
by hand and have silently dropped this one twice. Launching such an app while
`navigator.onLine` is false says so rather than letting it fail with "failed to fetch"
inside its own iframe, where the shell cannot see it. `appNeedsNetwork` in `index.html`
therefore ORs the installed record with the catalog one: `window.apps` is a derived,
partial view, the catalog record is the manifest, and reading both means losing the flag
takes two omissions instead of one. The catalog is fetched over HTTP, so a boot with no
network has none of this — phase 7's precache is what fixes that.

**The shell is precached; the filesystem never needed to be.** `sw.js` caches
`index.html`, every module in `js/shell/`, the vendor bundles, `settings/preinstall.json`,
`templates/`, the two system apps and every catalog manifest — the manifests followed out
of `registry.json` at install time rather than listed, because a hand-written list of
twenty-five rots the day someone adds an app. The strategy is **network first, cache
second**, which is backwards from the usual advice and deliberate: this repo is served
straight off disk with no build step and no content hashing, so cache-first would hand back
yesterday's `index.html` after every edit and no reload would fix it. The cache is only
read when a fetch actually fails. Two details bite. The cache name carries a version and
`activate` deletes every other cache — `skipWaiting()` + `clients.claim()` mean a new
worker takes over immediately, and without that you get a new worker serving the old
worker's assets. And cache keys have the query string stripped, because `fetchServed()` and
the app registry both append `?<random>` to defeat the HTTP cache, so keying on the full
URL would store a new copy every boot and find one never. `tests/precache.test.mjs` checks
the list against the real `index.html` and the real directory, which is the only thing that
can. The worker is also where the shell's idea of *being*
offline comes from. `navigator.onLine` is wrong in both directions: on a reload under
DevTools offline emulation it can still read `true`, and switching that emulation off does
not reliably fire `online` — so its events are a hint. A request is not: `sw.js` records
whether one failed and tells clients, and `system-stats.js` asks it at boot (a page served
from the cache missed the broadcast, having not existed yet) and probes
`favicon.png?__pixos-probe=` every ten seconds while it believes it is offline. The worker
never answers or stores a probe, or it would report "online" out of its own cache forever.
A request that arrives outranks `navigator.onLine`.
The worker also **stands aside for anything cross-origin**, which is not an optimisation:
under `COEP: credentialless` the browser fetches a no-cors cross-origin subresource without
credentials and allows it, but a worker that intercepts the same request re-issues it as it
stands and returns an opaque response, which then has to pass the stricter `require-corp`
check — no CORP header, blocked, silently. Every remote image in PixOS failed on this until
phase 14 found it.

**Archives go through 7-Zip, and its words are the interface.** `apps/7z/vendor` holds
JS7z (7-Zip 25.01 in WebAssembly); Explorer's *Extract…* and *Compress…* are the only
callers. Five things
about it are load-bearing. It is the **single-threaded** build, because the multi-threaded
one needs `SharedArrayBuffer` — PixOS does ask for cross-origin isolation, but Safari has
no `credentialless` and the first load is not service-worker-controlled, so isolation
cannot be relied on; the cost is that a big archive blocks the tab, and the dialog says
so. It is a UMD bundle loaded with a `<script>` tag rather than an import — its Node
branch has `require` beside a top-level `await`, which no module loader accepts — and only
on the first press, since it is 1.4 MB; `js/parse.js` is what Explorer imports at startup,
so *deciding* whether a file is an archive is free. **One `callMain` per instance**: the
runtime is never reset, so listing then extracting is two engines, and a tarball is two
more. **The exit code cannot be acted on** — a wrong password and a truncated file are
both 2 — so `classify()` reads what 7-Zip printed, and `-p` is passed on every run even
when empty, or it asks for a password on a stdin that does not exist and hangs for ever.
And **nothing is read back from a failed run**: 7-Zip leaves partial and garbage files in
its output folder, and those must never reach yours. Compressing adds three rules of its
own: the archive name must be **free** (given an existing one, 7-Zip tries to add to it
and stops with `Is not archive`), the staged files are named **relative** to a `chdir`
into `/in` through a list file, and a password the chosen format cannot hold is dropped in
`compressSteps` as well as disabled in the dialog — an archive that quietly came out
unprotected is the failure being designed against.

**A deck is a markdown file, and the app owns both halves of it.** `apps/filmoskop` puts
the source and the slides in one window, which is what lets the caret scroll the preview
with no messages, no file watching and nothing to keep in step — PixOS still has no way
for one window to see another's writes. Slides split on `-----`; layouts are comark
components (`::side-image{src="a.png"}`), which arrive in the AST as named nodes with
props, so a layout is a rendering decision rather than a pattern matched out of the text.
Four things are load-bearing. **Only the parser is vendored** — filmoskop walks the AST
itself, and that walk is the security boundary, since comark passes raw HTML through and a
deck is a file people send each other. **A relative picture resolves against the deck**,
not against the app two folders away, or every image in every deck is broken. **The
launcher gives this app `allowfullscreen`** (no other app has it) and deliberately defines
no `deliver`, because an empty one — as `explorer` uses to opt out — would mean the deck
never arrives. And **`talk.deck.md` opens here while plain `.md` stays with the markdown
viewer**, through the compound-extension candidates `['deck.md', 'md']`. The editor in the
left pane is either its own textarea or the **Monaco that `apps/monaco-cdn` already carries**
(that app's *folder*; its id is `monaco`, and filmoskop needs both — the id for
`parent.apps` and `installAppById`, the folder for the path it loads `vendor/vs` from) —
borrowed from that app's `vendor/vs`, since it is the same filesystem and shipping a second
12 MB copy would be absurd — chosen by `/settings/filmoskop.json` and hidden behind six
functions so nothing above that line knows which is in the pane, which is also what lets
the *Install Monaco* button on the "not installed" note swap the pane in place
(`parent.installAppById`, then `useEditor` again) with nothing reopening. Watch one trap
that bit both of this app's overlays at once: **`element.hidden = true` does nothing to an
element an author rule gives a `display` to** — cascade origin beats specificity — so
anything toggled that way needs `[hidden] { display: none !important; }` in the sheet, and
in filmoskop it belongs to the chrome stylesheet, never the slide one. That slide sheet is
the **single description of a slide**: the export copies it verbatim, and the presenter
window loads it into an `iframe` per preview — a frame rather than a div because the sheet
is written in `vw`/`vh`, which in another window of another size would mean something else.
The **block palette** (phase 15) draws its tiles as plain elements for exactly the mirror
reason: they are in the app's own document, so those units already mean what they mean in
the preview. Its `kind` — `slide` goes after the current slide with a separator, `block`
goes at the caret — is declared for the nine built-ins and *derived* for a file in
`/settings/filmoskop-blocks`, by whether the fragment opens with a **layout**: that is what
makes `::notes` a block rather than a slide. `insertionFor` returns an edit rather than
applying one, because the textarea needs `execCommand('insertText')` and Monaco needs
`executeEdits` — both to keep an undo history the palette must not cost you.

**Two apps carry their own editor**, and for both the folder is not the id: `monaco-cdn`
holds `monaco`, `tinymce-cdn` holds `tinymce` — the folders kept their names through phase
7 so no association or saved session would break, so anything that both installs one of
these and reads a file out of it must carry the two names separately.
`apps/monaco-cdn/vendor/vs` (12 MB, Monaco 0.52.0) and
`apps/tinymce-cdn/vendor/tinymce` (3.9 MB, TinyMCE 8.1.2 GPL), each with a `vendor/README.md`
recording the version, the source tarball, what was trimmed and why. They are ordinary app
files, so they are copied into BrowserFS on install like everything else — which is also why
`apps/app-catalog.js` cannot list them and its entries for those two are knowingly wrong.
Vendoring Monaco fixed something separate: its language services run in a worker loaded from
`vs/base/worker/workerMain.js`, and from a CDN that is a cross-origin worker the browser
refuses outright, so they had never actually run.

**A peek ends the moment a window would be needed.** `desktop.js` drops the peek on the
WM's `opened` event, and the taskbar routes a window-button click through the shell's
`onShowWindow` rather than calling `focusWindow` directly. Without both, launching or
switching from any surface that stays reachable during a peek — the desktop menu, a
widget, the taskbar — puts a window behind the peek and reads as a dead click. A widget
ends it a step earlier still, before its own `open.run`: an open that has to install an
app first would otherwise spend that time looking like a click that did nothing.

**Every widget is a door.** A widget in `js/shell/widgets.js` may declare
`open: {title, run}`, and the container owns everything else about it — the pointer
cursor, the hover state, the tooltip, ending the peek, and reporting a failure through
`window.notify`. The About card did all of that by hand and was the only widget that did,
which is precisely why the other three stayed dead ends: there was nothing to leave out
of, only something to write again. Clock → `calendar`, Storage → `treemap` on `/`,
Battery → `system-info`, About → `/home/about.md`. The click handler is exported as
`openHandler(widget)` so what a click *means* can be tested without a DOM, and
`tests/widgets.test.mjs` reads the source to check that every registered widget declares a
destination — a fifth widget with none is what this regresses into, and it would look
finished. The two apps the widgets lead to are in `settings/preinstall.json`; treemap is
not, so `openCatalogApp` in `index.html` **installs before it opens** rather than letting
`launch` throw `App treemap has no launch path`, which is what a dead click looks like
from the inside. The taskbar tray shows three of the same readings and leads to the same
places, through `widgets.get(id)` + `openHandler` — never its own copy of the
destinations, which is how the two would come to disagree, and the tray is the copy nobody
would check.

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

The same model holds **recent files** (`/settings/recent-files.json`), and they are
recorded in `launch()` rather than in `openFile`/`openPath` — the one funnel every route
already goes through, so a route added later feeds the list without being told to. A
restore is excluded, or replaying the last session would rewrite the list into itself on
every boot. Entries are `{path, dir}` so a menu need not stat a dozen paths to know which
call to offer, but `openRecentFile` stats anyway: that stat is both the check that the file
still exists (a missing one is pruned *then*, never swept for in advance) and the truth
about whether it is a folder, so a stored flag that is wrong still opens correctly.

**A shell shortcut only works because the shell listens inside the app.** Input in an
iframe never reaches the shell's document, so `wm.bridgeInput` attaches capture-phase
`keydown`/`mousedown` listeners inside each app document and republishes them — and it
follows **nested** same-origin frames too, watching for ones added later with a
`MutationObserver` on added nodes only. That is not hypothetical tidiness: `tinymce` edits
inside an iframe it builds itself long after load and rebuilds whenever the editor is, so
every shell chord was dead in that one app and nowhere else. A *cross-origin* nested frame
(`photopea`) is still opaque, and always will be.

Those same listeners are what keeps **which window is active** honest. GoldenLayout's tab
selection is only half the story: two panes side by side are both visible, so selecting one
tab and then typing in the other used to leave the shell naming the wrong window — and
*Close window* closing it. Any click or keystroke inside a window makes it the active one
(`noteInteraction`, a no-op when it already is).

**The overview is the answer to "there is no free chord".** `overview.js` shows every
window on every desktop as a numbered tile, and the numbers exist only while it is open —
so one chord has to survive rather than nine, and it keeps working past nine windows.
Two things about it are load-bearing. It **takes focus when it opens** (`element.tabIndex =
-1` then `focus()`): the window in front is usually an app iframe, and a keystroke inside
an iframe never reaches the shell's document, so without that the numbers would be dead for
exactly the person who opened it to escape an app. And `resolveKey` returns `null` for
anything it does not claim — `Ctrl+Shift+1..9` still switches desktop while the overlay is
open — because the handler `preventDefault`s whatever `resolveKey` names and nothing else.
Closing a window lives here too (`Delete`, or a tile's ✕) plus a palette command, because
outside fullscreen there is no free close chord and inventing one that silently never fires
is the mistake earlier phases already made. There are no thumbnails: a page cannot
screenshot its own iframes.

**File search walks the tree; there is no index.** `file-search.js` is pure over an
injected `readdir`. Breadth-first (shallow matches are the ones you meant), capped at 200
matches and 300 ms, and the result says **which** limit it hit, because a truncated answer
reported as a complete one is worse than a slow one. The budget is a *deadline*: each read
races the remaining time, since a `files3` or native mount reads over the network and one
`readdir` that never answers would hang a walk that only checked the clock between
directories. `/apps` is skipped unless the query names it — and that default lives in the
module, not the caller. The palette runs it in two stages: the directory listing is instant
and renders first, the walk is debounced 160 ms and its results are **appended**, never
merged into the sort, so the row under the highlight does not move while you reach for
Enter. Each keystroke cancels the previous walk through its token.

**`Ctrl+Shift+1..9` switches desktops**, not `Ctrl+1..9` — that is the browser's own tab
switching on Windows and Linux, and only ever worked because macOS puts it on `Cmd+1..9`.

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

The shell also injects `markDirty(dirty)` **into** the app's window on load, already bound
to that window — an app cannot be expected to know its own window id, and the shell cannot
work out which iframe called a `parent.*` function, so this reaches in the same direction
`openFile` already does. Call `markDirty(true)` on an edit and `markDirty(false)` once it
has reached the filesystem; feature-detect it (`typeof markDirty === 'function'`) so the app
still runs standalone. That flag is the whole basis of the dot on the window title and its
taskbar button, of the palette's *Unsaved work*, and of whether `beforeunload` fires at all
— an app that never calls it is a window the system will let you close without a word.

**Two ways an editor can be safe, and it must declare which.** `"autosave": true` in
`pixos.app.json` means the app writes changes back on its own — `ace` and `monaco` do, and
App Manager shows a *saves automatically* badge for them. `tinymce` does not and says so by
marking its window dirty until you save. Before this, which of your edits survived closing
the tab depended on which editor you happened to open and nothing on screen said which one
you were in. Like `needsNetwork`, `autosave` must be listed by hand in all four record
builders in `js/app-registry.js` or it silently does not exist.

**One tab owns the session.** `js/shell/tabs.js` elects an owner over a
`BroadcastChannel`, and only that tab writes `session.json`, `desktop.json` and
`recent-apps.json` — otherwise two tabs save on their own schedules, last writer wins, and
arranging your windows in one tab and closing the other quietly reverts them. A follower
keeps full read/write access to *files*, because it is the same filesystem and the user
opened the second tab in order to use it. The election is deliberately kept separate from
the channel so `tests/tabs.test.mjs` can drive it by hand, and `isOwner()` is false until it
settles: nobody writing for a quarter of a second is not a problem, two tabs writing during
that quarter second is the whole one. **What this does not fix:** two tabs writing the same
*file* still race. The follower's note says so rather than implying otherwise.

**`Ctrl/Cmd+W` can only ever be ours in fullscreen, and only in Chromium.**
`js/shell/fullscreen.js` requests fullscreen and then `navigator.keyboard.lock(['KeyW',
'KeyT', 'KeyN'])`. Both constraints are load-bearing: leaving fullscreen by any route,
including Esc, hands the keys straight back with no event of its own, so the hotkey handler
re-checks `isKeyboardLocked()` rather than trusting a flag; and where the API is missing the
mode still enters but *says* it cannot take the key, because silently doing nothing is worse
than not offering it. `describe()` is the single source of that wording, so the button, the
palette entry and the note cannot describe the mode three different ways.

**The filesystem is evictable unless you ask.** `navigator.storage.persist()` is requested
once per boot and the storage widget reports what was actually granted — *persistent*,
*best effort*, *unknown*. Never what was asked for: Chromium grants silently on engagement,
Firefox prompts, Safari has no equivalent, and a durability promise nobody verified is worse
than none because it is the one people rely on.

**Manifests are generated, never hand-written — except the system apps'.** `pixos.app.json`
carries every file with a SHA-256 hash; only identity fields (`id`, `name`, `version`,
`entryPath`) are yours to edit. Bump `version` or App Manager will not offer the update to
existing installs. Known quirk: the manifest's own self-hash can never converge (writing the
hash changes the file), so it mismatches in every app — that is expected, not a bug to chase.

**Editing a system app leaves its manifest stale, and the generator will not tell you.**
`explorer` and `app-manager` are reserved ids: `npm run generate-apps` walks straight past
them and rewrites only `registry.json`, printing nothing about the app you just changed. So
after touching `apps/explorer/**` or `apps/app-manager/**`, update
`apps/<id>/pixos.app.json` **by hand** — recompute the file's `sha256:` (`shasum -a 256
apps/explorer/index.html`) and bump `version`. Nothing at boot verifies it, because both are
preloaded with `refresh: true` and never installed through the registry, which is exactly
why a wrong hash can sit there for months before App Manager surfaces it as a phantom
"modified locally".

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

**Another machine is a session, and the wire is a closed list.** `js/shell/peers.js` owns
the connection — not Explorer, because a shared folder is a *mount*, a call is not a file
manager's business and a phone driving this machine is not either; apps get only
`window.peers.list()` / `.sendFile()` / `.open()`, never connect or identity. Five things
are load-bearing. `parseMessage` accepts exactly nine message types and returns null for
everything else, bounding every field it does accept: what arrives was written by someone
else's machine, and the share this replaces took an HTML document over the wire and
`new Function`'d it. An incoming file is a **question** (a note with Accept/Refuse) that
lands in `/home/received` and never on top of an existing name — `fileName()` keeps only
the last path segment, `cleanName()` strips control characters before a peer's own name is
drawn in the panel that reports on it. The **id is stable** (`/settings/peers.json`) so a
reconnect needs no fresh link, which also makes it a stable identifier — hence shown,
copyable and resettable. **One tab holds the connection**, because a peer id registers with
a broker once; a follower says so. And **vendoring PeerJS did not remove the broker**: WebRTC
needs an introducer, by default the PeerJS cloud, so the host is configurable for a LAN
`peerjs-server` and the panel names whichever is in use. Explorer's old *Share* is
untouched and is replaced by the peer mount later.

**A shared folder is a mount, and one function is the boundary.** `mount-manager.js` gains
`mountPeer`; the filesystem object comes from `js/shell/peer-fs.js` because it needs the
peer session to talk over. Once the folder is a mount, Explorer, the palette, the apps and
`sw.js` all reach it without knowing peers exist — that is the whole reason it is not a
window with a file list in it. Four things are load-bearing. `resolveShared(root, path)` in
`peers.js` normalises `..`, backslashes and control characters and refuses anything landing
outside the root; a path from the wire is always *relative to the share*, sharing `/` is
refused, and a refused path gets **the same answer as an ungranted peer** so probing learns
nothing. The **host approves every mount** (a note with *Let them* / *No*) and the grant
lives for the connection, written nowhere. The backend is a **plain object, not a
subclass** — the vendored BrowserFS exports no base class, so the interface it implements
(`readdir`, `stat(path, isLstat, cb)`, `readFile(path, encoding, flag, cb)`, `exists`,
`realpath`, plus the metadata answers) was established by experiment; `supportsSynch()` is
false because there is no synchronous way to ask another machine anything. And **latency is
designed for**: every call has a deadline, listings and stats are cached 4 s (Explorer stats
every row it draws), file contents never are, and a read is capped at 32 MB because it
crosses in one message.

**Two kinds of app.** *Catalog* apps live in `apps/`, are discovered via `registry.json`, and
must be installed (copied into BrowserFS). *Local* apps are folders the user creates under
`/apps/` inside BrowserFS and are active immediately. Ids must not collide.

**Uninstalling is not the reverse of installing.** `uninstallAppById` deletes the app's
folder, its `/settings/installed-apps/<id>.json` record and any default-extension
association naming it — and then three things it must *not* do. It never touches
`/settings/preinstalled.json`: that file is what stops preinstall putting the app back on
the next boot, so clearing it would undo the uninstall. It never builds the folder path out
of the app id (`monaco` lives in `monaco-cdn`) but reads it from `entryPath`, always
`/apps/<one segment>`, refusing anything else rather than guessing. And it refuses the
reserved ids. It is deliberately tolerant of a folder that is already gone, because
deleting one in Explorer is what people did while there was no button, and pressing
*Uninstall* afterwards is what repairs the record. Nothing watches the filesystem, so App
Manager still lists such an app until *Rescan apps*.

**`apps/app-catalog.js` is a legacy fallback** used when `registry.json` is unreachable. The
generator reads it but never writes it, so its file lists rot silently and will install a
broken app. Update the relevant entry by hand when an app gains or loses files.

**A file with no default app is a question now, not a guess.** `openFile` used to fall
through to `launch({appId: null})`, where the path becomes the iframe src — so the *least*
useful option was the silent default. `js/shell/open-with.js` asks instead, and three
things about it are load-bearing. The list always ends with two entries that are not apps
— *Open in a browser tab* and *Open as a plain file in a window*, the old fallback with a
name — so the dialog can never be empty, which matters because the files that reach it are
exactly the ones nothing installed can read. The *always open .csv this way* checkbox
tracks the highlighted row and disables itself on those two, because an association maps
an extension to an **app id** and there is none to store. And installing precedes
remembering: `setDefaultAppForExtension` refuses an app that is not installed, so the other
order throws and loses the preference. A failed *remember* still opens the file. The
chooser lives in the shell rather than in Explorer because `openFile` is the funnel every
route goes through — palette, recent file, desktop menu, another app's `parent.openFile`.
**Explorer's own *Open with...* is this same dialog**, through
`window.openWithChooser({paths, apps, extension, title, universal, extras})`: it drew its
own for a while, and two dialogs raised in nearly the same situation that looked nothing
alike was the visible cost. What stays in Explorer is only what Explorer knows — that a
folder can be navigated to in place, and that several files can open at once — so it
passes the candidates and the buttons (*App Manager*, *Manage Defaults*, its own dialogs)
and acts on the answer. `universal: false` drops the two universal routes for a folder,
where neither means anything. Explorer's empty-area menu raises it for the *current*
folder — the one folder that has no row to right-click — and hands it over as an item
rather than a path, since a path would be looked up among the rows and the selection would
answer instead. `SELF_OPENING_EXTENSIONS` (`html`, `htm`) is the other
exception: a page is already a window, and it is how a local app's `index.html`, App
Manager included, opens.

**The bookmarks document has two writers, and one owner.** `apps/bookmarks/js/links.js`
owns `/settings/links.json`; `js/shell/bookmarks.js` is the shell's copy of only what
appending one link needs, for `window.addBookmark({title, url})` — a second copy for the
same reason the frontmatter parser is one, since an app is installed *into* BrowserFS and
the shell cannot import from it. `npm test` checks the two answer identically for every
URL shape rather than trusting them to. Two rules that are not obvious: it is deliberately
**not** behind the tab-ownership gate (this is a document the user edits, not a record of
how this tab is arranged, and the app writes it from any tab), and a file that will not
parse is never written over — "no file yet" and "a file with something wrong in it" are
different answers, and replacing the second with a fresh one holding a single link would
be the worst possible response to a typo. `addTo` does not mutate what it is handed, so a
write that never happens leaves nothing half-applied.

**The clipboard can refuse, and Explorer is an iframe.** `navigator.clipboard.writeText`
needs a secure context and a gesture and is refused in a frame without permission — so
Explorer tries it, falls back to `execCommand('copy')` (which still works in exactly that
case), and only then shows the text in a dialog with it already selected. A copy that
silently did nothing is the failure being designed out; the *Copy Link* button in the
share dialog had the same unguarded call for years.

**Extension matching is candidate-based.** `getExtensionCandidates` in `index.html` expands a
path most-specific-first (`book.fb2.zip` → `['fb2.zip', 'zip']`), so an app can claim a
compound type without hijacking the trailing one, and a specific default beats a generic one.
Explorer keeps the plain trailing extension for archive mounting.

## Boundaries

MUST: regenerate manifests (`npm run generate-apps`) after changing files under `apps/`
MUST: hand-update `apps/explorer/pixos.app.json` (hash + `version`) after changing
`apps/explorer/**` — the generator skips reserved ids and says nothing. `apps/app-manager`
has no manifest at all: it is copied in by `preinstall.json` with `refresh: true` on every
boot, so editing it needs nothing
MUST: keep `npm test` green
MUST: keep this file in English and update it when the project structure changes
MUST NOT: use git — see `AGENTS.md`
