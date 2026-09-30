// The screensaver's PIN (phase 26, pass 6): which PINs are PINs, the salted hash kept for one and
// checked against, the wrong tries and the wait they cost, and the lock written down in
// localStorage for every tab and a reload to find. Hashed with node's own WebCrypto, which is the
// browser's API.

import {check, report} from './assert.mjs';

const pin = await import('../js/shell/pin.js');

// --- which PINs are PINs --------------------------------------------------------------------------

check('four digits', pin.isValidPin('0000'), true);
check('eight digits', pin.isValidPin('12345678'), true);
check('not three', pin.isValidPin('123'), false);
check('not nine', pin.isValidPin('123456789'), false);
check('not letters, spaces or signs', ['12a4', '12 34', '-1234', '1234.', ''].map(pin.isValidPin), [false, false, false, false, false]);
check('nor nothing', [pin.isValidPin(null), pin.isValidPin(undefined)], [false, false]);
check('a number is read as its digits', pin.isValidPin(4321), true);

// --- what is kept ---------------------------------------------------------------------------------

const SALT = '0123456789abcdef0123456789abcdef';
const HASH = 'a'.repeat(64);
check('a record is a salt and a hash, hex', pin.normalizePin({salt: SALT, hash: HASH, extra: 1}), {salt: SALT, hash: HASH});
check('a short salt is no record', pin.normalizePin({salt: SALT.slice(1), hash: HASH}), null);
check('nor a long hash', pin.normalizePin({salt: SALT, hash: HASH + 'a'}), null);
check('nor capitals or other letters', [pin.normalizePin({salt: SALT.toUpperCase(), hash: HASH}), pin.normalizePin({salt: SALT, hash: 'g'.repeat(64)})], [null, null]);
check('nor nothing, or not an object', [pin.normalizePin(null), pin.normalizePin('1234')], [null, null]);

check('hashing needs SubtleCrypto', [pin.canHash(globalThis.crypto), pin.canHash({}), pin.canHash(null), pin.canHash({subtle: {}})], [true, false, false, false]);

const made = await pin.makePin('2468', globalThis.crypto);
check('a PIN is kept as a salt and a SHA-256, never itself', [made.salt.length, made.hash.length, JSON.stringify(made).includes('2468')], [32, 64, false]);
check('which is a record', pin.normalizePin(made), made);
const expected = Buffer.from(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(made.salt + ':2468'))).toString('hex');
check('the hash is of the salt and the PIN', made.hash, expected);
const again = await pin.makePin('2468', globalThis.crypto);
check('the same PIN twice has two salts and two hashes', [again.salt !== made.salt, again.hash !== made.hash], [true, true]);

check('the right PIN opens it', await pin.checkPin('2468', made, globalThis.crypto), true);
check('as digits in a number too', await pin.checkPin(2468, made, globalThis.crypto), true);
check('a wrong one does not', await pin.checkPin('2469', made, globalThis.crypto), false);
check('nor the right one against another salt', await pin.checkPin('2468', {salt: again.salt, hash: made.hash}, globalThis.crypto), false);
check('nor anything against no record', await pin.checkPin('2468', null, globalThis.crypto), false);
check('nor something that is not a PIN, whatever it hashes to', await pin.checkPin('246', made, globalThis.crypto), false);
check('and nothing where nothing can hash', await pin.checkPin('2468', made, {}), false);

let refused = null;
await pin.makePin('12', globalThis.crypto).catch(err => { refused = err.message; });
check('a PIN that is not one is refused, saying what one is', refused, 'A PIN is four to eight digits.');
refused = null;
await pin.makePin('1234', {}).catch(err => { refused = err.message; });
check('and so is any where it cannot be hashed, saying why', /https/.test(refused), true);

// --- the wrong tries ------------------------------------------------------------------------------

const lock = pin.normalizeLock(Object.assign({}, made, {failures: '2', until: 'soon'}));
check('a lock is the record, the wrong tries and when the next is taken', lock, {salt: made.salt, hash: made.hash, failures: 2, until: 0});
check('a lock without a record is none', pin.normalizeLock({failures: 3}), null);
check('fractions and negatives are no tries', [pin.normalizeLock(Object.assign({failures: -1, until: -5}, made)).failures, pin.normalizeLock(Object.assign({failures: 1.7}, made)).failures], [0, 1]);

let tries = pin.normalizeLock(made);
for (let i = 0; i < pin.TRIES - 1; i++) {
	tries = pin.afterWrong(tries, 1000);
}
check('four wrong tries cost nothing', [tries.failures, pin.waitLeft(tries, 1000)], [4, 0]);
tries = pin.afterWrong(tries, 1000);
check('the fifth costs half a minute', [tries.failures, pin.waitLeft(tries, 1000)], [5, 30000]);
check('which runs down', pin.waitLeft(tries, 21000), 10000);
check('and is over when it is over', pin.waitLeft(tries, 31000), 0);
const sixth = pin.afterWrong(tries, 40000);
check('the sixth does not start it again', sixth.until, tries.until);
let tenth = sixth;
for (let i = 0; i < 4; i++) {
	tenth = pin.afterWrong(tenth, 50000);
}
check('the tenth does', [tenth.failures, pin.waitLeft(tenth, 50000)], [10, 30000]);
check('the record is not changed in place', [pin.normalizeLock(made).failures], [0]);
check('no lock, no wait', pin.waitLeft(null, 0), 0);

// --- written down --------------------------------------------------------------------------------

function memory () {
	const items = {};
	return {
		items,
		getItem (key) { return key in items ? items[key] : null; },
		setItem (key, value) { items[key] = String(value); },
		removeItem (key) { delete items[key]; }
	};
}

const store = memory();
check('nothing written, no lock', pin.readLock(store), null);
pin.writeLock(store, tries);
check('written under its own key', Object.keys(store.items), [pin.LOCK_KEY]);
check('and read back as it was', pin.readLock(store), tries);
pin.clearLock(store);
check('cleared, gone', pin.readLock(store), null);
store.setItem(pin.LOCK_KEY, '{not json');
check('what is not a lock is none', pin.readLock(store), null);
store.setItem(pin.LOCK_KEY, JSON.stringify({failures: 1}));
check('nor a lock with no PIN in it', pin.readLock(store), null);

const blocked = {getItem () { throw new Error('blocked'); }, setItem () { throw new Error('blocked'); }, removeItem () { throw new Error('blocked'); }};
const warn = console.warn;
let warned = 0;
console.warn = () => { warned++; };
pin.writeLock(blocked, tries);
console.warn = warn;
check('storage that throws is a lock in this tab only, and says so', [pin.readLock(blocked), warned], [null, 1]);
pin.clearLock(blocked);
check('and clearing it throws nothing', true, true);
check('no storage at all is the same', [pin.readLock(null), pin.writeLock(null, tries), pin.clearLock(null)], [null, undefined, undefined]);

process.exit(report('pin') ? 1 : 0);
