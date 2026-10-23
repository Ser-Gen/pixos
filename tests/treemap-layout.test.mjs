// Disk Treemap's picture (apps/treemap): the squarified layout, nested folders, the smallest items
// folded into one block, finding the rect under the pointer, and the renderer's pure parts.
// What it has to get right: every rect inside its box and the box covered, areas in proportion to
// bytes, a folder's children inside it below its header, a folder of 100 000 files costing no more
// rects than the window has room for, and the deepest rect under a point.

import {check, report} from './assert.mjs';

const tree = await import('../apps/treemap/js/tree.js');
const lay = await import('../apps/treemap/js/layout.js');
const render = await import('../apps/treemap/js/render.js');

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

// --- squarify ------------------------------------------------------------------------------------------

function placed(sizes, x, y, w, h) {
	const out = [];
	lay.squarify(sizes, x, y, w, h, (k, rx, ry, rw, rh) => { out[k] = {x: rx, y: ry, w: rw, h: rh}; });
	return out;
}
{
	const sizes = [600, 300, 200, 100, 50, 25, 5];
	const box = {x: 10, y: 20, w: 400, h: 300};
	const rects = placed(sizes, box.x, box.y, box.w, box.h);
	const total = sizes.reduce((a, b) => a + b, 0);
	check('one rect for each size', rects.filter(Boolean).length, sizes.length);
	check('each in proportion to its size', rects.every((r, k) => near(r.w * r.h, (sizes[k] / total) * box.w * box.h, 0.5)), true);
	check('each inside the box', rects.every((r) => r.x >= box.x - 1e-6 && r.y >= box.y - 1e-6 && r.x + r.w <= box.x + box.w + 1e-6 && r.y + r.h <= box.y + box.h + 1e-6), true);
	check('together covering it', near(rects.reduce((a, r) => a + r.w * r.h, 0), box.w * box.h, 0.5), true);
	const overlaps = rects.some((a, i) => rects.some((b, j) => i < j && a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6));
	check('and none overlapping', overlaps, false);
	const worst = Math.max(...rects.map((r) => Math.max(r.w / r.h, r.h / r.w)));
	check('squarish: no rect thinner than 1 to 4 here', worst < 4, true);
	check('the first, largest, at the corner', [rects[0].x, rects[0].y], [10, 20]);
	check('a tall box lays rows across instead', (() => {
		const tall = placed([1, 1], 0, 0, 100, 400);
		return [tall[0].w, tall[0].h, tall[1].y];
	})(), [100, 200, 200]);
	check('nothing to lay out lays out nothing', [placed([], 0, 0, 10, 10).length, placed([1], 0, 0, 0, 10).length, placed([0, 0], 0, 0, 10, 10).length], [0, 0, 0]);
	check('one size fills the box', placed([7], 3, 4, 50, 60), [{x: 3, y: 4, w: 50, h: 60}]);
	check('a box one pixel across still gets its rects, one with no height none', [placed([1], 0, 0, 1, 5).length, placed([1], 0, 0, 5, 1).length, placed([1], 0, 0, 10, 0).length], [1, 1, 0]);
}
{
	// The worked example in Bruls, Huizing and van Wijk's paper: areas 6 6 4 3 2 2 1 in a 6 × 4 box.
	// 6 and 6 make a column 3 wide; 4 and 3 a row 2⅓ high across what is left; then each of 2, 2
	// and 1 is squarer alone than with the next.
	const round = (r) => [r.x, r.y, r.w, r.h].map((v) => Math.round(v * 1e4) / 1e4);
	const paper = [[0, 0, 3, 2], [0, 2, 3, 2], [3, 0, 1.7143, 2.3333], [4.7143, 0, 1.2857, 2.3333],
		[3, 2.3333, 1.2, 1.6667], [4.2, 2.3333, 1.2, 1.6667], [5.4, 2.3333, 0.6, 1.6667]];
	check('the paper\'s example, rect for rect', placed([6, 6, 4, 3, 2, 2, 1], 0, 0, 6, 4).map(round), paper);
	check('and the same at a tenth of the size, where every area is under 1', placed([6, 6, 4, 3, 2, 2, 1], 0, 0, 0.6, 0.4).map(round),
		paper.map((r) => r.map((v) => Math.round(v * 1e3) / 1e4)));
	check('a square box lays its first row as a column', placed([1, 1], 0, 0, 10, 10).map(round), [[0, 0, 10, 5], [0, 5, 10, 5]]);
	// The smaller items' block comes last whatever its size, so a row's largest is not always its
	// first, nor its smallest its last.
	check('a last size larger than the ones before it', placed([10, 1, 1, 30], 0, 0, 40, 10).map(round),
		[[0, 0, 9.5238, 10], [9.5238, 0, 1.9048, 5], [9.5238, 5, 1.9048, 5], [11.4286, 0, 28.5714, 10]]);
	// Where the larger last size would join the row if its smallest or largest were taken to be the
	// one just added or the first: the two 1s make a row, and 25 is the rest.
	check('a row\'s smallest is the smallest in it, wherever it is', placed([1, 1, 25], 0, 0, 3, 7).map(round),
		[[0, 0, 1.5, 0.5185], [1.5, 0, 1.5, 0.5185], [0, 0.5185, 3, 6.4815]]);
	check('and its largest the largest', placed([8, 7, 7, 5, 5, 29], 0, 0, 4, 6).map(round),
		[[0, 0, 2.1333, 1.4754], [2.1333, 0, 1.8667, 1.4754], [0, 1.4754, 1.6471, 1.6721], [1.6471, 1.4754, 1.1765, 1.6721], [2.8235, 1.4754, 1.1765, 1.6721], [0, 3.1475, 4, 2.8525]]);
}

