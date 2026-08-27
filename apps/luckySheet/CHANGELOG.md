# Changelog

## 2026-08-27

### Added — save to the Pixos filesystem
Export only ever triggered a browser download, so a spreadsheet opened from Explorer could
be edited but not saved back. The app now writes through the shell's
`parent.saveFileLocal(path, content)` (the same hook ace and monaco use for Ctrl+S).

- `pixosHost()` in `index.html` returns the parent window only when it is same-origin and
  exposes `saveFileLocal`; standalone or cross-origin it returns `null`, so a directly
  opened copy never touches BrowserFS.
- `sourcePath` records the `/__browserfs__/...` path a workbook was opened from. Drag &
  drop clears it — a dropped file has no place in the filesystem.
- A **Save** button (bottom right, above the export bar) and **Ctrl/Cmd+S** appear only
  when both a host and a `sourcePath` are present. They write the live workbook back over
  its own file, in that file's own format, leaving Export (download) untouched.
- `exportXlsx(fileName?, opts?)` and `exportSheetjs(format, fileName?, opts?)` accept
  `opts.download === false` to build the Blob without downloading it. The bytes are handed
  over as a `Buffer` made from the host's `Buffer` — BrowserFS cannot write a Blob.
- The shell's `saveFileLocal` now returns a Promise (resolving with the written path,
  rejecting with the BrowserFS error), so the status line shows "Saving..." until the write
  lands and then reports "Saved <name>" or the actual failure instead of assuming success.
  Shells predating that change return `undefined`; the app checks for a thenable first.
- Note: `xlsm` has no distinct writer; ExcelJS emits xlsx bytes under the original name.

### Fixed — `openFile` signature did not match the shell contract
The shell calls `contentWindow.openFile(src, name)`, but the app declared
`openFile(url, opts)`, so the basename landed in the options slot. It worked by accident
(`'x.csv'.delimiter` is `undefined`), but the documented `?delimiter=` override was
unreachable through the shell. `openFile(url, name?, opts?)` now accepts both shapes.

### Fixed — manifest and catalog were stale
- `pixos.app.json` still listed `.DS_Store` (which the generator now skips) and omitted
  `CHANGELOG.md` / `CLAUDE.md`. Regenerated with `npm run generate-apps`.
- `version` was still `1.0.0` despite the whole import/export layer being new, so App
  Manager would never have offered the update to existing installs. Bumped to `1.1.0`.
- The legacy `luckySheet` entry in `apps/app-catalog.js` listed 20 files and was missing
  all five new scripts `index.html` loads (`xlsx.full.min.js`, `exceljs.umd.js`,
  `export.js`, `sheetjs-import.js`, `sheetjs-export.js`); in registry-fallback mode it
  would have installed a spreadsheet that could neither import nor export. Refreshed from
  the regenerated manifest.

### Removed
- The orphaned `100 AI Tools.xlsx` sample; nothing in the UI referenced it and it was not
  shipped in the manifest. The `CLAUDE.md` local-testing snippet no longer names it.

## 2026-07-21

### Added — drag & drop open
- Dropping a file anywhere on the page now opens it. Refactored `openFile` in `index.html`
  into a shared `openBlob(blob, name, opts?)` core (`window.openBlob`); `openFile` fetches a
  URL then delegates, and the drop handler passes the dropped `File` directly. A drop overlay
  ("Drop a spreadsheet to open") shows while dragging, driven by a dragenter/leave depth
  counter and gated on `dataTransfer.types` containing `Files`.

