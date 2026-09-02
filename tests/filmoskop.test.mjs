// Slide decks: where one ends, what a layout is, and what the speaker sees.
//
// The parser is the real vendored comark rather than a stub, and the deck parsed at the
// bottom is the real seeded template — so a change in the AST shape, or a template that
// stops demonstrating what it claims to, fails here rather than in front of an audience.

import fs from 'fs';
import {check, report} from './assert.mjs';
import * as deck from '../apps/filmoskop/js/deck.js';
import {parseMarkdown} from '../apps/filmoskop/vendor/comark.mjs';

// --- where a slide ends ------------------------------------------------------------------

let split = deck.splitSlides('# one\n\n-----\n\n# two\n\n-----\n\n# three');
check('five dashes separate slides', split.slides.length, 3);
check('and the dashes themselves are not part of one',
	split.slides[1].includes('-----'), false);
check('each slide knows which line it starts on', split.starts, [0, 3, 7]);

check('no separator at all is one slide', deck.splitSlides('# only').slides.length, 1);
check('an empty document is still one slide, not none',
	deck.splitSlides('').slides.length, 1);
check('more than five dashes is still a separator',
	deck.splitSlides('a\n--------\nb').slides.length, 2);
// Three dashes is frontmatter, and markdown's own thematic break. Taking it would break
// every deck that has a horizontal rule in it.
check('but three is not — that is frontmatter and a horizontal rule',
	deck.splitSlides('a\n---\nb').slides.length, 1);
check('and dashes with text after them are not either',
	deck.splitSlides('a\n----- and more\nb').slides.length, 1);
check('trailing spaces do not stop it being a separator',
	deck.splitSlides('a\n-----  \nb').slides.length, 2);

// --- following the caret --------------------------------------------------------------------

const source = '# one\n\n-----\n\n# two\n\n-----\n\n# three';
check('the caret at the start is in the first slide', deck.slideAtOffset(source, 0), 0);
check('after the first separator it is in the second',
	deck.slideAtOffset(source, source.indexOf('# two')), 1);
check('and at the end, in the last', deck.slideAtOffset(source, source.length), 2);
check('a line number works too', deck.slideAtLine(source, 4), 1);
check('the line the separator is on belongs to the slide it opens',
	deck.slideAtLine(source, 3), 1);

// --- layouts ----------------------------------------------------------------------------------

check('the layouts a deck can ask for', Object.keys(deck.LAYOUTS).sort(),
	['background-image', 'columns', 'quote', 'side-image', 'title']);
check('and an ordinary component is not one of them', deck.isLayout('alert'), false);

let doc = await parseMarkdown('::side-image{src="a.png" align="left"}\n# Hello\n::');
let plan = deck.planSlide(doc.nodes);
check('a component becomes a layout on the slide', plan.className,
	'Slide--sideImage Slide--imageLeft');
check('the default side is the right one',
	deck.planSlide((await parseMarkdown('::side-image{src="a.png"}\ntext\n::')).nodes).className,
	'Slide--sideImage Slide--imageRight');
check('a background image is dimmed unless told otherwise',
	deck.planSlide((await parseMarkdown('::background-image{src="a.png"}\ntext\n::')).nodes).className,
	'Slide--backgroundImage Slide--dimmed');
check('and the shading can be turned off',
	deck.planSlide((await parseMarkdown('::background-image{src="a.png" dim="false"}\ntext\n::')).nodes).className,
	'Slide--backgroundImage');
check('a slide with no component has no layout class',
	deck.planSlide((await parseMarkdown('# plain')).nodes).className, '');

// Two layouts on one slide is a mistake; the last one winning would make the answer depend
// on something invisible.
const twice = deck.planSlide((await parseMarkdown('::title\na\n::\n\n::quote\nb\n::')).nodes);
check('with two layouts the first one wins', twice.className, 'Slide--title');

// --- the speaker's half ---------------------------------------------------------------------

