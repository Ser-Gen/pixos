// Explorer's pure functions: names, paths, sizes, escaping. Nothing here reads the DOM,
// the filesystem or Explorer's state, which is the point -- this is the first code in this
// app that can be imported and tested without a browser (`tests/explorer-format.test.mjs`).
//
// `path` is a parameter rather than the global it used to close over, because that global
// is the only thing that stood between these functions and a test: in the app it is
// BrowserFS's path module reached through `parent.path`, and in a test it is node's own
// `path.posix`, which answers identically for every input the two callers here give it.

export function createFormat (path) {

	function normalizePath (p) {
		if (!p) return '/';
		var normalized = path.normalize(p);
		if (!normalized.startsWith('/')) {
			normalized = '/' + normalized;
		}
		return normalized;
	}

	function getParentPath (p) {
		if (!p || p === '/') return '/';
		var parentPath = path.dirname(p);
		return parentPath === '.' ? '/' : parentPath;
	}

	function formatSize (size) {
		if (!size) return '0 B';
		var units = ['B', 'KB', 'MB', 'GB'];
		var idx = 0;
		var val = size;
		while (val >= 1024 && idx < units.length - 1) {
			val = val / 1024;
			idx++;
		}
		return val.toFixed(val >= 10 || idx === 0 ? 0 : 1) + ' ' + units[idx];
	}

	function getItemTitle (item) {
		return [
			'Name: ' + item.name,
			'Size: ' + (item.isDirectory ? '-' : formatSize(item.size)),
			'Modified: ' + item.mtime
		].join('\n');
	}

	function escapeHtml (v) {
		return String(v)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function escapeAttr (v) {
		return escapeHtml(v).replace(/`/g, '&#96;');
	}

	function getExt (name) {
		var idx = name.lastIndexOf('.');
		if (idx < 1) return '';
		return name.slice(idx + 1).toLowerCase();
	}

	function getNameByPath (p) {
		return p.split('/').pop();
	}

	function splitNameAndExtension (fileName) {
		var ext = path.extname(fileName);
		var name = ext ? fileName.slice(0, -ext.length) : fileName;
		return {
			name: name,
			ext: ext
		};
	}

	function basenameEnd (name) {
		var text = String(name == null ? '' : name);
		var dot = text.lastIndexOf('.');
		// A leading dot is the whole name of a dotfile, not an extension.
		return dot > 0 ? dot : text.length;
	}

	function isImageExtension (fileName) {
		var imgExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'svg', 'avif', 'tiff', 'tif'];
		var ext = (fileName.split('.').pop() || '').toLowerCase();
		return imgExts.indexOf(ext) !== -1;
	}

	return {
		normalizePath: normalizePath,
		getParentPath: getParentPath,
		formatSize: formatSize,
		getItemTitle: getItemTitle,
		escapeHtml: escapeHtml,
		escapeAttr: escapeAttr,
		getExt: getExt,
		getNameByPath: getNameByPath,
		splitNameAndExtension: splitNameAndExtension,
		basenameEnd: basenameEnd,
		isImageExtension: isImageExtension
	};
}
