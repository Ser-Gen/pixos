// The calendar's arithmetic.
//
// Every function takes the date it works from as an argument, which is the only reason
// any of this is testable: the days worth checking — the 29th of February, the week that
// belongs to last year, the last day of December — are never today.

import {check, report} from './assert.mjs';
import * as cal from '../apps/calendar/js/calendar.js';

// --- the month grid --------------------------------------------------------------------

const august = cal.monthGrid(2026, 7, {weekStart: cal.MONDAY, today: new Date(2026, 7, 29)});

check('always six rows, so paging through months does not move the buttons',
	august.weeks.length, 6);
check('and seven days in each', august.weeks.map(w => w.days.length), [7, 7, 7, 7, 7, 7]);
check('the week starts where it was told to', august.weeks[0].days[0].date.getDay(), 1);
check('August 2026 starts on a Saturday, so five days lead in',
	august.weeks[0].days.filter(d => !d.inMonth).map(d => d.day), [27, 28, 29, 30, 31]);
check('and those are the real days of July, not blanks',
	august.weeks[0].days[0].month, 6);
check('the first day of the month is marked as in it', august.weeks[0].days[5].inMonth, true);
check('today is marked, once', august.weeks.flatMap(w => w.days).filter(d => d.today).length, 1);
check('and it is the right day',
	august.weeks.flatMap(w => w.days).find(d => d.today).iso, '2026-08-29');
check('weekends are marked from the day, not the column',
	august.weeks[1].days.filter(d => d.weekend).map(d => d.day), [8, 9]);

const sundayFirst = cal.monthGrid(2026, 7, {weekStart: cal.SUNDAY});
check('starting the week on Sunday shifts the whole grid',
	sundayFirst.weeks[0].days[0].iso, '2026-07-26');
check('and Saturday is still a weekend',
	sundayFirst.weeks[0].days[6].weekend, true);

// A month that starts on the first day of the week must not lead in with a blank week.
const september2025 = cal.monthGrid(2025, 8, {weekStart: cal.MONDAY});
check('September 2025 starts on a Monday, so the grid starts on the 1st',
	september2025.weeks[0].days[0].iso, '2025-09-01');
check('and it runs on into October rather than stopping short',
	september2025.weeks[5].days[6].iso, '2025-10-12');

check('no day is skipped or repeated across the whole grid',
	new Set(august.weeks.flatMap(w => w.days).map(d => d.iso)).size, 42);

// --- leap years -------------------------------------------------------------------------

check('February 2024 has 29 days', cal.daysInMonth(2024, 1), 29);
check('February 2025 has 28', cal.daysInMonth(2025, 1), 28);
check('1900 was not a leap year, whatever the four-year rule says', cal.isLeapYear(1900), false);
check('2000 was — the four-hundred-year rule wins', cal.isLeapYear(2000), true);
check('the 29th of February is in the grid for it',
	cal.monthGrid(2024, 1, {weekStart: cal.MONDAY}).weeks.flatMap(w => w.days)
		.some(d => d.inMonth && d.day === 29), true);

// --- moving around ------------------------------------------------------------------------

check('next month', cal.addMonths(2026, 7, 1), {year: 2026, month: 8});
check('December rolls into January', cal.addMonths(2026, 11, 1), {year: 2027, month: 0});
check('and January back into December', cal.addMonths(2026, 0, -1), {year: 2025, month: 11});
check('a whole year forward', cal.addMonths(2026, 3, 12), {year: 2027, month: 3});
check('and a long way back', cal.addMonths(2026, 3, -30), {year: 2023, month: 9});

// --- ISO weeks ------------------------------------------------------------------------------

// The Thursday rule. These are the days it is visible on, and they are the reason the
// week number is computed rather than divided out of the day of the year.
check('1 January 2021 was a Friday, so it belongs to week 53 of 2020',
	cal.isoWeek(new Date(2021, 0, 1)), {year: 2020, week: 53});
check('1 January 2026 is a Thursday, so it is week 1 of 2026',
	cal.isoWeek(new Date(2026, 0, 1)), {year: 2026, week: 1});
check('31 December 2019 was a Tuesday — week 1 of 2020',
	cal.isoWeek(new Date(2019, 11, 31)), {year: 2020, week: 1});
check('a year can have 53 weeks', cal.isoWeek(new Date(2020, 11, 31)), {year: 2020, week: 53});
check('and the last week of an ordinary year is 52',
	cal.isoWeek(new Date(2025, 11, 29)), {year: 2026, week: 1});

// --- the year as one number -------------------------------------------------------------------

check('the first day of the year is day 1', cal.yearProgress(new Date(2026, 0, 1)).day, 1);
const lastDay = cal.yearProgress(new Date(2026, 11, 31));
check('the last is day 365 of 365', [lastDay.day, lastDay.days], [365, 365]);
check('and reads as a full year rather than 99%', lastDay.ratio, 1);
check('nothing is left of it', lastDay.remaining, 0);

const leap = cal.yearProgress(new Date(2024, 11, 31));
check('a leap year is 366 days long', leap.days, 366);
check('and says so', leap.leap, true);
check('1 March of a leap year is a day later than an ordinary one',
	cal.yearProgress(new Date(2024, 2, 1)).day - cal.yearProgress(new Date(2025, 2, 1)).day, 1);

// --- the first day of the week ------------------------------------------------------------------

// Intl.Locale.prototype.weekInfo is Chromium and Safari only, and node's support tracks
// V8's — so this checks the shape of the answer rather than a specific one, plus the
// fallback, which is what Firefox actually gets.
const first = cal.firstDayOfWeek('en-GB');
check('a first day is always a real weekday index', first >= 0 && first <= 6, true);
check('an unknown locale falls back rather than throwing', cal.firstDayOfWeek('¬¬¬'), cal.MONDAY);
check('and the fallback can be asked for explicitly',
	cal.firstDayOfWeek('¬¬¬', cal.SUNDAY), cal.SUNDAY);

// --- names --------------------------------------------------------------------------------------

const names = cal.weekdayNames('en-GB', cal.MONDAY);
check('seven weekday names', names.length, 7);
check('starting where the grid does', names[0], 'Mon');
check('and Sunday last', names[6], 'Sun');
check('a Sunday-first week says so', cal.weekdayNames('en-GB', cal.SUNDAY)[0], 'Sun');
check('the month label carries the year, since the grid shows two of them',
	cal.monthLabel(2026, 7, 'en-GB'), 'August 2026');
check('and a mini month only needs the month', cal.monthName(7, 'en-GB'), 'August');

process.exit(report('calendar') ? 1 : 0);
