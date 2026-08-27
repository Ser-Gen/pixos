/*
 * sheetjs-export.js — LuckySheet -> csv/tsv/txt/xls/ods/xlsb exporter, built on SheetJS
 * (window.XLSX). The inverse of sheetjs-import.js, so any file that opens via SheetJS can
 * be saved back to its own format.
 *
 * Fidelity: values + formulas + merges + column/row sizes. SheetJS's community build does
 * not write cell styles, so colors/fonts are not carried (these formats mostly lack them
 * anyway). For a styled workbook, export xlsx via export.js (ExcelJS) instead.
 *
 * Public API:
 *   window.exportSheetjs(format, fileName?, opts?) -> Blob  (also triggers a download)
 *     format: 'csv' | 'tsv' | 'txt' | 'xls' | 'ods' | 'xlsb'
 *     opts.delimiter: field separator for csv/tsv/txt (defaults: csv=",", tsv/txt="\t")
 *     opts.download: set false to only build the Blob (used when saving to the Pixos FS).
 */
(function () {
	'use strict';

	// Single-sheet text formats vs. multi-sheet spreadsheet formats.
	var TEXT = { csv: 1, tsv: 1, txt: 1 };
	var BOOK = { xls: 'xls', ods: 'ods', xlsb: 'xlsb' };

	// Convert one luckysheet cell object to a SheetJS cell (mirror of sheetjs-import.js).
	function cellToSheetjs(lc) {
		if (lc == null) return null;
		var cell;
		if (lc.f != null && lc.f !== '') {
			cell = { t: typeof lc.v === 'number' ? 'n' : (lc.v == null ? 'z' : 's'),
				v: lc.v, f: String(lc.f).replace(/^=/, '') };
		} else if (typeof lc.v === 'number') {
			cell = { t: 'n', v: lc.v };
		} else if (typeof lc.v === 'boolean') {
			cell = { t: 'b', v: lc.v };
		} else if (lc.v != null && lc.v !== '') {
			cell = { t: 's', v: String(lc.v) };
		} else if (lc.m != null && lc.m !== '') {
			cell = { t: 's', v: String(lc.m) };
		} else {
			return null;
		}
		if (lc.m != null) cell.w = String(lc.m);        // cached display text
		var fa = lc.ct && lc.ct.fa;
		if (fa && fa !== 'General') cell.z = fa;         // number format
		return cell;
	}

	// Build a SheetJS worksheet from a luckysheet sheet (celldata, or the 2D data grid).
	function buildWorksheet(XLSX, sheet) {
		var ws = {};
		var maxR = 0, maxC = 0, any = false;

		function put(r, c, lc) {
			var cell = cellToSheetjs(lc);
			if (!cell) return;
			ws[XLSX.utils.encode_cell({ r: r, c: c })] = cell;
			if (r > maxR) maxR = r;
			if (c > maxC) maxC = c;
			any = true;
		}

		if (Array.isArray(sheet.celldata) && sheet.celldata.length) {
			sheet.celldata.forEach(function (cd) { put(cd.r, cd.c, cd.v); });
		} else if (Array.isArray(sheet.data)) {
			sheet.data.forEach(function (row, r) {
				if (!row) return;
				row.forEach(function (lc, c) { if (lc != null) put(r, c, lc); });
			});
		}

		ws['!ref'] = any
			? XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } })
			: 'A1';

		var config = sheet.config || {};
		if (config.merge) {
			ws['!merges'] = Object.keys(config.merge).map(function (k) {
				var m = config.merge[k];
				return { s: { r: m.r, c: m.c }, e: { r: m.r + m.rs - 1, c: m.c + m.cs - 1 } };
			});
		}
		if (config.columnlen) {
			ws['!cols'] = [];
			Object.keys(config.columnlen).forEach(function (c) {
				ws['!cols'][Number(c)] = { wpx: config.columnlen[c] };
			});
		}
		if (config.rowlen) {
			ws['!rows'] = [];
			Object.keys(config.rowlen).forEach(function (r) {
				ws['!rows'][Number(r)] = { hpx: config.rowlen[r] };
			});
		}
		return ws;
	}

	function triggerDownload(blob, fileName) {
		var url = URL.createObjectURL(blob);
		var a = document.createElement('a');
		a.href = url;
		a.download = fileName;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
	}

	function baseName() {
		var n = window.luckysheet.getWorkbookName && window.luckysheet.getWorkbookName();
		return (n || 'export').replace(/\.[^.\/\\]+$/, '');   // strip any existing extension
	}

	window.exportSheetjs = function (format, fileName, opts) {
		opts = opts || {};
		format = String(format || '').toLowerCase();
		var XLSX = window.XLSX;
		if (!XLSX) throw new Error('SheetJS (XLSX) not loaded');
		if (typeof window.luckysheet === 'undefined') throw new Error('luckysheet not loaded');
		if (!TEXT[format] && !BOOK[format]) throw new Error('Unsupported export format: ' + format);

		var sheets = window.luckysheet.getAllSheets();
		if (!sheets || !sheets.length) throw new Error('No sheets to export');
		sheets = sheets.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

		var name = fileName || (baseName() + '.' + format);
		if (!new RegExp('\\.' + format + '$', 'i').test(name)) name += '.' + format;

		var blob;
		if (TEXT[format]) {
			// single-sheet: the active sheet (status===1), else the first
			var active = sheets.filter(function (s) { return s.status === 1; })[0] || sheets[0];
			var ws = buildWorksheet(XLSX, active);
			var fs = opts.delimiter || (format === 'csv' ? ',' : '\t');
			var text = XLSX.utils.sheet_to_csv(ws, { FS: fs });
			blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
		} else {
			var wb = XLSX.utils.book_new();
			sheets.forEach(function (s, i) {
				XLSX.utils.book_append_sheet(wb, buildWorksheet(XLSX, s), s.name || ('Sheet' + (i + 1)));
			});
			var out = XLSX.write(wb, { bookType: BOOK[format], type: 'array' });
			blob = new Blob([out], { type: 'application/octet-stream' });
		}

		if (opts.download !== false) triggerDownload(blob, name);
		return blob;
	};
})();
