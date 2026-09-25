# PixOS — the not-so-simple aspects

**Why each of these is written down: it is behaviour you would not predict from the code,
and in most cases somebody already lost an afternoon to it.** This was the bulk of
`CLAUDE.md`, moved out when that file stopped being readable in one sitting. `CLAUDE.md`
keeps the structure, the commands and the rules that must never be broken, and points here.

**Read the relevant section before changing the area it describes.** Nothing here is
optional detail; a paragraph exists because the obvious change breaks something that is not
obvious. Where a rule is checked by a test, the test is named — those are the ones that
will stop you. The rest will not.

Keep this file in English, and update it when the behaviour it describes changes.

---

## Serving, offline, and saying when something failed

**Everything is served through the service worker.** App URLs look like
`/__browserfs__/apps/<id>/index.html`. `sw.js` strips the query string before *looking the
file up*, but the iframe's document URL keeps it — so an app can read its own `?params`, and
`treemap` (`?path=`), `media-player` (`?initPlaylist=`) and `transcriber` (`?audio=`) all do.
**The fragment is stripped too, and for years was not**: Chrome keeps it in the `request.url` a
worker sees, as the Fetch standard now says, so any page opened with a `#` was looked up under
that whole name and was a 404. Nothing opened one until phase 26's Pipes, whose look is
`index.html#{"hideUI":true}`. `servedPath` in `sw.js` is the one place a request becomes a path,
and `tests/sw-served-path.test.mjs` runs it. A directory URL without a trailing slash gets a
redirect first (`withSlash`, which puts the slash before the query rather than after it), so
relative `../` references inside an app resolve either way.

**A file on a mount is read by asking a shell, and which shell is the whole question.** The
worker has only IndexedDB; a zip, an iso, a local folder, a Files3 storage or a peer exists only
in the page that mounted it. So a request under a mount is posted to a PixOS window as `stat`,
`readFile` or `readdir` over a `MessageChannel`, and the `navigator.serviceWorker` listener in
`index.html` answers from `window.fs`. The worker used to ask one guessed window — the first
top-level one `clients.matchAll()` returned, which is the one focused last, and only among the
pages it controls — and both limits lost the mount. A file opened in a browser tab and focused
after the shell was asked instead; after a hard reload the shell was not controlled, so an app
frame was. Neither answers, so after five seconds every file under the mount was a 404 and its
app opened empty, while every file outside it opened, because the worker reads those itself.
Whatever put the shell first again — a reload, usually — made it work, which is why it looked
like a mount that only works once PixOS has been reloaded. `askShells` in `sw.js` now asks
**only a shell** — a page directly in the scope's folder; an app, a file tab and a check page
are all somewhere below it — **controlled or not** (`includeUncontrolled`), best first and
**one at a time**: a second PixOS without that mount says no at once and the next is asked,
whereas asking them all together would read a large file once per tab. **And a shell loaded
around its worker reloads once into it** (`ensureControlled` in `index.html`). A hard reload
does that while the worker is active, and such a page stays uncontrolled: its own
`/__browserfs__` fetches go to the server and 404, and it is not cross-origin isolated. It
reloads before BrowserFS is configured, so a page about to be replaced writes nothing, and
`pixos-sw-reload` in `sessionStorage` stops a browser that bypasses the worker every time from
looping. It is not the isolation reload's flag, which a browser that is never isolated never
clears. `tests/sw-mount-reads.test.mjs`.

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

**Three layers of catching are worth nothing if the error was thrown away at the bottom.**
Every wrapper in `apps/explorer/js/fs-helpers.js` turns one callback-style BrowserFS call into
a promise, and the rule is that the error survives the translation. One of them did not:
`mkdir` ignored the callback's error and resolved regardless, so **New Folder** with a name it
could not create closed its dialog, made nothing, and said nothing — not a card, not a console
line, nothing for the `actions` wrapper or `openDialog`'s wrapper or `unhandledrejection` to
catch, because there was no longer an error anywhere. Three wrappers answer with a value
rather than a rejection *on purpose* and must stay that way: `stat` answers `false` because it
is asked as a "does this exist" question, and `readdir` and `listDirectory` answer with an
empty folder. That last one is a real cost — an unreadable folder is drawn as an empty one —
and is in `docs/backlog.md` rather than fixed here, because every listing path depends on the
current shape. `ensureDir` is allowed to ignore exactly one errno, `EEXIST`, and only because
it has just checked with `stat`: two writes into the same new folder race, and the loser
finding it already made is the good outcome. Everything else it hits belongs to the caller —
`ensureDir` runs in front of every write there is, so a swallow in it is a write that looks
like it worked. `tests/explorer-fs-helpers.test.mjs` asks each wrapper both questions.

**A question is a modal; a failure is a card — and one of them is not a failure at all.**
Renaming a file onto a name that already exists looks like it should be an error, and is
not: `fsRename` does not refuse an occupied name, it silently **replaces** what is there, so
there is no error to catch and nothing to translate. The question has to be asked *before*
the call, and it is the same `pasteConflict` dialog a paste asks, with the same three
answers — Cancel, *Save as new name*, Replace. A card would be wrong here: the operation
cannot proceed without an answer, and a note in the corner is not somewhere to answer
anything. **New → Folder** onto an existing name used to go the other way and report a `warn`
card, on the reasoning that `mkdir` genuinely refuses, so the operation is over before anyone
could be asked. That reasoning was sound and the result was still worse: being told the name
is taken and then left to retype it is a refusal where a question would do. It now asks the
same question through the same dialog, with `sourceIsDirectory` true, which is what greys out
*Replace* — replacing a folder would mean deleting whatever is inside it, and that is not a
thing one click should do. The dialog names what is actually in the way, a folder or a file,
because the commonest collision here is one folder with another.

**Every dialog in Explorer opens through `openDialog`, and that is not a style preference.**
It is `apps/explorer/js/dialogs.js`, and it wraps every `on*`-shaped key on the dialog in
`guarded` on the way in. A submit handler runs long after the action that opened the dialog has
returned, so the wrapper around `actions` is off the stack by the time it fires — a rename onto
a file another window had just deleted reported itself as `Uncaught (in promise)` in a console
nobody had open, and as nothing at all on screen. It wraps *whatever is on\*-shaped* rather
than a list of the callbacks that exist today, because a list is a thing to forget to add to.
Two smaller rules in the same file have each cost an afternoon. **The submit latch has to
release when a handler returns `false`** — a click and an Enter can both arrive for one press,
so the latch exists, but a handler that declined an empty filename has not submitted, and a
latch that stays shut leaves the dialog alive and deaf with Cancel the only way out. And
**the focus never lands on a checkbox**: the archive dialog is a list of them, and focusing the
first buries the field the dialog is actually asking you to use; on a filename field the
selection stops at the last dot, so typing straight over `report.final.pdf` keeps `.pdf`.
`closeDialog` answers `'cancel'` for a `pasteConflict` and for nothing else — that is the one
dialog with a caller awaiting an answer, and submitting any other on its way out would perform
the operation the user just dismissed.

