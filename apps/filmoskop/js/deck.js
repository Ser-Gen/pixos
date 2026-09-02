// A deck, apart from the browser.
//
// Everything here is pure: where one slide ends and the next begins, which comark
// component means which layout, what belongs to the speaker rather than the audience, and
// what a standalone export looks like. The app around it does the DOM and the files.
//
// The parser is comark, and the reason it was chosen is visible in `LAYOUTS` below: a
// `::side-image{src="a.png"}` block arrives as `["side-image", {src: "a.png"}, ...]` --
// a named node with props -- so a layout is a rendering decision rather than a string
// somebody has to pattern-match out of the markdown.

// Five dashes on a line of their own, which is what the original filmoskop used and what
// every deck already written uses. Three would collide with frontmatter, and markdown's
// own thematic break is still available inside a slide.
export var SEPARATOR = /^-{5,}$/;

export function splitSlides (source) {
	var lines = String(source == null ? '' : source).split(/\r?\n/);
	var slides = [];
	var current = [];
	var starts = [0];

	lines.forEach(function (line, index) {
		if (SEPARATOR.test(line.trim())) {
			slides.push(current.join('\n'));
			current = [];
			starts.push(index + 1);
			return;
		}
		current.push(line);
	});
	slides.push(current.join('\n'));

	return {
		// The first line of each slide in the source, which is what turns a cursor
		// position into a slide number without re-scanning the text.
		starts: starts,
		slides: slides
	};
}

// Which slide the caret is in. The editor and the preview are one window here, so this is
// the whole of the "follow me while I type" behaviour -- no messages, no guessing.
export function slideAtOffset (source, offset) {
	var text = String(source == null ? '' : source);
	var upto = text.slice(0, Math.max(0, offset || 0));
	var breaks = upto.split(/\r?\n/).filter(function (line) {
		return SEPARATOR.test(line.trim());
	});
	return breaks.length;
}

export function slideAtLine (source, line) {
	var split = splitSlides(source);
	var found = 0;
	for (var i = 0; i < split.starts.length; i++) {
		if (split.starts[i] <= line) {
			found = i;
		}
	}
	return found;
}

// --- layouts ---------------------------------------------------------------------------
//
// A component is a layout. `slots` names the props that hold an image or a piece of text
// so the renderer knows what to do with them, and everything else in the block is the
// slide's own content.

export var LAYOUTS = {
	'side-image': {
		className: 'Slide--sideImage',
		image: 'src',
		// left or right, and the content takes the other half.
		modifier: function (props) {
			return 'Slide--image' + (String(props.align || 'right') === 'left' ? 'Left' : 'Right');
		}
	},
	'background-image': {
		className: 'Slide--backgroundImage',
		image: 'src',
		// The image goes behind the text, so it needs a scrim or the text is unreadable
		// over a light photograph. Off is available and has to be asked for.
		modifier: function (props) {
			return props.dim === 'false' ? '' : 'Slide--dimmed';
		}
	},
	title: {className: 'Slide--title'},
	columns: {className: 'Slide--columns'},
	quote: {className: 'Slide--quote'}
};

export function isLayout (name) {
	return Object.prototype.hasOwnProperty.call(LAYOUTS, name);
}

// Not shown to the room. `::notes` is dropped from the slide and handed to the speaker
// window -- the one thing in a deck that must never be rendered where it can be read.
export var NOTES = 'notes';

// The comark AST is `[tag, props, ...children]`, and a plain string is a text node. This
// walks it once and answers three questions the app has: what the slide's layout is, what
// the speaker's notes are, and what is left to render.
export function planSlide (nodes) {
	var content = [];
	var notes = [];
	var layout = null;

	(nodes || []).forEach(function (node) {
		if (!Array.isArray(node)) {
			content.push(node);
			return;
		}
		var name = node[0];
		var props = node[1] || {};
		if (name === NOTES) {
			notes.push(node);
			return;
		}
		if (isLayout(name)) {
			// The first one wins. Two layouts on one slide is a mistake, and picking the
			// last would mean the answer depended on something invisible.
			if (!layout) {
				layout = {name: name, props: props, children: node.slice(2)};
			}
			content.push(node);
			return;
		}
		content.push(node);
	});

	return {
		layout: layout,
		className: classNameFor(layout),
		notes: notes,
		content: content,
		hasNotes: notes.length > 0
	};
}

