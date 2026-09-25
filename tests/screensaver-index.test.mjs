// apps/screensavers/index.json (phase 26, pass 4): generated, and checked here against the folders it
// is generated from, the way tests/precache.test.mjs checks the precache against the directory.
// Then what the three vendored screensavers have to be for a download to work offline: a README
// saying where each came from, its licence among what every look downloads, and nothing that
// reaches another server. Then the generator's refusals, on folders made for the purpose.

import {check, report} from './assert.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const builder = require('../scripts/screensaver-index.js');
const {readIndex, entryFile} = await import('../js/shell/screensaver-catalog.js');

const root = new URL('..', import.meta.url).pathname;
const dir = path.join(root, 'apps/screensavers');
const preinstall = JSON.parse(fs.readFileSync(path.join(root, 'settings/preinstall.json'), 'utf8'));
const committed = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));

check('the index on disk is the one the folders make -- run npm run generate-apps after changing them',
	JSON.stringify(committed) === JSON.stringify(builder.buildIndex(dir, preinstall)), true);
check('the generator writes it', /writeScreensaverIndex\(\)/.test(fs.readFileSync(path.join(root, 'scripts/generate-apps-catalog.js'), 'utf8')), true);

const names = committed.screensavers.map(entry => entry.path);
check('Matrix, Pipes and Habitats are downloaded', names, ['Habitats.xscr', 'Matrix.xscr', 'Pipes.xscr']);
check('and the slideshow, which preinstall copies in, is not', names.includes('Slideshow.xscr'), false);
check('the looks, as the plan chose them', committed.screensavers.map(e => [e.name, e.looks.map(l => l.name)]),
	[['Habitats', ['Reefscape', 'Riverscape']], ['Matrix', ['Classic', 'Resurrections', '3D']], ['Pipes', ['Pipes']]]);

const shell = readIndex(committed);
check('the shell takes every screensaver and every look the generator wrote',
	shell.map(e => [e.path, e.looks.length]), committed.screensavers.map(e => [e.path, e.looks.length]));

const habitats = committed.screensavers.find(e => e.name === 'Habitats');
const look = name => habitats.looks.find(l => l.name === name);
check('Riverscape does not download Reefscape\'s scene, nor Reefscape Riverscape\'s', [
	look('Riverscape').files.some(f => f.includes('/scenes/reefscape/')),
	look('Reefscape').files.some(f => f.includes('/scenes/riverscape/'))
], [false, false]);
check('both need three.js and the shared scene code', ['Habitats.xscr/vendor/three.module.js', 'Habitats.xscr/scenes/shared/pixos-host.js']
	.every(f => look('Reefscape').files.includes(f) && look('Riverscape').files.includes(f)), true);
const sizeOf = files => files.reduce((sum, f) => sum + habitats.files.find(x => x.path === f).size, 0);
check('a look\'s size is the sum of what it needs', habitats.looks.map(l => l.size === sizeOf(l.files)), [true, true]);

for (const entry of committed.screensavers) {
	const folder = path.join(dir, entry.path);
	const readme = fs.readFileSync(path.join(folder, 'README.md'), 'utf8');
	check(entry.name + ': its README pins the commit it came from', /commit [0-9a-f]{40}\b/.test(readme), true);
	check(entry.name + ': every look downloads its licence, its README and its looks', entry.looks.every(l =>
		['LICENSE', 'README.md', 'looks.json'].every(f => l.files.includes(entry.path + '/' + f))), true);
	check(entry.name + ': every look\'s page is among what it downloads', entry.looks.every(l => l.files.includes(entryFile(entry.path, l.entry))), true);
	// Offline after the download is the promise: no page may load a script, a stylesheet or an image
	// from somewhere else. Pipes' original asked cdnjs for three.js and GitHub for a ribbon.
	const remote = entry.files.filter(f => /\.html?$/i.test(f.path)).filter(f => {
		const html = fs.readFileSync(path.join(dir, f.path), 'utf8');
		return /<(script|img|iframe)\b[^>]*\ssrc=["']?(https?:)?\/\//i.test(html) || /<link\b[^>]*\shref=["']?(https?:)?\/\//i.test(html);
	}).map(f => f.path);
	check(entry.name + ': no page loads anything from another server', remote, []);
}

const hostScript = fs.readFileSync(path.join(dir, 'Habitats.xscr/scenes/shared/pixos-host.js'), 'utf8');
check('Habitats is started, and paused and resumed through its frame rate', [
	/window\.habitatRate\(RATE\);/.test(hostScript),
	/window\.pixosPause = \(\) => window\.habitatRate\(0\);/.test(hostScript),
	/window\.pixosResume = \(\) => window\.habitatRate\(RATE\);/.test(hostScript)
], [true, true, true]);
for (const scene of ['reefscape', 'riverscape']) {
	const page = fs.readFileSync(path.join(dir, 'Habitats.xscr/scenes', scene, 'wallpaper.html'), 'utf8');
	check(scene + ' loads the host script after start.js, which keeps the rate until the scene is there',
		/src="\.\.\/shared\/start\.js"[^>]*><\/script>[\s\S]*src="\.\.\/shared\/pixos-host\.js"/.test(page), true);
}

// --- the generator's rules, on folders made for them ---------------------------------------------------

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pixos-screensavers-'));
function folder (name, files) {
	const at = path.join(scratch, name);
	fs.rmSync(at, {recursive: true, force: true});
	for (const [file, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(at, file)), {recursive: true});
		fs.writeFileSync(path.join(at, file), text);
	}
	return name;
}
function refusal (files) {
	const name = folder('Test.xscr', files);
	try {
		builder.buildEntry(scratch, name);
		return 'built';
	}
	catch (err) {
		return err.message;
	}
}
const looksOf = looks => JSON.stringify({looks});

