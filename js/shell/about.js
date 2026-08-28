// The one file in the system that is about you: /home/about.md.
//
// Its frontmatter -- the `---` block at the top -- is what the desktop's About widget
// shows. The body is left to the Markdown Viewer; nothing here renders markdown.
//
// The parser below is a second copy of the one in apps/markdown-viewer/js/markdown.js,
// and deliberately so: an app is installed *into* BrowserFS and has to be self-contained,
// so the shell cannot share a module with it. Two forty-line parsers of the same tiny
// YAML subset is the cost of that boundary; both are covered by npm test.

export var ABOUT_PATH = '/home/about.md';

// `key: value`, a `key:` followed by `- item` lines, and `- title: x` / `  url: y`
// blocks. Anything richer is ignored rather than guessed at.
export function parseFrontmatter (text) {
	var source = String(text == null ? '' : text);
	var match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
	if (!match) {
		return {data: {}, body: source};
	}

	var data = {};
	var key = null;
	var list = null;

	match[1].split(/\r?\n/).forEach(function (line) {
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
			if (pair) {
				var object = {};
				object[pair[1]] = unquote(pair[2]);
				list.push(object);
			}
			else {
				list.push(unquote(item[1]));
			}
			return;
		}

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

	return {data: data, body: source.slice(match[0].length)};
}

function unquote (value) {
	var text = String(value).trim();
	if (/^".*"$/.test(text) || /^'.*'$/.test(text)) {
		return text.slice(1, -1);
	}
	return text;
}

// Only http(s), mailto and filesystem paths become links on the desktop. A widget is not
// a place where a `javascript:` url should ever end up.
export function safeUrl (raw) {
	var url = String(raw == null ? '' : raw).trim();
	if (!url) {
		return null;
	}
	if (/^(https?:|mailto:)/i.test(url)) {
		return url;
	}
	if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
		return null;
	}
	return url.startsWith('/') ? url : null;
}

// What the widget actually draws: the three fields it understands, already validated, so
// nothing downstream has to decide what a missing or malformed one means.
export function profileFrom (data) {
	var fields = data || {};
	return {
		name: String(fields.name || fields.title || '').trim(),
		tagline: String(fields.tagline || fields.description || '').trim(),
		links: (Array.isArray(fields.links) ? fields.links : [])
			.map(function (link) {
				if (!link || typeof link !== 'object') {
					return null;
				}
				var url = safeUrl(link.url);
				return url ? {title: String(link.title || url).trim(), url: url} : null;
			})
			.filter(Boolean)
	};
}

// The file is read over the service worker rather than through window.fs, so this module
// stays usable from anywhere in the shell without a filesystem handle.
export async function read (filePath) {
	var target = filePath || ABOUT_PATH;
	try {
		var response = await fetch('/__browserfs__' + target + '?' + Date.now(), {cache: 'no-store'});
		if (!response.ok) {
			throw new Error(response.status + ' ' + response.statusText);
		}
		var text = await response.text();
		var parsed = parseFrontmatter(text);
		return {path: target, profile: profileFrom(parsed.data), data: parsed.data, error: null};
	}
	catch (err) {
		// A missing file is the ordinary case on a system where the seed never ran, so
		// the caller gets an empty profile and a reason rather than a rejection.
		return {path: target, profile: profileFrom({}), data: {}, error: err};
	}
}
