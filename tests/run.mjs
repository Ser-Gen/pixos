// Runs every *.test.mjs in this folder, each in its own process: the tests stub globals
// (document, $, GoldenLayout) and would trample each other in one.

import {readdirSync} from 'fs';
import {spawnSync} from 'child_process';
import {fileURLToPath} from 'url';
import {dirname, join} from 'path';

var here = dirname(fileURLToPath(import.meta.url));
var files = readdirSync(here).filter(function (name) {
	return name.endsWith('.test.mjs');
}).sort();

var failed = [];
files.forEach(function (name) {
	console.log('\n' + name);
	var result = spawnSync(process.execPath, [join(here, name)], {stdio: 'inherit'});
	if (result.status !== 0) {
		failed.push(name);
	}
});

console.log(failed.length ? '\nFAILED: ' + failed.join(', ') : '\n' + files.length + ' test files passed');
process.exit(failed.length ? 1 : 0);
