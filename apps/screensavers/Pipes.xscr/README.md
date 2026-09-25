# Vendored: 3D Pipes, by Isaiah Odhner

    https://github.com/1j01/pipes
    commit 86e8eb1418f937ef43f9acbd871085c5160714fc (2021-08-05, "Mention 98.js.org on readme")
    https://codeload.github.com/1j01/pipes/tar.gz/86e8eb1418f937ef43f9acbd871085c5160714fc

MIT, `LICENSE` beside this file. It bundles three.js r98 (MIT, `lib/three.min.js`) and two
three.js examples, `lib/OrbitControls.js` and `lib/TeapotBufferGeometry.js`. A screensaver for
PixOS since phase 26: not preinstalled, but downloaded into `/apps/screensavers/Pipes.xscr/` the
first time it is chosen. `docs/screensavers-plan.md` in the PixOS repository says why.

## The look

One. `looks.json` is PixOS's, and its only job here is the address: `index.html` shows a panel of
controls unless its hash says `{"hideUI":true}`, which the look's `entry` does, escaped. A left
click on the pipes as a background changes the view, as it does in the original.

## What was kept, and what was not

Kept: `index.html` (changed, below), `screensaver.js`, `LICENSE`, `lib/three.min.js`,
`lib/OrbitControls.js`, `lib/TeapotBufferGeometry.js`, `images/textures/candycane.png` (the
candy-cane pipes) and the three icons in `images/meta/`, so that the page opened on its own in a
tab still has them.

Left out: `images/textures/rusty.png` (531 KB, which nothing loads), `images/meta/screencap.gif`
(the README's animation), `lib/sri-fallback.js` (see below), the README and the npm and editor
files.

## Changed

`index.html`, twice, each marked with a `PixOS:` comment:

- three.js is loaded from `lib/three.min.js` directly. The original asked cdnjs first, with an
  integrity hash, and fell back to the same local file through `lib/sri-fallback.js`. The local
  file matches that hash, so this changes where it comes from and nothing else: no request to
  another server, and nothing to fail first when offline.
- The "Fork me on GitHub" ribbon is gone. It was an image from `camo.githubusercontent.com`,
  fetched even with the controls hidden. The project's address is above.

PixOS pauses it by holding its animation frames from outside. Its fade between scenes is started
by a timer, but every step of it is drawn in a frame, so a held page does not move.

## Updating

Download the tarball of a newer commit, copy the same files over, make the two changes again,
update the commit above, and run `npm run generate-apps`, which rewrites
`apps/screensavers/index.json` from this folder.
