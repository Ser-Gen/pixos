// A small CommonMark-ish renderer. No dependencies, because PixOS has no build step and
// has to work offline -- and because the alternative (a 40 kB bundled parser) is more
// code than the app around it.
//
// It deliberately does not support raw HTML: everything is escaped before any inline
// rule runs, so a document from anywhere can be rendered without becoming a script
// injection into the shell's own origin.

export function escapeHtml (text) {
	return String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// Only http(s), mailto and same-origin paths reach an href. Everything else -- most
// importantly `javascript:` -- is dropped rather than rewritten, so a bad link renders
// as inert text instead of quietly becoming a different link.
export function safeUrl (raw) {
	var url = String(raw || '').trim();
	if (!url) {
		return null;
	}
	if (/^(https?:|mailto:)/i.test(url)) {
		return url;
	}
	if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
		return null;
	}
	return url;
}

// --- frontmatter -----------------------------------------------------------------
//
// A deliberately small subset of YAML: `key: value`, plus `key:` followed by `- item`
// lines, plus `- title: x` / `  url: y` blocks. Enough for an about-me header, and it
// fails to an empty object rather than throwing on anything richer.

export function parseFrontmatter (text) {
	var source = String(text == null ? '' : text);
	var match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
	if (!match) {
		return {data: {}, body: source};
	}
	return {data: parseYamlish(match[1]), body: source.slice(match[0].length)};
}

