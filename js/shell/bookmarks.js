// Editing the bookmarks document from outside the Bookmarks app.
//
// The document is `/settings/links.json` and the app that owns it is `apps/bookmarks`,
// whose `js/links.js` holds the real rules. This is the shell's half, and it is a second
// copy for the same reason the frontmatter parser is: an app is installed *into*
// BrowserFS, so the shell cannot import a module from one. Only the rules the shell's own
// edits need are here -- what a URL is allowed to be, what a link record looks like, and
// what removing, moving and renaming one does -- and if any of them changes in
// `apps/bookmarks/js/links.js` it has to change here too. `npm test` checks both copies
// give the same answer.
//
// Two layers. The functions at the top are pure: each takes the parsed document and returns
// what to write, never touching what it was handed. `createBookmarks` at the bottom is the
// read-apply-write around them, with the notes a person sees, and it is what the shell puts
// on `window` for any app -- Explorer's pinned places are its first caller beyond
// `addBookmark`.

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
	var name = String(request.group || DEFAULT_GROUP).trim() || DEFAULT_GROUP;
	var index = indexOfGroup(groups, name);
	// A named group is asked about on its own. Pinning a folder to Explorer's `Places` is a
	// different act from bookmarking it, and a folder already under *Bookmarks* would
	// otherwise refuse to be pinned with a note saying it was bookmarked. With no group
	// named the whole document is searched, which is what `Add to bookmarks` always did.
	var existing = request.group
		? (index === -1 ? null : findDuplicate({groups: [groups[index]]}, url))
		: findDuplicate({groups: groups}, url);
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
		doc: rebuilt(document, groups),
		link: link,
		group: group,
		duplicate: null
	};
}

// Group names are matched the way a person reads them: trimmed, and in any case. One rule
// for adding and listing, so a group `listGroup` cannot see is never one `addTo` then
// appends to, or the other way round.
function indexOfGroup (groups, name) {
	var wanted = String(name == null ? '' : name).trim().toLowerCase();
	return groups.findIndex(function (candidate) {
		return String(candidate.name || '').trim().toLowerCase() === wanted;
	});
}

function rebuilt (document, groups) {
	return Object.assign({}, document, {
		version: typeof document.version === 'number' ? document.version : VERSION,
		favicons: document.favicons === true,
		groups: groups
	});
}

function linksOf (group) {
	return Array.isArray(group.links) ? group.links : [];
}

// Where a link is, by id, across every group -- or null. The id is the only handle a caller
// holds that survives the list being redrawn between the click and the write.
function locate (groups, linkId) {
	for (var i = 0; i < groups.length; i++) {
		var index = linksOf(groups[i]).findIndex(function (link) {
			return link && link.id === linkId;
		});
		if (index !== -1) {
			return {groupIndex: i, index: index, link: linksOf(groups[i])[index]};
		}
	}
	return null;
}

// The one shape every edit below returns. `doc` is only worth writing when `reason` is in
// CHANGED -- a link somebody else removed a moment ago is `missing`, and nothing is written.
function outcome (ok, reason, doc, link, group) {
	return {ok: ok, reason: reason, doc: doc, link: link || null, group: group || null};
}

// Copies the document down to the one group being edited and hands its links over to be
// changed. Nothing the caller passed in is touched.
function editGroup (doc, linkId, change) {
	var document = (doc && typeof doc === 'object') ? doc : {};
	var groups = usableGroups(document);
	var found = locate(groups, linkId);
	if (!found) {
		return outcome(true, 'missing', document);
	}
	var links = linksOf(groups[found.groupIndex]).slice();
	var result = change(links, found.index, found.link);
	var group = Object.assign({}, groups[found.groupIndex], {links: links});
	groups = groups.slice();
	groups[found.groupIndex] = group;
	return outcome(true, result.reason, rebuilt(document, groups), result.link, group);
}

export var CHANGED = ['added', 'removed', 'moved', 'renamed', 'created'];

// Mirrors removeLink in apps/bookmarks/js/links.js.
export function removeFrom (doc, linkId) {
	return editGroup(doc, linkId, function (links, index, link) {
		links.splice(index, 1);
		return {reason: 'removed', link: link};
	});
}

