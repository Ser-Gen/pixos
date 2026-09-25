# Vendored: Desktop Habitats, by Chase Lean

    https://github.com/chaseleantj/desktop-habitats
    commit 66e80ea1b6bafd25324c84c72067e750c1a1f334 (2026-09-22, "Update readme with latest screenshot")
    https://codeload.github.com/chaseleantj/desktop-habitats/tar.gz/66e80ea1b6bafd25324c84c72067e750c1a1f334

MIT, `LICENSE` beside this file. It bundles three.js 0.180.0 (MIT, `vendor/THREE-LICENSE.txt`).
Riverscape's rock, wood and sand textures are from Poly Haven under CC0 (*Rock Boulder Dry*,
*Rough Wood*, *Sand 01*); Reefscape's rock, coral and sand are the project's own procedural
artwork, described in `scenes/reefscape/assets/README.md`. A screensaver for PixOS since phase 26:
not preinstalled, but downloaded into `/apps/screensavers/Habitats.xscr/` the first time one of
its looks is chosen. `docs/screensavers-plan.md` in the PixOS repository says why.

## The looks

`looks.json` is PixOS's. The two tanks are the two looks, each the project's own wallpaper page:
*Reefscape* (`scenes/reefscape/wallpaper.html`, the saltwater tank) and *Riverscape*
(`scenes/riverscape/wallpaper.html`, the planted freshwater one). Each claims its own scene
folder, so choosing Riverscape does not download Reefscape's 15 MB of rock, and choosing the
other one later downloads only what it adds.

As a background, the fish follow the pointer and a left click drops food, as in the project's own
browser preview.

## What was kept, and what was not

Kept, unmodified: `LICENSE`, `vendor/` (three.js), `ui/icons.js`, `ui/scene.css`, `ui/tokens.css`,
`scenes/shared/`, and of each scene its `wallpaper.html` (changed, below), `style.css`, `src/` and
`assets/`.

Left out: `docs/` (18 MB of screenshots and a video), `tools/` (the Python bakers that made the
assets), `wallpaper/` (the macOS app), every `tests/` folder, the gallery page (`index.html`,
`ui/gallery.*`), each scene's `index.html` (the preview with its buttons, which a background has no
use for), `serve.mjs`, `package.json` and the README.

## Changed

Each `wallpaper.html` loads one more script, marked with a `PixOS:` comment:
`scenes/shared/pixos-host.js`, which is PixOS's and not the project's. A wallpaper page says
`data-motion="host"` — its host decides when it moves — and in that mode it draws nothing until
the host gives it a frame rate. The script gives it one, and defines `pixosPause` and
`pixosResume`, which PixOS calls to pause a background, as `habitatRate(0)` and
`habitatRate(60)`. Rate 0 stops the scene's loop outright, and the time it was stopped is not
simulated afterwards. (`habitatPower`, which the plan once named for this, is the battery switch.)

## Updating

Download the tarball of a newer commit, copy the same files over, add the script line to both
`wallpaper.html` files again, check `start.js` still holds `habitatRate` until the scene has
loaded (the host script relies on it), update the commit above, and run `npm run generate-apps`,
which rewrites `apps/screensavers/index.json` from this folder.
