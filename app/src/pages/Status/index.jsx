import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  History,
  Mail,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { statusApi } from '@/services/api/statusApi';
import UptimeBars from './UptimeBars';
import { formatDate, formatPercent, relativeTime, statusMeta } from './statusMeta';

const POLL_MS = 45000;

function StatusBadge({ status }) {
  const meta = statusMeta(status);
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold"
      style={{ backgroundColor: meta.softColor, borderColor: meta.borderColor, color: meta.textColor }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.dotColor }} />
      {meta.label}
    </span>
  );
}

function StatusSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-96 animate-pulse rounded-xl bg-slate-100" />
    </div>
  );
}

function OverallStatusBanner({ status, message }) {
  const meta = statusMeta(status);
  const Icon = status === 'major_outage' || status === 'partial_outage' ? TriangleAlert : Check;
  return (
    <section
      className="overflow-hidden rounded-xl border bg-white shadow-sm"
      aria-labelledby="overall-status-heading"
      style={{ borderColor: meta.borderColor }}
    >
      <div className="flex items-center gap-3 px-5 py-4" style={{ backgroundColor: meta.softColor }}>
        <span className="flex h-6 w-6 items-center justify-center rounded-full text-white" style={{ backgroundColor: meta.dotColor }}>
          <Icon className="h-4 w-4" />
        </span>
        <h1 id="overall-status-heading" className="text-xl font-extrabold tracking-normal" style={{ color: meta.textColor }}>
          {message || meta.banner}
        </h1>
      </div>
      <p className="px-5 py-5 text-base leading-7 text-slate-700">{meta.detail}</p>
    </section>
  );
}

function IncidentStrip({ title, items = [] }) {
  if (!items.length) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-extrabold tracking-normal text-slate-950">{title}</h2>
      <div className="mt-3 space-y-3">
        {items.map((incident) => (
          <Link
            key={incident.id}
            to={`/status/incidents/${incident.slug}`}
            className="block rounded-lg border border-slate-200 p-4 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-bold text-slate-950">{incident.title}</p>
                <p className="mt-1 text-sm text-slate-600">{incident.latestUpdate?.message || incident.description}</p>
              </div>
              <StatusBadge status={incident.impact === 'maintenance' ? 'maintenance' : incident.impact === 'critical' ? 'major_outage' : 'degraded_performance'} />
            </div>
            <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
              Started {formatDate(incident.startedAt, { year: true, time: true })}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function StatusGroupRow({ group, expanded, onToggle }) {
  const meta = statusMeta(group.status);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div className="border-t border-slate-200">
      <div className="flex w-full items-start justify-between gap-3 px-5 py-4 transition hover:bg-slate-50">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onToggle}
            className="flex min-w-0 flex-wrap items-center gap-2 text-left"
            aria-expanded={expanded}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full text-white" style={{ backgroundColor: meta.dotColor }}>
              <Check className="h-3.5 w-3.5" />
            </span>
            <span className="font-bold text-slate-950">{group.name}</span>
            <span className="text-sm text-slate-500">{group.componentsCount} components</span>
            <Chevron className="h-4 w-4 text-slate-400" />
          </button>
          <div className="mt-3">
            <UptimeBars history={group.history90d} label={`${group.name} 90 day uptime`} />
          </div>
        </div>
        <div className="text-right text-sm font-semibold text-slate-500">{formatPercent(group.uptimePercent90d)}</div>
      </div>
      {expanded ? (
        <div className="bg-slate-50 px-5 pb-4">
          <div className="space-y-2 border-l border-slate-200 pl-4">
            {group.components.map((component) => (
              <div key={component.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={component.status} />
                      <p className="font-semibold text-slate-900">{component.name}</p>
                      <p className="text-xs text-slate-500">Checked {relativeTime(component.lastCheckedAt)}</p>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {formatPercent(component.uptimePercent90d)}
                      {component.lastResponseTimeMs ? ` - ${component.lastResponseTimeMs} ms response` : ''}
                    </p>
                  </div>
                  <div className="flex-1" style={{ minWidth: '14rem' }}>
                    <UptimeBars history={component.history90d} compact label={`${component.name} 90 day uptime`} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SystemStatusCard({ groups = [] }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const dateRange = useMemo(() => {
    const firstHistory = groups.find((group) => group.history90d?.length)?.history90d || [];
    if (!firstHistory.length) return 'Last 90 days';
    return `${formatDate(firstHistory[0].date)} - ${formatDate(firstHistory[firstHistory.length - 1].date, { year: true })}`;
  }, [groups]);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="system-status-heading">
      <div className="flex flex-col gap-2 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="system-status-heading" className="text-xl font-extrabold tracking-normal text-slate-950">System status</h2>
          <span className="inline-flex items-center gap-2 text-sm text-slate-500">
            <CalendarDays className="h-4 w-4" />
            {dateRange}
          </span>
        </div>
      </div>
      {groups.length ? groups.map((group) => {
        const isExpanded = expanded.has(group.id);
        return (
          <StatusGroupRow
            key={group.id}
            group={group}
            expanded={isExpanded}
            onToggle={() => {
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(group.id)) next.delete(group.id);
                else next.add(group.id);
                return next;
              });
            }}
          />
        );
      }) : (
        <div className="px-5 py-10 text-center text-slate-500">No public status components are configured.</div>
      )}
    </section>
  );
}

export default function StatusPage() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setRefreshing(true);
      setError('');
      const data = await statusApi.getPublicStatus();
      setPayload(data);
    } catch (err) {
      setError(err.message || 'Unable to load status');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const timer = window.setInterval(() => loadStatus({ silent: true }), POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadStatus]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-14">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link to="/" className="inline-flex items-center gap-3 text-3xl font-extrabold tracking-normal text-slate-950">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-950 text-base font-black text-white">A</span>
            Aura Status
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            {payload?.lastUpdatedAt ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                <Clock3 className="h-3.5 w-3.5" />
                Updated {relativeTime(payload.lastUpdatedAt)}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => loadStatus({ silent: true })}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50"
              aria-label="Refresh status"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <Link
              to="/status/subscribe"
              className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800"
            >
              <Mail className="h-4 w-4" />
              Subscribe to updates
            </Link>
          </div>
        </header>

        {loading ? <StatusSkeleton /> : null}
        {!loading && error ? (
          <section className="rounded-xl border border-slate-200 bg-white p-5 text-slate-700">
            <h1 className="text-lg font-extrabold tracking-normal">Status unavailable</h1>
            <p className="mt-2 text-sm">{error}</p>
          </section>
        ) : null}
        {!loading && payload ? (
          <>
            <OverallStatusBanner status={payload.overallStatus} message={payload.message} />
            <IncidentStrip title="Active incidents" items={payload.activeIncidents || []} />
            <IncidentStrip title="Scheduled maintenance" items={payload.activeMaintenance || []} />
            <SystemStatusCard groups={payload.groups || []} />
            <div className="flex justify-center">
              <Link
                to="/status/history"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-base font-bold text-slate-950 shadow-sm transition hover:bg-slate-50"
              >
                <History className="h-5 w-5" />
                View history
              </Link>
            </div>
          </>
        ) : null}

        <footer className="flex flex-col items-center justify-center gap-2 pb-4 text-sm text-slate-500 sm:flex-row">
          <span>Powered by Aura status</span>
          <span className="hidden sm:inline">-</span>
          <a href="/api/status/rss" className="font-semibold text-slate-700">RSS</a>
        </footer>
      </div>
    </div>
  );
}