**A long operation is a note that is not finished yet.** `notifications.progress({title,
total, unit, source})` returns a *handle* — `update({value, total, message})`, `done()`,
`fail()`, `dismiss()` — and draws a card in the same stack as everything else the system
says, reachable from inside an app as `parent.startProgress`. It is not a dialog on
purpose: a dialog would take the focus and block the thing it describes, whereas installing
`monaco` (98 files, 11.6 MB, fetched one at a time) has to be able to run while you keep
working, and two can run at once. Five things about it are load-bearing. It **never
expires** — `timeout: 0`, not a level with a timer — because it ends when the operation
ends. It is **never folded** into an identical note: two installs are two operations and a
`×2` on a progress bar would describe neither. `update()` **patches the card in place**
rather than calling `render()`, which rebuilds the whole stack — 98 files would otherwise
throw away and rebuild every note on screen 98 times, and the width transition with it;
`note.ui` holds the nodes and is re-made by every `render()`, so it is never a reference to
a detached one. A count is **floored, never rounded**, because a caller may advance by a
fraction (the boot note moves by a fraction of an app as each of its files lands) and
"3 of 5" when the third has barely started is worse than no number. And **the × is a
decision**: after the user dismisses it, `update()` and `done()` do nothing, but `fail()`
still raises its error — "stop telling me about this" is not "do not tell me it broke".
With no `total` the bar is indeterminate and animated, because an operation that cannot
count its own steps still has to look distinguishable from one that has hung.

**Every interactive install goes through `window.installAppById`, and that is where the
bar lives.** App Manager, the *Open with…* chooser and `openCatalogApp` all call it, so
the note is raised once rather than in three places that would drift. On failure the
progress note *becomes* the error card — the same card the user is already watching, naming
the app and the reason — which is why the chooser and `openCatalogApp` deliberately swallow
the error instead of reporting it again; App Manager had no failure surface at all before
this and now inherits one. The registry itself stays UI-free: `installAppById(appId,
onProgress)` takes a callback, called **before** each file with the count already finished,
so the bar shows completed work while the line under it names what is in flight. Boot is
the second shape that callback exists for: `installPreinstallApps` installs its apps with
`{quiet: true}` and covers all five with one note, advancing fractionally per file — five
cards appearing and self-dismissing while the desktop is still being built is noise.

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
twenty-five rots the day someone adds an app. The **apps preinstall installs** are followed
the same way, out of `settings/preinstall.json` and then each manifest: caching the manifests
and not the files they name left a first offline boot with a shell and no apps. The strategy is **network first, cache
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

## Apps that carry their own engine

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

**Explorer's half of 7-Zip is `apps/explorer/js/archive-ui.js`, and three of its rules are
not the obvious ones.** **A wrong password is a question, not a failure**: the extract dialog
stays open and asks again with what went wrong above the field, because closing it and raising
a card would throw away the listing and make the user reopen the archive to try a second
password. Only a `kind` that is not `password` closes it. **Extraction always makes a folder
of its own, and never one whose name is taken** — extracting the same archive twice is
ordinary, and merging into a folder somebody has since put their own files in cannot be
undone; compressing is stricter still, because 7-Zip does not *replace* an archive it is given
the name of, it tries to add to it and stops with "Is not archive". **A redraw is not a
reopen**: `openDialog` wraps a dialog's callbacks so a throw inside one is reported, and it
wraps again every time it is called, so a four-state dialog that re-opened itself on each
redraw would end up several layers deep in its own error handling — `refreshArchiveDialog`
calls `renderOverlays` for the live dialog and `openDialog` only for one that is not on screen.
Two more things are easy to undo by accident: the engine promise is cached but a *rejection*
is not, so a failed load does not poison the rest of the session; and an answer that arrives
after the dialog has been closed is dropped rather than reopening it over whatever is on
screen now.

**A screen recording is written by the browser and then repaired.** Explorer's recorder is
`apps/explorer/js/recording.js`, and five things in it are load-bearing. **A webm out of
`MediaRecorder` carries no duration** — as far as the container is concerned it is still a
live stream — so a player shows it as 0:00 and will not seek; `apps/fix-webm-duration.js`
patches the header afterwards, and the length it needs comes from Explorer's own clock,
because nothing in the file knows it. An mp4 does not need this and does not get it, and a
patch that fails writes the original rather than nothing. **One recorder takes one stream**,
so system audio and the microphone are summed through an `AudioContext` into a single track
before it sees them — two audio tracks on one `MediaStream` is not a mix, it is two tracks,
and what survives is whichever one the container decided to keep. **Stopping is two passes
and has to stay two**: the first call only asks the recorder to stop, because the last chunk
has not been handed over yet, and the recorder's own `onstop` calls back once the file is
written to do the teardown — collapsing that into one pass loses the end of every recording.
**Every track is stopped on every route out**, including the two failure paths that run
*after* the permission prompt has been answered, or the browser's own capture indicator stays
lit over a window that believes nothing is recording; and the browser's *Stop sharing* bar
fires nothing of ours, so the video track is watched for `ended` — the same rule, for the
same reason, as a peer call. **Muting is done on the track, not on the gain node**, so a
muted microphone is muted for the browser too and its indicator goes out with it; a gain of
zero is still a live microphone. And **there is no audio-only screen capture**:
`getDisplayMedia({video: false})` is not a smaller ask, it is a rejected one — it throws
`NotSupportedError`, which is how *record with the video off* came to answer *Could not start
screen capture / Not supported* and record nothing at all. Turning the video off now means one
of two different requests. With system audio wanted, the picker is still opened asking for
video, because a tab's or a screen's sound only ever comes attached to a video track; the
track is simply left out of what the recorder is handed, and deliberately **not** stopped —
it is what the *Stop sharing* bar and the `ended` watch hang on, and stopping it takes the
audio down with it. With system audio not wanted either, `getDisplayMedia` is not called at
all, because nothing is being taken off the screen and nobody should be asked to choose one.
The format follows: with no video track in the stream a video mime is not an over-ask but a
wrong one — the recorder is being told to write a vp9 track it will never be given — so the
container becomes `audio/webm` or `audio/mp4`, whichever this browser admits to supporting,
and the file is named `.webm` or `.m4a` for what is actually in it rather than for what was
picked in the dialog. None of this was reachable by a test until phase 21 made
`getDisplayMedia`, `MediaRecorder`, `AudioContext` and the clock into parameters — the first
of those cannot be reached at all without a person answering a prompt over a real screen.

## The desktop and its widgets

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

**Only the desktop layer knows whether a widget can be seen.** `system-stats.js` stops
polling on `document.hidden`, which is about the *tab* — a desktop buried under a maximised
window is exactly as invisible and costs the same. So `desktop.js` tells `widgets.js` (it
already did, to fade them out) and `widgets.setVisible` tells
`stats.setDesktopVisible`, which re-reads storage the moment it comes into view and polls
every 10 s while it is there rather than every 60 s regardless. That was half of "the
storage widget looks frozen"; the other half is not fixable and is in the widget's tooltip
instead — `navigator.storage.estimate()` reports the quota manager's bookkeeping for the
whole origin on the browser's own schedule, so a re-read can honestly return the same
number, and Disk Treemap is what measures the filesystem.