// --- what gets a rect -----------------------------------------------------------------------------------

function folderOf(name, sizes) {
	const root = tree.folder(name);
	sizes.forEach((size, i) => tree.addFile(root, `f${i}.bin`, size));
	return tree.finish(root);
}
{
	const node = folderOf('d', [1000, 500, 10, 5, 1, 1]);
	const all = lay.visibleChildren(node, 100000);
	check('with room, every child gets a rect', [all.items.length, all.rest], [6, null]);
	// Areas as multiples of MIN_AREA per byte (the folder holds 1517): at M/6 a byte, 10 bytes get a
	// rect and 5 do not, and the 7 left over together do.
	const M = lay.MIN_AREA;
	const some = lay.visibleChildren(node, 1517 * M / 6);
	check('without, the ones under MIN_AREA are folded into one block', [some.items.map((k) => k.size), some.rest.size, some.rest.count, some.rest.rest],
		[[1000, 500, 10], 7, 3, true]);
	const crumbs = lay.visibleChildren(node, 1517 * M / 1.5);
	check('more room, more of them get their own; the block is what is left', [crumbs.items.length, crumbs.rest.size], [4, 2]);
	check('and the block itself needs MIN_AREA, or it is left out', lay.visibleChildren(folderOf('e', [1000, 1]), 1001 * M / 2).rest, null);
	check('an empty folder or box has nothing', [lay.visibleChildren(tree.finish(tree.folder('x')), 100), lay.visibleChildren(node, 0), lay.visibleChildren(node, -5)],
		[{items: [], rest: null}, {items: [], rest: null}, {items: [], rest: null}]);
	check('nor does a folder of empty files', lay.visibleChildren(folderOf('z', [0, 0]), 1000), {items: [], rest: null});
	// Exactly MIN_AREA: at one square pixel a byte, a child of MIN_AREA bytes gets its rect, and a
	// block of MIN_AREA bytes is drawn.
	const at = lay.visibleChildren(folderOf('m', [3 * M, M, M / 2, M / 2]), 5 * M);
	check('exactly MIN_AREA is enough, for a child and for the block', [at.items.map((k) => k.size), at.rest && at.rest.size], [[3 * M, M], M]);
	const none = lay.visibleChildren(folderOf('n', [10, 10, 10]), 30 * M / 20);
	check('when even the largest is too small, they are all the one block', [none.items, none.rest.size, none.rest.count], [[], 30, 3]);
	check('a file has nothing', lay.visibleChildren(node.kids[0], 100).items, []);
}