doc = await parseMarkdown('# Slide\n\n::notes\nRemember the thing.\n::\n\nVisible text.');
plan = deck.planSlide(doc.nodes);
check('notes are taken out of the slide', plan.hasNotes, true);
// The one thing in a deck that must never be rendered where the room can read it.
check('and are not left in what gets shown',
	plan.content.some(node => Array.isArray(node) && node[0] === 'notes'), false);
check('the rest of the slide is untouched',
	plan.content.filter(node => Array.isArray(node)).length, 2);
check('the notes come back as text for the presenter window',
	deck.textOf(plan.notes[0]).trim(), 'Remember the thing.');
check('a slide with no notes says so',
	deck.planSlide((await parseMarkdown('# plain')).nodes).hasNotes, false);

// --- titles -------------------------------------------------------------------------------------

check('a slide is named by its heading',
	deck.titleOf((await parseMarkdown('## The middle bit\n\ntext')).nodes), 'The middle bit');
// The heading is almost always inside a layout, so the search has to go into components —
// a ::title slide would otherwise be listed by its whole body run together.
check('even when the heading is inside a layout',
	deck.titleOf((await parseMarkdown('::title\n# Wrapped\n\nmore\n::')).nodes), 'Wrapped');
check('and with no heading, by its first words',
	deck.titleOf((await parseMarkdown('just some words here')).nodes), 'just some words here');
check('a long slide with no heading is cut rather than filling the list',
	deck.titleOf((await parseMarkdown('x '.repeat(80))).nodes).length <= 60, true);

// --- deck settings -------------------------------------------------------------------------------

let settings = deck.settingsFrom({title: 'Talk', author: 'Me', theme: 'light'});
check('frontmatter carries the deck settings', [settings.title, settings.author, settings.theme],
	['Talk', 'Me', 'light']);
check('the theme defaults to dark', deck.settingsFrom({}).theme, 'dark');
check('an unknown theme is dark rather than broken', deck.settingsFrom({theme: 'neon'}).theme, 'dark');
check('slide numbers are on by default', deck.settingsFrom({}).counter, true);
check('and can be turned off', deck.settingsFrom({counter: false}).counter, false);
check('including from YAML that made it a string',
	deck.settingsFrom({counter: 'false'}).counter, false);

// --- pictures ------------------------------------------------------------------------------------

// The renderer is the app, which lives in /apps/filmoskop — two folders from the deck. A
// relative path resolved against the *document* is how every picture in every deck breaks.
check('a picture beside the deck resolves against the deck',
	deck.resolveAsset('pic.png', '/home/talks'), '/home/talks/pic.png');
check('and one above it', deck.resolveAsset('../img/a.png', '/home/talks'), '/home/img/a.png');
check('an absolute path is left alone', deck.resolveAsset('/home/a.png', '/other'), '/home/a.png');
check('and a URL is not touched at all',
	deck.resolveAsset('https://example.com/a.png', '/home'), 'https://example.com/a.png');
check('nor is a data URI', deck.isExternalSrc('data:image/png;base64,AAA'), true);
check('a plain filename is not external', deck.isExternalSrc('pic.png'), false);

// --- export ---------------------------------------------------------------------------------------

check('an exported deck is named after the file', deck.exportNameFor('talk.deck.md'), 'talk.html');
check('a plain markdown deck too', deck.exportNameFor('notes.md'), 'notes.html');