**An animated background is paused the moment it is covered, and unloaded if it stays
covered.** `desktop.js` decides when the background cannot be seen (a window on the active
desktop, no peek, or a hidden tab) and tells the handle `wallpaper.mount` returned. The handle
pauses at once and, after `UNLOAD_AFTER_MS` (30 s) still out of sight, unmounts the provider; the
next reveal mounts it again from the start. Both halves are needed. A pause saves only the drawing:
a page keeps its memory, its textures, its timers, and a shader its WebGL context. Unloading at
once would save everything, but the desktop is uncovered constantly — a peek, the last window
closed, a switch to an empty desktop — and each would restart the scene and read it from storage
again. A colour or an image returns no instance and is never unloaded. The handle is also why a
provider keeps nothing in module state since phase 26: the same shader can be the background and
the screensaver at once, and `tests/wallpaper-shader.test.mjs` runs two.

**Hiding a frame does not stop it drawing.** Measured in headless Chrome 153 with
`docs/checks/hidden-frame.html`: a same-origin frame under `display:none`, `visibility:hidden` or
`opacity:0` goes on at 60 frames a second. So `wallpaper-page.js` pauses a page one of two ways. A
page that defines `window.pixosPause` / `window.pixosResume` is asked. Any other has its
`requestAnimationFrame` replaced from outside on every load (`holdAnimationFrames`): while held, a
callback is queued rather than scheduled, and a release hands the queue on — the same check took
that to 0 frames and back to 60. Its `cancelAnimationFrame` is replaced too, or a page cancelling an
id it was given while held would cancel nothing. A hold cannot reach a timer or a CSS animation;
those stop when the handle unloads the page.

**A page as the background never takes the pointer itself.** Its frame is `pointer-events: none`,
because a frame that took the pointer would also take the right-click (the desktop's menu) and
dropped files. The desktop listens for `pointermove`, `pointerdown`, `pointerup` and `click` and
hands each in as events made in the frame's own window, at the same place under the frame's
corner — a pointer event and its mouse event both, since a made pointer event brings no mouse event
with it. Only the left button is handed in, a move goes in wherever the pointer is, and a press on a
widget is the widget's. The events are not trusted (`isTrusted` is false): a page that checks will
ignore them. A page that 404s is caught by the status Chrome reports for the frame's navigation
(`responseStatus`), taken away, and reported through the handle's `onError` — otherwise the worker's
*404 File Not Found* page would be drawn as the background.

**The screensaver counts idle two ways, and trusts the browser's over its own.** Where Chrome's
`IdleDetector` is allowed, it is the authority: its threshold is the wait itself, so when it says
idle the last input anywhere on the machine was that long ago, and `decide` in
`js/shell/screensaver.js` ignores what PixOS saw before that. Input PixOS sees *after* it still
counts, because the detector says so only a moment later. Without it, idle is the time since the
last input PixOS saw: its own document, plus every same-origin window through the WM's bridge,
which since phase 26 also counts `pointermove` and `wheel` inside windows — passively, at most once
a second (`noteActivity` → `activity`), never passed on as events. That fallback cannot see into a
cross-origin frame, so it never starts while the focus is in one (`opaqueFocus`), but scrolling a
web page window without clicking into it is invisible to it, and the screensaver can start over
someone reading. Focus outside the page altogether — the address bar, another program — holds
nothing off: that is usually someone who has walked away.

**A video, a hidden tab or a locked screen hold it off, and the wait starts again from them.** A
playing `<video>` or `<audio>` in the shell or any same-origin window counts as input
(`mediaPlaying`), except what plays in the desktop layer or on the screensaver itself — a
background with a video in it would otherwise hold itself off for ever. The walk through every
window happens only once the wait is over, not on every five-second tick. Sound made through Web
Audio alone, or media kept out of the DOM, cannot be seen.

**The permission is asked in the click that turns it on, and nowhere else.** Chrome shows no prompt
without a user gesture, so the dialog's tile click calls `askForIdle()`, which calls
`IdleDetector.requestPermission()` before its first `await` — after one, the activation may be
gone. A headless Chrome answers the prompt with *denied* on its own; the permission is granted
there with CDP (`Browser.grantPermissions`, `idleDetection`) and idle faked with
`Emulation.setIdleOverride`.

**The input that ends the screensaver goes nowhere.** Its layer takes the focus when it starts, so
a key reaches the shell's document and not an app, and a press lands on the layer and not on a
window. The layer stays, clear, until the press is let go, or the click that follows it would land
on whatever is underneath. The key listener is a capture listener on `window` and swallows with
`stopImmediatePropagation`, which stops only listeners registered *after* it — so `index.html` calls
`screensaver.init` before `desktop.init` and before the shell's hotkey handler, or a Ctrl+K that ends
the screensaver would also open the palette. The launchers register their Escape handlers at module
scope, earlier than anything, so the screensaver closes them as it starts (`onStart`): an Escape
that closed the palette under it would not also end it. A pointer move ends it only after its
first second and only a few pixels from where the pointer stood — the hand leaving the mouse after
*Start screensaver*, and a desk being bumped, are not someone back. A repeating key never ends it:
that is the chord that started it, still held.

**Explorer shows a screensaver rather than opening it, and keeps its own copy of which names are
one.** Double-click or Enter on `Name.xscr.html` or a `Name.xscr` folder previews it — the menu calls
that entry *Preview* — so a folder one is no longer gone into by double-click: *Show contents* does
that, and *Open with...* still opens the page. Both ask one function, `previews` in
`apps/explorer/js/shell-actions.js`, which is true only where the shell has `previewScreensaver`; a
standalone Explorer opens it as before. The rule is `isScreensaver` in Explorer's `format.js`, a copy
of `isScreensaverPath` in `js/shell/wallpaper-page.js` rather than an import: that module is not in
BrowserFS, and loading it registers a background provider in Explorer's window.
`tests/explorer-format.test.mjs` checks the shell takes every name Explorer does, so *Preview* never
offers what the shell would fail to show. **A screensaver folder is the one folder whose kind is not
`dir`** — it is `scr`, typed *Screensaver* and sorted under that name — but it is still a directory
everywhere else (`data-type`, folders first). *Set as screensaver* from Explorer asks for idle
detection like the gallery does, and the click it is asked in is on Explorer's menu, in a frame:
Chrome counts a click in a frame as its parent's too, so the shell's request still carries it —
checked in headless Chrome against a control, where the same request with no click is refused with
*Must be handling a user gesture* and leaves the permission at *prompt*.

**Matrix, Pipes and Desktop Habitats are downloaded the first time a look is chosen, and a look
downloads only what it needs.** They are vendored in `apps/screensavers/` but not in `preinstall.json`:
23 MB, most of it Reefscape's 15 MB of rock, for something most people will choose once or never. The
generator writes `apps/screensavers/index.json` from the folders (`scripts/screensaver-index.js`), and
a folder's `looks.json` — ours — names each look's page and query and **the files only it owns**; a
file no look claims is shared. So Riverscape is 6.7 MB and not 24, and choosing Reefscape afterwards
fetches only what Reefscape adds. The generator refuses a claim that matches nothing, because a typo
there would silently download everything. `js/shell/screensaver-catalog.js` fetches what a look needs
and BrowserFS does not have — *have* meaning the file exists, since a write is one IndexedDB value —
one file at a time, **checks each is the size the index says** (a host's fallback page is a 200 too),
and **writes the look's page last**. A download cut short then leaves a look whose page is missing,
which fails to mount and says so, rather than one that starts and draws without its textures; choosing
it again fetches the rest. The dialog puts a progress note over it that becomes the error on failure,
and chooses the look when it is done — **unless something else was chosen since**, in the dialog or
from Explorer, which wins (`choose` in `wallpaper-dialog.js` counts every choice). The screensaver tab
still asks for idle detection first, in the click: the download would take the activation with it.
`tests/screensaver-catalog.test.mjs` and `tests/screensaver-index.test.mjs`, which also rebuilds the
index from disk and fails if it was not regenerated.

**A folder chosen by its path alone opens the first of its looks that is here.** Explorer's *Preview*
and *Set as…* and the file field name a folder, not a look, and Pipes' `index.html` shows a panel of
controls unless its look's address hides it. So `wallpaper-page.js` reads the folder's `looks.json`
through the worker and opens the first look whose page the worker serves (`firstLookEntry`) — with only
Riverscape downloaded, Habitats is Riverscape, not a 404 for Reefscape. The gallery marks the same
tile. **Offline there is no index**, so the gallery is what is on disk, and a folder's own `looks.json`
still lists every look: only the looks whose page is here are offered. A look chosen for its entry
carries `options.look` as well, which is what makes two looks of one folder two pictures.

**Habitats in host mode draws nothing until it is given a frame rate.** Its `wallpaper.html` says
`data-motion="host"`, which hands its motion to whoever embeds it. PixOS's
`scenes/shared/pixos-host.js`, loaded after `start.js`, gives it 60 (the quality profile caps it at
30) and maps `pixosPause` / `pixosResume` onto `habitatRate(0)` / `habitatRate(60)`: rate 0 stops the
loop with no frame and no timer left, and the time stopped is not simulated afterwards. `start.js` keeps
the last rate it is given until the scene has loaded, which is why the script can run first.
`habitatPower`, which the plan once named for the pause, is its battery switch — pass 5's. Matrix and
Pipes have no such hook and need none: both draw only from `requestAnimationFrame`, so holding their
frames stops them entirely.

## Windows, desktops and sessions

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

**A window title is a filename, and GoldenLayout drew it as markup.** `Tab.setTitle` hands
the title to jQuery's `.html()`, so a file called `<img src=x onerror=alert(1)>` ran its script
the moment somebody opened it — in the *shell's* window, which is where the filesystem, the
session and every app's iframe live. Titles reach that call from three directions (a file
opened from Explorer, an app calling `setTitle`, a session restored from disk), so it is fixed
at the one place it is drawn: `makeTabTitlesSafe` in `js/shell/wm.js` replaces
`Tab.prototype.setTitle` with the same method written through `.text()`, at import, before any
layout exists. It is patched from our side rather than inside
`js/goldenlayout/goldenlayout.min.js` because that is vendor code and an edit in there is an
edit that disappears with the next bundle. The tooltip is better off for it too — the original
ran the title through `stripTags`, which deleted whatever part of a filename looked like a tag.
Everything else in the shell that draws a title (the taskbar, the overview, the palette) uses
`textContent` already, and `tests/wm.test.mjs` is what keeps the patch honest.

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

## Getting around

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

**Every shell chord is spelled once, and the sheet reads the spelling the handler does.**
`js/shell/shortcuts.js` holds each chord as a string (`Mod+Shift+K`; `Mod` is Cmd or Ctrl,
whichever is held), and the hotkey handler in `index.html` and the peek's in `desktop.js` test a
keydown with `matchesChord` against that string — which is also what the *Keyboard shortcuts*
sheet, the palette's key column, the desktop menu's hints and the taskbar tooltip print, through
`formatChord` (`⇧⌘K` on a Mac, `Ctrl+Shift+K` elsewhere). Before phase 25 the handlers tested
modifier flags by hand and a hint was typed in beside the command, as `Ctrl+K` — which on a Mac is
not the key anyone presses. `matchesChord` is strict where the old tests were loose in two places:
a modifier the chord does not name must not be held, so `Ctrl+Shift+Space` no longer opens the
palette and `Cmd+Shift+W` in fullscreen no longer closes a window.

**A chord the OS takes is bound but not advertised.** `Ctrl+Space` (macOS input sources) and the
peek's `Ctrl/Cmd+Alt+D` (taken on a Mac in phase 1; `⌥⌘D` is the Dock's show-and-hide) are left off
the Mac sheet and out of every Mac hint by `availableKeys`, and stay bound for the machine where
they do arrive. **`Ctrl/Cmd+/` opens the sheet except while typing**: it is *toggle comment* in both
code editors, which take their keys through a hidden textarea, so the handler lets the chord through
to any text field, textarea or contenteditable. The sheet takes the focus when it opens, for the
overview's reason — the window in front is usually an app, and its Esc would never reach the shell.

