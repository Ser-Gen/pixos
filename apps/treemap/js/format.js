const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  if (i === 0) return `${bytes} B`;
  const value = bytes / 1024 ** i;
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${UNITS[i]}`;
}

export function formatPercent(part, total) {
  if (!total || part <= 0) return '0%';
  const pct = (part / total) * 100;
  if (pct >= 10) return `${pct.toFixed(1)}%`;
  if (pct >= 1) return `${pct.toFixed(2)}%`;
  if (pct >= 0.01) return `${pct.toFixed(3)}%`;
  return '<0.01%';
}

const COUNT = new Intl.NumberFormat('en-US');

export function formatCount(n) {
  return COUNT.format(n);
}

export function plural(n, one, many) {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

export function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}
