# Changelog

Changes made to run this Yandex Book Reader standalone (Pixos) and to add features.
Affected files: `index.html`, `index.js`, `index.css`, `pixos.app.json` (integrity hashes).

## Fixes

### Persistence: bookmarks, reading progress, and settings
The app is a repackaged Chrome extension; its storage layer used `chrome.storage.local`,
which does not exist under Pixos. It had been stubbed out (`this.storage_ = {}`,
`this.bookmarks_ = {}`), which broke bookmarks, progress, and — as a side effect — hid
the whole menu/navigation bar (the load sequence threw before `reader-menu` was un-hidden).

- `StorageHandler` now uses `chrome.storage.local` when present and falls back to
  `window.localStorage` otherwise (`getFromStorageAsync_` / `setToStorageAsync_`).
- Restored real `StorageHandler.create` / `BookmarksHandler.create` initialization.
- Restored reading position, render mode, and font-size restore on load.

Note: `localStorage` is per-origin/per-device, so bookmarks and progress do not sync
across machines (the original extension's `chrome.storage` could).

### Localization strings never loaded
`ReaderLoadTimeData`'s constructor never resolved its data promise (`return 'kek'`), so
every `getString`/`getStringF` threw "No data". It now resolves with English strings:
`bookmarkDefault`, `pageNumber` (`"$1 of $2"`), and the bookmark tooltips. The empty
bookmarks-panel message was also translated to English.

## Features

### Dark reading theme
- Toggle button added to the reader menu (crescent-moon icon drawn in pure CSS — no new
  image asset).
- App chrome darkens via `body[theme="dark"]` (`index.css`) and `:host([theme="dark"])`
  rules for the title/progress text.
- Book text is themed by injecting a dark stylesheet into the book iframe
  (`READER_DARK_BOOK_CSS`), tagged `renderer-injected-styles` so the core's `clear()`
  preserves it; re-applied on page/document changes and mode switches.
- Choice is persisted via `StorageHandler` (`getTheme`/`setTheme`); first-open default
  follows the OS `prefers-color-scheme`.
- `html`/`body` also default their background to the OS scheme in `index.css` (with
  `body[theme="light"]`/`[theme="dark"]` overriding), so opening a book no longer flashes
  a white page before JS applies the saved theme.
- In dark mode the inactive bookmark icon is inverted/brightened so it stays visible; the
  colored active icon is left unchanged.

### Open a file by drag-and-drop or URL parameter
Previously the book to open was hard-coded in `index.html` (`<reader-page src="1.fb2.zip">`).
An inline bootstrap script in `index.html` now creates the `<reader-page>` dynamically and
adds two ways to choose the book:

- **Drag & drop**: dropping an `.epub` / `.fb2` / `.fb2.zip` file anywhere on the window
  opens it. The file is wrapped in an in-memory `blob:` URL and passed as the reader's
  `src`; the type is inferred from the file name. (The core fetches `streamUrl` with an
  XHR GET, and the content-type is provided explicitly, so a `blob:` URL loads without a
  server.)
- **URL parameter**: `?src=<url>` (aliases `?file=`, `?url=`) opens that path/URL;
  optional `?type=epub|fb2|fb2.zip` overrides extension-based detection. With no
  parameter it now shows an **empty state** instead of auto-loading the sample.

### Empty state when no book is open
When started without a `?src=` parameter, `index.html` shows a centered empty state
explaining how to open a book (drag & drop, or the `?src=` URL parameter) with an
**"Open example book"** button at the bottom that loads the bundled `1.fb2.zip`. The
empty state is styled inline (theme-aware via `prefers-color-scheme`) and is hidden as
soon as a book is opened.

### Pixos shell integration (`window.openFile`)
The shell opens an app in an iframe and then calls `contentWindow.openFile(src, name)`.
The bootstrap script had an `openFile` helper, but it was local to its IIFE and never
assigned to `window`, so "Open with -> Yandex Book Reader" from Explorer launched the app
and left it on the empty state. The drag-and-drop helper is now `openLocalFile`, and
`window.openFile(src, name)` is exported; the book type is detected from `name` (the real
basename), because `src` is a `/__browserfs__/...` path.

Note: the shell's iframe URL has no query string, and the service worker strips queries,
so the `?src=` parameter only applies when the app is opened directly.

### `.fb2.zip` files could not be opened at all
`pixos_supported` advertised `fb2.zip`, but the shell derived extensions with
`path.extname()`, which yields `zip` — the compound value could never match, and Explorer
only lists compatible apps, so `.fb2.zip` showed "No compatible apps found".

The shell now expands a path into candidates, most specific first
(`book.fb2.zip` -> `['fb2.zip', 'zip']`) via `getExtensionCandidates` /
`normalizeExtensionCandidates` in the repo root `index.html`. Compatibility profiles carry
an `extensions` array, `isAppCompatibleWithProfile` matches any candidate, and default-app
lookup tries the most specific first, so an `fb2.zip` association beats a plain `zip` one
and the reader does not get offered for every zip file. Explorer uses the most specific
value as the "set as default" key while keeping the trailing extension for archive
mounting, so `book.fb2.zip` still offers **Mount**.

### Example book was missing
The empty state's button pointed at `1.fb2.zip`, which did not exist (the bundled file was
`test_book.fb2.zip`), and no book was listed in the manifest's `files[]`, so Install never
copied one into BrowserFS. The sample is now `example.fb2.zip`, referenced by that name and
shipped in the manifest.

## Notes
- After editing any bundled file, regenerate `pixos.app.json` (Pixos verifies file
  integrity) with `npm run generate-apps` from the repo root. It rewrites `files[]` with
  fresh SHA-256 hashes and updates `apps/registry.json`.
- Bump `version` in `pixos.app.json` before shipping, or App Manager's "Check update" will
  not offer the new build to existing installs.
