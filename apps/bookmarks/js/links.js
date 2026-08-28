// The bookmarks document: /settings/links.json.
//
// All of it is here rather than in the UI, because this is the part with rules -- what a
// valid document is, what a URL is allowed to be, and what happens to a link when its
// group is deleted. The UI reads and re-renders; it never reasons about the shape.

export var VERSION = 1;

// Shipped when there is no file yet, and when the app runs outside PixOS and has nothing
// to read. Deliberately about PixOS itself: a first boot should show something true.
export var DEFAULT_DOC = {
	version: VERSION,
	favicons: false,
	groups: [
		{
			name: 'PixOS',
			links: [
				{title: 'About me', url: '/home/about.md', note: 'Your own file — edit it in ace'},
				{title: 'BrowserFS', url: 'https://github.com/jvilk/BrowserFS', note: 'The filesystem underneath'},
				{title: 'GoldenLayout', url: 'https://golden-layout.com/', note: 'The window layout engine'}
			]
		},
		{
			name: 'Daily',
			links: [
				{title: 'Hacker News', url: 'https://news.ycombinator.com/'},
				{title: 'MDN', url: 'https://developer.mozilla.org/'},
				{title: 'Can I use', url: 'https://caniuse.com/'}
			]
		}
	]
};

var counter = 0;

export function createId (prefix) {
	counter++;
	return (prefix || 'l') + '-' + Date.now().toString(36) + '-' + counter.toString(36);
}

// Only http(s) reaches an href, and a bare hostname is upgraded rather than rejected --
// typing "example.com" into the URL field is what people actually do. Filesystem paths
// pass through as-is: a bookmark to /home/about.md opens in PixOS.
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

// A document from disk may be anything at all -- hand-edited, half-written, from an older
// version. Everything unrecognised is dropped rather than repaired, and a link without a
// usable URL is not a link.
export function normalize (raw) {
	var input = (raw && typeof raw === 'object') ? raw : {};
	var groups = Array.isArray(input.groups) ? input.groups : [];

	var doc = {
		version: VERSION,
		favicons: input.favicons === true,
		groups: groups
			.filter(function (group) {
				return group && typeof group === 'object';
			})
			.map(function (group) {
				return {
					id: typeof group.id === 'string' && group.id ? group.id : createId('g'),
					name: String(group.name == null ? '' : group.name).trim() || 'Links',
					links: (Array.isArray(group.links) ? group.links : [])
						.map(normalizeLink)
						.filter(Boolean)
				};
			})
	};

	if (!doc.groups.length) {
		doc.groups = [{id: createId('g'), name: 'Links', links: []}];
	}
	return doc;
}

function normalizeLink (raw) {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	var url = normalizeUrl(raw.url);
	if (!url) {
		return null;
	}
	return {
		id: typeof raw.id === 'string' && raw.id ? raw.id : createId('l'),
		title: String(raw.title == null ? '' : raw.title).trim() || hostOf(url),
		url: url,
		note: String(raw.note == null ? '' : raw.note).trim(),
		// Meaningless on a filesystem path -- there is nowhere else for one to open --
		// so it is cleared rather than carried, and the editor greys the field out to
		// match. A link that changes from a site to a path loses the flag with it.
		frame: raw.frame === true && isExternal(url)
	};
}

export function hostOf (url) {
	var text = String(url || '');
	if (!isExternal(text)) {
		return text.split('/').filter(Boolean).pop() || text;
	}
	return text.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0];
}

// --- editing ----------------------------------------------------------------------
//
// Every one of these mutates the document it is given and returns it: the app holds one
// document, redraws from it and saves it, and a copy-on-write model would buy nothing.

export function addGroup (doc, name) {
	var group = {id: createId('g'), name: String(name || '').trim() || 'Links', links: []};
	doc.groups.push(group);
	return group;
}

export function renameGroup (doc, groupId, name) {
	var group = findGroup(doc, groupId);
	if (group) {
		group.name = String(name || '').trim() || group.name;
	}
	return group;
}

// The last group is never removed: an empty document with nowhere to add a link is a
// dead end, exactly like the empty desktop this whole project started from.
export function removeGroup (doc, groupId) {
	if (doc.groups.length < 2) {
		return false;
	}
	var index = doc.groups.findIndex(function (group) {
		return group.id === groupId;
	});
	if (index === -1) {
		return false;
	}
	doc.groups.splice(index, 1);
	return true;
}

export function addLink (doc, groupId, raw) {
	var group = findGroup(doc, groupId) || doc.groups[0];
	var link = normalizeLink(raw);
	if (!group || !link) {
		return null;
	}
	group.links.push(link);
	return link;
}

