// /settings/system.json (phase 27): js/shell/system-settings.js, with the file made of plain objects.
// Pass 1 gives it no fields of its own, so these tests hand it two. What it has to get right: every
// default until something is set, a field that is not valid read as its default, a field it does not
// know kept and written back, a change applied here even in a tab that may not write it, and every
// subscriber told once per change and only then.

import {check, report} from './assert.mjs';

const sys = await import('../js/shell/system-settings.js');

check('the file', sys.SYSTEM_FILE, '/settings/system.json');
check('pass 1 keeps nothing in it yet', sys.FIELDS, {});

const fields = {
	clock: {value: '24', valid: v => v === '12' || v === '24'},
	brightness: {value: 100, valid: v => typeof v === 'number' && v >= 30 && v <= 150}
};

check('nothing stored is every default', sys.readSystem(null, fields), {clock: '24', brightness: 100});
check('a stored value is read', sys.readSystem({clock: '12', brightness: 80}, fields), {clock: '12', brightness: 80});
check('one that is not valid is its default, the rest as stored', sys.readSystem({clock: 'twelve', brightness: 80}, fields),
	{clock: '24', brightness: 80});
check('a field from a later PixOS is kept', sys.readSystem({theme: 'light', clock: '12'}, fields), {clock: '12', brightness: 100, theme: 'light'});
check('an array or a string is not a document', [sys.readSystem([1, 2], fields), sys.readSystem('{}', fields)],
	[{clock: '24', brightness: 100}, {clock: '24', brightness: 100}]);
check('a field named like an Object method is only a field', sys.readSystem({constructor: 1}, {}), {constructor: 1});

check('a patch: what may be set, and what may not', sys.checkPatch({clock: '12', brightness: 400, theme: 'light'}, fields),
	{accepted: {clock: '12'}, refused: ['brightness', 'theme']});
check('an empty patch is nothing', sys.checkPatch(undefined, fields), {accepted: {}, refused: []});
check('nor is a name every object has', sys.checkPatch({constructor: 1, toString: 2}, fields), {accepted: {}, refused: ['constructor', 'toString']});

function world (file, options) {
	const w = {file, writes: [], owner: true, told: []};
	w.settings = sys.createSystemSettings({
		fields,
		readText: () => w.file === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(w.file),
		writeText: (path, text) => {
			if (options && options.refuse) {
				return Promise.reject(new Error('QuotaExceededError'));
			}
			w.writes.push([path, text]);
			w.file = text;
			return Promise.resolve();
		},
		canWrite: () => w.owner
	});
	return w;
}

{
	const w = world(undefined);
	check('before anything is read, every default', w.settings.get(), {clock: '24', brightness: 100});
	w.settings.subscribe(value => w.told.push(value));
	check('a subscriber is told at once', w.told, [{clock: '24', brightness: 100}]);
	await w.settings.load();
	check('no file is every default, and nobody is told it again', [w.settings.get(), w.told.length], [{clock: '24', brightness: 100}, 1]);
	const set = await w.settings.set({brightness: 70});
	check('a value is set, and the rest stay', set, {clock: '24', brightness: 70});
	check('told, and written whole as JSON', [w.told.length, w.writes],
		[2, [['/settings/system.json', '{\n  "clock": "24",\n  "brightness": 70\n}\n']]]);
	await w.settings.set({brightness: 70});
	check('setting what is set tells nobody', w.told.length, 2);
	let refused = null;
	await w.settings.set({brightness: 10, clock: '12'}).catch(err => { refused = err.message; });
	check('a patch with one bad field sets nothing, and says which', [refused, w.settings.get(), w.told.length],
		['Not a system setting: brightness', {clock: '24', brightness: 70}, 2]);
	const copy = w.settings.get();
	copy.brightness = 140;
	check('what get hands out is a copy', w.settings.get().brightness, 70);
}
{
	const w = world('{"clock": "12", "theme": "light"}');
	await w.settings.load();
	await w.settings.set({brightness: 90});
	check('a field nobody here knows is written back as it was', JSON.parse(w.file), {clock: '12', brightness: 90, theme: 'light'});
	w.file = '{"clock": "12", "theme": "light", "brightness": 90';
	w.settings.subscribe(value => w.told.push(value));
	await w.settings.load();
	check('a broken file is every default, and that is a change', [w.settings.get(), w.told.length], [{clock: '24', brightness: 100}, 2]);
}
{
	const w = world(undefined);
	w.owner = false;
	w.settings.subscribe(value => w.told.push(value));
	await w.settings.set({clock: '12'});
	check('a tab that does not own the session applies it and writes nothing', [w.settings.get().clock, w.told.length, w.writes.length],
		['12', 2, 0]);
}
{
	const w = world(undefined, {refuse: true});
	let failed = null;
	await w.settings.set({clock: '12'}).catch(err => { failed = err.message; });
	check('a refused write says so, and the value still applies here', [failed, w.settings.get().clock], ['QuotaExceededError', '12']);
}
{
	const w = world(undefined);
	const warn = console.warn;
	const warned = [];
	console.warn = (...args) => warned.push(args[0]);
	let thrown = null;
	try {
		w.settings.subscribe(() => { throw new Error('a listener blew up (expected)'); });
	}
	catch (err) {
		thrown = err;
	}
	const unsubscribe = w.settings.subscribe(value => w.told.push(value));
	await w.settings.set({clock: '12'});
	console.warn = warn;
	check('a listener that throws is only warned about, and the next is still told', [thrown, w.told.length, warned],
		[null, 2, ['A system settings listener failed', 'A system settings listener failed']]);
	unsubscribe();
	await w.settings.set({clock: '24'});
	check('an unsubscribed listener is not told', w.told.length, 2);
}
{
	// With the module's own FIELDS, which pass 1 leaves empty: anything set is refused.
	const w = {file: '{"later": 1}'};
	const own = sys.createSystemSettings({readText: () => Promise.resolve(w.file), writeText: () => Promise.resolve(), canWrite: () => true});
	await own.load();
	check('with no fields of its own it keeps what it finds', own.get(), {later: 1});
	check('and sets nothing', await own.set({later: 2}).then(() => 'set', err => err.message), 'Not a system setting: later');
}

process.exit(report('system-settings') ? 1 : 0);