**App icons are mostly generated.** `pixos.app.json` gains an `icon` when the generator
finds `favicon.svg` / `icon.svg` / `favicon.png` / `icon.png` in the app folder — and only
if that file is also in `files`, or installing would not copy it. Barely any app ships
one, so `app-icons.js`'s monogram fallback (initials on a colour hashed from the id) is
the normal case, not the exception.

## Launching, and the app contract

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

`setWindowPath(path)` is injected beside it, bound the same way, and is **where a window now
stands** for an app that moves around inside itself. A session saves each window's launch
descriptor, and that descriptor was written once, when the window opened — so until Explorer
reported its folder, every reload brought every Explorer back to the folder it had been *opened*
in: the root for one opened from the menu, a mount point for one opened by mounting, never the
folder it was left in. `wm.setPath` replaces the descriptor's first path and announces a change
only when the path is a different one. Explorer calls it at the end of a successful listing,
**after** the walk up from a folder that has gone, so a window is saved where it is drawn; a
listing that failed reports nothing. A folder under a mount that has not come back yet — a local
folder waiting for its click — is therefore saved as the folder the window walked up to.

`watchStorage(win, handler)` is the one figure an app is handed rather than asked for: the storage
use `js/shell/system-stats.js` already measures for the taskbar and the widgets, drawn since phase 24
in Explorer's foot. It is `parent.watchStorage`, not injected — it needs no window id — but it takes
the app's own window like `watchFiles` and stops the first time that frame is found gone. **Only a
change is passed on.** `system-stats` emits every second for the clock, and each of those carries the
same storage object, so the shell compares and calls the handler once per new figure, plus once
straight away with whatever is known — `null` until the first measurement, `{supported: false}` in a
browser that will not estimate. `subscribe` calls back *before* it returns, so a window already gone
on that first call cannot reach `stop` yet; it is stopped once `subscribe` has returned. The figure
is the quota manager's bookkeeping, which Chromium updates on its own schedule after a write, so a
copy that just finished can still show the number from before it.