function classNameFor (layout) {
	if (!layout) {
		return '';
	}
	var rule = LAYOUTS[layout.name];
	var names = [rule.className];
	if (rule.modifier) {
		var extra = rule.modifier(layout.props || {});
		if (extra) {
			names.push(extra);
		}
	}
	return names.join(' ');
}

// --- text, for the speaker window and for search ------------------------------------------

export function textOf (node) {
	if (node === null || node === undefined) {
		return '';
	}
	if (typeof node === 'string') {
		return node;
	}
	if (!Array.isArray(node)) {
		return '';
	}
	return node.slice(2).map(textOf).join('');
}

// The first heading, or the first words. Used for the slide list and the speaker window,
// where "slide 7" is not something anybody can navigate by.
//
// The search goes *into* components, because a layout wraps the slide's content and the
// heading is almost always inside one -- a `::title` slide would otherwise be listed by
// its whole body run together.
export function titleOf (nodes) {
	var found = findHeading(nodes || []);
	if (found) {
		return textOf(found).trim();
	}
	var list = nodes || [];
	var text = list.map(textOf).join(' ').trim().replace(/\s+/g, ' ');
	return text.length > 60 ? text.slice(0, 57) + '…' : text;
}

function findHeading (nodes) {
	for (var i = 0; i < (nodes || []).length; i++) {
		var node = nodes[i];
		if (!Array.isArray(node)) {
			continue;
		}
		if (/^h[1-6]$/.test(String(node[0]))) {
			return node;
		}
		var inside = findHeading(node.slice(2));
		if (inside) {
			return inside;
		}
	}
	return null;
}

// --- deck settings -------------------------------------------------------------------------

export function settingsFrom (frontmatter) {
	var data = frontmatter || {};
	return {
		title: String(data.title || '').trim(),
		author: String(data.author || '').trim(),
		theme: String(data.theme || 'dark').trim().toLowerCase() === 'light' ? 'light' : 'dark',
		// Slide numbers are on by default and turned off for a deck that is one image per
		// slide, where a number in the corner is just litter.
		counter: data.counter !== false && data.counter !== 'false'
	};
}

// --- export --------------------------------------------------------------------------------
//
// A deck you can send to somebody who does not have PixOS. The slides are already
// rendered, so the export carries no parser -- 220 KB of comark to read a file that is
// already HTML would be absurd -- only the markup, the stylesheet and enough script to
// move between slides. That also means it opens with no network and never changes after
// you send it.

export function exportHtml (deck) {
	var cfg = deck || {};
	var settings = cfg.settings || settingsFrom({});
	var slides = (cfg.slides || []).map(function (slide, index) {
		return '<section class="Slide ' + (slide.className || '') + '" id="s' + index + '">'
			+ '<div class="Slide__content">' + slide.html + '</div>'
			+ (settings.counter ? '<div class="Slide__counter">' + (index + 1) + '</div>' : '')
			+ '</section>';
	}).join('\n');

	return '<!DOCTYPE html>\n'
		+ '<html lang="' + escapeAttribute(cfg.lang || 'en') + '">\n'
		+ '<head>\n<meta charset="utf-8">\n'
		+ '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
		+ '<title>' + escapeHtml(settings.title || cfg.name || 'Slides') + '</title>\n'
		+ '<style>\n' + (cfg.css || '') + '\n</style>\n</head>\n'
		+ '<body class="theme-' + settings.theme + '">\n'
		+ '<main class="Slides">\n' + slides + '\n</main>\n'
		+ '<script>\n' + NAVIGATION + '\n</script>\n'
		+ '</body>\n</html>\n';
}

