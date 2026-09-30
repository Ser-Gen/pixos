'use strict';

// apps/screensavers/Sky.xscr/data/stars.json: the stars the Sky screensaver draws, cut from the Yale
// Bright Star Catalogue. Phase 26, the Sky pass; docs/screensavers-plan.md.
//
// The catalogue is not in this repository -- 9,110 entries and a remarks file, 1.3 MB -- only what
// was cut from it. Run by hand, once, with the two files CDS serves as catalogue V/50:
//
//     curl -O https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz
//     curl -O https://cdsarc.cds.unistra.fr/ftp/V/50/notes.gz
//     gunzip catalog.gz notes.gz
//     node scripts/sky-stars.js catalog notes
//
// **Down to magnitude 4**, which the user chose over the whole catalogue: 518 stars, about a city
// sky. Each star keeps its J2000 place, its brightness, its colour (B-V) and what the page calls it
// when pointed at -- the catalogue's own name for it when its remarks give one (207 of the 518 have
// one: Betelgeuse, Vega, Polaris), and always its Bayer or Flamsteed designation, written out the way
// an atlas does, "α Orionis".
//
// Required by tests/sky-stars.test.mjs, which reads the parsers below against lines copied from the
// catalogue and checks the committed file.

var fs = require('fs');
var path = require('path');

var LIMIT = 4;
var OUT = path.join(__dirname, '..', 'apps', 'screensavers', 'Sky.xscr', 'data', 'stars.json');

// The catalogue's three-letter Greek abbreviations, as in its Name field ("Mu " and "Nu " included).
var GREEK = {
	Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε', Zet: 'ζ', Eta: 'η', The: 'θ', Iot: 'ι', Kap: 'κ',
	Lam: 'λ', Mu: 'μ', Nu: 'ν', Xi: 'ξ', Omi: 'ο', Pi: 'π', Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ',
	Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω'
};
var SUPERSCRIPT = {1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹'};

// The 88 constellations by their IAU abbreviation, each with the genitive a designation uses.
var CONSTELLATIONS = {
	And: 'Andromedae', Ant: 'Antliae', Aps: 'Apodis', Aqr: 'Aquarii', Aql: 'Aquilae', Ara: 'Arae',
	Ari: 'Arietis', Aur: 'Aurigae', Boo: 'Boötis', Cae: 'Caeli', Cam: 'Camelopardalis', Cnc: 'Cancri',
	CVn: 'Canum Venaticorum', CMa: 'Canis Majoris', CMi: 'Canis Minoris', Cap: 'Capricorni',
	Car: 'Carinae', Cas: 'Cassiopeiae', Cen: 'Centauri', Cep: 'Cephei', Cet: 'Ceti',
	Cha: 'Chamaeleontis', Cir: 'Circini', Col: 'Columbae', Com: 'Comae Berenices',
	CrA: 'Coronae Australis', CrB: 'Coronae Borealis', Crv: 'Corvi', Crt: 'Crateris', Cru: 'Crucis',
	Cyg: 'Cygni', Del: 'Delphini', Dor: 'Doradus', Dra: 'Draconis', Equ: 'Equulei', Eri: 'Eridani',
	For: 'Fornacis', Gem: 'Geminorum', Gru: 'Gruis', Her: 'Herculis', Hor: 'Horologii', Hya: 'Hydrae',
	Hyi: 'Hydri', Ind: 'Indi', Lac: 'Lacertae', Leo: 'Leonis', LMi: 'Leonis Minoris', Lep: 'Leporis',
	Lib: 'Librae', Lup: 'Lupi', Lyn: 'Lyncis', Lyr: 'Lyrae', Men: 'Mensae', Mic: 'Microscopii',
	Mon: 'Monocerotis', Mus: 'Muscae', Nor: 'Normae', Oct: 'Octantis', Oph: 'Ophiuchi', Ori: 'Orionis',
	Pav: 'Pavonis', Peg: 'Pegasi', Per: 'Persei', Phe: 'Phoenicis', Pic: 'Pictoris', Psc: 'Piscium',
	PsA: 'Piscis Austrini', Pup: 'Puppis', Pyx: 'Pyxidis', Ret: 'Reticuli', Sge: 'Sagittae',
	Sgr: 'Sagittarii', Sco: 'Scorpii', Scl: 'Sculptoris', Sct: 'Scuti', Ser: 'Serpentis',
	Sex: 'Sextantis', Tau: 'Tauri', Tel: 'Telescopii', Tri: 'Trianguli', TrA: 'Trianguli Australis',
	Tuc: 'Tucanae', UMa: 'Ursae Majoris', UMi: 'Ursae Minoris', Vel: 'Velorum', Vir: 'Virginis',
	Vol: 'Volantis', Vul: 'Vulpeculae'
};

// Bytes `from` to `to` of a catalogue line, 1-based and inclusive as its ReadMe numbers them.
function field (line, from, to) {
	return line.slice(from - 1, to).trim();
}

// "  58Alp Ori" -> "α Orionis"; " 41Gam1Leo" -> "γ¹ Leonis"; a Flamsteed number alone -> "58 Orionis";
// neither -> "HR 2061".
function designation (line) {
	var hr = Number(field(line, 1, 4));
	var flamsteed = field(line, 5, 7);
	var bayer = line.slice(7, 10).trim();
	var index = line.slice(10, 11).trim();
	var genitive = CONSTELLATIONS[field(line, 12, 14)];
	if (genitive && GREEK[bayer]) {
		return GREEK[bayer] + (SUPERSCRIPT[index] || '') + ' ' + genitive;
	}
	if (genitive && flamsteed) {
		return flamsteed + ' ' + genitive;
	}
	return 'HR ' + hr;
}

// One catalogue line as a star, or null for the fourteen entries that are not stars (novae and
// galaxies kept only for the numbering) and so have no place or no magnitude.
function parseStar (line) {
	if (!field(line, 76, 77) || !field(line, 103, 107)) {
		return null;
	}
	var ra = (Number(field(line, 76, 77)) + Number(field(line, 78, 79)) / 60 + Number(field(line, 80, 83)) / 3600) * 15;
	var dec = (field(line, 84, 84) === '-' ? -1 : 1)
		* (Number(field(line, 85, 86)) + Number(field(line, 87, 88)) / 60 + Number(field(line, 89, 90)) / 3600);
	var bv = field(line, 110, 114);
	return {
		hr: Number(field(line, 1, 4)),
		ra: ra,
		dec: dec,
		mag: Number(field(line, 103, 107)),
		bv: bv === '' ? null : Number(bv),
		designation: designation(line)
	};
}

// "BETELGEUSE" -> "Betelgeuse"; "KAUS AUSTRALIS" -> "Kaus Australis".
function titleCase (text) {
	return text.toLowerCase().replace(/(^|[\s-])([a-zà-ÿ])/g, function (all, before, letter) {
		return before + letter.toUpperCase();
	});
}

var GENITIVES = Object.keys(CONSTELLATIONS).map(function (key) {
	return CONSTELLATIONS[key];
});

// The name a star's first `N:` remark opens with, or ''. The famous ones are in capitals ahead of
// the older spellings -- "POLARIS; Alruccabah; ..." -- and the rest in plain case, "Caph; Chaph".
// But a remark is free text, and many open with a sentence instead: "Head of Hydrus.", "See HR
// 1543.", "Called Alpha Mon in BAC ...", "Achird, according to Becvar; ...". So a name in plain case
// counts only when it stands alone before a ";" or a ".", in capitalised words (with "al" and "el",
// and a Roman numeral, as in "Nair al Saif" and "Hyadum II"), and is not a constellation's genitive
// ("Fornacis; 12 Eri in For."). A name lost to that is still drawn, and called by its designation.
function nameIn (remark) {
	var match = /^([^;,.()]+)(;|\.|$)/.exec(remark.trim());
	var first = match ? match[1].trim() : '';
	if (/^[A-Z][A-Z' -]*[A-Z]$/.test(first)) {
		return titleCase(first);
	}
	if (/^[A-Z][a-z']+(?: (?:[A-Z][a-z']+|al|el|I{1,3}))*$/.test(first) && GENITIVES.indexOf(first) === -1) {
		return first;
	}
	return '';
}

