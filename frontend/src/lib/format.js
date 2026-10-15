/** Presentation helpers shared across pages. */

/** Join class names, skipping falsy values. */
export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const fullFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'medium',
});

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  if (!sameYear) return d.toLocaleString();
  return dateTimeFormat.format(d);
}

export function formatFull(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return fullFormat.format(d);
}

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Compact relative time: "just now", "12m ago", "3h ago", "6d ago". */
export function timeAgo(value) {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

/** Human duration between two instants, e.g. "1h 24m". */
export function formatDuration(fromValue, toValue = Date.now()) {
  if (!fromValue) return '—';
  const from = new Date(fromValue).getTime();
  const to = typeof toValue === 'number' ? toValue : new Date(toValue).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return '—';
  const totalMinutes = Math.round((to - from) / 60000);
  if (totalMinutes < 1) return '<1m';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

/** "5 min before the incident" style phrase used by correlation evidence. */
export function minutesLabel(minutes) {
  if (minutes === null || minutes === undefined) return '';
  const m = Math.round(Number(minutes) * 10) / 10;
  if (m < 1) return 'less than a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = Math.round(m % 60);
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

export function initials(name) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

export function shortSha(sha) {
  if (!sha) return null;
  return String(sha).slice(0, 8);
}

export function percent(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

/** Value displayed with an em dash when empty. */
export function orDash(value) {
  if (value === null || value === undefined || value === '') return '—';
  return value;
}
