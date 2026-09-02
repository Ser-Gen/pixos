# Vendored: JS7z 2.5.0 — 7-Zip 25.01, single-threaded build

    https://github.com/GMH-Code/JS7z/releases/download/v2.5.0/js7z-st-fs-ec.zip
    js7z.js    ->  apps/7z/vendor/js7z.js    (100 KB, unmodified)
    js7z.wasm  ->  apps/7z/vendor/js7z.wasm  (1.4 MB, unmodified)

Both files are byte-for-byte the release.

`ST+FS+EC`: **s**ingle-**t**hreaded, extended **f**ile **s**ystem, extra **e**xception
**c**atching. Licence: the 7-Zip licence, in `7z-Src/DOC` of the source distribution
(LGPL, with the unRAR restriction). The project's own home is
<https://github.com/GMH-Code/JS7z>.

## Loaded as a script, not as a module

The release is a UMD bundle: it assigns a global `JS7z`. `apps/7z/js/archive.js` loads it
by appending a `<script>` and reading that global, which is not a stylistic choice — the
bundle's Node branch calls `require` at the top level beside a top-level `await`, and no
module loader will take a file containing both. An earlier attempt appended
`export default JS7z;` and it fails to parse. If a future release ships a single-threaded
ES module, that is the moment to change this.

## Why single-threaded, when the multi-threaded build is the recommended one

The MT build needs `SharedArrayBuffer`, which needs cross-origin isolation. PixOS *is*
isolated once its service worker is in control — `sw.js` sends `Cross-Origin-Opener-Policy:
same-origin` alongside `Cross-Origin-Embedder-Policy: credentialless` — but that is not the
whole picture:

- **Safari does not implement `credentialless`.** The header is ignored there, the page is
  not isolated, and an MT build would fail to start at all.
- **The very first load is not controlled by the service worker**, so it is not isolated
  either. Extracting something before the first reload would fail for that reason alone,
  which is impossible to explain to anybody.

Single-threaded is slower and, until JS7z changes it, `callMain()` does not return until
the command is finished — so a large archive blocks the tab. That is the trade taken here:
it works everywhere, always, rather than quickly in most places. `docs/backlog.md` holds
the two ways out (run it in a worker; use the MT build when `crossOriginIsolated`).

## Updating

Download the new `js7z-st-fs-ec.zip` release, replace both files, re-append the
`export default JS7z;` line, and check `apps/7z/js/parse.js` against the new version's
messages — the classifier reads 7-Zip's own wording to tell a wrong password from a
corrupt archive, and that wording is the interface. `tests/archive.test.mjs` is where the
recorded output lives.
