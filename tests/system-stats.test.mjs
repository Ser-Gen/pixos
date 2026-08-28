// The formatters behind the tray and the widgets. The pollers themselves need a browser;
// these are the parts that decide what the numbers actually read as.

import {check, report} from './assert.mjs';

// node has a real read-only `navigator` with neither storage.estimate nor getBattery,
// which is the same shape as a browser that does not support them.
globalThis.document = {hidden: false, addEventListener () {}};

const stats = await import('../js/shell/system-stats.js');

check('bytes stay bytes', stats.formatBytes(512), '512 B');
check('kilobytes round', stats.formatBytes(2048), '2.0 KB');
check('a large value drops the decimal', stats.formatBytes(15 * 1024 * 1024), '15 MB');
check('gigabytes keep one decimal while small', stats.formatBytes(4.25 * 1024 ** 3), '4.3 GB');
check('zero is a real measurement, not a blank', stats.formatBytes(0), '0 B');
check('undefined is a blank', stats.formatBytes(undefined), '—');

check('minutes only', stats.formatDuration(90 * 60), '1h 30m');
check('under an hour drops the hours', stats.formatDuration(20 * 60), '20m');
// dischargingTime is Infinity until the browser has an estimate, and often stays there.
check('an unknown duration is null, not "Infinity"', stats.formatDuration(Infinity), null);
check('a zero duration is null too', stats.formatDuration(0), null);

const noon = new Date(2026, 7, 27, 9, 5);
check('the clock is zero-padded', stats.formatClock(noon), '09:05');

check('nothing is measured before the first poll', stats.get().storage, null);

process.exit(report('system-stats') ? 1 : 0);
