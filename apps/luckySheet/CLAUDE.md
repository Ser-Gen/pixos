# Project Overview

LuckySheet — a browser-based Excel/xlsx spreadsheet editor, repackaged to run
standalone as a Pixos app. Key files:

- `index.html` — entry point; boots LuckySheet into the `#luckysheet` container and
  defines `window.openFile(url, name?, opts?)`, which fetches a file and renders it,
  dispatching by extension (see below). The Pixos shell calls `openFile(src, name)`;
  direct callers may still use `openFile(url, opts)` — both shapes are accepted. `window.openBlob(blob, name, opts?)` is the shared core — it
  renders any Blob whose `name` carries the extension, used by both `openFile` and drag &
  drop. Auto-opens a file passed as `?file=<url>` (used by the Pixos host or when opening in
  a browser); `?delimiter=` overrides the field separator for csv/tsv/txt. **Drag & drop:**
  dropping a file anywhere on the page opens it (shows a drop overlay while dragging).
- `luckysheet.umd.js` / `luckysheet.css` — the LuckySheet spreadsheet engine and styles.
- `luckyexcel.umd.js` — xlsx → LuckySheet import (`LuckyExcel.transformExcelToLucky`).
  Note: its `transformLuckyToExcel` is an empty stub, so export is NOT done here.
- `xlsx.full.min.js` — vendored SheetJS 0.18.5 (UMD, exposes `window.XLSX`); reads the
  non-xlsx tabular formats (xls, csv, tsv, txt, ods, xlsb).
- `sheetjs-import.js` — converts a SheetJS workbook to LuckySheet sheet objects
  (`window.sheetjsToLucky(wb)`): values, formulas, merges, column/row sizes. No cell styles
  (SheetJS's community build doesn't read them).
- `exceljs.umd.js` — vendored ExcelJS 4.4.0 (UMD, exposes `window.ExcelJS`), used for export.
- `export.js` — LuckySheet → **xlsx** exporter (styled). Reads `luckysheet.getAllSheets()` and
  builds a styled workbook (values, formulas, number formats, merges, column/row sizes, fonts,
  fills, alignment, wrap, best-effort borders). Exposes `window.exportXlsx(fileName?)`, which
  returns a Blob and triggers a browser download.
- `sheetjs-export.js` — LuckySheet → **csv/tsv/txt/xls/ods/xlsb** exporter (inverse of
  `sheetjs-import.js`). Exposes `window.exportSheetjs(format, fileName?, opts?)`; carries
  values, formulas, merges, column/row sizes but NO styles (SheetJS's community build can't
  write them). `opts.delimiter` sets the field separator for csv/tsv/txt.
- The bottom-right **export bar** in `index.html` is a format `<select>` + "Export" button:
  xlsx routes to `exportXlsx` (styled), everything else to `exportSheetjs`. It preselects the
  format of the file you opened, so "open csv → save csv" is one click.
- `plugin.js` / `plugins.css` / `pluginsCss.css` — bundled plugins (incl. jQuery and the
  chart plugin) and their styles.
- `chartmix.*`, `echarts@4.8.0__*`, `element-ui@2.13.2__*`, `vue@2.6.11__*`, `vuex@3.4.0__*`
  — vendored dependencies for the chart plugin.
- `pixos.app.json` — Pixos manifest with per-file SHA-256 integrity hashes and the
  `supported.extensions` list. Regenerate with `npm run generate-apps` from the repo root
  after editing any bundled file; it also rewrites `apps/registry.json`. Bump `version`
  before shipping, or App Manager will not offer the update to existing installs. Keep
  `supported.extensions` in sync with the `pixos_supported` file.

## Saving under Pixos

Under the Pixos shell the app is hosted in a same-origin iframe whose parent exposes
`saveFileLocal(path, content)`. `pixosHost()` in `index.html` returns that window, or
`null` when the app runs standalone or cross-origin — so a directly-opened copy never
touches BrowserFS.

The **Save** button (bottom right, above the export bar) and **Ctrl/Cmd+S** write the live
workbook back over the file it was opened from, in that file's own format, and appear only
when both conditions hold: a Pixos host is present, and the file came from a
`/__browserfs__/...` path (tracked in `sourcePath`). Drag-and-dropped files clear
`sourcePath`, since they have no place in the filesystem.

Bytes are produced by the existing exporters with `{ download: false }` and handed over as
a `Buffer` built from the host's `Buffer` — BrowserFS cannot write a Blob. `saveFileLocal`
returns a Promise, so the status line shows "Saving..." until the write actually lands and
then reports "Saved <name>" or the real error. Shells older than this change return
`undefined`; the app checks for a thenable and skips the await rather than breaking.

Export (download) is unchanged and stays available in both environments.

## Supported formats (`openFile` dispatch)

- `xlsx`, `xlsm` → **LuckyExcel** — full styling preserved.
- `xls`, `ods`, `xlsb` → **SheetJS** — values, formulas, merges, sizes (no styles).
- `csv`, `tsv`, `txt` → **SheetJS** text parse; delimiter defaults by extension
  (csv=`,`, tsv/txt=`\t`), overridable via `opts.delimiter` or `?delimiter=`.

Anything else is rejected with an "Unsupported file format" alert.

See `CHANGELOG.md` for the history of fixes and features.

## Local testing

Serve the folder over HTTP (fetch does not work over `file://`) and pass a file:

    python3 -m http.server 8777
    open "http://localhost:8777/index.html?file=<some-spreadsheet>.xlsx"

Opened this way there is no Pixos host, so Save is hidden and only Export works.

# Boundaries

MUST: be brief — answer briefly and to the point
MUST: update CLAUDE.md when changing the project structure
MUST: rebuild the project after making changes and make sure that the project is rebuilt without errors.
MUST NOT: never use git — do not execute any git commands (git commit, git add, git push, git status, etc.)
