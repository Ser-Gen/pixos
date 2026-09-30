# Sky

The sky over one place, drawn over a sea, with each thing in it where it really is: the sun, the moon
with its real phase, the five bright planets, and the stars down to magnitude 4. Built for PixOS in
phase 26 (`docs/screensavers-plan.md`, the Sky pass). It is downloaded the first time one of its looks
is chosen, like the other screensavers here.

## Where each part came from

| Part | From | Licence |
| --- | --- | --- |
| The layers and colours of `index.html` | msaetre's pen [CSS Sunset Sunrise](https://codepen.io/msaetre/pen/JjqPby), also posted as [BernardoHille/pen/gOjaJZj](https://codepen.io/BernardoHille/pen/gOjaJZj), which is the copy that was brought here | MIT (CodePen's terms for a public pen); `LICENSE` |
| `lib/suncalc.js` | [SunCalc](https://github.com/mourner/suncalc) 2.0.2, `index.js` at commit 0ed9f4981b3e2f7a6bde7b340eb965488128c3c1, fetched as a tarball and unmodified | BSD 2-Clause; `lib/suncalc-LICENSE` |
| `data/stars.json` | The Bright Star Catalogue, 5th Revised Ed. (Hoffleit & Warren, 1991), CDS catalogue [V/50](https://cdsarc.cds.unistra.fr/ftp/V/50/), fetched 2026-09-25 | its ReadMe states no licence; cited here |
| The planets' elements in `js/astro.js` | JPL, [Approximate Positions of the Planets](https://ssd.jpl.nasa.gov/planets/approx_pos.html), Table 1 (1800–2050) | US government work |

`data/stars.json` is made by `scripts/sky-stars.js` in the PixOS repository, which says how. It keeps
the 518 stars down to magnitude 4 — a city sky, chosen over the catalogue's 8,404 to magnitude 6.5 —
each with its J2000 place, magnitude, colour index, and what it is called: the catalogue's own name
for it where its remarks give one (207 of them), and its designation, *α Orionis*.

## What changed from the pen

The pen drew every layer from one number: how far down the screen the mouse was. Here that number is
where the sun is (`depth` and `look` in `js/sky.js`), worked out by SunCalc for the place and the
moment.

- The gradients are written in today's CSS rather than the `-webkit-` syntax of the time, with the
  same colours and stops.
- Its twilight went on reddening all the way down, so its whole night was red. Here the red goes by
  the end of civil twilight, and nautical twilight is deep blue.
- The sun's glow sinks below the horizon four times faster than the sun, so its core does not show
  above the sea at −5°.
- Gone: a `stars.jpg` that was never in the pen, star shapes that were never shown
  (`display: none`), a line between sky and sea meant to be dragged that could not be (its code sat in
  a branch that never ran), a loop over clouds that did not exist, and the mouse moving the sun.
- New: the stars, the planets and the moon on a canvas; the paths the sun and the moon light on the
  sea; a label for whatever the pointer is over.

## How the sky is laid out

The screen is a compass panorama facing the equator, exactly as wide as the year's widest day — at
Riga from 35° to 325°, so the June sun rises at the left edge and December's makes a short, low arc in
the middle. Altitude is up, in the same degrees as across. How dark the sky is follows the sun's real
depth through the three twilights, so a June night at Riga, where the sun gets no lower than −9°,
stays blue.

## In PixOS

- **Where**: the page asks `parent.watchLocation(window, handler)`, which the Wallpaper dialog sets.
  Outside PixOS it is Riga.
- **Looks** (`looks.json`): *Now*; *One day*, today in two minutes, looping (`?pace=day`); *One year*,
  this clock time on each day of the year, a day a second (`?pace=year`). `?at=<ISO date>` starts any of
  them at another moment.
- **Pausing**: `pixosPause` and `pixosResume`. Nothing runs between animation frames.
- **The pointer**: PixOS hands the desktop's pointer moves in, and the label follows them. As a
  screensaver there are none.
