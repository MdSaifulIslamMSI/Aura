export const STATUS_META = {
  operational: {
    label: 'Operational',
    banner: 'All systems operational',
    detail: "We're not aware of any issues affecting Aura systems.",
    dot: 'bg-emerald-500',
    text: 'text-emerald-800',
    soft: 'bg-emerald-50',
    border: 'border-emerald-300',
    bar: 'bg-emerald-400',
  },
  degraded_performance: {
    label: 'Degraded',
    banner: 'Degraded performance',
    detail: 'Some services are slower than expected.',
    dot: 'bg-amber-400',
    text: 'text-amber-800',
    soft: 'bg-amber-50',
    border: 'border-amber-300',
    bar: 'bg-amber-400',
  },
  degraded: {
    label: 'Degraded',
    banner: 'Degraded performance',
    detail: 'Some services are slower than expected.',
    dot: 'bg-amber-400',
    text: 'text-amber-800',
    soft: 'bg-amber-50',
    border: 'border-amber-300',
    bar: 'bg-amber-400',
  },
  partial_outage: {
    label: 'Partial outage',
    banner: 'Partial outage',
    detail: 'One or more services are unavailable for some users.',
    dot: 'bg-orange-500',
    text: 'text-orange-800',
    soft: 'bg-orange-50',
    border: 'border-orange-300',
    bar: 'bg-orange-400',
  },
  major_outage: {
    label: 'Major outage',
    banner: 'Major outage',
    detail: 'A major service interruption is currently active.',
    dot: 'bg-rose-500',
    text: 'text-rose-800',
    soft: 'bg-rose-50',
    border: 'border-rose-300',
    bar: 'bg-rose-500',
  },
  maintenance: {
    label: 'Maintenance',
    banner: 'Scheduled maintenance',
    detail: 'Maintenance is in progress or scheduled.',
    dot: 'bg-indigo-500',
    text: 'text-indigo-800',
    soft: 'bg-indigo-50',
    border: 'border-indigo-300',
    bar: 'bg-indigo-500',
  },
  unknown: {
    label: 'Unknown',
    banner: 'Unknown',
    detail: 'No status data is available yet.',
    dot: 'bg-slate-300',
    text: 'text-slate-700',
    soft: 'bg-slate-50',
    border: 'border-slate-200',
    bar: 'bg-slate-300',
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