// Mirrors moveLink in apps/bookmarks/js/links.js for a move inside the link's own group, and
// with its meaning of `toIndex`: the position *before the link is taken out*, so moving one
// down a place is `index + 2`. That is what a drop between two rows naturally produces, and a
// second meaning in the second copy is exactly the drift the agreement test exists to catch.
// A number is required. links.js falls back to the end of the group without one, and inside
// the link's own group that fallback lands one place short of it -- the app only ever omits
// the index when the group changes, so it never meets that, and this copy does not offer it.
export function moveWithin (doc, linkId, toIndex) {
	if (typeof toIndex !== 'number' || !isFinite(toIndex)) {
		return outcome(false, 'index', doc);
	}
	return editGroup(doc, linkId, function (links, from, link) {
		links.splice(from, 1);
		var index = toIndex;
		if (from < index) {
			index--;
		}
		links.splice(Math.max(0, Math.min(index, links.length)), 0, link);
		return {reason: 'moved', link: link};
	});
}

// Mirrors updateLink in apps/bookmarks/js/links.js for the title alone: an empty title is not
// kept, it falls back to the name the link would have had with none -- the same fallback
// `addTo` uses, so a rename to nothing gives the title adding it gave.
export function renameIn (doc, linkId, title) {
	return editGroup(doc, linkId, function (links, index, link) {
		var renamed = Object.assign({}, link, {title: titleFor(link.url, title)});
		links[index] = renamed;
		return {reason: 'renamed', link: renamed};
	});
}

// A group by name, created with these links if it is not there -- and left exactly as it is
// if it is, links and all. That second half is the point: a caller showing defaults for a
// group that does not exist yet writes them on its first edit, and must not write over a
// group another window created in the meantime.
//
// entries: [{url, title, directory}], each held to the same rules `addTo` holds one to; an
// entry that is not an address is dropped rather than failing the rest.
export function ensureGroup (doc, name, entries) {
	var document = (doc && typeof doc === 'object') ? doc : {};
	var groups = usableGroups(document);
	var label = String(name == null ? '' : name).trim();
	if (!label) {
		return outcome(false, 'name', document);
	}
	var index = indexOfGroup(groups, label);
	if (index !== -1) {
		return outcome(true, 'exists', document, null, groups[index]);
	}
	var links = (Array.isArray(entries) ? entries : []).map(function (entry) {
		var url = normalizeUrl(entry && entry.url);
		if (!url) {
			return null;
		}
		if (entry.directory === true) {
			url = asFolderUrl(url);
		}
		return {id: createId('l'), title: titleFor(url, entry.title), url: url, note: '', frame: false};
	}).filter(Boolean);
	var group = {id: createId('g'), name: label, links: links};
	return outcome(true, 'created', rebuilt(document, groups.concat([group])), null, group);
}

// What is in one group, for display: its id and name, and copies of the links that have an
// address. `group` is null when there is no such group, which is a different answer from a
// group with nothing in it -- somebody who unpinned everything has not asked for defaults.
export function listGroup (doc, name) {
	var groups = usableGroups(doc);
	var index = indexOfGroup(groups, name);
	if (index === -1) {
		return {group: null, links: []};
	}
	var group = groups[index];
	return {
		group: {id: group.id || null, name: group.name},
		links: linksOf(group).filter(function (link) {
			return link && typeof link.url === 'string';
		}).map(function (link) {
			return {id: link.id || null, title: titleFor(link.url, link.title), url: link.url};
		})
	};
}

export function serialize (doc) {
	return JSON.stringify(doc, null, '\t');
}

// --- the read-apply-write -------------------------------------------------------------------
//
// deps: {read, write, notify, describeError, openBookmarks}
//   read()            -> the parsed document, null when there is no file, a rejection when
//                        there is a file that will not read or parse
//   write(text)       -> resolves once it is on disk, rejects when it is not
//   notify(note)      -> one note on the shell's surface
//   describeError(title, err) -> {title, message}
//   openBookmarks()   -> the Add note's button
//
// **Every call waits for the one before it.** Each is a read, a change and a write, and two of
// them overlapping -- *Move up* pressed twice -- would both read the document before either
// wrote, and the second write would put back what the first had moved. Reads wait too, so a
// list asked for after an edit sees it.
//
// **A file that will not read is never written.** "No file yet" and "a file with something
// wrong in it" are different answers, and replacing the second with a fresh document holding
// one link would be the worst possible response to a typo. That rule used to live in the
// shell's `addBookmark` alone; every edit has it now because every edit comes through here.