export function updateLink (doc, linkId, patch) {
	var found = findLink(doc, linkId);
	if (!found) {
		return null;
	}
	var merged = normalizeLink(Object.assign({}, found.link, patch, {id: found.link.id}));
	if (!merged) {
		return null;
	}
	found.group.links[found.index] = merged;
	return merged;
}

export function removeLink (doc, linkId) {
	var found = findLink(doc, linkId);
	if (!found) {
		return false;
	}
	found.group.links.splice(found.index, 1);
	return true;
}

// Reordering and moving between groups are the same operation, which is what makes one
// drag handler enough for both.
export function moveLink (doc, linkId, toGroupId, toIndex) {
	var found = findLink(doc, linkId);
	var target = findGroup(doc, toGroupId);
	if (!found || !target) {
		return false;
	}
	found.group.links.splice(found.index, 1);
	var index = typeof toIndex === 'number' ? toIndex : target.links.length;
	// Removing from earlier in the same group shifts everything after it down by one.
	if (found.group === target && found.index < index) {
		index--;
	}
	target.links.splice(Math.max(0, Math.min(index, target.links.length)), 0, found.link);
	return true;
}

export function moveGroup (doc, groupId, toIndex) {
	var from = doc.groups.findIndex(function (group) {
		return group.id === groupId;
	});
	if (from === -1) {
		return false;
	}
	var group = doc.groups.splice(from, 1)[0];
	var index = typeof toIndex === 'number' ? toIndex : doc.groups.length;
	if (from < index) {
		index--;
	}
	doc.groups.splice(Math.max(0, Math.min(index, doc.groups.length)), 0, group);
	return true;
}

export function findGroup (doc, groupId) {
	return doc.groups.find(function (group) {
		return group.id === groupId;
	}) || null;
}

export function findLink (doc, linkId) {
	for (var i = 0; i < doc.groups.length; i++) {
		var index = doc.groups[i].links.findIndex(function (link) {
			return link.id === linkId;
		});
		if (index !== -1) {
			return {group: doc.groups[i], index: index, link: doc.groups[i].links[index]};
		}
	}
	return null;
}

// --- search -----------------------------------------------------------------------
//
// Returns the same shape as the document, so the renderer draws a filtered view with the
// code that draws the whole thing. A group whose *name* matches keeps all of its links.

export function search (doc, query) {
	var text = String(query || '').trim().toLowerCase();
	if (!text) {
		return doc.groups;
	}
	return doc.groups
		.map(function (group) {
			if (group.name.toLowerCase().includes(text)) {
				return group;
			}
			var links = group.links.filter(function (link) {
				return (link.title + ' ' + link.url + ' ' + link.note).toLowerCase().includes(text);
			});
			return links.length ? Object.assign({}, group, {links: links}) : null;
		})
		.filter(Boolean);
}

// --- tiles ------------------------------------------------------------------------
//
// The same monogram scheme the shell uses for apps without an icon, so a bookmark tile
// and an app tile look like they belong to one system. Nothing is ever fetched here --
// see the favicons toggle in the app, which is off by default and says why.

function hashString (value) {
	var hash = 2166136261;
	var text = String(value || '');
	for (var i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

export function colorFor (seed) {
	return 'hsl(' + (hashString(seed) % 360) + ', 42%, 44%)';
}

export function tileFor (link) {
	var host = hostOf(link.url);
	// Initials come from a title, never from a hostname: "developer.mozilla.org" would
	// otherwise read as "DM", which is a worse label than the single letter.
	if (!String(link.title || '').trim()) {
		return {label: (host.slice(0, 1) || '?').toUpperCase(), color: colorFor(host)};
	}
	var words = String(link.title).replace(/[-_.]+/g, ' ').split(/\s+/).filter(Boolean);
	var label = !words.length
		? '?'
		: words.length === 1 ? words[0].slice(0, 1) : words[0].slice(0, 1) + words[1].slice(0, 1);
	return {label: label.toUpperCase(), color: colorFor(host)};
}

// The favicon of a site, from the site itself rather than a third-party icon service.
// Still a request to every bookmarked host, which is why the toggle exists and defaults
// to off: with it on, opening this app tells every site in your list that you did.
export function faviconUrl (link) {
	if (!isExternal(link.url)) {
		return null;
	}
	try {
		return new URL('/favicon.ico', link.url).href;
	}
	catch (err) {
		return null;
	}
}

export function serialize (doc) {
	return JSON.stringify({
		version: VERSION,
		favicons: !!doc.favicons,
		groups: doc.groups.map(function (group) {
			return {
				id: group.id,
				name: group.name,
				links: group.links.map(function (link) {
					var out = {id: link.id, title: link.title, url: link.url};
					if (link.note) {
						out.note = link.note;
					}
					if (link.frame) {
						out.frame = true;
					}
					return out;
				})
			};
		})
	}, null, 2);
}