// Deliberately tiny and deliberately inline: an exported deck is one file, and a file that
// needs a second one beside it is not something you can attach to a message.
export var NAVIGATION = [
	'(function () {',
	'\tvar slides = Array.prototype.slice.call(document.querySelectorAll(".Slide"));',
	'\tvar at = 0;',
	'\tfunction go (index) {',
	'\t\tat = Math.max(0, Math.min(slides.length - 1, index));',
	'\t\tslides[at].scrollIntoView({behavior: "smooth"});',
	'\t}',
	'\tdocument.addEventListener("keydown", function (e) {',
	'\t\tif (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); go(at + 1); }',
	'\t\telse if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(at - 1); }',
	'\t\telse if (e.key === "Home") { e.preventDefault(); go(0); }',
	'\t\telse if (e.key === "End") { e.preventDefault(); go(slides.length - 1); }',
	'\t\telse if (e.key === "f") { document.documentElement.requestFullscreen(); }',
	'\t});',
	// Which slide is on screen, so arrow keys carry on from where scrolling left off.
	'\tif (window.IntersectionObserver) {',
	'\t\tvar watcher = new IntersectionObserver(function (entries) {',
	'\t\t\tentries.forEach(function (entry) {',
	'\t\t\t\tif (entry.isIntersecting) { at = slides.indexOf(entry.target); }',
	'\t\t\t});',
	'\t\t}, {threshold: 0.5});',
	'\t\tslides.forEach(function (slide) { watcher.observe(slide); });',
	'\t}',
	'}());'
].join('\n');

