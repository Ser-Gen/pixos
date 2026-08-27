/*
 * sheetjs-import.js — convert a SheetJS workbook (window.XLSX) into LuckySheet sheet
 * objects, for formats LuckyExcel can't read: xls, csv, tsv, ods, xlsb, txt.
 *
 * Fidelity: values + formulas + merges + column/row sizes. SheetJS's community build
 * does not read cell styles, so colors/fonts are not carried (these formats mostly
 * lack them anyway). xlsx keeps full styling via the separate LuckyExcel path.
 *
 * Public API: window.sheetjsToLucky(workbook) -> Array<luckysheetSheet>
 */
(function () {
	'use strict';

	function cellToLucky(c) {
		if (c == null) return null;
		var out = {};
		if (c.f != null && c.f !== '') out.f = '=' + c.f;      // formula
		if (c.v != null) out.v = c.v;                          // raw value (result for formulas)
		out.m = c.w != null ? c.w : (c.v != null ? String(c.v) : ''); // display text
		out.ct = { fa: 'General', t: typeof c.v === 'number' ? 'n' : 'g' };
		return out;
	}

	function convertSheet(XLSX, ws, name, index) {
		var config = {};
		var celldata = [];
		var maxR = 0, maxC = 0;

		if (ws && ws['!ref']) {
			var range = XLSX.utils.decode_range(ws['!ref']);
			maxR = range.e.r; maxC = range.e.c;
			for (var r = range.s.r; r <= range.e.r; r++) {
				for (var col = range.s.c; col <= range.e.c; col++) {
					var addr = XLSX.utils.encode_cell({ r: r, c: col });
					var lc = cellToLucky(ws[addr]);
					if (lc) celldata.push({ r: r, c: col, v: lc });
				}
			}
		}

		// merges
		if (ws && Array.isArray(ws['!merges']) && ws['!merges'].length) {
			config.merge = {};
			ws['!merges'].forEach(function (m) {
				var rs = m.e.r - m.s.r + 1, cs = m.e.c - m.s.c + 1;
				config.merge[m.s.r + '_' + m.s.c] = { r: m.s.r, c: m.s.c, rs: rs, cs: cs };
			});
		}

		// column widths (SheetJS wpx px, else wch chars ~*7)
		if (ws && Array.isArray(ws['!cols'])) {
			config.columnlen = {};
			ws['!cols'].forEach(function (col, i) {
				if (!col) return;
				var px = col.wpx != null ? col.wpx : (col.wch != null ? Math.round(col.wch * 7) : null);
				if (px != null) config.columnlen[i] = px;
			});
		}
		// row heights (hpx px, else hpt points ~/0.75)
		if (ws && Array.isArray(ws['!rows'])) {
			config.rowlen = {};
			ws['!rows'].forEach(function (row, i) {
				if (!row) return;
				var px = row.hpx != null ? row.hpx : (row.hpt != null ? Math.round(row.hpt / 0.75) : null);
				if (px != null) config.rowlen[i] = px;
			});
		}

		return {
			name: name || ('Sheet' + (index + 1)),
			color: '',
			index: index,
			status: index === 0 ? 1 : 0,
			order: index,
			celldata: celldata,
			config: config,
			row: Math.max(maxR + 1, 100),
			column: Math.max(maxC + 1, 26)
		};
	}

	window.sheetjsToLucky = function (wb) {
		var XLSX = window.XLSX;
		if (!XLSX) throw new Error('SheetJS (XLSX) not loaded');
		if (!wb || !wb.SheetNames) return [];
		return wb.SheetNames.map(function (nm, i) {
			return convertSheet(XLSX, wb.Sheets[nm], nm, i);
		});
	};
})();
