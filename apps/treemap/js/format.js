const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** i;
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${UNITS[i]}`;
}

export function formatPercent(part, total) {
  if (!total) return '0%';
  const pct = (part / total) * 100;
  if (pct >= 10) return `${pct.toFixed(1)}%`;
  if (pct >= 1) return `${pct.toFixed(2)}%`;
  if (pct >= 0.01) return `${pct.toFixed(3)}%`;
  return '<0.01%';
}

export function truncateLabel(text, maxLen = 24) {
  if (!text || text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

export function fileExtension(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}
