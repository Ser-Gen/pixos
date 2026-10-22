// A DOM just big enough for the shell's settings pages: elements as plain objects, a document with a
// focus, keydown that bubbles. Installed as `globalThis.document` on import. Not a test of its own.

export function element (tag) {
	const node = {
		tagName: tag.toUpperCase(),
		children: [],
		parent: null,
		attributes: {},
		dataset: {},
		listeners: {},
		className: '',
		textContent: '',
		type: '',
		append (...nodes) {
			nodes.forEach(child => {
				if (typeof child === 'string') {
					node.textContent += child;
					return;
				}
				child.parent = node;
				node.children.push(child);
			});
		},
		replaceChildren () {
			node.children.forEach(child => { child.parent = null; });
			node.children = [];
		},
		remove () {
			if (node.parent) {
				node.parent.children = node.parent.children.filter(child => child !== node);
				node.parent = null;
			}
		},
		contains (other) {
			for (let at = other; at; at = at.parent) {
				if (at === node) {
					return true;
				}
			}
			return false;
		},
		setAttribute (name, value) { node.attributes[name] = String(value); },
		getAttribute (name) { return name in node.attributes ? node.attributes[name] : null; },
		addEventListener (type, fn) { (node.listeners[type] = node.listeners[type] || []).push(fn); },
		focus () { doc.activeElement = node; },
		blur () { if (doc.activeElement === node) { doc.activeElement = doc.body; } },
		click () { if (node.onclick) { node.onclick(); } },
		key (key) {
			const e = {key, prevented: false, stopped: false, preventDefault () { e.prevented = true; }, stopPropagation () { e.stopped = true; }};
			for (let at = node; at; at = at.parent) {
				(at.listeners.keydown || []).forEach(fn => fn(e));
				if (e.stopped) {
					break;
				}
			}
			return e;
		}
	};
	return node;
}

export const doc = {
	head: element('head'),
	body: element('body'),
	activeElement: null,
	createElement: element,
	getElementById: id => doc.head.children.find(node => node.id === id) || null
};
doc.activeElement = doc.body;
globalThis.document = doc;

export const all = (root, test, found = []) => {
	root.children.forEach(child => {
		if (test(child)) {
			found.push(child);
		}
		all(child, test, found);
	});
	return found;
};
export const byClass = (root, name) => all(root, node => node.className.split(' ').includes(name));

