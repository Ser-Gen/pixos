# PixOS

A desktop-like OS in the browser: a BrowserFS filesystem, a windowed shell, and apps that
run in iframes. Pure static site — no build step, no backend.

## Where things are

- `index.html` the shell (everything global on `window`); `sw.js` the service worker serving
  `/__browserfs__/...` and the precache; `js/shell/` the shell's modules; `js/app-registry.js`,
  `js/mount-manager.js`.
- `apps/<id>/` one folder per app; `apps/explorer` and `apps/app-manager` are system apps;
  `apps/7z/` the archive engine; `apps/screensavers/` the screensaver pages (not an app).
- `settings/preinstall.json` + `templates/` what a fresh system is made of; `scripts/` the generators.
- `tests/` node unit tests (`npm test`); `tests/browser/` headless-Chrome harnesses, run by hand.

**Open the doc for the area before working in it** — none of these is loaded with this file:

| Doc | Read it when |
|---|---|
| `docs/structure.md` | you need the full map: every shell module and what it owns, apps, screensavers, scripts, tests, docs |
| `docs/explorer-modules.md` | you touch `apps/explorer/`: its modules, the late-bound cycles, the construction order |
| `docs/not-so-simple.md` | you change behaviour: its first section lists what each section covers |
| `docs/backlog.md` | before proposing work: candidate phases as checklists, every open item with its state, what was rejected and why (done items: `docs/backlog-done.md`) |
| `docs/settings-plan.md` | phase 27, the Settings window: passes 1 and 2 of 5 built (earlier plans: `docs/structure.md`) |
| `docs/shell-phase<n>-checklist.md` | a phase's browser checklist, for the user to walk |
| `tests/browser/README.md` | you want to see a change work in a real browser |

## Commands

    npm run generate-apps                 # rebuild every app manifest + registry.json
    npm run generate-apps -- --only=<id>  # just one app
    npm test                              # shell unit tests (node, no browser)
    node tests/browser/<name>.mjs         # one browser harness; see tests/browser/README.md
    python3 -m http.server 8000           # serve the repo root; a service worker needs http

Run the generator after changing anything inside `apps/`. It never writes manifests for
reserved ids (`explorer`, `app-manager`) — those are maintained by hand.

Browser harnesses are heavy (a server, a headless Chrome, WebGL, multi-MB downloads): run one at a
time, only when the user asks, and check afterwards that no `http.server` or headless Chrome is left.

## Boundaries

MUST: regenerate manifests (`npm run generate-apps`) after changing files under `apps/`
MUST: hand-update `apps/explorer/pixos.app.json` (hash + `version`) after changing
`apps/explorer/**` — the generator skips reserved ids and says nothing. **Adding a file
under `apps/explorer/` means naming it in four lists**, none of which fails loudly:
that manifest, `settings/preinstall.json`, `PRECACHE` in `sw.js` (bump `SHELL_CACHE` too),
and `FALLBACK_PREINSTALL` in the shell's `index.html`. `tests/explorer-modules.test.mjs`
is what actually enforces it. `apps/app-manager` has no manifest at all: it is copied in by
`preinstall.json` with `refresh: true` on every boot, so editing it needs nothing
MUST: add a new shell file to `PRECACHE` in `sw.js` and bump `SHELL_CACHE`
MUST NOT: hand-edit `apps/registry.json` or `apps/app-catalog.js` — both are generated,
and the second rotted for a year because it was not
MUST: keep `npm test` green
MUST: read the matching section of `docs/not-so-simple.md` before changing an area it
covers — every paragraph in it exists because the obvious change breaks something that is not obvious
MUST: keep this file and every doc above in English; update `docs/structure.md` (and
`docs/explorer-modules.md`) when the structure changes, `docs/not-so-simple.md` when the behaviour it
describes does, and this file only when its map, commands or rules do
MUST NOT: use git — see `AGENTS.md`
