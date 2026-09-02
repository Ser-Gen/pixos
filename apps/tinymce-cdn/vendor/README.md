# Vendored: TinyMCE 8.1.2 (GPL)

`tinymce/` is the npm package, trimmed:

    https://registry.npmjs.org/tinymce/-/tinymce-8.1.2.tgz
    package  ->  apps/tinymce-cdn/vendor/tinymce

The app sets `license_key: 'gpl'`; `license.md` and `notices.txt` are kept alongside the
code for that reason and must not be deleted in any future trim.

**What was removed:** every unminified `.js`/`.css` that has a `.min` twin (TinyMCE ships
both), the TypeScript declarations, the ES-module `index.js` shims, and the package
metadata and changelog. 3.9 MB remains, 177 files, down from 11 MB.

**What was deliberately kept** even though this app does not currently use it: all four UI
skins and all six content skins, and all twenty-nine plugins rather than the twenty-two the
app lists. Changing a setting in `index.html` should not require coming back here.

**What is not here and never was:** the translations. `index.html` asks for
`language: 'ru'`, and TinyMCE looks for `langs/ru.js`, which is not part of the npm package
— it is a separate download from TinyMCE's site. That request has always 404'd and TinyMCE
has always fallen back to English; the only difference now is that it fails locally rather
than over the network.

## Updating

Download the tarball for the new version, replace `tinymce/`, redo the trim above, update
the version, then `npm run generate-apps -- --only=tinymce-cdn` and bump `version` in
`pixos.app.json`.