const plain = builder.buildEntry(scratch, folder('Plain.xscr', {'index.html': 'x', 'a/b.js': 'yy'}));
check('a folder with no looks.json is one look, named after it, needing everything',
	plain.looks, [{name: 'Plain', size: 3, files: ['Plain.xscr/a/b.js', 'Plain.xscr/index.html']}]);
fs.writeFileSync(path.join(scratch, 'Rain.xscr.html'), 'rain');
check('a single page is one file and one look', builder.buildEntry(scratch, 'Rain.xscr.html'),
	{name: 'Rain', path: 'Rain.xscr.html', size: 4,
		files: [{path: 'Rain.xscr.html', size: 4, sha256: 'sha256:' + require('node:crypto').createHash('sha256').update('rain').digest('hex')}],
		looks: [{name: 'Rain', size: 4, files: ['Rain.xscr.html']}]});
const two = builder.buildEntry(scratch, folder('Two.xscr', {'index.html': 'x', 'one/a.png': 'aa', 'two/b.png': 'bbb', 'shared.js': 's',
	'looks.json': looksOf([{name: 'One', files: ['one/']}, {name: 'Two', entry: 'index.html?two', files: ['two/b.png']}])}));
check('a look needs what it claims and what nobody claims', two.looks.map(l => l.files.map(f => f.slice('Two.xscr/'.length))),
	[['index.html', 'looks.json', 'one/a.png', 'shared.js'], ['index.html', 'looks.json', 'shared.js', 'two/b.png']]);
const overlap = builder.buildEntry(scratch, folder('Overlap.xscr', {'index.html': 'x', 'one/a.png': 'aa',
	'looks.json': looksOf([{name: 'One', files: ['one/', 'one/a.png']}])}));
check('a file claimed twice by one look is needed once', overlap.looks[0].files.filter(f => /a\.png$/.test(f)).length, 1);
const escaped = builder.buildEntry(scratch, folder('Escaped.xscr', {'my page.html': 'x', 'looks.json': looksOf([{name: 'Mine', entry: 'my%20page.html?x'}])}));
check('a look\'s page is read unescaped, as the shell reads it', escaped.looks[0].entry, 'my%20page.html?x');

check('a looks.json that does not parse', /Test\.xscr\/looks\.json: not JSON/.test(refusal({'index.html': 'x', 'looks.json': '{'})), true);
check('no looks', refusal({'index.html': 'x', 'looks.json': looksOf([])}), 'Test.xscr/looks.json: needs a non-empty "looks" array');
check('a look with no name', refusal({'index.html': 'x', 'looks.json': looksOf([{entry: 'index.html'}])}), 'Test.xscr/looks.json: look 1 has no name');
check('two with one name', refusal({'index.html': 'x', 'looks.json': looksOf([{name: 'A'}, {name: 'A '}])}), 'Test.xscr/looks.json: two looks are called A');
check('a page outside the folder', refusal({'index.html': 'x', 'looks.json': looksOf([{name: 'A', entry: '../x.html'}])}),
	'Test.xscr/looks.json: A: "entry" must be a page inside the folder, not "../x.html"');
check('or behind a hash', /must be a page inside/.test(refusal({'index.html': 'x', 'looks.json': looksOf([{name: 'A', entry: '..#x'}])})), true);
check('a page that is not there', refusal({'index.html': 'x', 'looks.json': looksOf([{name: 'A', entry: 'gone.html?q'}])}),
	'Test.xscr/looks.json: A: its entry gone.html is not in the folder');
check('no page and no index.html', refusal({'page.html': 'x', 'looks.json': looksOf([{name: 'A'}])}),
	'Test.xscr/looks.json: A: no "entry", and no index.html to open instead');
check('a claim that matches nothing -- which would quietly download too much', refusal({'index.html': 'x', 'looks.json': looksOf([{name: 'A', files: ['assets/']}])}),
	'Test.xscr/looks.json: A: "assets/" matches no file');
check('a tile that is not a string', refusal({'index.html': 'x', 'looks.json': looksOf([{name: 'A', tile: 3}])}),
	'Test.xscr/looks.json: A: "tile" is a CSS background, a string');

fs.rmSync(path.join(scratch, 'Test.xscr'), {recursive: true, force: true});
folder('Kept.xscr', {'index.html': 'x'});
check('a screensaver preinstall copies in is not in the index',
	builder.buildIndex(scratch, {files: [{path: '/apps/screensavers/Kept.xscr/index.html'}]}).screensavers.map(e => e.path).includes('Kept.xscr'), false);
check('one it only names a neighbour of is', builder.buildIndex(scratch, {files: ['/apps/screensavers/Kept.xscr2/index.html']})
	.screensavers.map(e => e.path).includes('Kept.xscr'), true);
fs.rmSync(scratch, {recursive: true, force: true});

process.exit(report('screensaver-index') ? 1 : 0);
