// Icon resolution. Only a couple of apps ship a favicon, so the monogram fallback is the
// path that actually runs most of the time.

import {check, report} from './assert.mjs';
import * as icons from '../js/shell/app-icons.js';

check('a one-word name gives one letter', icons.monogramFor('Ace', 'ace'), 'A');
check('two words give two initials', icons.monogramFor('Disk Treemap', 'treemap'), 'DT');
check('a hyphenated id reads as two words', icons.monogramFor(null, 'media-player'), 'mp');
check('dots and underscores separate too', icons.monogramFor('tic80_v1.1', 'tic80'), 'tv');
check('nothing at all still renders something', icons.monogramFor(null, null), '?');

check('the colour is stable for an id', icons.colorFor('ace'), icons.colorFor('ace'));
check('different apps get different colours', icons.colorFor('ace') !== icons.colorFor('treemap'), true);
check('the colour is a legible hsl, not arbitrary', /^hsl\(\d+, 42%, 44%\)$/.test(icons.colorFor('anything')), true);

check('no icon means no candidates', icons.urlCandidates({id: 'ace'}), []);
// An app installed before it gained an icon has no copy in BrowserFS until the user
// takes the update; the catalog copy on the server is the second chance.
check('a manifest path tries the installed copy then the catalog', icons.urlCandidates({icon: '/apps/treemap/favicon.svg'}),
	['/__browserfs__/apps/treemap/favicon.svg', '/apps/treemap/favicon.svg']);
check('an already-served path is not retried', icons.urlCandidates({icon: '/__browserfs__/apps/x/i.svg'}), ['/__browserfs__/apps/x/i.svg']);
check('an absolute url has no second candidate', icons.urlCandidates({icon: 'https://x/i.png'}), ['https://x/i.png']);

check('no icon means no url', icons.urlFor({id: 'ace'}), null);
check('a manifest path is served through the worker', icons.urlFor({icon: '/apps/treemap/favicon.svg'}), '/__browserfs__/apps/treemap/favicon.svg');
check('a relative path is still absolute afterwards', icons.urlFor({icon: 'apps/x/i.svg'}), '/__browserfs__/apps/x/i.svg');
check('a data url is left alone', icons.urlFor({icon: 'data:image/svg+xml,<svg/>'}), 'data:image/svg+xml,<svg/>');
check('an http url is left alone', icons.urlFor({icon: 'https://x/i.png'}), 'https://x/i.png');

process.exit(report('app-icons') ? 1 : 0);