// --- the nested layout -----------------------------------------------------------------------------------

function project() {
	const root = tree.folder('proj');
	const src = tree.childFolder(root, 'src');
	for (let i = 0; i < 8; i++) tree.addFile(src, `m${i}.js`, 4000 - i * 300);
	const assets = tree.childFolder(root, 'assets');
	tree.addFile(assets, 'big.png', 20000);
	tree.addFile(tree.childFolder(assets, 'icons'), 'i.svg', 3000);
	tree.addFile(root, 'README.md', 2000);
	return tree.finish(root);
}
{
	const root = project();
	const W = 800;
	const H = 500;
	const rects = lay.layout(root, W, H);
	const top = rects.top;
	check('the view\'s children are the top level, largest first', Array.from({length: top.count}, (_, i) => rects.node[top.first + i].name), ['src', 'assets', 'README.md']);
	check('and fill the box', near(Array.from({length: top.count}, (_, i) => rects.w[i] * rects.h[i]).reduce((a, b) => a + b, 0), W * H, 2), true);
	check('a folder with room is opened, under a header', [0, 1].map((i) => [rects.header[i], rects.count[i] > 0]), [[1, true], [1, true]]);
	check('a file is not', [rects.header[2], rects.count[2], rects.first[2]], [0, 0, -1]);

	// Every child inside its folder, below the header and inside the padding.
	let inside = true;
	let after = true;
	for (let i = 0; i < rects.n; i++) {
		const p = rects.parent[i];
		if (p < 0) continue;
		if (i <= p) after = false;
		const bx = rects.x[p] + lay.PAD;
		const by = rects.y[p] + lay.HEADER;
		const bw = rects.w[p] - lay.PAD * 2;
		const bh = rects.h[p] - lay.HEADER - lay.PAD;
		if (rects.x[i] < bx - 0.01 || rects.y[i] < by - 0.01 || rects.x[i] + rects.w[i] > bx + bw + 0.01 || rects.y[i] + rects.h[i] > by + bh + 0.01) inside = false;
	}
	check('every child inside its folder, under the header', inside, true);
	check('and written after it', after, true);
	check('depths follow parents', Array.from({length: rects.n}, (_, i) => rects.parent[i] < 0 ? rects.depth[i] === 0 : rects.depth[i] === rects.depth[rects.parent[i]] + 1).every(Boolean), true);
	let ordered = true;
	for (let i = 1; i < rects.n; i++) if (rects.depth[i] < rects.depth[i - 1]) ordered = false;
	check('no rect comes before one shallower (the renderer batches by depth on this)', ordered, true);
	const named = (node, name) => node.kids.find((kid) => kid.name === name);
	const icons = lay.indexOf(rects, named(named(root, 'assets'), 'icons'));
	check('three levels deep where there is room', [icons >= 0, rects.depth[icons], rects.node[rects.first[icons]].name], [true, 1, 'i.svg']);
	check('a node that got no rect is not found; the first is', [lay.indexOf(rects, {}), lay.indexOf(rects, undefined), lay.indexOf(rects, rects.node[0])], [-1, -1, 0]);
	check('the picture starts at the corner', [rects.x[0], rects.y[0]], [0, 0]);

	// Every rect belongs to the rect it is drawn in: its node is that rect's node's child, the rects
	// of one folder are the ones its `first` and `count` name, and they fill the box under its header.
	let belongs = true;
	let counted = true;
	let filled = true;
	const ownerOf = (node) => node.parent;
	for (let i = 0; i < rects.n; i++) {
		const p = rects.parent[i];
		if (ownerOf(rects.node[i]) !== (p < 0 ? root : rects.node[p])) belongs = false;
		if (!rects.header[i]) continue;
		const kids = Array.from({length: rects.n}, (_, j) => j).filter((j) => rects.parent[j] === i);
		if (kids.length !== rects.count[i] || kids[0] !== rects.first[i] || kids.some((j, k) => j !== rects.first[i] + k)) counted = false;
		const area = kids.reduce((a, j) => a + rects.w[j] * rects.h[j], 0);
		if (!near(area, (rects.w[i] - 2 * lay.PAD) * (rects.h[i] - lay.HEADER - lay.PAD), 0.5)) filled = false;
	}
	check('every rect\'s node is a child of its parent rect\'s', belongs, true);
	check('a folder\'s rects are the ones its first and count name', counted, true);
	check('and fill the box under its header', filled, true);
	check('the top-left pixel is the first rect\'s', lay.hitTest(rects, 0, 0), 0);

	// The pointer.
	const svg = rects.first[icons];
	const cx = rects.x[svg] + rects.w[svg] / 2;
	const cy = rects.y[svg] + rects.h[svg] / 2;
	check('the deepest rect under a point', rects.node[lay.hitTest(rects, cx, cy)].name, 'i.svg');
	check('a folder\'s header is the folder', rects.node[lay.hitTest(rects, rects.x[icons] + 4, rects.y[icons] + 4)].name, 'icons');
	check('the top level\'s own header too', rects.node[lay.hitTest(rects, rects.x[0] + 4, rects.y[0] + 4)].name, 'src');
	check('outside the picture is nothing', [lay.hitTest(rects, -1, 10), lay.hitTest(rects, W + 1, 10), lay.hitTest(rects, 10, H)], [-1, -1, -1]);
	check('a rect\'s right and bottom edges belong to the next one', (() => {
		const at = lay.hitTest(rects, rects.x[0] + rects.w[0], rects.y[0] + 4);
		return at !== 0 && at >= 0;
	})(), true);
	check('an empty layout finds nothing', lay.hitTest(lay.layout(null, 10, 10), 1, 1), -1);
}
{
	// A small window: folders too small to open stay one block.
	const rects = lay.layout(project(), 60, 26);
	check('in a small box no folder is opened', Array.from({length: rects.n}, (_, i) => rects.header[i]).every((h) => h === 0), true);
	check('a view with no room or nothing in it lays out nothing', [lay.layout(project(), 0, 100).n, lay.layout(project(), 100, 0).n, lay.layout(project(), -10, -10).n,
		lay.layout(tree.finish(tree.folder('x')), 100, 100).n, lay.layout(tree.file('f', 1, null), 100, 100).n, lay.layout(null, 100, 100).n], [0, 0, 0, 0, 0, 0]);
	// A folder that is the view's only child fills the whole box, so the box is its size.
	const lone = () => {
		const root = tree.folder('r');
		tree.addFile(tree.childFolder(root, 'only'), 'f', 1);
		return tree.finish(root);
	};
	check('a folder exactly OPEN_MIN_W by OPEN_MIN_H is opened, a pixel less either way is not',
		[[lay.OPEN_MIN_W, lay.OPEN_MIN_H], [lay.OPEN_MIN_W - 1, lay.OPEN_MIN_H], [lay.OPEN_MIN_W, lay.OPEN_MIN_H - 1]].map(([w, h]) => lay.layout(lone(), w, h).header[0]),
		[1, 0, 0]);
}
{
	// The point of the culling: 100 000 files in one folder.
	const root = tree.folder('huge');
	// A few large and a long tail, as a disk is: the i-th largest is 1/i of the largest.
	for (let i = 0; i < 100000; i++) tree.addFile(root, `${i}.dat`, Math.floor(1e9 / (i + 1)));
	tree.finish(root);
	const t0 = performance.now();
	const rects = lay.layout(root, 1200, 800);
	const took = performance.now() - t0;
	const rest = rects.node.slice(0, rects.n).filter((n) => n.rest);
	check('100 000 files laid out as no more rects than the window has room for, and more than a handful', [rects.n <= (1200 * 800) / lay.MIN_AREA, rects.n > 1000], [true, true]);
	check('the rest folded into one block, standing for the right number', [rest.length, rest[0].count + rects.n - 1], [1, 100000]);
	check('and the bytes still add up', near(rest[0].size + rects.node.slice(0, rects.n).filter((n) => !n.rest).reduce((a, n) => a + n.size, 0), root.size, 0), true);
	console.log(`         (laid out in ${took.toFixed(1)} ms, ${rects.n} rects)`);
	const deep = tree.folder('d');
	let at = deep;
	for (let i = 0; i < 200; i++) at = tree.childFolder(at, 'x');
	tree.addFile(at, 'f', 1);
	tree.finish(deep);
	check('a chain of 200 folders stops opening at the depth limit, and not before', (() => { const r = lay.layout(deep, 4000, 4000); return Math.max(...r.depth.subarray(0, r.n)); })(), lay.MAX_DEPTH - 1);
}
{
	// The buffers grow past their first guess and keep what was written.
	const root = tree.folder('r');
	for (let i = 0; i < 3000; i++) tree.addFile(root, `${i}`, 1);
	tree.finish(root);
	const rects = lay.layout(root, 2000, 2000);
	check('more rects than the first capacity, all kept', [rects.n, rects.capacity >= rects.n, rects.node[2999].size, rects.w[2999] > 0], [3000, true, 1, true]);
	// Each file a 3 000th of the box: a rect written before the buffers grew and lost or moved in the
	// copy would be the wrong size.
	const share = (2000 * 2000) / 3000;
	check('and every one of them, early or late, the size it was written with', Array.from({length: rects.n}, (_, i) => near(rects.w[i] * rects.h[i], share, 0.5)).every(Boolean), true);
}

