# Vendored: comark 0.6.2, PrismJS 1.16.0

## comark.mjs — the markdown parser

    https://esm.sh/comark@0.6.2/es2022/comark.bundle.mjs   ->  vendor/comark.mjs

221 KB, MIT, one file with **no external imports**. The upstream npm package
(`comark@0.6.2`) cannot be vendored directly: its `dist/*.js` imports `markdown-exit`,
`js-yaml` and others by bare specifier, so using it as it ships would mean an import map
plus vendoring the whole dependency tree — in a repo with no build step. esm.sh's bundler
is what flattens it, and the file above is that bundle, saved once. jsDelivr's `+esm` was
tried first and is not suitable: it rewrites the bare specifiers to point at *other files
on jsDelivr*, so it is still a module graph and still needs the network.

Only the parser is here. `comark/render` — its HTML renderer — is deliberately **not**
vendored: filmoskop walks the AST itself in `js/deck.js`, because a slide needs layout
decisions (which component becomes which arrangement), real DOM nodes rather than an HTML
string, and its own handling of code blocks and images. Rendering to a string and then
re-parsing it would throw away exactly the structure the parser was chosen for.

What comark buys over the `marked.js` the original filmoskop used:

- **`::component{prop="value"}` blocks**, which is how a slide says it wants a layout.
  They arrive in the AST as `["side-image", {src: "a.png"}, ...children]` — a node with a
  name and props, not a string to pattern-match.
- **Frontmatter**, parsed into `doc.frontmatter`, which is where deck-level settings live.
- `{.class}` attributes on ordinary elements, CommonMark and GFM.

`parseMarkdown` is **async**. Everything that renders a slide is therefore async too.

### Updating

Fetch the same path with a new version, check `parseMarkdown` still returns
`{frontmatter, meta, nodes}` with components as named nodes, and run `npm test` —
`tests/filmoskop.test.mjs` parses real deck source through this file rather than a stub,
so a change in the AST shape fails there rather than in front of an audience.

## prism.js — code highlighting

PrismJS 1.16.0, okaidia theme, markup + css + clike + javascript + css-extras, from the
project's own download builder. Carried over unmodified from the original filmoskop, which
loaded it as `prismjs.js` beside `marked.js`. The theme's colours are in the app's
stylesheet rather than a separate CSS file.