export function createBookmarks (deps) {
	var queue = Promise.resolve();

	function serial (job) {
		var run = queue.then(job, job);
		queue = run.catch(function () {});
		return run;
	}

	function note (level, title, message, actions) {
		var entry = {level: level, title: title, message: message, source: 'PixOS'};
		if (actions) {
			entry.actions = actions;
		}
		try {
			deps.notify(entry);
		}
		catch (err) {
			// A note that could not be drawn is not a reason to report the edit as failed.
		}
	}

	// Resolves to the result of `apply`, or null when nothing could be done and a note has
	// already said why. Never rejects: every caller is a click, and a rejection from a click
	// reaches nobody.
	function edit (failTitle, apply) {
		return serial(async function () {
			var doc;
			try {
				doc = await deps.read();
			}
			catch (err) {
				note('error', failTitle, 'Your bookmarks file (/settings/links.json) could not be read, so '
					+ 'nothing was changed. Open it in an editor to see what is wrong with it.');
				return null;
			}
			var result = apply(doc);
			if (!result.ok || CHANGED.indexOf(result.reason) === -1) {
				return result;
			}
			try {
				await deps.write(serialize(result.doc));
			}
			catch (err) {
				var failed = deps.describeError(failTitle, err);
				note('error', failed.title, failed.message);
				return null;
			}
			return result;
		});
	}

	// Rejects when the file will not read, unlike every edit: a list has no note of its own to
	// raise, and the caller showing it is the one that knows what to draw instead.
	function list (name) {
		return serial(async function () {
			return listGroup(await deps.read(), name);
		});
	}

	// options.quiet: no note when it worked or was already there -- for a caller whose own
	// window shows the result, where a note saying so is one thing too many. A refusal and a
	// failure are still reported, because nothing on screen will.
	async function add (entry, options) {
		var quiet = !!(options && options.quiet);
		var result = await edit('Could not add the bookmark', function (doc) {
			return addTo(doc, entry);
		});
		if (!result) {
			return null;
		}
		if (!result.ok) {
			note('warn', 'That is not an address PixOS can bookmark',
				'A bookmark has to be a web address or a path inside PixOS.');
			return null;
		}
		if (result.duplicate) {
			if (!quiet) {
				note('info', 'Already bookmarked',
					'"' + result.link.title + '" is already in ' + (result.group.name || 'your bookmarks') + '.');
			}
			return result.link;
		}
		if (!quiet) {
			note('info', 'Added to bookmarks', '"' + result.link.title + '" is in ' + result.group.name + '.', [{
				label: 'Open Bookmarks',
				// A Bookmarks window that is already open hears the write through the change
				// signal; this is for the one that is not open yet.
				run: function () {
					deps.openBookmarks();
				}
			}]);
		}
		return result.link;
	}

	// A link that is not there any more -- removed in the Bookmarks app a moment ago -- is
	// `false` with no note: whatever the caller draws next will not have it either.
	async function remove (linkId) {
		var result = await edit('Could not remove the bookmark', function (doc) {
			return removeFrom(doc, linkId);
		});
		return !!(result && result.reason === 'removed');
	}

	async function move (linkId, toIndex) {
		var result = await edit('Could not move the bookmark', function (doc) {
			return moveWithin(doc, linkId, toIndex);
		});
		return !!(result && result.reason === 'moved');
	}

	async function rename (linkId, title) {
		var result = await edit('Could not rename the bookmark', function (doc) {
			return renameIn(doc, linkId, title);
		});
		return result && result.reason === 'renamed' ? result.link : null;
	}

	// Resolves to {group, created}, or null when nothing was written and a note said why.
	async function ensure (name, entries) {
		var result = await edit('Could not create the bookmark group', function (doc) {
			return ensureGroup(doc, name, entries);
		});
		if (!result || !result.ok) {
			return null;
		}
		return {group: {id: result.group.id || null, name: result.group.name}, created: result.reason === 'created'};
	}

	return {
		list: list,
		add: add,
		remove: remove,
		move: move,
		rename: rename,
		ensureGroup: ensure
	};
}
