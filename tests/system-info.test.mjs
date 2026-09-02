// What System Info says, and — the part that matters — what it says when the browser
// will not answer.
//
// The app's whole argument is that a missing reading is information. So the environment
// is an argument rather than a read of `navigator`: a browser that has everything is the
// one case you can check by opening the app, and every other case is here.

import {check, report} from './assert.mjs';
import * as probe from '../apps/system-info/js/probe.js';

const FULL = {
	userAgent: 'Mozilla/5.0 (Macintosh) Chrome/140',
	brands: [{brand: 'Not/A)Brand', version: '99'}, {brand: 'Chromium', version: '140'}],
	language: 'en-GB',
	languages: ['en-GB', 'ru'],
	timeZone: 'Europe/Moscow',
	secureContext: true,
	crossOriginIsolated: false,
	platform: 'MacIntel',
	cores: 10,
	memoryGB: 8,
	maxTouchPoints: 0,
	screen: {width: 1728, height: 1117, availWidth: 1728, availHeight: 1080, colorDepth: 30},
	viewport: {width: 900, height: 600},
	dpr: 2,
	online: true,
	connection: {effectiveType: '4g', downlink: 10, rtt: 50, saveData: false},
	storage: {supported: true, usage: 5 * 1024 * 1024, quota: 100 * 1024 * 1024, persisted: 'persistent'},
	battery: {supported: true, level: 0.42, charging: false, dischargingTime: 7200},
	serviceWorker: {supported: true, controlled: true, scope: 'http://localhost:8000/'},
	features: {serviceWorker: true, indexedDB: true, webGL: true, keyboardLock: false}
};

const sections = probe.collect(FULL);
const titles = sections.map(s => s.title);
const find = (section, label) =>
	sections.find(s => s.title === section).rows.find(r => r.label === label);

check('the sections are the ones the app draws', titles,
	['Browser', 'Machine', 'Display', 'Network', 'Storage', 'What PixOS needs']);

// --- a browser that answers ---------------------------------------------------------

check('the brand list is preferred over the user agent string',
	find('Browser', 'Browser').value, 'Chromium 140');
check('and Chromium\'s deliberate nonsense brand is dropped rather than shown',
	find('Browser', 'Browser').value.includes('Not/A'), false);
check('the raw user agent is still a row of its own',
	find('Browser', 'User agent').value, 'Mozilla/5.0 (Macintosh) Chrome/140');
check('every accepted language, not only the first',
	find('Browser', 'Also accepts').value, 'en-GB, ru');
check('cores', find('Machine', 'CPU cores').value, '10');
check('memory says "or more" — the browser rounds it down on purpose',
	find('Machine', 'Memory').value, '8 GB or more');
check('the battery is a percentage', find('Machine', 'Battery').value, '42%');
check('and what it is doing, with how long is left',
	find('Machine', 'Charge state').value, 'On battery · 2 h 0 min remaining');
check('the screen is a size', find('Display', 'Screen').value, '1728 × 1117');
check('the window is measured separately — it is not the screen',
	find('Display', 'This window').value, '900 × 600');
// Same rounding as the shell's storage widget, deliberately: the two numbers describe
// the same thing and disagreeing about how to write it would read as a discrepancy.
check('storage is bytes people read', find('Storage', 'Used').value, '5.0 MB');
check('and a share of the quota', find('Storage', 'Share of quota').value, '5%');
check('durability says what was granted, not what was asked for',
	find('Storage', 'Durability').value.startsWith('Persistent'), true);
check('a running service worker says it is the one serving the page',
	find('Storage', 'Service worker').value, 'Running, serving this page');

// --- a browser that does not ----------------------------------------------------------

// Everything absent: no userAgentData, no battery, no storage estimate, no connection.
// This is Safari and Firefox more than it is a hypothetical.
const bare = probe.collect({
	userAgent: 'Mozilla/5.0 (iPhone) Safari',
	online: false,
	storage: {supported: false},
	battery: {supported: false},
	serviceWorker: {supported: true, controlled: false},
	features: {}
});
const bareFind = (section, label) =>
	bare.find(s => s.title === section).rows.find(r => r.label === label);

check('with no brand list the user agent string is the answer',
	bareFind('Browser', 'Browser').value, 'Mozilla/5.0 (iPhone) Safari');
check('and it says where that came from, since browsers fake it',
	bareFind('Browser', 'Browser').note.includes('freeze and fake'), true);

check('a missing reading is null, which the app draws as Unavailable',
	bareFind('Machine', 'Battery').value, null);
check('and the row still explains itself rather than sitting there blank',
	bareFind('Machine', 'Battery').note.includes('Chromium-only'), true);
check('no storage estimate means no usage', bareFind('Storage', 'Used').value, null);
check('no quota either', bareFind('Storage', 'Quota').value, null);
check('and no share to compute from them', bareFind('Storage', 'Share of quota').value, null);
check('unknown durability is not reported as best effort — the difference is the '
	+ 'whole point of the row', bareFind('Storage', 'Durability').value, null);
check('offline says offline', bareFind('Network', 'Status').value, 'Offline');
check('a supported worker that is not controlling this page says exactly that',
	bareFind('Storage', 'Service worker').value, 'Supported, not controlling this page');

check('every row in every section carries a note, so no row can be a dead end',
	bare.concat(sections).flatMap(s => s.rows).filter(r => !r.note).length, 0);

// --- what PixOS needs -------------------------------------------------------------------

const needs = sections.find(s => s.title === 'What PixOS needs').rows;
check('the capability list is not empty', needs.length > 8, true);
check('a present one is available',
	needs.find(r => r.label === 'IndexedDB').value, 'Available');
check('an absent one says Missing rather than nothing',
	needs.find(r => r.label === 'Keyboard lock').value, 'Missing');
check('and says what it costs, which is the reason the row exists',
	needs.find(r => r.label === 'Keyboard lock').note.includes('Ctrl/Cmd+W'), true);

// Unchecked is a bug in the probe, not a browser that lacks the feature, and the two must
// not look the same.
check('a capability nobody probed is unknown, not missing',
	needs.find(r => r.label === 'BroadcastChannel').state, 'unknown');
check('and is not claimed to be available either',
	needs.find(r => r.label === 'BroadcastChannel').value, null);
check('a real absence is marked as one',
	needs.find(r => r.label === 'Keyboard lock').state, 'missing');

// --- formatting ----------------------------------------------------------------------------

check('bytes', probe.formatBytes(0), '0 B');
check('kilobytes', probe.formatBytes(2048), '2.0 KB');
check('a round number of gigabytes stays readable',
	probe.formatBytes(12 * 1024 * 1024 * 1024), '12 GB');
check('nothing is not zero', probe.formatBytes(undefined), null);
check('a duration in minutes', probe.formatDuration(300), '5 min');
check('and in hours', probe.formatDuration(9000), '2 h 30 min');
check('an infinite discharge time is no answer at all — Chromium reports it while '
	+ 'plugged in', probe.formatDuration(Infinity), null);

// The one thing this app must never do is be wrong about where the data goes.
check('the notice says nothing is sent anywhere', probe.NOTICE.includes('Nothing here is sent'), true);
check('and names the reason it is worth seeing', probe.NOTICE.includes('fingerprinting'), true);

process.exit(report('system-info') ? 1 : 0);
