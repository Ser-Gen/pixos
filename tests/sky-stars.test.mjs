// The stars the Sky screensaver draws (phase 26, the Sky pass): scripts/sky-stars.js, which cuts them
// from the Yale Bright Star Catalogue, read here against lines copied from that catalogue; and
// apps/screensavers/Sky.xscr/data/stars.json, the file it wrote. The catalogue itself is not in this
// repository, so the cut is checked by what it must be, not remade.

import {check, report} from './assert.mjs';
import fs from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const cut = require('../scripts/sky-stars.js');

// Five lines of CDS V/50's catalog, as they are (the first 120 bytes of each, which is all it reads).
const BETELGEUSE = '2061 58Alp OriBD+07 1055  39801113271 224I   4506  Alp Ori  054945.4+072319055510.3+072425199.79-08.96 0.50  +1.85 +2.06';
const GAMMA1_LEO = '4057 41Gam1LeoBD+20 2467  89484 81298    I   7724A  4823    101427.6+202051101958.3+195030216.55 54.65 2.61  +1.15 +1.00';
const ELECTRA = '1142 17    TauBD+23  507  23302 76131 136  D                033856.1+234757034452.5+240648166.18-23.85 3.70  -0.11 -0.40';
const NOVA = '  92 NOVA 1572                                     B Cas                                                                ';
const UNNAMED = '   1          BD+44 4550      3 36042          46           000001.1+444022000509.9+451345114.44-16.88 6.70  +0.07 +0.08';

check('a Bayer letter, as an atlas writes it', cut.designation(BETELGEUSE), 'α Orionis');
check('with its superscript', cut.designation(GAMMA1_LEO), 'γ¹ Leonis');
check('a Flamsteed number when there is no letter', cut.designation(ELECTRA), '17 Tauri');
check('and the HR number when there is neither', cut.designation(UNNAMED), 'HR 1');
check('the 88 constellations', Object.keys(cut.CONSTELLATIONS).length, 88);

const star = cut.parseStar(BETELGEUSE);
check('its J2000 place in degrees', [Math.round(star.ra * 1000) / 1000, Math.round(star.dec * 1000) / 1000], [88.793, 7.407]);
check('its magnitude and colour', [star.mag, star.bv], [0.5, 1.85]);
check('a southern declination is negative', cut.parseStar(ELECTRA).dec > 0 && cut.parseStar(ELECTRA).dec < 25, true);
check('a nova kept for its number is not a star', cut.parseStar(NOVA), null);

// Remarks as the notes file writes them: HR, counter, category, text.
check('a name in capitals, the famous way', cut.nameIn('BETELGEUSE; Betelguex; Betelgeuze; Beteiguex; Al Mankib.'), 'Betelgeuse');
check('in capitals over two words', cut.nameIn('KAUS AUSTRALIS; Kaus.'), 'Kaus Australis');
check('in plain case, standing alone before a semicolon', cut.nameIn('Caph; Chaph; Kaff; Al Sanam al Nakah.'), 'Caph');
check('or a full stop', cut.nameIn('Hyadum I.'), 'Hyadum I');
check('with "al" inside it', cut.nameIn('Nair al Saif; Hatysa in Becvar.'), 'Nair al Saif');
check('not a sentence', [cut.nameIn('Head of Hydrus.'), cut.nameIn('See HR 1543.'), cut.nameIn('Called Alpha Mon in BAC and many early catalogues.'),
	cut.nameIn('Rana in Becvar. But see HR 188.')], ['', '', '', '']);
check('not a name with a caveat after a comma', cut.nameIn('Achird, according to Becvar; Allen says "unnamed".'), '');
check('not a constellation\'s genitive', cut.nameIn('Fornacis; 12 Eri in For.'), '');

const notes = [
	' 2061 1N:   BETELGEUSE; Betelguex; Betelgeuze; Beteiguex; Al Mankib.',
	' 2061 1S:   Not a name at all.',
	' 1142 1N:   Electra.',
	' 1142 2N:   Merope.',
	'  591 1N:   Head of Hydrus.',
	' 4057 2N:   ALGIEBA; Algeiba.'
].join('\n');
check('each star\'s first name remark, by HR number -- a second one, even a name, is not its name', cut.properNames(notes), {2061: 'Betelgeuse', 1142: 'Electra'});
check('capitals to title case', [cut.titleCase('BETELGEUSE'), cut.titleCase('ZUBEN ELGENUBI'), cut.titleCase('AL-NAIR')],
	['Betelgeuse', 'Zuben Elgenubi', 'Al-Nair']);

const built = cut.buildStars([UNNAMED, ELECTRA, BETELGEUSE, NOVA, GAMMA1_LEO].join('\n'), notes);
check('down to magnitude 4, brightest first, with its name and designation', built,
	[[88.793, 7.407, 0.5, 1.85, 'Betelgeuse', 'α Orionis'], [154.993, 19.842, 2.61, 1.15, '', 'γ¹ Leonis'], [56.219, 24.113, 3.7, -0.11, 'Electra', '17 Tauri']]);

// --- the file it wrote --------------------------------------------------------------------------------

const doc = JSON.parse(fs.readFileSync(new URL('../apps/screensavers/Sky.xscr/data/stars.json', import.meta.url), 'utf8'));
const stars = doc.stars;
check('the fields it says it has', doc.fields, ['ra', 'dec', 'mag', 'bv', 'name', 'designation']);
check('518 stars, the catalogue down to magnitude 4', [stars.length, cut.LIMIT, stars.every(s => s[2] <= cut.LIMIT)], [518, 4, true]);
check('brightest first', stars.every((s, i) => !i || stars[i - 1][2] <= s[2]), true);
check('Sirius first', stars[0].slice(4), ['Sirius', 'α Canis Majoris']);
check('each a place, a magnitude and a designation', stars.every(s => s.length === 6 && s[0] >= 0 && s[0] < 360 && Math.abs(s[1]) <= 90
	&& typeof s[2] === 'number' && (s[3] === null || typeof s[3] === 'number') && typeof s[4] === 'string' && s[5].length > 0), true);
check('207 with a name of their own', stars.filter(s => s[4]).length, 207);
check('and no name twice', new Set(stars.filter(s => s[4]).map(s => s[4])).size, 207);
check('it says where it came from', /Bright Star Catalogue.*V\/50/.test(doc.source), true);

process.exit(report('sky-stars') ? 1 : 0);
