// Wallpaper providers.
//
// Not one setting but a registry, so a new background type is a new file rather than an
// edit to the desktop. Phase 1 shipped the three that cost nothing (they are CSS), the WebGL
// shader provider registered itself the same way in phase 2, and phase 26 added a page.
//
// A provider is {mount(element, config, context)}. mount may return an instance,
// {pause(), resume(), unmount(), forward(event)}, every part of it optional; the CSS ones
// return nothing. It is an instance rather than state kept in the provider's module since
// phase 26, because the same shader can be the background and the screensaver at once, and
// each has to be paused on its own. `context.fail(message)` is how a provider says it cannot
// draw: it takes away what it added first, and is never called again after that.
//
// `mount` here wraps an instance in a handle that owns the two decisions every animated
// background needs and none should make for itself: paused or not, and **unloaded once it has
// been out of sight for UNLOAD_AFTER_MS**. A pause alone saves the drawing but keeps
// everything else -- a page's memory, its textures, its timers, a WebGL context. Unloading at
// once would save all of it, but the desktop is uncovered all the time (a peek, the last window
// closed, a switch to an empty desktop), and every one of those would restart the scene and
// read it from storage again. So: paused the moment it is covered, gone if it stays covered,
// mounted again from the start when it is next seen.
//
// **On battery it is held still instead** (pass 6): `setStill(true)` lets it move for
// STILL_AFTER_MS each time it comes into view -- long enough for a page to load and draw a
// picture, and Pipes to lay a few pipes -- and then pauses it where it is. A still one is not
// unloaded for being still, only for being covered, because it is still being looked at.

var providers = {};

export var UNLOAD_AFTER_MS = 30000;
export var STILL_AFTER_MS = 8000;

export var PRESETS = {
	midnight: {label: 'Midnight', angle: 160, stops: ['#1b2735', '#090a0f']},
	dusk: {label: 'Dusk', angle: 145, stops: ['#3a1c47', '#160f22', '#0a0a12']},
	slate: {label: 'Slate', angle: 135, stops: ['#2c3440', '#171b21']},
	forest: {label: 'Forest', angle: 150, stops: ['#1d3b2a', '#0d1a13']},
	ember: {label: 'Ember', angle: 155, stops: ['#3d1f14', '#160b08']}
};

export var DEFAULT_WALLPAPER = {type: 'gradient', value: 'midnight', options: {}};

export function register (type, provider) {
	if (!type || !provider || typeof provider.mount !== 'function') {
		throw new Error('wallpaper provider needs a type and a mount()');
	}
	providers[type] = provider;
}

export function listTypes () {
	return Object.keys(providers);
}

// Fills in the gaps rather than rejecting: an unusable config would leave the user
// staring at a black rectangle with no way to fix it from the UI.
export function normalize (config) {
	if (!config || typeof config !== 'object' || !providers[config.type]) {
		return Object.assign({}, DEFAULT_WALLPAPER);
	}
	return {
		type: config.type,
		value: typeof config.value === 'undefined' ? DEFAULT_WALLPAPER.value : config.value,
		options: Object.assign({}, config.options || {})
	};
}

export function gradientCss (gradient) {
	return 'linear-gradient(' + gradient.angle + 'deg, ' + gradient.stops.join(', ') + ')';
}

function clear (host) {
	host.replaceChildren();
	host.style.cssText = '';
}

function call (instance, name) {
	if (instance && typeof instance[name] === 'function') {
		instance[name]();
	}
}