**An app's keys are the app's to list, and are read when they are asked for.** An app sets
`window.pixosShortcuts` to a list of `{keys, label, note}` in the shell's spelling, and the shell
reads it from the window in front at the moment the shortcuts sheet opens (`frontAppShortcuts`),
checked entry by entry by `readAppShortcuts` — a bad entry is dropped, a cross-origin frame answers
nothing. It is deliberately **not** a `pixos.app.json` field: a manifest field has to be named by hand
in four record builders (see `autosave` below) or it silently does not exist, and a list kept in the
manifest is kept away from the handler it describes. Explorer keeps its list in `apps/explorer/js/keys.js`
beside nothing but itself, and its test presses every chord on it against the real handler. An app
that wants to print a chord the way the shell does calls `parent.formatShortcut(spec)` and
`parent.isMacPlatform()`; Explorer's menus and tooltips do, and print nothing with no shell.

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

## When a file changes underneath a window

**Nobody is asked to announce a write, because the one who forgets is the whole bug.**
Two Explorer windows on one folder each read their listing once, when the folder was
opened; delete a file in one and the other still shows it. The obvious fix — have every
writer say what it wrote — has a hole in it that never closes: every app, every shell
module and every call site added later has to remember, and the first one that does not is
a stale window nobody can explain. So the writers are not asked. There is exactly one
`fs` in this system, created in `fsOnInit` and reached by Explorer, terminal, treemap and
filmoskop as `parent.fs`, and `js/shell/fs-events.js` wraps its mutating methods at that
single point, **before `MountManager` exists and before anything has written**. A write is
announced because it happened, not because somebody remembered.

**The wrap has to be invisible, which is most of its code.** The callback is found as the
trailing argument rather than at a fixed index, because `writeFile` is called both with and
without options; a call made with no callback at all gets one appended, which is the shape
a caller with options already produces. It reports **only after success** — a refused write
did not change anything, and a listing refreshed because of one would be a lie in the other
direction. It is idempotent, so a second `watchFs` does not double every event. And nothing
inside it may throw into a caller: recording is wrapped, and one listener throwing does not
stop the next one hearing about the change.

**The one writer this cannot see is a mount**, because mounting changes what a directory
contains without going through `fs` at all. `MountManager` reports itself, from
`_notifySW` — the one function every one of its six mount-table changes already calls. It
hands over the **whole table** rather than the difference, because none of those six call
sites knows which one it is; the shell diffs it. A write made through a file descriptor
(`open`/`write`/`close`) is the remaining gap, and nothing does that today.

**Coalescing is not a debounce, and not a throttle.** A batch is emitted once writes go
quiet (80ms), *and* at least every 500ms while they keep coming. Debounce alone would say
nothing at all for the whole of a long copy — the listing would sit still until it
finished. Throttle alone would keep firing after it ended. Both together mean a copy of
five hundred files refreshes a listing twice a second while it runs and once more when it
stops. A batch is also **capped**: past 200 entries or 50 folders it sets `truncated`
instead of growing, and **every question a truncated batch is asked is answered `true`** —
so extracting an archive costs a needless refresh rather than a missed one.

**The questions live on the batch, not in the listener.** `change.affects(dir)` is *did
this folder's listing change* and `change.touches(path)` is *is what I am holding still
what is on disk*. Neither is obvious: a rename changed **two** folders and the batch
carries both ends of it as one entry; the folder you are standing in being removed counts
as your listing changing, and so does any folder above it; a plain write counts, because
Explorer shows size and modified time. Every one of those is a thing a listener would get
wrong once per listener, so no listener is allowed to work it out.

**An app hands over its own window: `parent.watchFiles(window, handler)`.** The shell
cannot tell which iframe called a `parent.*` function — the same problem `markDirty`
solves by being injected — but injection happens on `load`, which is already too late for
an app that wants to subscribe from its first inline script, as Explorer does. Passing the
window solves both halves at once: the subscription is tied to something the shell can
check, and it drops itself the moment that window's frame leaves the document, instead of
pinning a dead app's whole realm in memory for the rest of the session. The returned value
unsubscribes. `parent.addEventListener('pixos:fs-changed', ...)` is the same batch with no
handshake at all, for anything that would rather listen that way; it is what App Manager
already does for `pixos:apps-registry-updated`, and it is the one that leaks.
`parent.notifyFileChange(kind, paths)` is for a writer the wrap could not see.

**The other tab hears about it too**, over a `pixos-fs` BroadcastChannel — deliberately
*not* the one `tabs.js` uses, whose vocabulary is an ownership election and would be muddied
by traffic. A batch that arrived from elsewhere is marked `remote` and is **never
re-broadcast**, or two tabs would hand one write back and forth for ever. This does not make
two tabs safe to write the same file — that still races, and `tabs.js` still says so — it
only means the loser finds out.

**An empty listing does not mean an empty folder.** Explorer's `readdir` wrapper resolves
`contents || []`, so it answers the same for a folder with nothing in it and for a folder
that is not there any more — and once phase 20 made a window refresh itself when something
changed elsewhere, deleting the folder somebody was standing in emptied their listing,
left the dead path in their breadcrumbs, and said nothing. `refreshCurrentDir` now asks
`stat` **only when the listing came back empty**, which is the only case that can be
either, and on a folder that is gone walks up to the nearest one that still exists and
raises a `warn` note naming both. It walks rather than taking the parent because deleting a
tree takes the parent too. The regression to watch for is the other half: a folder that is
simply empty must still be left exactly where it is — `tests/explorer-listing.test.mjs`.

**A dropped folder arrives twice, and the obvious half is the wrong one.**
`dataTransfer.files` carries one entry named after the folder; `dataTransfer.items` carries
a directory entry that can be walked with `webkitGetAsEntry()`. Choosing between them with
`if (!files.length)` means the walk never runs — Chrome always fills `files` — and the
directory goes down the loose-file path, where `FileReader` answers `NotFoundError: A
requested file or directory could not be found at the time an operation was processed`.
Explorer did that from the day folder drops were added until phase 21, so they had never
worked once. The test is *is there a directory among the entries*, not *is `files` empty*.
And `webkitGetAsEntry()` has to be called **synchronously inside the drop handler**: the
item list is emptied the moment that handler yields, so resolving the entries after the
first `await` reads an empty list and drops nothing, silently.

## Storage, and what the browser will not keep

**The filesystem is evictable unless you ask.** `navigator.storage.persist()` is requested
once per boot and the storage widget reports what was actually granted — *persistent*,
*best effort*, *unknown*. Never what was asked for: Chromium grants silently on engagement,
Firefox prompts, Safari has no equivalent, and a durability promise nobody verified is worse
than none because it is the one people rely on.

