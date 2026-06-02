import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CalendarClock, Filter } from 'lucide-react';
import { statusApi } from '@/services/api/statusApi';
import { formatDate, statusMeta } from './statusMeta';
import { FormattedMessage, useIntl } from 'react-intl';

import { StableText } from '@/i18n/StableText';
const FILTERS = [
  { value: 'all', labelMessage: { id: 'status.history.filter.all', defaultMessage: 'All' } },
  { value: 'incidents', labelMessage: { id: 'status.history.filter.incidents', defaultMessage: 'Incidents' } },
  { value: 'maintenance', labelMessage: { id: 'status.history.filter.maintenance', defaultMessage: 'Maintenance' } },
];

function HistoryItem({ incident }) {
  const intl = useIntl();
  const meta = statusMeta(incident.impact === 'maintenance' ? 'maintenance' : incident.impact === 'critical' ? 'major_outage' : incident.impact === 'major' ? 'partial_outage' : 'degraded');
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link to={`/status/incidents/${incident.slug}`} className="text-lg font-extrabold tracking-normal text-slate-950 hover:underline">
            {incident.title}
          </Link>
          <p className="mt-2 text-sm leading-6 text-slate-600">{incident.latestUpdate?.message || incident.description || intl.formatMessage({ id: 'status.history.updatePosted', defaultMessage: 'Status update posted.' })}</p>
        </div>
        <span
          className="inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-widest"
          style={{ backgroundColor: meta.softColor, borderColor: meta.borderColor, color: meta.textColor }}
        >
          {incident.status}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
        <span>{formatDate(incident.startedAt, { year: true })}</span>
        <span>{incident.durationMinutes} min</span>
        <span>{incident.type}</span>
        {incident.affectedComponents?.length ? <span>{incident.affectedComponents.map((component) => component.name).join(', ')}</span> : null}
      </div>
      {incident.timeline?.length ? (
        <ol className="mt-4 space-y-3 border-l border-slate-200 pl-4">
          {incident.timeline.map((update, index) => (
            <li key={`${incident.id}-${index}`}>
              <p className="text-sm font-bold text-slate-900">{update.status}</p>
              <p className="text-sm leading-6 text-slate-600">{update.message}</p>
              <p className="text-xs text-slate-400">{formatDate(update.createdAt, { year: true, time: true })}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </article>
  );
}

export default function StatusHistoryPage() {
  const intl = useIntl();
  const [filter, setFilter] = useState('all');
  const [status, setStatus] = useState('all');
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await statusApi.getHistory({ type: filter, status });
      setPayload(data);
    } catch (err) {
      setError(err.message || 'Unable to load history');
    } finally {
      setLoading(false);
    }
  }, [filter, status]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-14">
        <header className="space-y-5">
          <Link to="/status" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600">
            <ArrowLeft className="h-4 w-4" />
            <FormattedMessage id="status.page.label" defaultMessage="Status" />
          </Link>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-extrabold tracking-normal text-slate-950"><StableText id={"support.jsx.text.incident.history.3356ca32"} defaultMessage={"Incident history"} /></h1>
              <p className="mt-2 text-sm text-slate-500"><StableText id={"support.jsx.text.past.incidents.maintenance.windows.and.resolution.timelines.9ba76518"} defaultMessage={"Past incidents, maintenance windows, and resolution timelines."} /></p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Filter className="h-4 w-4 text-slate-400" />
              {FILTERS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setFilter(item.value)}
                  className={`rounded-lg border px-3 py-2 text-sm font-bold ${filter === item.value ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-700'}`}
                >
                  {intl.formatMessage(item.labelMessage)}
                </button>
              ))}
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
                <option value="all"><StableText id={"common.jsx.text.any.state.54d61e33"} defaultMessage={"Any state"} /></option>
                <option value="investigating">{intl.formatMessage({ id: 'status.incident.state.investigating', defaultMessage: 'Investigating' })}</option>
                <option value="identified">{intl.formatMessage({ id: 'status.incident.state.identified', defaultMessage: 'Identified' })}</option>
                <option value="monitoring">{intl.formatMessage({ id: 'status.incident.state.monitoring', defaultMessage: 'Monitoring' })}</option>
                <option value="resolved">{intl.formatMessage({ id: 'status.incident.state.resolved', defaultMessage: 'Resolved' })}</option>
              </select>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="space-y-3">
            <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : null}
        {!loading && error ? <div className="rounded-xl border border-slate-200 bg-white p-5 text-slate-700">{error}</div> : null}
        {!loading && !error && payload?.incidents?.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <CalendarClock className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-3 font-bold text-slate-900"><StableText id={"common.jsx.text.no.matching.history.a3f8b96c"} defaultMessage={"No matching history"} /></p>
          </div>
        ) : null}
        {!loading && !error && payload?.incidents?.length ? (
          <div className="space-y-4">
            {payload.incidents.map((incident) => <HistoryItem key={incident.id} incident={incident} />)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
