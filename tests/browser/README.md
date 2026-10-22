# Browser harnesses

What `npm test` cannot see: a real service worker, real frames, real input, a real reload. Each
harness here boots PixOS in headless Chrome on a fresh profile and prints `ok` / `FAIL` per check, with a
count at the end, and exits non-zero if anything failed. They are **not** run by `npm test` (its runner
reads only `tests/*.test.mjs`), and nothing runs them all at once.

    node tests/browser/p27-1-settings.mjs

**Run one at a time, and only when it is worth it.** Each starts a static server and a headless Chrome
that boots PixOS, runs WebGL backgrounds and downloads screensavers of several MB into the browser's
storage. A series of them, run back to back with one left behind, grew swap until a Chrome had to be
killed by hand. Afterwards, check that nothing is left:

    ps aux | grep -E "http.server|headless=new" | grep -v grep

## What they need

- Google Chrome. `CHROME=/path/to/chrome` if it is not at the macOS default.
- `python3` (the server is `python3 -m http.server`, as in `CLAUDE.md`'s commands).
- Port **8123** free (`PIXOS_PORT=` to change it); `served-from-folder` also uses **8124**. A port
  already answering is refused rather than tested in place of PixOS.
- Node 22 or later (the built-in `WebSocket`).

Chrome picks its own debugging port, so a harness never attaches to a Chrome you have open with
`--remote-debugging-port` — a fixed port once did exactly that, and drove someone's own browser.
The profile is made in the system's temp folder and removed at the end; screenshots go to
`tests/browser/out/`, which is not part of the project.

## The harnesses

Named by the phase and pass whose checklist they cover (`docs/shell-phase<n>-checklist.md`).

| Harness | What it checks | Last run |
|---|---|---|
| `served-from-folder.mjs` | PixOS served from a folder (`/repo/`, not `/`): Slideshow and a downloaded Riverscape load as the background inside the worker's scope, and no `/__browserfs__` request reaches the server | 2026-10-23: 5 of 5 |
| `p27-1-settings.mjs` | The Settings window: opened from Start, its pages and keys, Escape, `⌘,`; a background chosen on its page and Explorer's route redrawing it; Location typed, then *Follow me* with the permission granted, a reload finding the place again, a reload with it gone asking nothing; a phone's width | 2026-10-23: 29 of 29 |
| `p26-2-screensaver.mjs` | The screensaver: started from the key with nothing chosen, its gallery, the idle permission asked in a click, previews, Slideshow, a page from another origin. `--quick` skips the last check, a minute of doing nothing (it waits 50 s, then up to 20 s more) | 2026-10-23: 45 of 45 with `--quick` |
| `p26-3-explorer.mjs` | Explorer and screensavers: the mark on a page and a folder, a double-click previewing in the layer, the menus' *Preview*, *Show contents*, *Set as…*, the note a choice raises, the grid view | 2026-10-23: 46 of 46 |
| `p26-4-downloads.mjs` | Matrix, Pipes and Habitats downloaded on first use: sizes on the tiles, a look downloading only its own files, the progress note, a choice made mid-download winning, **offline** (the harness stops its server and reloads), and a deleted folder becoming a download again | 2026-10-23: 37 of 38 — *the note counts bytes* is unconfirmed, see the comment above it |
| `p26-5-sky.mjs` | Sky: the gallery, Now as the background, a typed location and a wrong one, *Use my location* (overridden to Tallinn), a known full moon over Riga to point at, covered and uncovered, One year and One day, a reload keeping the place, Sydney facing north. Where things should be is worked out in node from the pure `sky.js` and SunCalc | 2026-10-23: 35 of 35 |
| `p26-6-corners-pin.mjs` | Pass 6: the Screensaver page's three rows, a PIN set and refused, a hot corner starting it locked, the pad, a reload coming back locked, a press on a corner passed on, a *never* corner holding idle off, two tabs locking together, a background held still on battery | 2026-10-23: 40 of 40 |
| `mount-native-folder.mjs` | A real folder on disk, dropped on the shell and mounted, a file in it opened and read from an app's frame — `plain`, with a same-origin file `tab` focused after the shell, after a `hard` reload (the shell reloads itself under the worker), and `stay` (that reload already spent, so it stays uncontrolled). Give a mode, or none for all four | **not run since it was written** (phase 26); expect it to need updating |

"Last run" is the last time each was run against the code as it then was. A harness that fails is
first a question about the harness: most failures after a change are checks written for what the UI
used to be.

## Writing one

`cdp.mjs` is all of it: `serve()` (with `stop` and `start`, for a harness that takes the network away),
`profileDir(name)` and `removeProfile`, `out(file)` for a screenshot, and two clients:

- `launch({profile})` — one browser, any number of pages (`await browser.page(url)`), each with
  `eval`, `until(expression, ms)`, `key`, `mouse`, `click`, `type`, `screenshot` and the `errors` it
  threw. Use this one; `p27-1-settings.mjs` is the model.
- `launchPage(profile)` — one page with `evaluate`, `mouse`, `send`, `screenshot` and its raw
  `events`, and `until(what, test, ms)` beside it. The phase 26 harnesses are written on it.

Read a value the code owns from the code rather than copying it into the harness — the precache's
name is read from `sw.js`, for one — or the harness goes stale with the next change.
