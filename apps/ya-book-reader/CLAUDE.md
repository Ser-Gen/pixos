# Project Overview

Yandex Book Reader (FB2/FB2.ZIP/EPUB) — a repackaged Chrome extension running standalone
as a Pixos app. Key files:

- `index.html` — entry point; a bootstrap script creates the `<reader-page>` and opens
  the book from `window.openFile(src, name)` (the Pixos shell entry point), a
  `?src=`/`?file=`/`?url=` URL parameter, or a drag-and-dropped file. With no book it
  shows an empty state whose button opens the bundled `example.fb2.zip`.
- `index.js` — all app logic and Polymer UI elements (reader page, menu, navigation,
  bookmarks), plus `StorageHandler`, `BookmarksHandler`, and localization.
- `index.css` — top-level page styles and theme background var.
- `resources/js/reader_core/reader_core.js` — book rendering engine (renders into a
  sandboxed iframe).
- `example.fb2.zip` — sample book behind the empty state's button; it must stay in the
  manifest's `files[]` or Install will not copy it into BrowserFS.
- `pixos.app.json` — Pixos manifest with per-file SHA-256 integrity hashes; regenerate
  with `npm run generate-apps` from the repo root after editing any listed file.

# Pixos integration

The shell opens the app in an iframe at `/__browserfs__/apps/ya-book-reader/index.html`
and then calls `iframe.contentWindow.openFile(src, name)` — see `openFile` in the repo
root `index.html`. The iframe URL carries no query string (the service worker strips it),
so `?src=` works only when the app is opened directly, not through the shell. `name` is
the real basename and is what the book type is detected from.

`pixos_supported` lists `epub`, `fb2` and `fb2.zip`. The compound `fb2.zip` requires the
shell's multi-segment extension matching (`getExtensionCandidates` in the root
`index.html`); without it `path.extname()` would yield only `zip`.

See `CHANGELOG.md` for the history of fixes and features.

# Boundaries

MUST: be brief — answer briefly and to the point
MUST: update CLAUDE.md when changing the project structure
MUST: rebuild the project after making changes and make sure that the project is rebuilt without errors.
MUST NOT: never use git — do not execute any git commands (git commit, git add, git push, git status, etc.)