// The catalogue's own name for each star that has one, by HR number.
function properNames (notes) {
	var names = {};
	notes.split('\n').forEach(function (line) {
		if (line.slice(7, 9) !== 'N:' || Number(line.slice(5, 7)) !== 1) {
			return;
		}
		var name = nameIn(line.slice(12));
		if (name) {
			names[Number(line.slice(1, 5))] = name;
		}
	});
	return names;
}

function round (value, places) {
	var factor = Math.pow(10, places);
	return Math.round(value * factor) / factor;
}

function buildStars (catalog, notes) {
	var names = properNames(notes);
	return catalog.split('\n').map(parseStar).filter(function (star) {
		return star && star.mag <= LIMIT;
	}).sort(function (a, b) {
		return a.mag - b.mag || a.hr - b.hr;
	}).map(function (star) {
		return [round(star.ra, 3), round(star.dec, 3), star.mag, star.bv, names[star.hr] || '', star.designation];
	});
}

// One star to a line, so a change to the cut reads as a diff.
function writeStars (stars) {
	var head = {
		_comment: [
			'Generated by scripts/sky-stars.js from the Yale Bright Star Catalogue. Do not edit by hand.',
			'Every star down to magnitude ' + LIMIT + ', brightest first: J2000 right ascension and declination',
			'in degrees, visual magnitude, B-V colour (null where the catalogue has none), the catalogue\'s',
			'own name for it or "", and its designation.'
		],
		source: 'The Bright Star Catalogue, 5th Revised Ed. (Hoffleit & Warren, 1991), CDS catalogue V/50',
		fields: ['ra', 'dec', 'mag', 'bv', 'name', 'designation']
	};
	var text = JSON.stringify(head, null, '\t').replace(/\n}$/, ',\n\t"stars": [\n')
		+ stars.map(function (star) { return '\t\t' + JSON.stringify(star); }).join(',\n') + '\n\t]\n}\n';
	fs.mkdirSync(path.dirname(OUT), {recursive: true});
	fs.writeFileSync(OUT, text);
	return text;
}

if (require.main === module) {
	var args = process.argv.slice(2);
	if (args.length !== 2) {
		console.error('usage: node scripts/sky-stars.js <catalog> <notes>   (CDS V/50, unzipped)');
		process.exit(1);
	}
	var stars = buildStars(fs.readFileSync(args[0], 'latin1'), fs.readFileSync(args[1], 'latin1'));
	var text = writeStars(stars);
	console.log('wrote ' + path.relative(process.cwd(), OUT) + ': ' + stars.length + ' stars, '
		+ stars.filter(function (star) { return star[4]; }).length + ' named, ' + Buffer.byteLength(text) + ' bytes');
}

module.exports = {
	LIMIT: LIMIT,
	CONSTELLATIONS: CONSTELLATIONS,
	designation: designation,
	parseStar: parseStar,
	nameIn: nameIn,
	properNames: properNames,
	titleCase: titleCase,
	buildStars: buildStars
};
