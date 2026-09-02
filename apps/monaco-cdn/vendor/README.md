# Vendored: Monaco Editor 0.52.0

`vs/` is the `min/vs` directory of the npm package, unmodified:

    https://registry.npmjs.org/monaco-editor/-/monaco-editor-0.52.0.tgz
    package/min/vs  ->  apps/monaco-cdn/vendor/vs

**One thing was removed:** `nls.messages.*.js`, the nine translated UI string bundles
(de, es, fr, it, ja, ko, ru, zh-cn, zh-tw), about 1.8 MB. The app never sets a locale, so
Monaco uses the English strings compiled into `editor.main.js` and never asks for them.
Add one back if the editor is ever localised.

Everything else is kept, including `language/typescript/tsWorker.js` (5.5 MB, the largest
single file here). It is not optional: it *is* the JavaScript and TypeScript intelligence,
and it is what the editor was reaching for when it failed offline. 12 MB in total, 94 files.

## Why it is here rather than on a CDN

So the app works with no network. It also fixes something that never worked: Monaco runs
its language services in a web worker loaded from `vs/base/worker/workerMain.js`, and from
a CDN that is a cross-origin worker, which the browser refuses outright. Same-origin, it
runs.

## Updating

Download the tarball for the new version, replace `vs/` with its `min/vs`, delete the
`nls.messages.*.js` files, update the version above, then `npm run generate-apps --
--only=monaco-cdn` and bump `version` in `pixos.app.json` so App Manager offers the update.