function parseYamlish (block) {
	var data = {};
	var key = null;
	var list = null;

	block.split(/\r?\n/).forEach(function (line) {
		if (!line.trim() || /^\s*#/.test(line)) {
			return;
		}

		var item = /^\s*-\s+(.*)$/.exec(line);
		if (item && key) {
			if (!list) {
				list = [];
				data[key] = list;
			}
			var pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(item[1]);
			list.push(pair ? nested(pair) : unquote(item[1]));
			return;
		}

		// A continuation of the object most recently pushed onto a list: `  url: ...`
		// indented under a `- title: ...`.
		var last = list && list[list.length - 1];
		if (last && typeof last === 'object' && /^\s\s+/.test(line)) {
			var cont = /^\s*([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
			if (cont) {
				last[cont[1]] = unquote(cont[2]);
			}
			return;
		}

		var entry = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (!entry) {
			return;
		}
		key = entry[1];
		list = null;
		data[key] = unquote(entry[2]);
	});

	return data;
}

function nested (pair) {
	var obj = {};
	obj[pair[1]] = unquote(pair[2]);
	return obj;
}

function unquote (value) {
	var text = String(value).trim();
	if (/^".*"$/.test(text) || /^'.*'$/.test(text)) {
		return text.slice(1, -1);
	}
	return text;
}

// --- inline ----------------------------------------------------------------------

// Private-use codepoints, written as escapes so the source stays plain ASCII.
// escapeHtml() has already run by the time these are inserted, so nothing a
// document can contain collides with them and the restore pass is exact.
var CODE_OPEN = '\uE000';
var CODE_CLOSE = '\uE001';

function inline (text, options) {
	var codes = [];
	var out = escapeHtml(text);

	// Code spans are extracted first and restored last: nothing inside one is markup.
	out = out.replace(/(`+)([\s\S]*?)\1/g, function (all, ticks, body) {
		codes.push('<code>' + body.replace(/^ | $/g, '') + '</code>');
		return CODE_OPEN + (codes.length - 1) + CODE_CLOSE;
	});

	out = out.replace(/!\[([^\]]*)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)(?:\s+&quot;([^&]*)&quot;)?\)/g, function (all, alt, href, title) {
		var url = safeUrl(href);
		if (!url) {
			return alt;
		}
		return '<img src="' + url + '" alt="' + alt + '"' + (title ? ' title="' + title + '"' : '') + '>';
	});

	// The destination may contain one level of balanced parentheses -- javascript:alert(1)
	// being the case that matters, since dropping it half-parsed would leave a stray ")".
	// Titles are matched in their escaped form: escapeHtml() has already run, so a literal
	// quote cannot reach the attribute at all.
	out = out.replace(/\[([^\]]+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)(?:\s+&quot;([^&]*)&quot;)?\)/g, function (all, label, href, title) {
		return anchor(safeUrl(href), label, title, options);
	});

	// Autolinks. The angle brackets are already escaped by the time we get here.
	out = out.replace(/&lt;((?:https?:\/\/|mailto:)[^\s&]+)&gt;/g, function (all, href) {
		return anchor(safeUrl(href), href, null, options);
	});

	out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
	out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	out = out.replace(/(^|[^\w*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>');
	out = out.replace(/(^|[^\w_])__([^_]+)__/g, '$1<strong>$2</strong>');
	out = out.replace(/(^|[^\w_])_([^_\s][^_]*?)_/g, '$1<em>$2</em>');
	out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

	// Two trailing spaces are a hard line break; single newlines inside a paragraph are
	// not, which is what makes reflowed source render as one paragraph.
	out = out.replace(/ {2,}\n/g, '<br>\n');

	return out.replace(new RegExp(CODE_OPEN + '(\\d+)' + CODE_CLOSE, 'g'), function (all, index) {
		return codes[Number(index)];
	});
}

function anchor (url, label, title, options) {
	if (!url) {
		return label;
	}
	var external = /^(https?:|mailto:)/i.test(url);
	var attrs = ' href="' + url + '"';
	if (title) {
		attrs += ' title="' + title + '"';
	}
	if (external && (!options || options.externalTarget !== false)) {
		attrs += ' target="_blank" rel="noopener noreferrer"';
	}
	if (!external) {
		// A link to somewhere in the filesystem. The viewer turns these into openPath
		// calls; standalone they stay ordinary relative links.
		attrs += ' data-pixos-path="' + url + '"';
	}
	return '<a' + attrs + '>' + label + '</a>';
}

// --- blocks ----------------------------------------------------------------------

export function render (text, options) {
	var body = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
	return blocks(body.split('\n'), options || {}).join('\n');
}

function isFence (line) {
	return /^ {0,3}(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)\s*$/.exec(line || '');
}

function isHeading (line) {
	return /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line || '');
}

function isRule (line) {
	return /^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(line || '');
}

function blocks (lines, options) {
	var out = [];
	var i = 0;

	while (i < lines.length) {
		var line = lines[i];

		if (!line.trim()) {
			i++;
			continue;
		}

		var fence = isFence(line);
		if (fence) {
			var closer = new RegExp('^ {0,3}\\' + fence[1][0] + '{' + fence[1].length + ',}\\s*$');
			var code = [];
			i++;
			while (i < lines.length && !closer.test(lines[i])) {
				code.push(lines[i]);
				i++;
			}
			i++;
			out.push('<pre><code' + (fence[2] ? ' class="language-' + fence[2] + '"' : '') + '>'
				+ escapeHtml(code.join('\n')) + '</code></pre>');
			continue;
		}

		var heading = isHeading(line);
		if (heading) {
			var level = heading[1].length;
			out.push('<h' + level + ' id="' + slug(heading[2]) + '">'
				+ inline(heading[2], options) + '</h' + level + '>');
			i++;
			continue;
		}

		if (isRule(line)) {
			out.push('<hr>');
			i++;
			continue;
		}

		if (/^ {0,3}>/.test(line)) {
			var quoted = [];
			while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
				quoted.push(lines[i].replace(/^ {0,3}>\s?/, ''));
				i++;
			}
			out.push('<blockquote>\n' + blocks(quoted, options).join('\n') + '\n</blockquote>');
			continue;
		}

		if (isTable(lines, i)) {
			var table = readTable(lines, i, options);
			out.push(table.html);
			i = table.next;
			continue;
		}

		if (listMarker(line)) {
			var list = readList(lines, i, options);
			out.push(list.html);
			i = list.next;
			continue;
		}

		var paragraph = [];
		while (i < lines.length && lines[i].trim()
			&& !listMarker(lines[i])
			&& !isHeading(lines[i])
			&& !isFence(lines[i])
			&& !isRule(lines[i])
			&& !/^ {0,3}>/.test(lines[i])) {
			paragraph.push(lines[i]);
			i++;
		}
		if (paragraph.length) {
			out.push('<p>' + inline(paragraph.join('\n').replace(/\s+$/, ''), options) + '</p>');
		}
		else {
			i++;
		}
	}

	return out;
}

// Latin and Cyrillic survive; everything else collapses to a dash. Headings need an id
// only so the viewer's outline can scroll to them.
function slug (text) {
	return String(text).toLowerCase()
		.replace(/[^a-z0-9Ѐ-ӿ]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function listMarker (line) {
	return /^(\s*)([-*+]|\d+[.)])\s+/.exec(line || '');
}

function readList (lines, start, options) {
	var first = listMarker(lines[start]);
	var indent = first[1].length;
	var ordered = /\d/.test(first[2]);
	var items = [];
	var current = null;
	var i = start;

	while (i < lines.length) {
		var line = lines[i];

		if (!line.trim()) {
			// A blank line only continues the list if what follows is still indented
			// into it -- otherwise the list is over and a new block starts.
			var next = lines[i + 1];
			var nextMarker = listMarker(next);
			var continues = next && next.trim()
				&& ((nextMarker && nextMarker[1].length >= indent) || next.search(/\S/) > indent);
			if (!continues) {
				break;
			}
			if (current) {
				current.push('');
			}
			i++;
			continue;
		}

		var marker = listMarker(line);
		if (marker && marker[1].length <= indent) {
			if (marker[1].length < indent) {
				break;
			}
			current = [line.slice(marker[0].length)];
			items.push(current);
			i++;
			continue;
		}
		if (!current) {
			break;
		}
		// Anything more indented belongs to the item; anything else is a lazy
		// continuation of its paragraph.
		var offset = line.search(/\S/);
		current.push(offset > indent ? line.slice(Math.min(offset, indent + 2)) : line.trim());
		i++;
	}

	// One blank line anywhere in the list makes the whole list loose, and every item
	// keeps its <p> wrappers. That is the rule readers actually see: spaced-out source
	// renders spaced out.
	var loose = items.some(function (item) {
		return item.some(function (line) { return !line.trim(); });
	});

	var html = items.map(function (item) {
		var rendered = blocks(item, options);
		if (!loose) {
			rendered = rendered.map(function (block) {
				return /^<p>[\s\S]*<\/p>$/.test(block) ? block.slice(3, -4) : block;
			});
		}
		return '<li>' + rendered.join('\n') + '</li>';
	}).join('\n');

	var tag = ordered ? 'ol' : 'ul';
	var startsAt = ordered ? first[2].replace(/\D/g, '') : '1';
	var startAttr = startsAt !== '1' ? ' start="' + startsAt + '"' : '';
	return {html: '<' + tag + startAttr + '>\n' + html + '\n</' + tag + '>', next: i};
}

function isTable (lines, i) {
	return /\|/.test(lines[i] || '')
		&& /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1] || '');
}

function readTable (lines, start, options) {
	var cells = function (line) {
		return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (cell) {
			return cell.trim();
		});
	};
	var align = cells(lines[start + 1]).map(function (spec) {
		if (/^:-+:$/.test(spec)) {
			return ' style="text-align:center"';
		}
		if (/-+:$/.test(spec)) {
			return ' style="text-align:right"';
		}
		return '';
	});
	var head = cells(lines[start]).map(function (cell, index) {
		return '<th' + (align[index] || '') + '>' + inline(cell, options) + '</th>';
	}).join('');

	var body = [];
	var i = start + 2;
	while (i < lines.length && lines[i].trim() && /\|/.test(lines[i])) {
		body.push('<tr>' + cells(lines[i]).map(function (cell, index) {
			return '<td' + (align[index] || '') + '>' + inline(cell, options) + '</td>';
		}).join('') + '</tr>');
		i++;
	}

	return {
		html: '<table>\n<thead><tr>' + head + '</tr></thead>\n<tbody>\n' + body.join('\n') + '\n</tbody>\n</table>',
		next: i
	};
}
