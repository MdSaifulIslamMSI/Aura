import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Gauge,
  History,
  KeyRound,
  Mail,
  RefreshCw,
  ShieldCheck,
  Terminal,
  TriangleAlert,
} from 'lucide-react';
import { statusApi } from '@/services/api/statusApi';
import UptimeBars from './UptimeBars';
import { formatDate, formatPercent, relativeTime, statusMeta } from './statusMeta';
import { FormattedMessage, useIntl } from 'react-intl';

import { StableText } from '@/i18n/StableText';
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
        <h2 id="overall-status-heading" className="text-xl font-extrabold tracking-normal" style={{ color: meta.textColor }}>
          {message || meta.banner}
        </h2>
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
        {items.map((incident) => {
          const target = incident.type === 'maintenance' && !incident.latestUpdate
            ? '/status'
            : `/status/incidents/${incident.slug}`;
          return (
          <Link
            key={incident.id}
            to={target}
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
              <StableText id={"common.jsx.text.started.e10f130f"} defaultMessage={"Started"} /> {formatDate(incident.startedAt, { year: true, time: true })}
            </p>
          </Link>
          );
        })}
      </div>
    </section>
  );
}

function ResponseTimeSparkline({ values = [] }) {
  const intl = useIntl();
  const safeValues = values.map(Number).filter((value) => Number.isFinite(value) && value >= 0).slice(-30);
  if (safeValues.length < 2) return null;
  const max = Math.max(...safeValues, 1);
  const points = safeValues.map((value, index) => {
    const x = (index / Math.max(safeValues.length - 1, 1)) * 120;
    const y = 32 - ((value / max) * 28);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <div
      className="h-9 w-32"
      aria-label={intl.formatMessage({ id: 'status.responseTimeSparkline.ariaLabel', defaultMessage: 'Response time sparkline' })}
    >
      <svg viewBox="0 0 120 36" role="img" className="h-full w-full overflow-visible">
        <polyline points={points} fill="none" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function StatusPowerCard({ power = null }) {
  if (!power) return null;
  const score = Number(power.score || 0);
  const level = String(power.level || 'unknown').replace(/_/g, ' ');
  const dimensions = Array.isArray(power.dimensions) ? power.dimensions : [];
  const coverage = power.coverage || {};

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="status-power-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase tracking-normal text-slate-600">
            <Gauge className="h-4 w-4" />
            <StableText id={"common.jsx.text.status.power.9676a934"} defaultMessage={"Status power"} />
          </div>
          <h2 id="status-power-heading" className="mt-3 text-xl font-extrabold tracking-normal text-slate-950">
            {score}/100 {level}
          </h2>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            {Number(coverage.groups || 0)} <StableText id={"common.jsx.text.groups.9780c562"} defaultMessage={"groups,"} /> {Number(coverage.components || 0)} <StableText id={"common.jsx.text.components.edf20371"} defaultMessage={"components,"} /> {Number(coverage.healthSignals || 0)} <StableText id={"common.accessibility.jsx.text.health.signals.533914d8"} defaultMessage={"health signals"} />
          </p>
        </div>
        <div className="min-w-[10rem] rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
          <span className="text-3xl font-black leading-none">{score}</span>
          <span className="ml-1 text-sm font-black uppercase tracking-normal">power</span>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(score, 100))}%` }} />
          </div>
        </div>
      </div>
      {dimensions.length ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {dimensions.map((dimension) => (
            <div key={dimension.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-extrabold text-slate-950">{dimension.label}</p>
                <span className="text-sm font-black text-slate-700">{Number(dimension.score || 0)}/100</span>
              </div>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{dimension.detail}</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-slate-950" style={{ width: `${Math.max(0, Math.min(Number(dimension.score || 0), 100))}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function StatusGroupRow({ group, expanded, onToggle }) {
  const intl = useIntl();
  const meta = statusMeta(group.status);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const monitoringText = group.monitoringStartedAt
    ? intl.formatMessage(
      { id: 'status.monitoring.startedAt', defaultMessage: 'Monitoring started {date}' },
      { date: formatDate(group.monitoringStartedAt, { year: true }) },
    )
    : intl.formatMessage({ id: 'status.monitoring.noDataYet', defaultMessage: 'No monitoring data yet' });
  const formatUptimeLabel = (name) => intl.formatMessage(
    { id: 'status.uptime.ninetyDayLabel', defaultMessage: '{name} 90 day uptime' },
    { name },
  );
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
            <span className="text-sm text-slate-500">
              {intl.formatMessage({ id: 'status.components.count', defaultMessage: '{count} components' }, { count: group.componentsCount })}
            </span>
            <Chevron className="h-4 w-4 text-slate-400" />
          </button>
          <p className="mt-1 text-xs font-semibold text-slate-500">{monitoringText}</p>
          <div className="mt-3">
            <UptimeBars history={group.history90d} label={formatUptimeLabel(group.name)} />
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
                      <p className="text-xs text-slate-500"><StableText id={"common.jsx.text.checked.a765e9cb"} defaultMessage={"Checked"} /> {relativeTime(component.lastCheckedAt)}</p>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {formatPercent(component.uptimePercent90d)}
                      {component.lastResponseTimeMs
                        ? intl.formatMessage(
                          { id: 'status.response.msSuffix', defaultMessage: ' - {value} ms response' },
                          { value: component.lastResponseTimeMs },
                        )
                        : ''}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">
                      {component.monitoringStartedAt
                        ? intl.formatMessage(
                          { id: 'status.monitoring.startedAt', defaultMessage: 'Monitoring started {date}' },
                          { date: formatDate(component.monitoringStartedAt, { year: true }) },
                        )
                        : <StableText id={"common.jsx.expression.no.monitoring.data.yet.bcaedfc6"} defaultMessage={"No monitoring data yet"} />}
                    </p>
                  </div>
                  <div className="flex-1" style={{ minWidth: '14rem' }}>
                    <UptimeBars history={component.history90d} compact label={formatUptimeLabel(component.name)} />
                    <div className="mt-2 flex items-center justify-end">
                      <ResponseTimeSparkline values={component.responseTimeSparkline || []} />
                    </div>
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

export function SystemStatusCard({ groups = [], monitoringStartedAt = null, uptimeSinceMonitoringBegan = null }) {
  const intl = useIntl();
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
          <h2 id="system-status-heading" className="text-xl font-extrabold tracking-normal text-slate-950"><StableText id={"common.jsx.text.system.status.d541b0a1"} defaultMessage={"System status"} /></h2>
          <span className="inline-flex items-center gap-2 text-sm text-slate-500">
            <CalendarDays className="h-4 w-4" />
            {dateRange}
          </span>
        </div>
        {monitoringStartedAt ? (
          <p className="text-sm font-semibold text-slate-600">
            <StableText id={"common.jsx.text.monitoring.started.5d1383ef"} defaultMessage={"Monitoring started"} /> {formatDate(monitoringStartedAt, { year: true })}
            {uptimeSinceMonitoringBegan !== null && uptimeSinceMonitoringBegan !== undefined
              ? intl.formatMessage(
                { id: 'status.uptime.sinceMonitoringBeganSuffix', defaultMessage: ' - Uptime since monitoring began: {uptime}' },
                { uptime: formatPercent(uptimeSinceMonitoringBegan) },
              )
              : ''}
          </p>
        ) : null}
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
        <div className="px-5 py-10 text-center text-slate-500"><StableText id={"common.jsx.text.no.public.status.components.are.configured.d7eb3b70"} defaultMessage={"No public status components are configured."} /></div>
      )}
    </section>
  );
}

