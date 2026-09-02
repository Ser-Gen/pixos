// The arithmetic behind the calendar, kept apart from the rendering so it can be tested.
//
// Everything here is pure and takes the date it works from as an argument -- there is no
// read of `new Date()` below. A calendar that reads the clock from inside its own logic
// can only be tested on the day you wrote it, and the interesting days (the 29th of
// February, the week that belongs to the previous year, the last day of December) are
// never today.

export var MONDAY = 1;
export var SUNDAY = 0;

// Intl.Locale.prototype.weekInfo is Chromium and Safari only; Firefox has none of it, so
// the answer there is the default rather than a guess dressed up as a locale rule. The
// spec numbers the days 1..7 from Monday, and JS Date numbers them 0..6 from Sunday --
// two conventions that differ only for Sunday, which is exactly the value in question.
export function firstDayOfWeek (locale, fallback) {
	var fallbackDay = typeof fallback === 'number' ? fallback : MONDAY;
	try {
		var info = new Intl.Locale(locale || 'en').weekInfo;
		var first = info && info.firstDay;
		if (typeof first === 'number') {
			return first === 7 ? SUNDAY : first;
		}
	}
	catch (err) {
		// An unknown locale, or a browser without weekInfo. Neither is an error worth
		// showing anybody: the calendar is still right, it just starts where we said.
	}
	return fallbackDay;
}

export function daysInMonth (year, month) {
	return new Date(year, month + 1, 0).getDate();
}

export function isLeapYear (year) {
	return daysInMonth(year, 1) === 29;
}

export function addMonths (year, month, delta) {
	var total = year * 12 + month + delta;
	return {year: Math.floor(total / 12), month: ((total % 12) + 12) % 12};
}

export function sameDay (a, b) {
	return !!a && !!b
		&& a.getFullYear() === b.getFullYear()
		&& a.getMonth() === b.getMonth()
		&& a.getDate() === b.getDate();
}

export function toISO (date) {
	var month = String(date.getMonth() + 1).padStart(2, '0');
	var day = String(date.getDate()).padStart(2, '0');
	return date.getFullYear() + '-' + month + '-' + day;
}

// The Thursday rule: the ISO week a day belongs to is the week whose Thursday shares its
// year. That is why the 1st of January is sometimes week 52 or 53 of the year before --
// getting this wrong is invisible for eleven months of the year.
export function isoWeek (date) {
	var thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	var offset = (thursday.getDay() + 6) % 7;
	thursday.setDate(thursday.getDate() - offset + 3);
	var firstThursday = new Date(thursday.getFullYear(), 0, 4);
	firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
	var week = 1 + Math.round((thursday - firstThursday) / (7 * 24 * 3600 * 1000));
	return {year: thursday.getFullYear(), week: week};
}

// Always six rows. A month needs four to six depending on where it starts, and a grid
// that changes height as you page through the year moves everything under the pointer --
// including the arrow you are clicking.
export var WEEKS_IN_GRID = 6;

// options: {weekStart, today}. Cells outside the month are still real days, not blanks:
// the last days of the previous month are part of the week you are looking at.
export function monthGrid (year, month, options) {
	var cfg = options || {};
	var weekStart = typeof cfg.weekStart === 'number' ? cfg.weekStart : MONDAY;
	var today = cfg.today || null;

	var first = new Date(year, month, 1);
	var lead = (first.getDay() - weekStart + 7) % 7;
	var cursor = new Date(year, month, 1 - lead);

	var weeks = [];
	for (var w = 0; w < WEEKS_IN_GRID; w++) {
		var days = [];
		for (var d = 0; d < 7; d++) {
			var date = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
			days.push({
				date: date,
				day: date.getDate(),
				month: date.getMonth(),
				year: date.getFullYear(),
				iso: toISO(date),
				inMonth: date.getMonth() === month && date.getFullYear() === year,
				today: sameDay(date, today),
				weekend: date.getDay() === 0 || date.getDay() === 6
			});
			cursor.setDate(cursor.getDate() + 1);
		}
		weeks.push({week: isoWeek(days[0].date).week, days: days});
	}
	return {year: year, month: month, weekStart: weekStart, weeks: weeks};
}

// The short weekday names in the viewer's own language, in the order the grid uses them.
// Built from real dates rather than a hard-coded list, so a locale that abbreviates
// differently gets its own abbreviations.
export function weekdayNames (locale, weekStart, style) {
	var format = new Intl.DateTimeFormat(locale || undefined, {weekday: style || 'short'});
	var names = [];
	// 2024-01-07 is a Sunday, so adding the weekday index lands on that weekday.
	for (var i = 0; i < 7; i++) {
		names.push(format.format(new Date(2024, 0, 7 + ((weekStart + i) % 7))));
	}
	return names;
}

export function monthLabel (year, month, locale) {
	return new Intl.DateTimeFormat(locale || undefined, {month: 'long', year: 'numeric'})
		.format(new Date(year, month, 1));
}

export function monthName (month, locale, style) {
	return new Intl.DateTimeFormat(locale || undefined, {month: style || 'long'})
		.format(new Date(2024, month, 1));
}

export function dayOfYear (date) {
	var start = new Date(date.getFullYear(), 0, 1);
	var here = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	// Rounded, not floored: the two dates are local midnights, and a daylight-saving
	// change between them makes the difference an hour short of a whole number of days.
	return Math.round((here - start) / (24 * 3600 * 1000)) + 1;
}

// The whole year as one number, which is the only thing the year view can say that the
// month view cannot.
export function yearProgress (date) {
	var year = date.getFullYear();
	var days = isLeapYear(year) ? 366 : 365;
	var day = dayOfYear(date);
	return {
		year: year,
		day: day,
		days: days,
		remaining: days - day,
		leap: isLeapYear(year),
		// The day you are in counts as done at the end of it, so a ratio of 1 means the
		// 31st of December rather than "some time on the 30th".
		ratio: day / days
	};
}