### Added — export to more formats (round-trip save)
- Added `sheetjs-export.js` — `window.exportSheetjs(format, fileName?, opts?)` writes the live
  workbook to **csv, tsv, txt, xls, ods, xlsb** via SheetJS (inverse of `sheetjs-import.js`).
  Carries values, formulas, merges, and column/row sizes; no styles (SheetJS's community build
  can't write them). csv/tsv/txt export the active sheet; `opts.delimiter` overrides the field
  separator (defaults: csv=`,`, tsv/txt=`\t`). Returns a Blob and triggers a download.
- Replaced the single "Export xlsx" button with an **export bar** (format `<select>` + Export
  button). xlsx still routes to the styled ExcelJS path (`export.js`); the rest go through
  SheetJS. The picker preselects the format you opened, so "open csv → save csv" is one click.
- Registered `sheetjs-export.js` in `pixos.app.json` with its SHA-256. `supported.extensions`
  is unchanged (every export format was already an open format).

### Added — open more tabular formats
- Vendored **SheetJS 0.18.5** as `xlsx.full.min.js` (UMD, exposes `window.XLSX`; offline).
- Added `sheetjs-import.js` — `window.sheetjsToLucky(wb)` converts a SheetJS workbook to
  LuckySheet sheet objects (values, formulas, merges, column/row sizes; no styles, which
  SheetJS's community build doesn't read).
- `openFile(url, opts?)` now dispatches by extension:
  - `xlsx`, `xlsm` → LuckyExcel (full styling, unchanged path).
  - `xls`, `ods`, `xlsb` → SheetJS.
  - `csv`, `tsv`, `txt` → SheetJS text parse; delimiter defaults by extension
    (csv=`,`, tsv/txt=`\t`), overridable via `opts.delimiter` or the `?delimiter=` query param.
  - Unknown extensions now get an explicit "Unsupported file format" alert.
- Expanded `supported.extensions` in `pixos.app.json` and the `pixos_supported` file to
  `xlsx, xlsm, xls, csv, tsv, txt, ods, xlsb`; registered the two new files with SHA-256 hashes.

## 2026-07-20

### Added — xlsx export
- Vendored **ExcelJS 4.4.0** as `exceljs.umd.js` (UMD, exposes `window.ExcelJS`, bundles
  JSZip; no CDN so it stays offline/integrity-hashed). The bundled `luckyexcel`'s own
  `transformLuckyToExcel` is an empty stub and cannot export, so ExcelJS is used instead.
- Added `export.js` — a LuckySheet → xlsx mapper. Reads `luckysheet.getAllSheets()` and
  builds a styled workbook preserving: values, formulas, number formats, merges,
  column widths / row heights, fonts (family/size/bold/italic/underline/strike/color),
  fills, alignment, wrap, and borders (best-effort). Exposes
  **`window.exportXlsx(fileName?)`** — returns a Blob and triggers a browser download.
- Added an **"Export xlsx"** button (bottom-right) in `index.html`, wired to `exportXlsx()`.
- Registered `exceljs.umd.js` and `export.js` in `pixos.app.json` with SHA-256 hashes.

### Fixed — file opening
- Corrected `openFile` in `index.html`: `userInfo` read `exportJson.info.name.creator`
  (`.creator` off the title string → always `undefined`); now `exportJson.info.creator`.
- Added a **`?file=<url>`** auto-open hook in the `onload` handler, so the Pixos host — or a
  plain browser URL — can open a spreadsheet directly. Previously `window.openFile` was
  defined but never callable. Note: `fetch` requires HTTP, so `file://` does not work.

### Fixed — serif fonts
- The app set no `font-family` on `html`/`body`, so unstyled UI text fell back to the
  browser's serif default. Added a root sans-serif rule
  (`-apple-system, "Helvetica Neue", Arial, sans-serif`) in `index.html`, plus a targeted
  override for `.luckysheet-datavisual-content-column-italic`, the one rule in
  `luckysheet.css` that hard-codes `"Times New Roman", serif`. (Cell text is drawn on a
  canvas in Arial and was unaffected.)

### Docs
- Rewrote `CLAUDE.md`, which previously described an unrelated "Yandex Book Reader"; it now
  documents LuckySheet, the import/export paths, and local testing.