**A file is one IndexedDB value, and a refused write says nothing about why.** BrowserFS's
IndexedDB backend translates a *synchronous* failure properly — a `QuotaExceededError`
becomes `ENOSPC` — but an asynchronous one goes through a handler that ignores
`request.error` entirely and reports a bare `EIO` however it failed. It also commits the
inode before it stores the data, so a refused write leaves a file of the right name and
**zero bytes** looking like it worked. That combination is what a 150 MB drop produced:
an empty file and *Input/output error*. Three things follow. `failure.js` owns
`MAX_FILE_BYTES` (128 MiB — the number in Chromium's own message; nothing keeps a value
larger, and PixOS keeps a file as exactly one) and `describeWriteLimit`, which is asked
**before** the write, because afterwards there is nothing left to explain with — and
because a file that cannot be stored should not be read into memory to find that out. It
is pure, so the `navigator.storage.estimate()` answer is passed in, not read, and a
browser that will not estimate does not block the write. Explorer's `writeIncomingFile`
(`apps/explorer/js/file-ops.js`, with the move and copy loops and the conflict question)
removes what a failed write left behind, and **stages a replacement under
`<name>.pixos-part` before touching the file it replaces** — the old order deleted first,
so a write that failed took the original with it. A file arriving by drop lands **where it was
dropped** — `onFileHandler` takes the destination folder as an argument and only falls back to
the folder being shown when it is not given one, because dropping a file onto a folder row
plainly means putting it in that folder. The row's own drop handler cannot do it: only this side
knows how to write a file, so that handler has to leave an event carrying nothing of ours
*alone* rather than claiming it. It did not — `preventDefault` and `stopPropagation` ran before
it worked out whether anything was being dragged — and a drop onto a folder did nothing
whatsoever: no file, no error, no console line. **A dropped folder is resolved at its root,
once.** It reaches `onFileHandler` one call per file, each carrying a path rooted at the drag
rather than a name, so the question every other arrival asks would be asked once per file —
a few hundred times for a folder worth dropping. It was therefore not asked anywhere, and a
folder dropped onto one that already had its name merged into it silently, file by file,
while dragging the same folder between two places *inside* PixOS asked first.
`resolveIncomingRoots` asks it once per top-level folder in the drop, before anything is
written; answering *keep both* resolves the root to a free name, which is also why nothing
below it can then collide. `rerootIncomingPath` carries that one answer down — and strips the
leading slash the drag adds, which is how a file dropped *beside* a folder came to look like
folder contents and skip the question too. Every route a file arrives by (drop,
paste, Upload) goes through `addIncomingFile`, which reports per file: all three are event
listeners, and nothing awaits one of those, so a rejection escaping one is an unhandled
rejection reported without ever naming the file.

**One spelling of a size.** `formatBytes` lives in `failure.js` and is re-exported by
`peers.js` and `system-stats.js`. It was in `system-stats.js`, which reads `navigator` and
attaches listeners on import — so nothing pure could borrow it and `peers.js` wrote its
own, which rounded differently. `apps/system-info` has a fourth copy and always will: an
app is installed *into* BrowserFS and cannot import a shell module, the same reason the
frontmatter parser is written twice.

**A mount is written down, and comes back only as far as the browser allows.**
`js/shell/mount-table.js` keeps the table in `/settings/mounts.json` and restores it during boot,
**before the session** — a window restored into `/mnt/work` has to find it mounted, or Explorer
walks up out of an empty mount point and says the folder is gone. The four types cannot come back
alike, and treating them alike breaks three of them. A zip or an iso is read again from the file
it was mounted from, which is why archives are now mounted **by path** (`mountZipFile`,
`mountIsoFile`): a mount made from bytes names no file, and is not kept. **Files3 mounts silently
only while its token is still in `localStorage`** — `ensureToken()` with no token opens a popup,
and a popup opened during boot has no click behind it and is blocked, so the restore asks
*whether* there is a token rather than asking *for* one. A local folder is a
`FileSystemDirectoryHandle`, which is structured-cloneable but not bytes, so it lives in an
IndexedDB database of its own (`pixos-mount-handles`) rather than in the JSON; after a reload
`queryPermission()` usually answers `prompt`, and `requestPermission()` answers only inside a
click — so in `reconnect()` it is **the first call, before anything is awaited**. A peer is not
kept at all (`docs/backlog.md`). Whatever cannot come back **waits** — in the table and as a row
in Explorer's sidebar reading *click to reconnect*, *click to sign in* or *did not come back* —
until it is clicked or forgotten; only a real failure raises a note, once per boot, because a
folder waiting for a click is every local folder on every reload. Two rules keep the file honest.
**Nothing is written until the table has been read**, or a mount made earlier in boot — a peer
connecting — writes a table of one over the table about to be restored. And, as with the
session, **only the tab that owns the settings writes** it; a follower restores and adds nothing.
The handles, the document and the pruning of handles nobody uses are three separate steps, so a
handle store that will not open costs the local folders their handle and not the zips their place.

## Manifests, boot, and what a fresh system is made of

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

**A file added to a system app has to be named in four lists, and none of them complains.**
Explorer was two files until phase 21 and this never came up. Now `apps/explorer/` holds a
stylesheet and a `js/` folder, and each file in it has to appear in `pixos.app.json` (by
hand, as above), in `settings/preinstall.json` (or it is never copied into BrowserFS, and
Explorer 404s it on the next boot), in `PRECACHE` in `sw.js` (or a first boot with no
network gets an Explorer with holes in it), and in `FALLBACK_PREINSTALL` in the shell's
`index.html` (or a boot that cannot reach `preinstall.json` gets the same). Changing
`PRECACHE` means bumping `SHELL_CACHE` in the same edit, because the worker already
installed keeps serving a cache that has never heard of the new file — the symptom is an
Explorer that opens unstyled, which reads like a CSS bug and is not one.
`tests/explorer-modules.test.mjs` walks the folder and asserts all four lists agree with
what is on disk.

**Explorer's fonts are files in those lists too, and binary ones.** Phase 24 bundled Archivo and
DM Mono under `apps/explorer/fonts/` — ten `woff2` files, two licences and a README, thirteen
entries in each list. Two things came with them. Preinstall copies with `arrayBuffer()`, so a font
arrives intact, but the worker's MIME table had no `woff2` and served it as
`application/octet-stream`; browsers load a same-origin font anyway, and the table now says
`font/woff2` so nothing depends on that leniency. And the fallback check in
`tests/explorer-modules.test.mjs` read a fixed 2000 characters after `FALLBACK_PREINSTALL`, which
thirteen more lines pushed Explorer's last entries past — it now reads to the end of the literal.
**Neither face has Cyrillic**: a Russian file name is drawn letter by letter in the fallback face
named after them in `--ui` and `--data`, in the same line, which is the browser working as intended.

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

**A boot that did not get what it asked for now says so on screen.** Both halves used to
fail into `console.error` alone, and the result was unreadable from the outside: a server
missing two files in `templates/` produced a PixOS with **no `/home` folder at all** —
nothing else in the system creates that directory, it exists only because a seed is written
into it — and an About widget quietly reading a file that had never been written.
`describeSeedFailure` and `describeBootFallback` in `failure.js` write the sentences;
`seedUserFiles` raises **one** note after its loop rather than one per file, because four
missing templates are one deployment problem, and each line names the destination *and* the
template it came from — whoever is reading the note is usually the person who deployed the
server the file is not on. The fallback note is an `error` rather than a `warn` because a
system on `FALLBACK_PREINSTALL` looks exactly like a working PixOS somebody emptied.
Neither is recorded as done, so uploading the missing file and reloading is the whole fix.
What is still console-only is `copyPreinstallFiles` — see `docs/backlog.md`.

