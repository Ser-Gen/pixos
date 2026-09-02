// Adding a bookmark from outside the Bookmarks app.
//
// The document is `/settings/links.json` and the app that owns it is `apps/bookmarks`,
// whose `js/links.js` holds the real rules. This is the shell's half, and it is a second
// copy for the same reason the frontmatter parser is: an app is installed *into*
// BrowserFS, so the shell cannot import a module from one. Only the rules that writing a
// single link needs are here -- what a URL is allowed to be, and what a link record looks
// like -- and if either changes in `apps/bookmarks/js/links.js` it has to change here too.
// `npm test` covers both copies.
//
// Everything is pure: `addTo` takes the parsed document and returns what to write.

export var VERSION = 1;
export var DEFAULT_GROUP = 'Bookmarks';

var counter = 0;

export function createId (prefix) {
	counter++;
	return (prefix || 'l') + '-' + Date.now().toString(36) + '-' + counter.toString(36);
}

// Mirrors normalizeUrl in apps/bookmarks/js/links.js. A filesystem path passes through
// as-is -- a bookmark to /home/about.md opens in PixOS -- http(s) passes, a bare hostname
// is upgraded rather than rejected, and every other scheme is refused: `addBookmark` is
// reachable from inside any app iframe, so `javascript:` must not be storable somewhere
// the Bookmarks app will later put in an href.
export function normalizeUrl (raw) {
	var url = String(raw == null ? '' : raw).trim();
	if (!url) {
		return null;
	}
	if (url.startsWith('/')) {
		return url;
	}
	if (/^(https?):\/\//i.test(url)) {
		return url;
	}
	if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
		return null;
	}
	if (/^[\w-]+(\.[\w-]+)+(\/|$|\?|#)/.test(url)) {
		return 'https://' + url;
	}
	return null;
}

export function isExternal (url) {
	return /^https?:\/\//i.test(String(url || ''));
}

export function titleFor (url, given) {
	var title = String(given == null ? '' : given).trim();
	if (title) {
		return title;
	}
	var text = String(url || '');
	if (!isExternal(text)) {
		return text.split('/').filter(Boolean).pop() || text;
	}
	return text.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0];
}

// A document read off disk may be anything -- hand-edited, half-written, from an older
// version -- but the one thing this must never do is *replace* it. Only the shape it
// needs is repaired: groups it does not recognise are left exactly as they are and
// carried through, so a field this copy has never heard of survives the write.
function usableGroups (doc) {
	var groups = (doc && Array.isArray(doc.groups)) ? doc.groups : [];
	return groups.filter(function (group) {
		return group && typeof group === 'object';
	});
}

export function findDuplicate (doc, url) {
	var groups = usableGroups(doc);
	for (var i = 0; i < groups.length; i++) {
		var links = Array.isArray(groups[i].links) ? groups[i].links : [];
		for (var j = 0; j < links.length; j++) {
			if (links[j] && links[j].url === url) {
				return {group: groups[i], link: links[j]};
			}
		}
	}
	return null;
}

// A trailing slash is how the bookmarks document marks a folder -- `apps/bookmarks`
// reads it to decide between openPath and openFile, and without it a bookmarked folder
// comes back as a file and raises the *Open with...* chooser instead of Explorer. The
// caller knows which it has; this is where that knowledge is written down.
export function asFolderUrl (url) {
	if (!url || isExternal(url) || url.endsWith('/')) {
		return url;
	}
	return url + '/';
}

// entry: {url, title, note, group, directory}
// Returns {ok, reason, doc, link, group, duplicate}. `doc` is only worth writing when
// `ok` is true and `duplicate` is null.
export function addTo (doc, entry) {
	var request = entry || {};
	var url = normalizeUrl(request.url);
	if (!url) {
		return {ok: false, reason: 'url', doc: doc, link: null, group: null, duplicate: null};
	}
	if (request.directory === true) {
		url = asFolderUrl(url);
	}

	var document = (doc && typeof doc === 'object') ? doc : {};
	var groups = usableGroups(document);
	var existing = findDuplicate({groups: groups}, url);
	if (existing) {
		return {
			ok: true,
			reason: 'duplicate',
			doc: document,
			link: existing.link,
			group: existing.group,
			duplicate: existing.link
		};
	}

	// The document that came in is never touched. `apps/bookmarks/js/links.js` mutates in
	// place, which is right for an app holding one open document and redrawing from it --
	// but this is called with a document that was just parsed off disk and may be
	// abandoned unwritten, and half-applying a change to it would be a bookmark that
	// exists only in memory.
	var name = String(request.group || DEFAULT_GROUP).trim() || DEFAULT_GROUP;
	var index = groups.findIndex(function (candidate) {
		return String(candidate.name || '').trim().toLowerCase() === name.toLowerCase();
	});
	var group;
	if (index === -1) {
		group = {id: createId('g'), name: name, links: []};
		groups = groups.concat([group]);
	}
	else {
		group = Object.assign({}, groups[index], {
			links: (Array.isArray(groups[index].links) ? groups[index].links : []).slice()
		});
		groups = groups.slice();
		groups[index] = group;
	}

	var link = {
		id: createId('l'),
		title: titleFor(url, request.title),
		url: url,
		note: String(request.note == null ? '' : request.note).trim(),
		// Only meaningful for a site: there is nowhere else for a filesystem path to open.
		frame: request.frame === true && isExternal(url)
	};
	group.links.push(link);

	return {
		ok: true,
		reason: 'added',
		doc: Object.assign({}, document, {
			version: typeof document.version === 'number' ? document.version : VERSION,
			favicons: document.favicons === true,
			groups: groups
		}),
		link: link,
		group: group,
		duplicate: null
	};
}

export function serialize (doc) {
	return JSON.stringify(doc, null, '\t');
}
