# Bundled: Archivo and DM Mono, from Fontsource 5.3.0

Explorer's two faces since phase 24 (mockup B). Bundled rather than linked from Google Fonts
because Explorer has to look the same offline, and a font from a CDN falls back to the system
face without saying so.

    https://cdn.jsdelivr.net/npm/@fontsource/archivo@5.3.0/files/archivo-<subset>-<weight>-normal.woff2
    https://cdn.jsdelivr.net/npm/@fontsource/dm-mono@5.3.0/files/dm-mono-<subset>-<weight>-normal.woff2

Renamed on the way in (`-normal` dropped), otherwise byte-for-byte:

| File | Weight | Subset |
| --- | --- | --- |
| `archivo-latin-400.woff2`, `archivo-latin-ext-400.woff2` | 400 | latin, latin-ext |
| `archivo-latin-500.woff2`, `archivo-latin-ext-500.woff2` | 500 | latin, latin-ext |
| `archivo-latin-600.woff2`, `archivo-latin-ext-600.woff2` | 600 | latin, latin-ext |
| `dm-mono-latin-400.woff2`, `dm-mono-latin-ext-400.woff2` | 400 | latin, latin-ext |
| `dm-mono-latin-500.woff2`, `dm-mono-latin-ext-500.woff2` | 500 | latin, latin-ext |

About 130 KB together. The `@font-face` rules are at the top of `apps/explorer/explorer.css`, with
the `unicode-range` of each subset copied from the package's own `index.css`, so a browser fetches
the latin-ext file only for a name that needs it.

**Neither family has Cyrillic** (Fontsource ships latin, latin-ext and, for Archivo, vietnamese).
A Cyrillic file name is drawn in the fallback face named after these in `--ui` and `--data`,
letter by letter, inside the same line. That is the browser's per-glyph fallback working as
intended, not a missing file.

Licence: SIL Open Font License 1.1, in `LICENSE-archivo.txt` and `LICENSE-dm-mono.txt`, copied from
the packages. The OFL allows bundling and redistribution; it does not allow selling the fonts on
their own.

Weights 700 and the 300 of DM Mono that mockup B linked are not here: nothing in Explorer uses them.