**A static host is allowed to have an opinion about your files, and Jekyll has one.**
GitHub Pages processes any file that begins with a `---` YAML front-matter block: it is a
page, and a markdown page is *published as `.html`*. So `templates/about.md` and
`templates/talk.deck.md` — the only two files in this repo that open with a fence — were on
the server and 404 at the URL PixOS asks for, while `thanks.block.md` (no front matter) and
`links.json` were served untouched. The fix is **`.nojekyll`** in the published root, which
turns the processing step off for the whole site. **Renaming the extension is not a fix:**
Jekyll processes any extension once front matter is present and strips the front-matter
block from what it publishes, so the URL would answer 200 with exactly the half of
`about.md` the About widget reads removed — a silent failure in place of a loud one.
`tests/precache.test.mjs` ties the two together: if a seed template opens with a fence,
`.nojekyll` has to exist.

## Frames that are not apps

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

## Frontmatter, parsed twice

**Frontmatter is parsed in two places on purpose.** `js/shell/about.js` for the desktop
widget, `apps/markdown-viewer/js/markdown.js` for the app. An app is installed *into*
BrowserFS and must be self-contained, so the shell cannot share a module with one. Both
copies are covered by `npm test`; if you change the accepted syntax, change both.

## Peers: another machine

**Another machine is a session, and the wire is a closed list.** `js/shell/peers.js` owns
the connection — not Explorer, because a shared folder is a *mount*, a call is not a file
manager's business and a phone driving this machine is not either; apps get only
`window.peers.list()` / `.sendFile()` / `.open()`, never connect or identity. Five things
are load-bearing. `parseMessage` accepts exactly the message types on its list and returns
null for everything else, bounding every field it does accept: what arrives was written by someone
else's machine, and the share this replaces took an HTML document over the wire and
`new Function`'d it. An incoming file is a **question** (a note with Accept/Refuse) that
lands in `/home/received` and never on top of an existing name — `fileName()` keeps only
the last path segment, `cleanName()` strips control characters before a peer's own name is
drawn in the panel that reports on it. The **id is stable** (`/settings/peers.json`) so a
reconnect needs no fresh link, which also makes it a stable identifier — hence shown,
copyable and resettable. **One tab holds the connection**, because a peer id registers with
a broker once; a follower says so. And **vendoring PeerJS did not remove the broker**: WebRTC
needs an introducer, by default the PeerJS cloud, so the host is configurable for a LAN
`peerjs-server` and the panel names whichever is in use. Explorer's old *Share* — a second
peer connection, in the app, that sent the guest a page of HTML and script their browser
then evaluated — was removed once the mount had been walked; `tests/peers.test.mjs` checks
that no file of Explorer's — `index.html` or any module beside it — contains a `new Peer(`, a
`data:text/html` or a `new Function(`, because that
is the property the removal was for, not the line count. It also removed a bug nothing else
could see: the peer share and the old one both wrote a `stopSharing` into the same `actions`
object, the second silently won, and *Stop sharing with peers* in the folder menu had never
once done anything. `tests/explorer-menus.test.mjs` now refuses a duplicate action name.

**A conversation is a file, and the panel that shows it must not be redrawn.** Chat adds
two types to the closed list — `chat` (one bounded string) and `chat-typing` (nothing at
all) — and lands in `/settings/peer-chats/<peer id>.json`, one file per peer, capped at 300
messages, read lazily and parsed as defensively as the wire. Four things are load-bearing.
**The clock is this machine's**: a message carries no timestamp, because a sender choosing
its own could put its line at the top of your history. **The composer is not part of what
`render()` rebuilds** — a ping lands every 3 s and every ping redraws the panel, so the
conversation is a second column with its own lifetime and `refreshChat()` appends only what
is new, never reassigning `disabled` on the field being typed into; drafts live in memory
per peer and are never written down. **Unread means "while you were not looking"**, so the
panel tells the module which conversation is on screen (`readingChat`) and a note is raised
**once per peer**, not once per message. And the note is `source: 'PixOS'` with the peer's
name in the *title*, because a peer picks its own label and one labelled "PixOS" must not
borrow the system's voice. Nothing here holds a message for a disconnected peer — sending
fails and the text goes back in the composer. Chat is deliberately **not** in `window.peers`:
an app being able to say something as you is not the same as an app offering a file.

**A call is agreed in words before any media moves, and it is not drawn in the panel.** Six
more types on the closed list (`call-offer` with one of exactly two `CALL_KINDS`,
`call-accept`, `call-refuse`, `call-live`, `call-end`, `call-mute`), and nothing reaches
`getUserMedia`/`getDisplayMedia` until both sides have said yes — so a refusal never
touches the media layer and knowing an id cannot make the browser's own permission prompt
appear on somebody's screen. Six things are load-bearing. **`peer.on('call')` fires for
anybody**, so an arriving MediaConnection is the one thing here that does not come through
`parseMessage`: `mediaAllowed` (pure, therefore tested) demands the same peer, the
`connecting` state, the side that *accepted* rather than offered, and a `token()`-bounded
call id out of the caller's own `metadata` — anything else is closed unread. **The offerer
always places the media call**, which is what makes a screen share one-way with no second
code path; its consequence is `call-live`, because the watcher answers with nothing and
without a word back the sharer's bar would sit at *connecting…* for the whole call.
**The stream is grabbed before the offer goes out** — pressing the button is the user
gesture the browser wants, and asking on their answer with no press behind it is refused
outright in some browsers. **Every track is stopped on every route out** (`clearCall` is
where a hang-up, a refusal, a timeout, a dropped link, *Go offline* and a disconnect all
end), or the browser's recording indicator stays lit after the bar has gone; the browser's
own *Stop sharing* bar fires nothing of ours, so the tracks are watched for `ended`.
**The bar is `js/shell/call-bar.js`, not the panel**, because the panel closes on Esc and
that must not be how you hang up on somebody — built once and updated in place for the same
three-second-ping reason as the composer, never re-assigning a `srcObject` it already has,
at the *top* of the screen because the note stack owns the bottom right and would cover
*Hang up*. Its screen viewer needs `[hidden] { display: none !important; }` — the same
cascade-origin trap as filmoskop. And **a device failure is a sentence**:
`describeMediaError` separates refused, missing and in-use, which are one `Error` to
anyone not reading `name`, while the far side is only ever told "they could not answer".

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

## The app system

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

**`apps/app-catalog.js` is generated, and is what a broken registry falls back to.** Written
by `scripts/generate-apps-catalog.js` from the same manifests as `registry.json`, in the
manifest's own shape — so an entry in it *is* a manifest and `legacyCatalogToManifest` is one
call to `normalizeManifest`. Do not edit it by hand; `tests/app-registry.test.mjs` checks it
against every manifest. It was hand-written for years and rotted exactly as a list of file
paths rots: `monaco` and `tinymce` gained vendored editors of 98 and 137 files while it went
on naming two each, so installing either from the fallback produced an app that opened and
stayed blank, and four later apps were missing entirely. Being a *fifth* hand-written record
builder it also dropped `needsNetwork`, `autosave` and `icon` — losing the offline warning on
precisely the boot that needs one. `base` in it is the bootstrap file list, taken from
`settings/preinstall.json` rather than kept as a second opinion about it.