const html = deck.exportHtml({
	name: 'talk.deck.md',
	settings: deck.settingsFrom({title: 'A & B', theme: 'light'}),
	slides: [{className: 'Slide--title', html: '<h1>One</h1>'}, {className: '', html: '<p>Two</p>'}],
	css: '.Slide{color:red}'
});
check('the export is a whole document', html.startsWith('<!DOCTYPE html>'), true);
check('with both slides in it', (html.match(/class="Slide /g) || []).length, 2);
check('the layout class survives into it', html.includes('Slide--title'), true);
check('the stylesheet is inline, because an export is one file',
	html.includes('.Slide{color:red}'), true);
// It carries no parser: the slides are already markup, and shipping 220 KB of comark to
// re-read HTML would be absurd.
check('and it carries navigation but no parser',
	[html.includes('ArrowRight'), html.includes('parseMarkdown')], [true, false]);
check('the theme is on the body', html.includes('class="theme-light"'), true);
check('a title with an ampersand in it is escaped', html.includes('<title>A &amp; B</title>'), true);
check('slide numbers appear when they are on',
	deck.exportHtml({settings: deck.settingsFrom({}), slides: [{html: 'x'}]}).includes('Slide__counter'),
	true);
check('and not when they are off',
	deck.exportHtml({settings: deck.settingsFrom({counter: false}), slides: [{html: 'x'}]})
		.includes('Slide__counter'), false);

// --- which editor ------------------------------------------------------------------------------------
//
// PixOS already has a real editor: the monaco-cdn app carries a vendored Monaco, in the
// same filesystem this app is installed into. Filmoskop borrows it rather than shipping a
// second copy — and falls back to its own textarea when nobody installed it.

check('with Monaco installed, that is what you get',
	deck.chooseEditor('auto', ['explorer', 'monaco']), 'monaco');
check('without it, the plain editor', deck.chooseEditor('auto', ['explorer']), 'plain');
check('asking for plain gets plain even when Monaco is there',
	deck.chooseEditor('plain', ['monaco']), 'plain');
// An editor that is not installed cannot be waited for, so the answer is the plain one —
// but the app says so, because a setting that silently does nothing is worse than one that
// explains itself.
check('asking for Monaco without it installed falls back',
	deck.chooseEditor('monaco', []), 'plain');
check('and that case is reported rather than silent',
	deck.editorUnavailable('monaco', []), true);
check('while an automatic fallback is not worth mentioning',
	deck.editorUnavailable('auto', []), false);
check('a setting nobody recognises is the automatic one',
	deck.chooseEditor('emacs', ['monaco']), 'monaco');

// Monaco is an app in this same system, so "not installed" is something Filmoskop can
// offer to fix. Outside PixOS there is no registry to install from, and an offer that
// cannot be taken is worse than a plain explanation — so the notice has two forms and the
// decision between them is here rather than inline.
check('inside PixOS the note offers to install it',
	deck.editorNotice('monaco', [], true), 'offer');
check('outside it, the note can only explain',
	deck.editorNotice('monaco', [], false), 'explain');
check('with Monaco installed there is nothing to say',
	deck.editorNotice('monaco', ['monaco'], true), null);
check('and an automatic fallback is never worth a note',
	deck.editorNotice('auto', [], true), null);

// The id and the folder are different words, and reading them off the real manifest is the
// only thing that can catch them drifting apart — getting it wrong made Monaco look
// uninstalled no matter how many times you installed it, and made the install button fail
// with "Unknown app".
const monacoManifest = JSON.parse(
	fs.readFileSync(new URL('../apps/monaco-cdn/pixos.app.json', import.meta.url), 'utf8'));
check('the id filmoskop installs by is that app\'s real id',
	monacoManifest.id, deck.MONACO_APP);
check('and the folder it borrows from is where that app actually puts its files',
	monacoManifest.files.some(file => (file.path || file) === deck.MONACO_VENDOR + '/loader.js'),
	true);

check('the setting is read out of a file', deck.readEditorSetting({editor: 'monaco'}), 'monaco');
check('a missing file is the default', deck.readEditorSetting(null), 'auto');
check('and so is a file with nonsense in it', deck.readEditorSetting({editor: 42}), 'auto');
check('which file it is', deck.settingsFileFor('filmoskop'), '/settings/filmoskop.json');

// --- the deck that ships with PixOS ------------------------------------------------------------------
//
// Seeded into /home on a fresh system, so it is the first deck anybody sees. It is also
// the only documentation of the layout syntax, which is why it is checked rather than
// trusted: a template that stops demonstrating a layout leaves that layout undiscoverable.

const template = fs.readFileSync(new URL('../templates/talk.deck.md', import.meta.url), 'utf8');
const templateSplit = deck.splitSlides(template);
check('the seeded deck has slides', templateSplit.slides.length > 5, true);

const parsedSlides = [];
for (const text of templateSplit.slides) {
	parsedSlides.push(await parseMarkdown(text));
}
check('its frontmatter is read', deck.settingsFrom(parsedSlides[0].frontmatter).title,
	'A deck in PixOS');

const usedLayouts = new Set();
let notesSeen = 0;
parsedSlides.forEach(parsed => {
	const slidePlan = deck.planSlide(parsed.nodes);
	if (slidePlan.layout) {
		usedLayouts.add(slidePlan.layout.name);
	}
	if (slidePlan.hasNotes) {
		notesSeen++;
	}
});
check('and it demonstrates every layout there is',
	Array.from(usedLayouts).sort(), Object.keys(deck.LAYOUTS).sort());
check('including notes, which are otherwise invisible and undiscoverable', notesSeen > 0, true);
check('every slide in it has a title for the presenter list',
	parsedSlides.every(parsed => deck.titleOf(deck.planSlide(parsed.nodes).content).length > 0), true);

// --- the stylesheet an export carries ------------------------------------------------------------
//
// The exported deck copies one <style> element verbatim. It used to be the app's single
// stylesheet with the editor rules cut out by a regex, and that regex ate the
// syntax-highlighting colours along with them — an export where no code was highlighted,
// with nothing to indicate why. Two elements now, and this is what keeps them apart.

const appSource = fs.readFileSync(new URL('../apps/filmoskop/index.html', import.meta.url), 'utf8');
const slideStyle = /<style id="slideStyle">([\s\S]*?)<\/style>/.exec(appSource);
check('the slide stylesheet is its own element', !!slideStyle, true);
check('and carries the code colours, which is what went missing',
	slideStyle[1].includes('.token.keyword'), true);
check('and the layouts', slideStyle[1].includes('.Layout--sideImage'), true);
check('and the slide itself', slideStyle[1].includes('.Slide__counter'), true);
check('while none of the editor chrome is in it',
	/#bar|#source|#editorPane|#grip/.test(slideStyle[1]), false);
// The other direction matters too: a slide rule left behind in the app's own stylesheet
// would look right in the preview and be missing from every export.
const chromeStyle = /<style>([\s\S]*?)<\/style>/.exec(appSource);
check('and no slide rule is left behind in the chrome',
	/\.Layout--|\.token\.|\.Slide__counter/.test(chromeStyle[1]), false);

// --- hiding something actually hides it ------------------------------------------------------
//
// `element.hidden = true` does nothing to an element an author rule gives a `display` to:
// cascade origin is decided before specificity, so any author rule beats the browser's own
// [hidden] rule. Both of this app's overlays are positioned across everything below them,
// so the placeholder sat on top of every slide and the presenter window looked permanently
// empty — one omission, two bugs that looked unrelated.

const speakerSource = fs.readFileSync(new URL('../apps/filmoskop/speaker.html', import.meta.url), 'utf8');
const hiddenReset = /\[hidden\]\s*\{\s*display:\s*none\s*!important/;

check('the app resets [hidden] itself', hiddenReset.test(chromeStyle[1]), true);
check('and so does the presenter window', hiddenReset.test(speakerSource), true);
// Both are toggled from script; without the reset above they are simply always on screen.
check('the empty-deck placeholder is one of the things that depends on it',
	/ui\.empty\.hidden\s*=/.test(appSource), true);
check('and so is the presenter\'s waiting overlay',
	/ui\.waiting\.hidden\s*=/.test(speakerSource), true);

// --- the presenter shows the same slide, not a similar one -------------------------------------
//
// Its previews used to be built from a handful of rules of its own: no layout classes at
// all, and a copy of the code colours. So a side-image slide was a picture *above* its text
// there and beside it on the screen — a difference you find at the worst possible moment.
// Each preview is now a frame carrying the deck's own stylesheet at the deck's own size,
// which is also the only way the vw/vh in that sheet can mean what they mean in the deck.

const speakerStyle = /<style>([\s\S]*?)<\/style>/.exec(speakerSource);
check('the presenter keeps no slide rules of its own',
	/\.Layout--|\.token\.|\.Slide__/.test(speakerStyle[1]), false);
check('it renders each preview in a frame, which is what gives vw/vh a viewport',
	/<iframe class="inner"/.test(speakerSource), true);
check('and puts the slide\'s layout classes back on it',
	/section\.className = 'Slide '/.test(speakerSource), true);

['style', 'width', 'height', 'theme'].forEach(field => {
	check('the deck sends its ' + field + ' to the presenter',
		new RegExp('\\n\\t\\t\\t' + field + ':').test(appSource), true);
});

// --- following the caret is not navigation -----------------------------------------------------
//
// `scrollIntoView({behavior: 'auto'})` means *defer to the CSS*, and #slides is
// `scroll-behavior: smooth` — so the jump meant to be invisible was animated, and every
// pause in typing slid the preview across the screen. Only 'instant' overrides a stylesheet.
check('the preview jumps rather than slides', /'instant' : 'smooth'/.test(appSource), true);
check('and nothing asks for the stylesheet\'s behaviour by accident',
	/behavior:\s*'auto'/.test(appSource), false);

// --- the export is the same deck ---------------------------------------------------------------
//
// It carries one stylesheet and nothing else, so anything about how a slide *looks* that
// lives outside that sheet is simply missing there. The font was: slides inherited it from
// the app's body, and an exported deck fell back to the browser's default serif.

check('the slide sheet names the font it is set in',
	/--slide-font:/.test(slideStyle[1]), true);
check('and the slide uses it, rather than inheriting one from the app',
	/font-family:\s*var\(--slide-font\)/.test(slideStyle[1]), true);
check('the scrolling stack is styled in the same sheet, so the export scrolls like the app',
	/\.Slides::-webkit-scrollbar/.test(slideStyle[1]), true);
check('and the app uses that class rather than a second copy under its own id',
	/id="slides" class="Slides"/.test(appSource), true);

const exported = deck.exportHtml({
	settings: deck.settingsFrom({}),
	css: slideStyle[1],
	slides: [{className: '', html: '<h1>Hello</h1>'}]
});
check('so an exported file carries the font with it', exported.includes('--slide-font'), true);
check('and the scrollbar', exported.includes('::-webkit-scrollbar'), true);

// --- a picture behind the words stays behind them ------------------------------------------------
//
// An absolutely positioned element paints above in-flow content whatever the DOM order
// says, so the background picture covered its own slide's text completely. The words are
// wrapped and given a layer; the wrapper is built in the app and styled in the sheet, so
// this checks the two still agree about its name.
check('the background layout wraps its words', /Layout__over/.test(appSource), true);
check('and the sheet lifts that wrapper above the picture',
	/\.Layout__over\s*\{[^}]*z-index/.test(slideStyle[1]), true);
check('while the picture is sized against a box that fills the slide',
	/\.Slide--backgroundImage \.Slide__content\s*\{[^}]*height:\s*100%/.test(slideStyle[1]), true);

// --- ready-made blocks -------------------------------------------------------------------------
//
// The layouts were only written down in the seeded deck, so the way to use one was to find
// a deck that already did and copy out of it. `kind` is the whole design of the palette: a
// title is a *slide* and goes after the one you are in, a code fence is a *block* and goes
// where the caret is. Cutting the slide you are looking at in half is what the other
// choice does.

check('every block says which it is',
	deck.BLOCKS.every(block => block.kind === 'slide' || block.kind === 'block'), true);
check('and has an id, a label and something to insert',
	deck.BLOCKS.every(block => block.id && block.label && block.text.trim()), true);
check('the ones that are slides open with a layout or are plain markdown',
	deck.BLOCKS.filter(block => block.kind === 'slide').length >= 5, true);

// Every built-in has to survive the real parser, or the palette offers something that
// renders as an error the moment it lands in the deck.
for (const block of deck.BLOCKS) {
	const parsed = await parseMarkdown(block.text);
	const built = deck.planSlide(parsed.nodes);
	check('the "' + block.label + '" block parses into something renderable',
		built.content.length > 0 || built.hasNotes, true);
}
check('and every layout in the app has a block that produces it',
	Object.keys(deck.LAYOUTS).every(name => deck.BLOCKS.some(b => b.text.startsWith('::' + name))), true);

// --- what a file in the folder is -----------------------------------------------------------
//
// Nothing to learn and no metadata format: a fragment that opens with a *layout* is a
// slide. `::notes` is the case that makes this a rule about layouts rather than about `::`.

check('a file that opens with a layout is a slide',
	deck.blockKindOf('::title\n# Hello\n::'), 'slide');
check('a speaker note is not, even though it opens with ::',
	deck.blockKindOf('::notes\nSay this.\n::'), 'block');
check('a code fence goes where the caret is', deck.blockKindOf('```js\nx\n```'), 'block');
check('and anything holding a separator is slides whatever else it holds',
	deck.blockKindOf('one\n\n-----\n\ntwo'), 'slide');
check('an empty file claims nothing', deck.blockKindOf(''), 'block');

check('the file name is the label', deck.blockLabelFor('my-closing-slide.md'), 'My closing slide');
check('and the id, so a file can replace a built-in', deck.blockIdFor('Title.md'), 'title');

const merged = deck.blocksFrom([
	{name: 'thanks.md', text: '::title\n# Thanks\n::'},
	{name: 'title.md', text: '::title\n# Mine\n::'},
	{name: 'empty.md', text: '   '}
]);
check('a file with a new name is added', merged.some(b => b.id === 'thanks'), true);
check('as its own kind, worked out from what is in it',
	merged.find(b => b.id === 'thanks').kind, 'slide');
check('a file named after a built-in replaces it rather than sitting beside it',
	merged.filter(b => b.id === 'title').length, 1);
check('and it is the file that wins', merged.find(b => b.id === 'title').text.includes('Mine'), true);
check('an empty file is not a block', merged.some(b => b.id === 'empty'), false);
check('with no files at all the built-ins are the palette',
	deck.blocksFrom([]).length, deck.BLOCKS.length);
check('and nothing said the built-ins were files', deck.blocksFrom([])[0].source, 'built-in');

// --- where the insertion goes ----------------------------------------------------------------

const deckText = 'one\n\n-----\n\ntwo\n\n-----\n\nthree';

check('slides start where the last separator left off',
	deck.slideBounds(deckText).length, 3);
check('and the last one runs to the end',
	deck.slideBounds(deckText)[2].end, deckText.length);

const middle = deck.insertionFor(deckText, deckText.indexOf('two'), {kind: 'slide', text: 'NEW'});
const afterMiddle = deckText.slice(0, middle.start) + middle.text + deckText.slice(middle.end);
check('a slide block lands after the slide the caret is in, not at the caret',
	afterMiddle, 'one\n\n-----\n\ntwo\n\n-----\n\nNEW\n\n-----\n\nthree');
check('with the caret on its first character', afterMiddle.slice(middle.caret, middle.caret + 3), 'NEW');
check('so the preview follows to the slide that was just inserted',
	deck.slideAtOffset(afterMiddle, middle.caret), 2);

const atEnd = deck.insertionFor(deckText, deckText.length, {kind: 'slide', text: 'NEW'});
check('at the end of the deck it simply follows the last slide',
	deckText.slice(0, atEnd.start) + atEnd.text + deckText.slice(atEnd.end),
	'one\n\n-----\n\ntwo\n\n-----\n\nthree\n\n-----\n\nNEW\n');

const empty = deck.insertionFor('', 0, {kind: 'slide', text: 'NEW'});
check('an empty deck gets the block with no separator in front of it',
	empty.text, 'NEW\n');

// Inserting twice must not walk the deck apart: the second insertion replaces the blank
// lines the first one left rather than adding to them.
const firstInsert = deck.insertionFor(deckText, 0, {kind: 'slide', text: 'A'});
const onceText = deckText.slice(0, firstInsert.start) + firstInsert.text + deckText.slice(firstInsert.end);
const secondInsert = deck.insertionFor(onceText, firstInsert.caret, {kind: 'slide', text: 'B'});
check('twice running leaves one blank line between each',
	(onceText.slice(0, secondInsert.start) + secondInsert.text + onceText.slice(secondInsert.end)).includes('\n\n\n'), false);

const atCaret = deck.insertionFor('hello world', 5, {kind: 'block', text: 'TABLE'});
check('a block block goes at the caret',
	'hello world'.slice(0, atCaret.start) + atCaret.text + 'hello world'.slice(atCaret.end),
	'hello\n\nTABLE\n\n world');
check('on blank lines of its own, because markdown counts them',
	deck.insertionFor('a\n\n', 3, {kind: 'block', text: 'X'}).text, 'X\n');
check('and one is enough when one is already there',
	deck.insertionFor('a\n', 2, {kind: 'block', text: 'X'}).text, '\nX\n');
check('a block with nothing in it is not an edit',
	deck.insertionFor('a', 1, {kind: 'block', text: '   '}), null);

// --- the panel is wired to all of that -------------------------------------------------------

check('both editors can insert, which is the seventh function of that interface',
	(appSource.match(/insert: function \(edit\)/g) || []).length, 2);
check('the plain one keeps undo by inserting as if typed',
	/insert: function \(edit\)[\s\S]{0,400}execCommand\('insertText'/.test(appSource), true);
check('and Monaco through its own edit history',
	/insert: function \(edit\)[\s\S]{0,400}executeEdits/.test(appSource), true);
check('the drawer takes the keyboard while it is open, or the arrows would page the deck '
	+ 'behind it', /if \(blocksOpen\) \{[\s\S]{0,200}Escape/.test(appSource), true);
check('the palette reads the folder the model names',
	/deck\.BLOCKS_DIR/.test(appSource), true);
// A tile is a slide, so anything true of a slide has to be true of a tile or the palette
// stops telling the truth. Content that overflows is shrunk to fit in the preview; the
// tiles skipped that and clipped their contents top and bottom on a narrow window.
check('a tile is fitted by the same rule the preview uses',
	/function sizeTile[\s\S]{0,1400}fitSlide\(section\)/.test(appSource), true);
// The tile's own box is measured rather than derived from `aspect-ratio` in a flex item,
// which resolved to a short strip across the top of a tall slide -- and a slide centres
// its content, so a strip across the top of one shows nothing at all.
check('and its box is measured from the grid cell it landed in',
	/view\.style\.height = Math\.round/.test(appSource), true);
check('with a ceiling on how tall a tile may get, since a deck pane is portrait whenever '
	+ 'the source is open', /TILE_HEIGHT/.test(appSource), true);
check('and so is the preview itself, from the one function',
	/function fit \(\)[\s\S]{0,120}forEach\(fitSlide\)/.test(appSource), true);
check('a picture arriving re-measures the slide it landed in, whichever of the two it is',
	/function watchImage[\s\S]{0,500}fitSlide\(section\)/.test(appSource), true);
check('and a fresh system has one of its own in it to find',
	fs.readFileSync(new URL('../settings/preinstall.json', import.meta.url), 'utf8')
		.includes('/settings/filmoskop-blocks/'), true);

process.exit(report('filmoskop') ? 1 : 0);
