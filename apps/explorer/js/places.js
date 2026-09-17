// The places pinned to the top of the sidebar: the `Places` group of /settings/links.json.
//
// Before phase 23 this was four rows written into the render -- Root, Apps, Current, Parent --
// and it could not be edited because it was not data. Now it is the bookmarks document, so a
// pinned folder is an ordinary bookmark: the Bookmarks app shows it, and editing it there changes
// it here. *Current* and *Parent* went for good; both were already on screen, in the breadcrumbs
// and on the Up button.
//
// **Explorer holds none of the bookmark rules.** The shell's `js/shell/bookmarks.js` is the one
// writer outside the Bookmarks app, and every call in here is a call on it: `listBookmarks` to
// draw, and `addBookmark`, `removeBookmark`, `moveBookmark`, `renameBookmark` and
// `ensureBookmarkGroup` to change. A fourth copy of the rules inside Explorer was rejected before
// the phase began, and `docs/backlog.md` says why.
//
// **With no `Places` group, Root and Apps are drawn as starters, and nothing is written.** A group
// is only created by the first edit -- a pin, an unpin, a move or a rename -- and that one write
// is the starters with the edit already applied, through `ensureBookmarkGroup`. Opening Explorer
// never writes the bookmarks file. A `Places` group with nothing in it is a different answer from
// no group at all: somebody who unpinned everything has not asked for the starters back.
//
// **A place is found again by its id, never by where it was drawn.** A menu is built from one
// render and pressed after the list may have been re-read -- a pin added in another window, say
// -- so every action takes the place it was built from and looks it up in what is current. A
// starter has no id yet and is found by its address.
//
// Only folders are drawn. A file or a site put into `Places` from the Bookmarks app stays in the
// document, and still counts for where a move lands, but Explorer goes to folders.

export var FILE = '/settings/links.json';
export var GROUP = 'Places';

export var STARTERS = [
	{title: 'Root', url: '/'},
	{title: 'Apps', url: '/apps/'}
];

// A folder in the bookmarks document is a path ending in a slash -- the rule the Bookmarks app
// reads to choose between opening a folder and opening a file. `/` is its own folder.
export function pathOf (url) {
	var text = String(url == null ? '' : url);
	if (text.charAt(0) !== '/' || text.charAt(text.length - 1) !== '/') {
		return null;
	}
	return text.length > 1 ? text.replace(/\/+$/, '') || '/' : '/';
}

export function urlOf (folderPath) {
	var text = String(folderPath == null ? '' : folderPath).replace(/\/+$/, '');
	return text ? text + '/' : '/';
}

// What the sidebar draws from what `listBookmarks` answered. `index` is the link's position in
// the whole group, files and sites included, because that is the position a move is written in.
export function placesFrom (links) {
	return (Array.isArray(links) ? links : []).map(function (link, index) {
		return {id: link.id || null, title: link.title, url: link.url, path: pathOf(link.url), index: index};
	}).filter(function (place) {
		return place.path !== null;
	});
}

export function starterPlaces () {
	return placesFrom(STARTERS.map(function (starter) {
		return {id: null, title: starter.title, url: starter.url};
	}));
}

