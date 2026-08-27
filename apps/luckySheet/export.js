/*
 * export.js — LuckySheet -> xlsx exporter (styling-preserving), built on ExcelJS.
 *
 * Reads the live workbook via luckysheet.getAllSheets() and produces an .xlsx that
 * keeps values, formulas, number formats, merges, column widths / row heights,
 * fonts (family/size/bold/italic/underline/strike/color), fills, alignment, wrap,
 * and borders (best-effort).
 *
 * Public API:
 *   window.exportXlsx(fileName?, opts?)  -> Promise<Blob>
 *     opts.download: set false to only build the Blob (used when saving to the Pixos FS).
 */
(function () {
	'use strict';

	// #rgb / #rrggbb -> ExcelJS ARGB (FFRRGGBB). Returns undefined for empty/invalid.
	function toArgb(hex) {
		if (!hex || typeof hex !== 'string') return undefined;
		var h = hex.trim().replace(/^#/, '');
		if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
		if (!/^[0-9a-fA-F]{6}$/.test(h)) return undefined;
		return ('FF' + h).toUpperCase();
	}

	// luckysheet ht: 0 center, 1 left, 2 right
	function hAlign(ht) {
		return { 0: 'center', 1: 'left', 2: 'right' }[ht];
	}
	// luckysheet vt: 0 middle, 1 top, 2 bottom
	function vAlign(vt) {
		return { 0: 'middle', 1: 'top', 2: 'bottom' }[vt];
	}
	// luckysheet border style code -> ExcelJS border style
	function borderStyle(code) {
		return { 1: 'thin', 2: 'hair', 3: 'dotted', 4: 'dashed', 5: 'thin',
			6: 'double', 7: 'medium', 8: 'medium', 9: 'medium', 10: 'thick',
			11: 'mediumDashed', 12: 'slantDashDot' }[code] || 'thin';
	}
	function edge(part) {
		if (!part) return undefined;
		return { style: borderStyle(part.style), color: { argb: toArgb(part.color) || 'FF000000' } };
	}

	// Apply one luckysheet cell object to an ExcelJS cell.
	function applyCell(xcell, lc) {
		if (lc == null) return;

		// value / formula / number format
		var ct = lc.ct || {};
		if (lc.f != null && lc.f !== '') {
			xcell.value = { formula: String(lc.f).replace(/^=/, ''), result: lc.v };
		} else if (lc.v != null && lc.v !== '') {
			xcell.value = lc.v;
		} else if (lc.m != null && lc.m !== '') {
			xcell.value = lc.m;
		}
		if (ct.fa && ct.fa !== 'General') xcell.numFmt = ct.fa;

		// font
		var font = {};
		if (lc.ff) font.name = typeof lc.ff === 'string' ? lc.ff : undefined;
		if (lc.fs) font.size = Number(lc.fs);
		if (lc.bl) font.bold = true;
		if (lc.it) font.italic = true;
		if (lc.cl) font.strike = true;
		if (lc.un) font.underline = true;
		var fcol = toArgb(lc.fc);
		if (fcol) font.color = { argb: fcol };
		if (Object.keys(font).length) xcell.font = font;

		// fill (background)
		var bg = toArgb(lc.bg);
		if (bg) xcell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };

		// alignment + wrap
		var align = {};
		var ha = hAlign(lc.ht); if (ha) align.horizontal = ha;
		var va = vAlign(lc.vt); if (va) align.vertical = va;
		if (lc.tb === '2' || lc.tb === 2) align.wrapText = true;
		if (Object.keys(align).length) xcell.alignment = align;
	}

	// Apply borders from a sheet's config.borderInfo (best-effort).
	function applyBorders(ws, borderInfo) {
		if (!Array.isArray(borderInfo)) return;
		borderInfo.forEach(function (bi) {
			if (bi.rangeType === 'cell' && bi.value) {
				var v = bi.value;
				var cell = ws.getCell(v.row_index + 1, v.col_index + 1);
				var b = {};
				if (v.l) b.left = edge(v.l);
				if (v.r) b.right = edge(v.r);
				if (v.t) b.top = edge(v.t);
				if (v.b) b.bottom = edge(v.b);
				if (Object.keys(b).length) cell.border = Object.assign({}, cell.border, b);
			} else if (bi.rangeType === 'range' && Array.isArray(bi.range)) {
				var e = { style: borderStyle(bi.style), color: { argb: toArgb(bi.color) || 'FF000000' } };
				bi.range.forEach(function (rg) {
					var r0 = rg.row[0], r1 = rg.row[1], c0 = rg.column[0], c1 = rg.column[1];
					for (var r = r0; r <= r1; r++) {
						for (var c = c0; c <= c1; c++) {
							var cell = ws.getCell(r + 1, c + 1);
							var b = Object.assign({}, cell.border);
							var outside = bi.borderType === 'border-outside' || bi.borderType === 'border-none';
							var all = bi.borderType === 'border-all' || !bi.borderType;
							if (all || (outside && r === r0)) b.top = e;
							if (all || (outside && r === r1)) b.bottom = e;
							if (all || (outside && c === c0)) b.left = e;
							if (all || (outside && c === c1)) b.right = e;
							if (bi.borderType === 'border-top') b.top = e;
							if (bi.borderType === 'border-bottom') b.bottom = e;
							if (bi.borderType === 'border-left') b.left = e;
							if (bi.borderType === 'border-right') b.right = e;
							cell.border = b;
						}
					}
				});
			}
		});
	}

	function buildSheet(wb, sheet) {
		var ws = wb.addWorksheet(sheet.name || 'Sheet');
		var config = sheet.config || {};

		// column widths (luckysheet px -> Excel char width ~ px/7)
		if (config.columnlen) {
			Object.keys(config.columnlen).forEach(function (c) {
				ws.getColumn(Number(c) + 1).width = Math.max(1, config.columnlen[c] / 7);
			});
		}
		// row heights (px -> points = px * 0.75)
		if (config.rowlen) {
			Object.keys(config.rowlen).forEach(function (r) {
				ws.getRow(Number(r) + 1).height = config.rowlen[r] * 0.75;
			});
		}

		// cells: prefer sparse celldata, fall back to the 2D data grid
		if (Array.isArray(sheet.celldata) && sheet.celldata.length) {
			sheet.celldata.forEach(function (cd) {
				applyCell(ws.getCell(cd.r + 1, cd.c + 1), cd.v);
			});
		} else if (Array.isArray(sheet.data)) {
			sheet.data.forEach(function (row, r) {
				if (!row) return;
				row.forEach(function (lc, c) {
					if (lc != null) applyCell(ws.getCell(r + 1, c + 1), lc);
				});
			});
		}

		// merges
		if (config.merge) {
			Object.keys(config.merge).forEach(function (k) {
				var m = config.merge[k];
				ws.mergeCells(m.r + 1, m.c + 1, m.r + m.rs, m.c + m.cs);
			});
		}

		applyBorders(ws, config.borderInfo);
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

	// Build the xlsx from the live workbook. Returns the Blob; downloads it unless
	// opts.download is false.
	window.exportXlsx = async function (fileName, opts) {
		opts = opts || {};
		if (typeof window.ExcelJS === 'undefined') throw new Error('ExcelJS not loaded');
		if (typeof window.luckysheet === 'undefined') throw new Error('luckysheet not loaded');

		var sheets = window.luckysheet.getAllSheets();
		if (!sheets || !sheets.length) throw new Error('No sheets to export');

		// Export in tab order.
		sheets = sheets.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

		var wb = new window.ExcelJS.Workbook();
		wb.creator = 'LuckySheet';
		wb.created = new Date();
		sheets.forEach(function (s) { buildSheet(wb, s); });

		var buffer = await wb.xlsx.writeBuffer();
		var blob = new Blob([buffer], {
			type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		});

		var name = fileName || (window.luckysheet.getWorkbookName && window.luckysheet.getWorkbookName()) || 'export';
		if (!/\.xlsx$/i.test(name)) name += '.xlsx';
		if (opts.download !== false) triggerDownload(blob, name);
		return blob;
	};
})();