// `hooks`: `onError(message, config)` when a provider fails, and the timer pair, which is a
// parameter so a test can move that clock by hand.
export function mount (host, config, hooks) {
	var options = hooks || {};
	var setTimer = options.setTimeout || setTimeout;
	var clearTimer = options.clearTimeout || clearTimeout;
	var unloadAfter = typeof options.unloadAfter === 'number' ? options.unloadAfter : UNLOAD_AFTER_MS;
	var stillAfter = typeof options.stillAfter === 'number' ? options.stillAfter : STILL_AFTER_MS;

	var next = normalize(config);
	var instance = null;
	var paused = false;
	var unloaded = false;
	var failed = false;
	var gone = false;
	var timer = null;
	// Held still on battery: `still` is the wish, `held` that the instance has been paused for it.
	var still = false;
	var held = false;
	var stillTimer = null;

	// The gradient a background falls back to when it cannot draw at all. Painted here rather
	// than by mounting the default, which would make the fallback look like the user's choice.
	var context = {
		fail: function (message) {
			if (gone || failed) {
				return;
			}
			failed = true;
			instance = null;
			stopTimer();
			stopStill();
			clear(host);
			host.style.background = gradientCss(PRESETS[DEFAULT_WALLPAPER.value]);
			console.error('Wallpaper (' + next.type + '): ' + message);
			if (typeof options.onError === 'function') {
				options.onError(message, next);
			}
		}
	};

	function start () {
		clear(host);
		unloaded = false;
		held = false;
		var made = providers[next.type].mount(host, next, context);
		// A provider that failed while mounting has already said so; what it returned is moot.
		instance = failed ? null : (made || null);
	}

	function stopStill () {
		if (stillTimer !== null) {
			clearTimer(stillTimer);
			stillTimer = null;
		}
	}

	// The time it moves before it is held, counted only while it can be seen.
	function armStill () {
		if (still && !paused && !held && !gone && !failed && instance && typeof instance.pause === 'function') {
			stillTimer = setTimer(holdStill, stillAfter);
		}
	}

	function holdStill () {
		stillTimer = null;
		if (gone || failed || paused || held || !instance) {
			return;
		}
		held = true;
		call(instance, 'pause');
	}

	function stopTimer () {
		if (timer !== null) {
			clearTimer(timer);
			timer = null;
		}
	}

	function unload () {
		timer = null;
		if (gone || failed || !paused || unloaded) {
			return;
		}
		call(instance, 'unmount');
		instance = null;
		unloaded = true;
		held = false;
		clear(host);
	}

	start();

	return {
		config: next,
		pause: function () {
			if (gone || paused) {
				return;
			}
			paused = true;
			stopStill();
			// One held still is paused already.
			if (!held) {
				call(instance, 'pause');
			}
			// Only an instance that holds something is worth unloading. A colour is not.
			if (instance && typeof instance.unmount === 'function') {
				timer = setTimer(unload, unloadAfter);
			}
		},
		resume: function () {
			if (gone || !paused) {
				return;
			}
			paused = false;
			stopTimer();
			if (unloaded) {
				start();
			}
			else if (!held) {
				call(instance, 'resume');
			}
			// Held before it was covered, it shows the same picture it was held on.
			armStill();
		},
		// On battery, or not. Held, it moves again as soon as it can be seen.
		setStill: function (on) {
			var want = !!on;
			if (gone || want === still) {
				return;
			}
			still = want;
			if (still) {
				armStill();
				return;
			}
			stopStill();
			if (held) {
				held = false;
				if (!paused) {
					call(instance, 'resume');
				}
			}
		},
		unmount: function () {
			if (gone) {
				return;
			}
			stopTimer();
			stopStill();
			call(instance, 'unmount');
			instance = null;
			gone = true;
			clear(host);
		},
		// Input from the desktop, for a background that takes it. Nothing reaches one that
		// cannot be seen.
		forward: function (event) {
			if (!gone && !paused && !held && instance && typeof instance.forward === 'function') {
				instance.forward(event);
			}
		},
		isPaused: function () {
			return paused;
		},
		isUnloaded: function () {
			return unloaded;
		},
		isHeld: function () {
			return held;
		},
		hasFailed: function () {
			return failed;
		}
	};
}

function resolveGradient (value) {
	if (value && typeof value === 'object' && Array.isArray(value.stops)) {
		return value;
	}
	return PRESETS[value] || PRESETS[DEFAULT_WALLPAPER.value];
}

register('color', {
	mount: function (element, config) {
		element.style.background = typeof config.value === 'string' ? config.value : '#1a1a2e';
	}
});

register('gradient', {
	mount: function (element, config) {
		element.style.background = gradientCss(resolveGradient(config.value));
	}
});

register('image', {
	mount: function (element, config) {
		var fit = (config.options && config.options.fit) || 'cover';
		var url = String(config.value || '');
		// A BrowserFS path is served through the service worker; anything already a URL
		// (data:, blob:, http:) is passed through untouched.
		if (url && url.charAt(0) === '/' && url.indexOf('/__browserfs__') !== 0) {
			url = '/__browserfs__' + url;
		}
		// The fallback colour shows through while the image loads, and stays if the path
		// is wrong -- better than a black screen with no explanation.
		element.style.background = (config.options && config.options.background) || '#12141a';
		if (!url) {
			return;
		}
		element.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
		element.style.backgroundPosition = 'center center';
		element.style.backgroundRepeat = fit === 'tile' ? 'repeat' : 'no-repeat';
		if (fit === 'cover' || fit === 'contain') {
			element.style.backgroundSize = fit;
		}
		else {
			element.style.backgroundSize = 'auto';
		}
	}
});
