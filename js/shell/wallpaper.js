// Wallpaper providers.
//
// Not one setting but a registry, so a new background type is a new file rather than an
// edit to the desktop. Phase 1 ships the three that cost nothing (they are CSS); the
// WebGL shader provider registers itself the same way in phase 2, which is why mount()
// gets its own element and why pause()/resume() are part of the contract from the start.
//
// A provider is {mount(element, config), unmount(element), pause(), resume()} -- only
// mount is required.

var providers = {};
var current = null;
var currentHost = null;
var paused = false;

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

export function getConfig () {
	return current ? Object.assign({}, current) : null;
}

export function apply (host, config) {
	var next = normalize(config);

	if (currentHost && current && providers[current.type] && providers[current.type].unmount) {
		providers[current.type].unmount(currentHost);
	}
	if (currentHost && currentHost !== host) {
		currentHost.replaceChildren();
		currentHost.style.cssText = '';
	}

	currentHost = host;
	current = next;
	host.replaceChildren();
	host.style.cssText = '';
	providers[next.type].mount(host, next);

	if (paused) {
		pause();
	}
	return next;
}

// Called when nothing can see the wallpaper: covered by windows, or the tab is hidden.
// The CSS providers ignore it; the shader provider in phase 2 stops its render loop,
// which is the whole point of having these in the contract now.
export function pause () {
	paused = true;
	var provider = current && providers[current.type];
	if (provider && provider.pause) {
		provider.pause();
	}
}

export function resume () {
	paused = false;
	var provider = current && providers[current.type];
	if (provider && provider.resume) {
		provider.resume();
	}
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
		var gradient = resolveGradient(config.value);
		element.style.background = 'linear-gradient(' + gradient.angle + 'deg, ' + gradient.stops.join(', ') + ')';
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