// --- the renderer's pure parts -----------------------------------------------------------------------------

{
	const measure = (text) => text.length * 10;
	check('text that fits is left alone', render.fitText(measure, 'hello', 50), 'hello');
	check('text that does not is cut with an ellipsis, as long as fits', render.fitText(measure, 'hello world', 50), 'hell…');
	check('no room is no text', [render.fitText(measure, 'hello', 0), render.fitText(measure, 'hello', 15)], ['', '']);
	// At every width, the longest start that fits with its ellipsis: worked out here one length at a time.
	const text = 'a rather long file name.txt';
	const longest = (max) => {
		if (measure(text) <= max) return text;
		for (let k = text.length - 1; k > 0; k--) if (measure(text.slice(0, k) + '…') <= max) return text.slice(0, k) + '…';
		return '';
	};
	check('at every width from nothing to all of it, the longest start that fits', Array.from({length: 300}, (_, max) => render.fitText(measure, text, max) === longest(max)).every(Boolean), true);
	const file = tree.file('a.png', 1, null);
	check('a file\'s fill is its kind\'s, worked out once', [render.fillOf(file, 3), file.kind], ['hsl(265, 34%, 19%)', 'image']);
	const dir = tree.folder('d');
	check('a folder is shaded by depth, deeper lighter, to a limit', [0, 1, 4, 9].map((d) => render.fillOf(dir, d)),
		[render.THEME.folders[0], render.THEME.folders[1], render.THEME.folders[4], render.THEME.folders[4]]);
	check('the smaller items are hatched', render.fillOf({rest: true, kids: null}, 0), 'rest');
}

process.exit(report('treemap-layout') ? 1 : 0);
