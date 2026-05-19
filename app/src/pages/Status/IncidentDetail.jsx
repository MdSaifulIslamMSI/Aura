import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, ExternalLink } from 'lucide-react';
import { statusApi } from '@/services/api/statusApi';
import { formatDate, statusMeta } from './statusMeta';

export default function StatusIncidentDetailPage() {
  const { slug } = useParams();
  const [incident, setIncident] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const loadIncident = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await statusApi.getIncident(slug);
      setIncident(data?.incident || null);
    } catch (err) {
      setError(err.message || 'Unable to load incident');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    loadIncident();
  }, [loadIncident]);

  const meta = statusMeta(incident?.impact === 'maintenance' ? 'maintenance' : incident?.impact === 'critical' ? 'major_outage' : incident?.impact === 'major' ? 'partial_outage' : 'degraded');

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-950">
      <div className="mx-auto flex w-full max-w-[820px] flex-col gap-6 px-4 py-10 sm:px-6 md:py-14">
        <Link to="/status/history" className="inline-flex w-fit items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" />
          History
        </Link>
        {loading ? <div className="h-96 animate-pulse rounded-xl bg-slate-100" /> : null}
        {!loading && error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-800">{error}</div> : null}
        {!loading && incident ? (
          <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] ${meta.soft} ${meta.border} ${meta.text}`}>
                  {incident.status}
                </span>
                <h1 className="mt-4 text-3xl font-extrabold tracking-normal text-slate-950">{incident.title}</h1>
                <p className="mt-3 text-base leading-7 text-slate-600">{incident.description}</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard?.writeText(window.location.href);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                }}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                <Copy className="h-4 w-4" />
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>

            <dl className="mt-6 grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-bold text-slate-500">Impact</dt>
                <dd className="mt-1 font-semibold text-slate-950">{incident.impact}</dd>
              </div>
              <div>
                <dt className="font-bold text-slate-500">Started</dt>
                <dd className="mt-1 font-semibold text-slate-950">{formatDate(incident.startedAt, { year: true, time: true })}</dd>
              </div>
              <div>
                <dt className="font-bold text-slate-500">Resolved</dt>
                <dd className="mt-1 font-semibold text-slate-950">{incident.resolvedAt ? formatDate(incident.resolvedAt, { year: true, time: true }) : 'Not resolved'}</dd>
              </div>
              <div>
                <dt className="font-bold text-slate-500">Affected</dt>
                <dd className="mt-1 font-semibold text-slate-950">{incident.affectedComponents?.map((component) => component.name).join(', ') || 'No public components'}</dd>
              </div>
            </dl>

            <section className="mt-7">
              <h2 className="text-xl font-extrabold tracking-normal text-slate-950">Timeline</h2>
              <ol className="mt-4 space-y-4 border-l border-slate-200 pl-5">
                {(incident.timeline || []).map((update, index) => (
                  <li key={`${update.createdAt}-${index}`} className="relative">
                    <span className={`absolute -left-[1.72rem] top-1 h-3 w-3 rounded-full ${statusMeta(update.status === 'resolved' ? 'operational' : incident.impact === 'maintenance' ? 'maintenance' : 'degraded').dot}`} />
                    <div className="rounded-lg border border-slate-200 p-4">
                      <p className="font-bold capitalize text-slate-950">{update.status}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{update.message}</p>
                      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.13em] text-slate-400">{formatDate(update.createdAt, { year: true, time: true })}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {incident.resolutionSummary ? (
              <section className="mt-7 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                <h2 className="font-extrabold tracking-normal">Resolution summary</h2>
                <p className="mt-2 text-sm leading-6">{incident.resolutionSummary}</p>
              </section>
            ) : null}

            <a href={incident.url} className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-slate-950">
              Public URL
              <ExternalLink className="h-4 w-4" />
            </a>
          </article>
        ) : null}
      </div>
    </div>
  );
}