**An app that dies before its own code runs is still reported.** An error inside an iframe
fires on *that* window, so the shell's handlers never see it — `ace` with no network opened a
blank window and left a console line, because the CDN editor was missing and its own script
then died on `ace is not defined`. The handler therefore arrives before the app: `sw.js`
injects one into every app document, reporting to `window.__pixosAppError`, which names the
app. Four things about it. It listens in the **capture** phase, so a `<script src>` that never
loaded is reported as the address that failed rather than as the exception that follows. It is
injected **only into navigations**, so every route that reads an app's own source — an
install, a hash, a `pixos_supported` read — still gets the file byte for byte. It goes in
after `<head>` and never before the doctype, which would drop the app into quirks mode. And
`window.__pixosOwnErrors = true` is the opt-out for an app that reports properly: Explorer
sets it, because two notes for one failure is worse than one. Since phase 21 it sets it from
`apps/explorer/js/failure.js`, which claims the flag and installs Explorer's own two
listeners as a side effect of being constructed — so that module has to be built early, and
is the first statement in `openExplorer` for that reason.

**`dropEffect` and `effectAllowed` are a pair, and an invalid pair cancels the drop
silently.** A drag starting on an Explorer row sets `effectAllowed = 'move'` at `dragstart`.
`document.body` carries a `dragover` handler for files arriving from the desktop, and body is
an ancestor of every row, so it runs *after* the row's own handler and has the last word. It
used to answer `dropEffect = 'copy'` for everything. `move` paired with `copy` is not a
preference the browser reconciles — the combination is invalid, so it cancels the drop
outright: **no `drop` event fires at all**, and the drag image animates back to where it
started. For a long time every move inside Explorer was therefore being performed not by the
drop but by one of the `dragend` fallbacks that ran afterwards, which is why the snap-back was
visible before the move and why releasing over the toolbar moved the file too. The page-level
handler now asks `isInternalDrag(e.dataTransfer)` first and answers `move` for Explorer's own
drags. During `dragover` the browser refuses `getData` and exposes only `types`, so the *type*
a drag carries is the only thing available to tell one of our rows from a file off the
desktop while the pointer is still moving.

**An app that has been renamed keeps answering to its old name.** `/settings/app-aliases.json`
maps old id to current, written by `renameLocalApp` and read by `buildAppRegistry`;
`resolveAppId` is consulted by `getApp`, `getCatalogApp` and `launch()`, which writes the
resolved id back into the descriptor so the next saved session holds the new name. Chains
collapse on write, so a lookup is one step and cannot loop. Renaming already carried the
default-app associations; what it did not carry was the saved session, so a window open on
the renamed app came back as *App &lt;old id&gt; has no launch path*. The alias is a file of
this system's own rather than a `previousIds` in the manifest, because it is a fact about
what happened here, not a property of the app.

## Opening a file

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
Manager included, opens. **The default is asked for first and that list only decides the
no-default case** — so an association for `html` does work, which the backlog claimed for a
while that it did not; `tests/open-with.test.mjs` drives the real `openFile` out of
`index.html` to keep the claim from coming back. The third way in is the palette's
**Open with…** (`openFocusedWith`), acting on the focused window's file: a file opened from
the palette, a recent-files entry or a bookmark otherwise had no *open this differently*
route at all, because Explorer was never involved in opening it.

## The bookmarks document

**The bookmarks document has two writers, and one owner.** `apps/bookmarks/js/links.js`
owns `/settings/links.json`; `js/shell/bookmarks.js` is the shell's copy of what the edits
made from outside the app need — adding a link, and since phase 23 listing a group, removing,
moving inside its group, renaming, and creating a group — put on `window` as `addBookmark`,
`listBookmarks`, `removeBookmark`, `moveBookmark`, `renameBookmark` and `ensureBookmarkGroup`.
It is a second copy for the same reason the frontmatter parser is one, since an app is
installed *into* BrowserFS and the shell cannot import from it. `npm test` checks the two
answer identically — every URL shape, and every move from every position to every position —
rather than trusting them to. `moveBookmark`'s index means what `moveLink`'s does: the position
*before the link is lifted out*, so one place down is its index plus two. Two rules that are not obvious: it is deliberately
**not** behind the tab-ownership gate (this is a document the user edits, not a record of
how this tab is arranged, and the app writes it from any tab), and a file that will not
parse is never written over — "no file yet" and "a file with something wrong in it" are
different answers, and replacing the second with a fresh one holding a single link would
be the worst possible response to a typo. `addTo` does not mutate what it is handed, so a
write that never happens leaves nothing half-applied. **The file is seeded**, from
`templates/links.json`, which is `DEFAULT_DOC` written out — a third copy, checked against
the app's in `tests/shell-bookmarks.test.mjs` rather than trusted. Without it `addBookmark`
created the file first and the app's starter document was never written at all: one
bookmark added from the desktop *was* the whole collection. A seed, not a refreshed file,
so it is copied once and never reasserted over a collection somebody has built.

**Every shell edit is a read, a change and a write, and they wait for each other.** *Move up*
pressed twice used to be two reads of the same document and a second write putting back what
the first had moved; the store in `js/shell/bookmarks.js` runs them one at a time, and a list
asked for after an edit waits for it. That is one queue *per shell*: two PixOS tabs, or the
Bookmarks app — which holds the document in memory and saves it whole — can still both write
in the same moment, and the later one wins. A file that will not read is never written by any
of the edits, not only by the add. And **a named group is searched for duplicates on its own**:
with `group` given, a link already in some *other* group is added anyway, because pinning a
folder to Explorer's places is not the same act as bookmarking it, and the whole-document search
answered "Already bookmarked" to a pin. With no group named, the whole document is searched, as
it always was.

**Explorer's places are the `Places` group, and opening Explorer never creates it.** With no such
group, Explorer draws Root and Apps as starters and writes nothing. The first edit — a pin, an
unpin, a move or a rename — writes the starters with that edit already applied, as one
`ensureBookmarkGroup` call, which **leaves a group that is already there exactly as it is**: if
another window created `Places` in the meantime, this window's edit to its stale starters is
dropped and the real group is drawn, rather than the starters being written over somebody's
pins. A `Places` group with nothing in it is not a missing one — unpinning everything does not
bring the starters back — but deleting the group in the Bookmarks app does. Only folders are
drawn (an address ending in `/`); a file or a site put into `Places` stays in the document and
still counts as a position when a move is written. A place is acted on by its id, never by the
row it was drawn in, since a menu is pressed after the list may have been read again; a link
with no id — a hand-written file the Bookmarks app has not saved yet — can be drawn but not
edited until it has one.

**Two places may not share a name, and only Explorer says so.** *Rename…* refuses a name another
place already has, ignoring case, and keeps the dialog open with the reason under the field — the
prompt dialog's `refuse(value)`, which answers synchronously and is deliberately not `on*`-shaped,
because the guard `openDialog` wraps callbacks in returns a promise and a promise refuses nothing.
The shell does not enforce it: `Places` is a group of links, and the Bookmarks app may title two
links alike. A pin is not refused either — it is named after its folder, so `/home` and
`/mnt/usb/home` can both be *home* until one is renamed.

## Two smaller traps

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