const harnessStatusToPublicStatus = (status) => {
  switch (status) {
    case 'ready':
      return 'operational';
    case 'partial':
      return 'degraded_performance';
    case 'blocked':
      return 'partial_outage';
    default:
      return 'unknown';
  }
};

function HarnessStatusBadge({ status }) {
  const intl = useIntl();
  const meta = statusMeta(harnessStatusToPublicStatus(status));
  const label = status === 'ready'
    ? intl.formatMessage({ id: 'status.harness.ready', defaultMessage: 'Ready' })
    : status === 'partial'
      ? intl.formatMessage({ id: 'status.harness.partial', defaultMessage: 'Partial' })
      : status === 'blocked'
        ? intl.formatMessage({ id: 'status.harness.blocked', defaultMessage: 'Blocked' })
        : intl.formatMessage({ id: 'status.harness.unknown', defaultMessage: 'Unknown' });
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-black uppercase tracking-normal"
      style={{ backgroundColor: meta.softColor, borderColor: meta.borderColor, color: meta.textColor }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.dotColor }} />
      {label}
    </span>
  );
}

function SecurityProviderTile({ provider }) {
  const missing = Array.isArray(provider.missingEnv) ? provider.missingEnv.slice(0, 5) : [];
  const configuredCount = Array.isArray(provider.configuredEnv) ? provider.configuredEnv.length : 0;

  return (
    <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-normal text-slate-500">{provider.area}</p>
          <h3 className="mt-1 text-base font-extrabold tracking-normal text-slate-950">{provider.name}</h3>
        </div>
        <HarnessStatusBadge status={provider.status} />
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{provider.summary}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
          <KeyRound className="h-3.5 w-3.5" />
          {configuredCount} <StableText id={"common.jsx.text.env.set.59da8b3a"} defaultMessage={"env set"} />
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
          <Gauge className="h-3.5 w-3.5" />
          {Number(provider.readinessPercent || 0)}%
        </span>
      </div>
      {provider.liveAuth ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-black uppercase tracking-normal text-slate-500"><StableText id={"auth.jsx.text.live.auth.67a9883c"} defaultMessage={"Live auth"} /></p>
            <HarnessStatusBadge status={provider.liveAuth.status} />
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-600">{provider.liveAuth.detail}</p>
          {provider.liveAuth.command ? (
            <code className="mt-2 block break-words rounded-md bg-white px-2 py-1.5 text-xs font-bold text-slate-700">
              {provider.liveAuth.command}
            </code>
          ) : null}
        </div>
      ) : null}
      {missing.length ? (
        <div className="mt-4">
          <p className="text-xs font-black uppercase tracking-normal text-slate-500"><StableText id={"common.jsx.text.missing.a7552a40"} defaultMessage={"Missing"} /></p>
          <div className="mt-2 flex flex-wrap gap-2">
            {missing.map((key) => (
              <code key={key} className="rounded-md bg-rose-50 px-2 py-1 text-xs font-bold text-rose-800">
                {key}
              </code>
            ))}
          </div>
        </div>
      ) : null}
      {provider.commands?.length ? (
        <div className="mt-4">
          <p className="text-xs font-black uppercase tracking-normal text-slate-500"><StableText id={"common.jsx.text.cli.d8cfa7cf"} defaultMessage={"CLI"} /></p>
          <div className="mt-2 space-y-2">
            {provider.commands.slice(0, 2).map((command) => (
              <code key={command} className="block break-words rounded-md bg-slate-950 px-2.5 py-2 text-xs font-bold text-white">
                {command}
              </code>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function SecurityControlTile({ control }) {
  const missing = Array.isArray(control.missingEnv) ? control.missingEnv.slice(0, 4) : [];
  return (
    <article className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-normal text-slate-500">{control.category}</p>
          <h3 className="mt-1 text-sm font-extrabold tracking-normal text-slate-950">{control.name}</h3>
        </div>
        <HarnessStatusBadge status={control.status} />
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{control.purpose}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(control.providerIds || []).map((providerId) => (
          <span key={providerId} className="rounded-md bg-white px-2 py-1 text-xs font-bold text-slate-600">
            {providerId}
          </span>
        ))}
      </div>
      {missing.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {missing.map((key) => (
            <code key={key} className="rounded-md bg-white px-2 py-1 text-xs font-bold text-rose-800">
              {key}
            </code>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function SecurityFlowRow({ flow }) {
  return (
    <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <HarnessStatusBadge status={flow.status} />
          <p className="font-bold text-slate-950">{flow.name}</p>
          <span className="text-xs font-bold text-slate-500">{Number(flow.readinessPercent || 0)}%</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(flow.providerIds || []).map((providerId) => (
            <span key={providerId} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
              {providerId}
            </span>
          ))}
        </div>
      </div>
      <code className="max-w-full break-words rounded-md bg-slate-950 px-3 py-2 text-xs font-bold text-white">
        {flow.command}
      </code>
    </div>
  );
}

export function SecurityHarnessCard({ harness = null }) {
  if (!harness?.enabled) return null;
  const meta = statusMeta(harness.overallStatus);
  const providers = Array.isArray(harness.providers) ? harness.providers : [];
  const controls = Array.isArray(harness.controls) ? harness.controls : [];
  const gatedFlows = Array.isArray(harness.gatedFlows) ? harness.gatedFlows : [];
  const nextActions = Array.isArray(harness.nextActions) ? harness.nextActions : [];
  const missingPreview = Array.isArray(harness.missingEnv) ? harness.missingEnv.slice(0, 8) : [];

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="security-harness-heading">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase tracking-normal text-slate-600">
              <ShieldCheck className="h-4 w-4" /><FormattedMessage id="account.security.jsx.text.security.harness" defaultMessage="Security harness" /></div>
            <h2 id="security-harness-heading" className="mt-3 text-xl font-extrabold tracking-normal text-slate-950">
              <StableText id={"common.jsx.text.student.pack.command.matrix.6ce5d29d"} defaultMessage={"Student Pack command matrix"} />
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              <StableText id={"common.jsx.text.sentry.datadog.doppler.testmail.lambdatest.and.localstack.8c9720ae"} defaultMessage={"Sentry, Datadog, Doppler, Testmail, LambdaTest, and LocalStack readiness for this Aura workspace."} />
            </p>
          </div>
          <div
            className="flex min-w-[9rem] flex-col items-start rounded-lg border px-4 py-3 sm:items-end"
            style={{ backgroundColor: meta.softColor, borderColor: meta.borderColor, color: meta.textColor }}
          >
            <span className="text-3xl font-black leading-none">{Number(harness.readinessPercent || 0)}%</span>
            <span className="mt-1 text-xs font-black uppercase tracking-normal"><StableText id={"common.jsx.text.harness.ready.8275fff8"} defaultMessage={"Harness ready"} /></span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">
            {Number(harness.readyProviders || 0)} ready
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">
            {Number(harness.partialProviders || 0)} partial
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-800">
            {Number(harness.blockedProviders || 0)} blocked
          </span>
          {harness.updatedAt ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
              <Clock3 className="h-3.5 w-3.5" />
              {relativeTime(harness.updatedAt)}
            </span>
          ) : null}
          {harness.liveAuth?.available ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
              <Terminal className="h-3.5 w-3.5" />
              <StableText id={"auth.jsx.text.live.auth.67a9883c"} defaultMessage={"Live auth"} /> {relativeTime(harness.liveAuth.generatedAt)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="grid gap-3 p-5 md:grid-cols-2">
        {providers.map((provider) => <SecurityProviderTile key={provider.id} provider={provider} />)}
      </div>
      {controls.length ? (
        <div className="border-t border-slate-200 px-5 py-4">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-black uppercase tracking-normal text-slate-500"><StableText id={"common.jsx.text.advanced.controls.037c1ff0"} defaultMessage={"Advanced controls"} /></p>
            <h3 className="text-lg font-extrabold tracking-normal text-slate-950"><FormattedMessage id="account.security.jsx.text.security.control.coverage" defaultMessage="Security control coverage" /></h3>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {controls.map((control) => <SecurityControlTile key={control.id} control={control} />)}
          </div>
        </div>
      ) : null}
      {gatedFlows.length ? (
        <div className="border-t border-slate-200">
          <div className="px-5 py-4">
            <p className="text-xs font-black uppercase tracking-normal text-slate-500"><StableText id={"common.jsx.text.gated.flows.ae8d462c"} defaultMessage={"Gated flows"} /></p>
            <h3 className="text-lg font-extrabold tracking-normal text-slate-950"><StableText id={"common.jsx.text.what.can.be.verified.now.bf834b85"} defaultMessage={"What can be verified now"} /></h3>
          </div>
          {gatedFlows.map((flow) => <SecurityFlowRow key={flow.id} flow={flow} />)}
        </div>
      ) : null}
      {nextActions.length ? (
        <div className="border-t border-slate-200 px-5 py-4">
          <p className="text-xs font-black uppercase tracking-normal text-slate-500"><StableText id={"common.jsx.text.next.actions.009c0d35"} defaultMessage={"Next actions"} /></p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {nextActions.map((action) => (
              <div key={action.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-extrabold text-slate-950">{action.title}</p>
                  <HarnessStatusBadge status={action.status} />
                </div>
                {action.missingEnv?.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {action.missingEnv.map((key) => (
                      <code key={key} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                        {key}
                      </code>
                    ))}
                  </div>
                ) : null}
                <code className="mt-3 block break-words rounded-md bg-slate-950 px-2.5 py-2 text-xs font-bold text-white">
                  {action.command}
                </code>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {missingPreview.length ? (
        <div className="border-t border-slate-200 px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-normal text-slate-500"><StableText id={"common.jsx.text.next.unlocks.763d6c50"} defaultMessage={"Next unlocks"} /></p>
              <div className="mt-2 flex flex-wrap gap-2">
                {missingPreview.map((key) => (
                  <code key={key} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                    {key}
                  </code>
                ))}
              </div>
            </div>
            <code className="inline-flex max-w-full items-center gap-2 break-words rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white">
              <Terminal className="h-4 w-4 shrink-0" />
              <StableText id={"common.jsx.text.npm.run.student.pack.doctor.577acd82"} defaultMessage={"npm run student-pack:doctor"} />
            </code>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function StatusPage() {
  const intl = useIntl();
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
          <h1 className="text-3xl font-extrabold tracking-normal text-slate-950">
            <Link to="/" className="inline-flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-950 text-base font-black text-white">A</span>
              <StableText id={"common.jsx.text.aura.status.e81a8e71"} defaultMessage={"Aura Status"} />
            </Link>
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            {payload?.lastUpdatedAt ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                <Clock3 className="h-3.5 w-3.5" />
                Updated {relativeTime(payload.lastUpdatedAt)}
              </span>
            ) : null}
            {payload?.fallbackSource && payload.fallbackSource !== 'live' ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800">
                <StableText id={"common.jsx.text.last.known.status.1d47edef"} defaultMessage={"Last known status"} />
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => loadStatus({ silent: true })}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50"
              aria-label={intl.formatMessage({ id: 'status.refresh.ariaLabel', defaultMessage: 'Refresh status' })}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <Link
              to="/status/subscribe"
              className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800"
            >
              <Mail className="h-4 w-4" />
              <StableText id={"common.jsx.text.subscribe.to.updates.a5bfc6e3"} defaultMessage={"Subscribe to updates"} />
            </Link>
          </div>
        </header>

        {loading ? <StatusSkeleton /> : null}
        {!loading && error ? (
          <section className="rounded-xl border border-slate-200 bg-white p-5 text-slate-700">
            <h1 className="text-lg font-extrabold tracking-normal"><StableText id={"common.jsx.text.status.unavailable.22bb4dd1"} defaultMessage={"Status unavailable"} /></h1>
            <p className="mt-2 text-sm">{error}</p>
          </section>
        ) : null}
        {!loading && payload ? (
          <>
            <OverallStatusBanner status={payload.overallStatus} message={payload.message} />
            <IncidentStrip title={<FormattedMessage id="status.incidents.active" defaultMessage="Active incidents" />} items={payload.activeIncidents || []} />
            <IncidentStrip
              title={intl.formatMessage({ id: 'status.scheduledMaintenance.title', defaultMessage: 'Scheduled maintenance' })}
              items={payload.activeMaintenance || []}
            />
            <StatusPowerCard power={payload.statusPower} />
            <SecurityHarnessCard harness={payload.securityHarness} />
            <SystemStatusCard
              groups={payload.groups || []}
              monitoringStartedAt={payload.monitoringStartedAt}
              uptimeSinceMonitoringBegan={payload.uptimeSinceMonitoringBegan}
            />
            <div className="flex justify-center">
              <Link
                to="/status/history"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-base font-bold text-slate-950 shadow-sm transition hover:bg-slate-50"
              >
                <History className="h-5 w-5" />
                <StableText id={"common.jsx.text.view.history.74a3ac4e"} defaultMessage={"View history"} />
              </Link>
            </div>
          </>
        ) : null}

        <footer className="flex flex-col items-center justify-center gap-2 pb-4 text-sm text-slate-500 sm:flex-row">
          <span><StableText id={"common.jsx.text.powered.by.aura.status.9f496e1b"} defaultMessage={"Powered by Aura status"} /></span>
          <span className="hidden sm:inline">-</span>
          <a href="/api/status/rss.xml" className="font-semibold text-slate-700"><StableText id={"common.jsx.text.rss.343bc2b9"} defaultMessage={"RSS"} /></a>
        </footer>
      </div>
    </div>
  );
}