export function escapeHtml (value) {
	return String(value === null || value === undefined ? '' : value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

export function escapeAttribute (value) {
	return escapeHtml(value).replace(/"/g, '&quot;');
}

// The name to offer when exporting: `talk.deck.md` -> `talk.html`.
export function exportNameFor (fileName) {
	var base = String(fileName || 'slides').replace(/\.(deck\.)?md$/i, '');
	return (base || 'slides') + '.html';
}

// --- assets -----------------------------------------------------------------------------
//
// An image in a deck is written the way you would write it in any markdown -- `pic.png`,
// beside the file. But the *document* doing the rendering is the app, two folders away in
// /apps/filmoskop, so a relative URL resolves against the wrong place and every picture in
// every deck is broken. This is where a path in the deck becomes a path in the filesystem.

export function isExternalSrc (src) {
	return /^(https?:|data:|blob:)/i.test(String(src || ''));
}

export function resolveAsset (src, dir) {
	var value = String(src || '').trim();
	if (!value || isExternalSrc(value)) {
		return value;
	}
	if (value.charAt(0) === '/') {
		return normalizePath(value);
	}
	return normalizePath((dir || '/') + '/' + value);
}

export function normalizePath (input) {
	var parts = String(input || '').split('/');
	var out = [];
	parts.forEach(function (part) {
		if (!part || part === '.') {
			return;
		}
		if (part === '..') {
			out.pop();
			return;
		}
		out.push(part);
	});
	return '/' + out.join('/');
}

// --- which editor ---------------------------------------------------------------------
//
// The plain textarea is always there; Monaco is only there if somebody installed the app
// that carries it, and filmoskop borrows that app's vendored copy rather than shipping a
// second one. The choice is a setting because both answers are reasonable: Monaco brings
// undo, multiple cursors and a minimap, and it is 12 MB and a moment to start.

// --- ready-made blocks -------------------------------------------------------------------
//
// The layouts are the only thing about this syntax that has to be remembered, and the
// seeded deck was the only place they were written down -- so the way to use one was to
// find a deck that already did and copy out of it. These are that, as a thing you can
// press.
//
// `kind` is the whole design: a `::title` is a *slide* and belongs after the one you are
// in, separator and all, while a code fence or a table is a *block* and belongs where the
// caret is. Cutting the slide you are looking at in half is what the other choice does.

export var BLOCKS_DIR = '/settings/filmoskop-blocks';

export var BLOCKS = [
	{
		id: 'title',
		label: 'Title slide',
		kind: 'slide',
		text: '::title\n# A title\n\nAnd a line underneath it.\n::'
	},
	{
		id: 'plain',
		label: 'Plain slide',
		kind: 'slide',
		text: '## A heading\n\n* One thing\n* Another\n* A third'
	},
	{
		id: 'side-image',
		label: 'Picture beside text',
		kind: 'slide',
		text: '::side-image{src="picture.jpg" align="right"}\n### A heading\n\n'
			+ 'The words go beside the picture. `align="left"` puts it on the other side.\n::'
	},
	{
		id: 'background-image',
		label: 'Picture behind text',
		kind: 'slide',
		text: '::background-image{src="picture.jpg"}\n# A heading\n\n'
			+ 'The words sit over the picture. Add `dim="false"` to drop the shading.\n::'
	},
	{
		id: 'columns',
		label: 'Two columns',
		kind: 'slide',
		text: '::columns\n### Left\n\nOne side.\n\n### Right\n\nThe other.\n::'
	},
	{
		id: 'quote',
		label: 'Quote',
		kind: 'slide',
		text: '::quote\n“Something worth quoting.”\n::'
	},
	{
		id: 'code',
		label: 'Code',
		kind: 'block',
		text: '```js\nfunction hello () {\n\treturn \'world\';\n}\n```'
	},
	{
		id: 'table',
		label: 'Table',
		kind: 'block',
		text: '| One | Two |\n| --- | --- |\n| A | B |'
	},
	{
		id: 'notes',
		label: 'Speaker note',
		kind: 'block',
		text: '::notes\nWhat to say here. It never appears on the slide.\n::'
	}
];

// What a file in BLOCKS_DIR is. Nothing to learn and no metadata format: a fragment that
// opens with a *layout* is a slide, and everything else -- a code fence, a table, a
// `::notes` block, a paragraph -- goes where the caret is. `::notes` is the case that
// makes this a rule about layouts rather than about `::`.
export function blockKindOf (text) {
	var body = String(text == null ? '' : text);
	var lines = body.split(/\r?\n/);
	for (var i = 0; i < lines.length; i++) {
		if (SEPARATOR.test(lines[i].trim())) {
			return 'slide';
		}
	}
	for (var n = 0; n < lines.length; n++) {
		var line = lines[n].trim();
		if (!line) {
			continue;
		}
		var match = /^::([a-zA-Z][\w-]*)/.exec(line);
		return match && isLayout(match[1]) ? 'slide' : 'block';
	}
	return 'block';
}

// The file name is the label, because asking someone to write frontmatter into a snippet
// is asking them not to keep snippets.
export function blockLabelFor (fileName) {
	var base = String(fileName || '').replace(/\.[^.]*$/, '').replace(/[-_]+/g, ' ').trim();
	return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Block';
}

export function blockIdFor (fileName) {
	return String(fileName || '').replace(/\.[^.]*$/, '').toLowerCase();
}

// The built-in blocks, plus whatever is in the folder. A file named after a built-in
// *replaces* it rather than sitting beside it -- that is how you change the title slide
// this app offers you into the title slide your talks actually use.
export function blocksFrom (files) {
	var out = BLOCKS.map(function (block) {
		return Object.assign({source: 'built-in'}, block);
	});
	(files || []).forEach(function (file) {
		if (!file || !file.name || !String(file.text || '').trim()) {
			return;
		}
		var block = {
			id: blockIdFor(file.name),
			label: blockLabelFor(file.name),
			kind: blockKindOf(file.text),
			text: String(file.text).replace(/\s+$/, ''),
			source: 'file'
		};
		var existing = out.findIndex(function (candidate) {
			return candidate.id === block.id;
		});
		if (existing === -1) {
			out.push(block);
		}
		else {
			out[existing] = Object.assign({}, block, {label: out[existing].label, replaces: true});
		}
	});
	return out;
}

// Where each slide starts and ends in the source, in characters rather than lines --
// `splitSlides` answers in lines, which is what following the caret needs and not what
// writing into the text needs.
export function slideBounds (source) {
	var text = String(source == null ? '' : source);
	var separator = /^[ \t]*-{5,}[ \t]*$/gm;
	var bounds = [];
	var start = 0;
	var match;

	while ((match = separator.exec(text)) !== null) {
		bounds.push({start: start, end: match.index});
		start = match.index + match[0].length;
		if (text.charAt(start) === '\r') {
			start++;
		}
		if (text.charAt(start) === '\n') {
			start++;
		}
	}
	bounds.push({start: start, end: text.length});
	return bounds;
}

// Blank lines matter in markdown, and a block dropped into the middle of a paragraph is
// not what anybody meant by "insert a table". These two say what padding the join needs,
// looking only at what is already there.
function leadFor (before) {
	if (!before) {
		return '';
	}
	if (/\n[ \t]*\n[ \t]*$/.test(before)) {
		return '';
	}
	if (/\n[ \t]*$/.test(before)) {
		return '\n';
	}
	return '\n\n';
}

function tailFor (after) {
	if (!after) {
		return '\n';
	}
	if (/^[ \t]*\r?\n[ \t]*\r?\n/.test(after)) {
		return '';
	}
	if (/^[ \t]*\r?\n/.test(after)) {
		return '\n';
	}
	return '\n\n';
}

// The edit a block makes: a range to replace, the text to put there, and where the caret
// ends up. Returned rather than applied, because the two editors apply it differently and
// both of them have to do it in a way the undo stack survives.
export function insertionFor (source, offset, block) {
	var text = String(source == null ? '' : source);
	var body = String((block && block.text) || '').replace(/\s+$/, '');
	if (!body) {
		return null;
	}
	var at = Math.max(0, Math.min(text.length, offset || 0));

	if ((block && block.kind) !== 'slide') {
		var lead = leadFor(text.slice(0, at));
		var tail = tailFor(text.slice(at));
		return {start: at, end: at, text: lead + body + tail, caret: at + lead.length};
	}

	// An empty deck has no slide to come after, and no separator to lead with.
	if (!text.trim()) {
		return {start: 0, end: text.length, text: body + '\n', caret: 0};
	}

	var bounds = slideBounds(text);
	var index = Math.min(slideAtOffset(text, at), bounds.length - 1);
	var end = bounds[index].end;
	// The trailing blank lines of the slide we are following are replaced rather than
	// added to, so inserting twice does not walk the deck apart.
	var head = text.slice(0, end).replace(/\s+$/, '');
	var join = '\n\n-----\n\n';
	// A blank line before the *next* separator when there is one, so a deck stays readable
	// as text after a dozen of these.
	var tail = end >= text.length ? '\n' : '\n\n';
	return {
		start: head.length,
		end: end,
		text: join + body + tail,
		caret: head.length + join.length
	};
}

// --- which editor ------------------------------------------------------------------------

export var EDITORS = ['auto', 'monaco', 'plain'];

// The app whose vendor folder holds Monaco, and where it lives inside it.
//
// Its **id** and its **folder** are not the same word, and both are needed: the id is what
// `parent.apps` lists and what `installAppById` takes, the folder is where the files land
// in BrowserFS. Deriving one from the other -- which is what this did -- made Monaco look
// permanently uninstalled however many times you installed it, and then made the install
// button fail with `Unknown app: monaco-cdn`. `tinymce` / `tinymce-cdn` is the same shape,
// so this is a pattern rather than a one-off typo; the test pins both against that app's
// real manifest.
export var MONACO_APP = 'monaco';
export var MONACO_FOLDER = 'monaco-cdn';
export var MONACO_VENDOR = '/apps/' + MONACO_FOLDER + '/vendor/vs';

export function chooseEditor (setting, installedIds) {
	var wanted = EDITORS.indexOf(setting) === -1 ? 'auto' : setting;
	var available = (installedIds || []).indexOf(MONACO_APP) !== -1;
	if (wanted === 'plain') {
		return 'plain';
	}
	// Asked for by name and not installed: the answer is still the plain one -- an editor
	// that is not there cannot be waited for -- but the caller is told, because a setting
	// that silently does nothing is worse than one that explains itself.
	if (wanted === 'monaco') {
		return available ? 'monaco' : 'plain';
	}
	return available ? 'monaco' : 'plain';
}

export function editorUnavailable (setting, installedIds) {
	return setting === 'monaco' && (installedIds || []).indexOf(MONACO_APP) === -1;
}

// What to say when the editor you asked for is not there. Monaco is an app in this same
// system, so "not installed" is something this app can *fix* rather than only report --
// but only when it is running inside PixOS, which is what `canInstall` answers. Outside
// it there is no registry to install from, and an offer that cannot be taken is worse
// than a plain explanation.
//
// Nothing is installed without being asked: it is twelve megabytes copied into the
// filesystem, and a picker that silently started a large download would be a worse
// surprise than the note.
export function editorNotice (setting, installedIds, canInstall) {
	if (!editorUnavailable(setting, installedIds)) {
		return null;
	}
	return canInstall ? 'offer' : 'explain';
}

export function settingsFileFor (name) {
	return '/settings/' + (name || 'filmoskop') + '.json';
}

export function readEditorSetting (raw) {
	var data = raw && typeof raw === 'object' ? raw : {};
	return EDITORS.indexOf(data.editor) === -1 ? 'auto' : data.editor;
}
