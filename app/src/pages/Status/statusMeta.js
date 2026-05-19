export const STATUS_META = {
  operational: {
    label: 'Operational',
    banner: 'All systems operational',
    detail: "We're not aware of any issues affecting Aura systems.",
    dotColor: '#10b981',
    textColor: '#065f46',
    softColor: '#ecfdf5',
    borderColor: '#6ee7b7',
    barColor: '#34d399',
  },
  degraded_performance: {
    label: 'Degraded',
    banner: 'Degraded performance',
    detail: 'Some services are slower than expected.',
    dotColor: '#f59e0b',
    textColor: '#92400e',
    softColor: '#fffbeb',
    borderColor: '#fcd34d',
    barColor: '#fbbf24',
  },
  degraded: {
    label: 'Degraded',
    banner: 'Degraded performance',
    detail: 'Some services are slower than expected.',
    dotColor: '#f59e0b',
    textColor: '#92400e',
    softColor: '#fffbeb',
    borderColor: '#fcd34d',
    barColor: '#fbbf24',
  },
  partial_outage: {
    label: 'Partial outage',
    banner: 'Partial outage',
    detail: 'One or more services are unavailable for some users.',
    dotColor: '#f97316',
    textColor: '#9a3412',
    softColor: '#fff7ed',
    borderColor: '#fdba74',
    barColor: '#fb923c',
  },
  major_outage: {
    label: 'Major outage',
    banner: 'Major outage',
    detail: 'A major service interruption is currently active.',
    dotColor: '#f43f5e',
    textColor: '#9f1239',
    softColor: '#fff1f2',
    borderColor: '#fda4af',
    barColor: '#f43f5e',
  },
  maintenance: {
    label: 'Maintenance',
    banner: 'Scheduled maintenance',
    detail: 'Maintenance is in progress or scheduled.',
    dotColor: '#6366f1',
    textColor: '#3730a3',
    softColor: '#eef2ff',
    borderColor: '#a5b4fc',
    barColor: '#6366f1',
  },
  unknown: {
    label: 'Unknown',
    banner: 'Unknown',
    detail: 'No status data is available yet.',
    dotColor: '#cbd5e1',
    textColor: '#334155',
    softColor: '#f8fafc',
    borderColor: '#e2e8f0',
    barColor: '#cbd5e1',
  },
};

export const statusMeta = (status) => STATUS_META[status] || STATUS_META.unknown;

export const formatPercent = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'No data';
  return `${numeric.toFixed(numeric >= 99.9 ? 2 : 1)}% uptime`;
};

export const formatDate = (value, options = {}) => {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: options.year ? 'numeric' : undefined,
    hour: options.time ? '2-digit' : undefined,
    minute: options.time ? '2-digit' : undefined,
  }).format(date);
};

export const relativeTime = (value) => {
  if (!value) return 'never';
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (!Number.isFinite(diff)) return 'never';
  const seconds = Math.max(Math.round(diff / 1000), 0);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return formatDate(value, { year: true });
};