export function createPlaces (deps) {

	var state = deps.state;
	var shell = deps.shell;
	var openDialog = deps.openDialog;
	var renderOverlays = deps.renderOverlays;
	// Late-bound, for the reason js/mounts.js takes it late: the sidebar is built from `actions`,
	// and `actions` is built from this.
	var renderSidebar = deps.renderSidebar;

	// status: 'loading' until the first read answers; then 'ready', or 'unreadable' when the
	// bookmarks file is there and will not parse, or 'unavailable' under a shell with no
	// `listBookmarks`. Only 'ready' is editable -- the shell would refuse the other two anyway,
	// and a menu offering what will only raise a note is worse than no menu.
	state.places = {status: 'loading', group: null, places: starterPlaces()};

	var loads = 0;

	function canEdit () {
		return state.places.status === 'ready';
	}

	async function loadPlaces () {
		var mine = ++loads;
		var next;
		if (!shell || typeof shell.listBookmarks !== 'function') {
			next = {status: 'unavailable', group: null, places: starterPlaces()};
		}
		else {
			try {
				var listed = await shell.listBookmarks(GROUP);
				next = {
					status: 'ready',
					group: listed.group,
					places: listed.group ? placesFrom(listed.links) : starterPlaces()
				};
			}
			catch (err) {
				next = {status: 'unreadable', group: null, places: starterPlaces(), error: err};
			}
		}
		// Two reads overlapping -- the change signal and an edit's own reload, which is the usual
		// case -- answer in either order. The one asked for last is the one that is true.
		if (mine !== loads) {
			return;
		}
		state.places = next;
		renderSidebar();
	}

	function find (place) {
		if (!place) {
			return -1;
		}
		return state.places.places.findIndex(function (candidate) {
			return place.id ? candidate.id === place.id : (!candidate.id && candidate.url === place.url);
		});
	}

	function isPinned (folderPath) {
		var url = urlOf(folderPath);
		return state.places.places.some(function (place) {
			return place.url === url;
		});
	}

	// The first edit to a group that does not exist: the starters as they are drawn, with the
	// edit applied, written as the group in one call. If another window created `Places` in the
	// meantime the shell leaves that group alone, and the reload after this shows it -- the edit
	// made to a list that was no longer the real one is dropped rather than merged.
	function writeStarters (places) {
		return shell.ensureBookmarkGroup(GROUP, places.map(function (place) {
			return {url: place.url, title: place.title, directory: true};
		}));
	}

	function titleFor (folderPath) {
		var name = String(folderPath).split('/').filter(Boolean).pop();
		return name || 'Root';
	}

	async function pinFolder (folderPath) {
		if (!canEdit() || !folderPath || isPinned(folderPath)) {
			return;
		}
		var pin = {url: urlOf(folderPath), title: titleFor(folderPath)};
		if (!state.places.group) {
			await writeStarters(state.places.places.concat([pin]));
		}
		else {
			// Quiet: the row appearing in the sidebar is the answer, and a note saying so on top
			// of it is one thing too many. A refusal or a failed write still raises one.
			await shell.addBookmark({url: pin.url, title: pin.title, directory: true, group: GROUP}, {quiet: true});
		}
		await loadPlaces();
	}

	async function unpinPlace (place) {
		var at = find(place);
		if (!canEdit() || at === -1) {
			return;
		}
		if (!state.places.group) {
			await writeStarters(state.places.places.filter(function (candidate, index) {
				return index !== at;
			}));
		}
		else {
			await shell.removeBookmark(state.places.places[at].id);
		}
		await loadPlaces();
	}

	// One place up (-1) or down (+1) among the drawn ones. Written as the shell's move, whose
	// index is the position before the link is lifted out -- so down is the next place's index
	// plus one, and anything in the group that is not drawn stays where it was relative to it.
	async function movePlace (place, delta) {
		var at = find(place);
		var places = state.places.places;
		if (!canEdit() || at === -1 || (delta !== -1 && delta !== 1) || !places[at + delta]) {
			return;
		}
		if (!state.places.group) {
			var swapped = places.slice();
			swapped[at] = places[at + delta];
			swapped[at + delta] = places[at];
			await writeStarters(swapped);
		}
		else {
			var other = places[at + delta];
			await shell.moveBookmark(places[at].id, delta < 0 ? other.index : other.index + 1);
		}
		await loadPlaces();
	}

	function renamePlace (place) {
		if (!canEdit() || find(place) === -1) {
			return;
		}
		var current = state.places.places[find(place)];
		openDialog({
			type: 'prompt',
			title: 'Rename place',
			message: 'The name shown here and in Bookmarks. The folder itself keeps its name.',
			defaultValue: current.title,
			// Two rows with one name are two rows nobody can tell apart without hovering, and
			// the name is the only thing a place has that the folder does not. Refused here,
			// in Explorer, and not in the shell: Bookmarks is a list of links, where two
			// titles alike are nobody's business. The place itself is left out, so a rename
			// that only changes the case goes through.
			refuse: function (title) {
				var wanted = title.toLowerCase();
				var clash = state.places.places.filter(function (other) {
					return other.url !== current.url && other.title.toLowerCase() === wanted;
				})[0];
				return clash ? 'Another place is already called “' + clash.title + '”.' : null;
			},
			onSubmit: async function (title) {
				state.dialog = null;
				renderOverlays();
				if (!title || title === current.title) {
					return;
				}
				// Looked up again: the dialog was open for as long as somebody took to type.
				var at = find(current);
				if (!canEdit() || at === -1) {
					return;
				}
				if (!state.places.group) {
					await writeStarters(state.places.places.map(function (candidate, index) {
						return index === at ? {url: candidate.url, title: title} : candidate;
					}));
				}
				else {
					await shell.renameBookmark(state.places.places[at].id, title);
				}
				await loadPlaces();
			}
		});
	}

	return {
		loadPlaces: loadPlaces,
		isPinned: isPinned,
		pinFolder: pinFolder,
		unpinPlace: unpinPlace,
		movePlace: movePlace,
		renamePlace: renamePlace
	};
}
