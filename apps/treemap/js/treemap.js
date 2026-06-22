/* global d3 */

export function layoutTreemap(children, width, height) {
  if (!children?.length || width <= 0 || height <= 0) return [];
  if (typeof d3 === 'undefined') return [];

  const total = children.reduce((s, c) => s + c.size, 0);
  if (total <= 0) return [];

  const root = d3.hierarchy({
    children: children.map((child) => ({
      node: child,
      value: Math.max(child.size, 1),
    })),
  })
    .sum((d) => d.value)
    .sort((a, b) => b.value - a.value);

  d3.treemap()
    .size([width, height])
    .paddingInner(1)
    .round(false)(root);

  if (!root.children) return [];

  return root.children.map((d) => ({
    x: d.x0,
    y: d.y0,
    w: d.x1 - d.x0,
    h: d.y1 - d.y0,
    data: d.data.node,
  }));
}
