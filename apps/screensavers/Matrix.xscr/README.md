# Vendored: Matrix digital rain, by Rezmason

    https://github.com/Rezmason/matrix
    commit 5ba90490453ceceb6812d6b1bc658a99a92411d0 (2024-10-31, "Adding SVGs of the resurrections glyphs")
    https://codeload.github.com/Rezmason/matrix/tar.gz/5ba90490453ceceb6812d6b1bc658a99a92411d0

MIT, `LICENSE` beside this file. It bundles regl (MIT) and gl-matrix 3.4.0 (MIT, its notice at
the top of `lib/gl-matrix.js`). A screensaver for PixOS since phase 26: not preinstalled, but
downloaded into `/apps/screensavers/Matrix.xscr/` the first time one of its looks is chosen.
`docs/screensavers-plan.md` in the PixOS repository says why.

## The looks

`looks.json` is PixOS's, not the project's. Each look is a query on the same `index.html`:
*Classic* (the default version), *Resurrections* (`version=resurrections`) and *3D*
(`version=3d`), all with `suppressWarnings=true`, because the notice Matrix shows on a machine
without graphics acceleration asks for a click, and any click ends a screensaver. A look's
`files` are the glyph textures only it needs, so choosing *Classic* does not download
Resurrections' glyphs.

## What was kept, and what was not

Kept, unmodified: `index.html`, `LICENSE`, `js/` except `js/webgpu/`, `lib/regl.min.js`,
`lib/gl-matrix.js`, `shaders/glsl/`, and three textures in `assets/` — `matrixcode_msdf.png`,
`resurrections_msdf.png` and `resurrections_glint_msdf.png`.

Left out, because none of the three looks loads them: the WebGPU renderer (`js/webgpu/`,
`shaders/wgsl/`, `lib/gpu-buffer.js`; it runs only with `renderer=webgpu`), the Looking Glass
library (`lib/holoplaycore.module.js`; `version=holoplay` only), the unminified `lib/regl.js`,
every other font and texture in `assets/` (the other versions'), the two `.ttf` fonts, the
Playdate ports, the SVG sources, `screenshot.png` and the project's notes and README.

So the other versions are not here: `version=trinity` and the rest will draw without their
textures. Adding one means copying its files back from the commit above and naming it in
`looks.json`.

## Changed

Nothing. PixOS pauses it by holding its animation frames from outside, which stops it
completely — regl draws only from `requestAnimationFrame`.

## Updating

Download the tarball of a newer commit, copy the same files over, check `js/config.js` still has
the three versions `looks.json` names, update the commit above, and run `npm run generate-apps`,
which rewrites `apps/screensavers/index.json` from this folder.
