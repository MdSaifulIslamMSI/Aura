import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ServerCrash, WifiOff } from 'lucide-react';
import { buildServiceUrl, requestWithTrace } from '@/services/apiBase';
import {
  getBufferedClientDiagnostics,
  getErrorReference,
  subscribeToClientDiagnostics,
} from '@/services/clientObservability';
import { cn } from '@/lib/utils';

const HEALTH_POLL_INTERVAL_MS = 30000;
const OUTAGE_STATUSES = new Set([0, 500, 502, 503, 504]);

const HEALTH_URL = buildServiceUrl('/health');

const parseJsonSafely = async (response) => {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const isBackendDiagnostic = (event) => {
  const url = String(event?.url || '');
  return url.includes('/api') || url.includes('/health');
};

const resolveRecentDiagnosticReference = () => {
  const recentEvent = [...getBufferedClientDiagnostics()]
    .reverse()
    .find((event) => isBackendDiagnostic(event) && String(event?.requestId || event?.serverRequestId || '').trim());

  return recentEvent?.serverRequestId || recentEvent?.requestId || '';
};

const createUnavailableStatus = ({ reference = '', checkedAt = '', detail = '' } = {}) => ({
  level: 'unavailable',
  title: 'Backend unavailable',
  message: 'The frontend cannot reach a healthy backend right now. Requests are failing before the API responds cleanly.',
  detail,
  reference,
  checkedAt: checkedAt || new Date().toISOString(),
});

const createDegradedStatus = ({ reference = '', checkedAt = '', detail = '' } = {}) => ({
  level: 'degraded',
  title: 'Backend health degraded',
  message: 'The API is responding, but the health endpoint is reporting a degraded or unready state.',
  detail,
  reference,
  checkedAt: checkedAt || new Date().toISOString(),
});

const formatCheckedAt = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const BackendStatusBanner = () => {
  const [status, setStatus] = useState(null);
  const [isChecking, setIsChecking] = useState(false);

  const runHealthCheck = useCallback(async () => {
    setIsChecking(true);

    try {
      const response = await requestWithTrace(HEALTH_URL, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        cache: 'no-store',
        throwOnHttpError: false,
      });
      const data = await parseJsonSafely(response);
      const serverRequestId = response.headers.get('x-request-id')
        || (data && typeof data === 'object' ? String(data.requestId || '') : '');
      const fallbackReference = serverRequestId || resolveRecentDiagnosticReference();
      const detail = typeof data === 'object' && data
        ? String(data.reason || data.status || '')
        : String(data || '').trim();

      if (data && typeof data === 'object' && data.status && data.status !== 'ok') {
        setStatus(createDegradedStatus({
          reference: fallbackReference,
          detail,
        }));
        return;
      }

      if (!response.ok) {
        setStatus(createUnavailableStatus({
          reference: fallbackReference,
          detail,
        }));
        return;
      }

      setStatus(null);
    } catch (error) {
      setStatus(createUnavailableStatus({
        reference: getErrorReference(error) || resolveRecentDiagnosticReference(),
        detail: error?.message || '',
      }));
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    runHealthCheck();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      runHealthCheck();
    }, HEALTH_POLL_INTERVAL_MS);

    const unsubscribe = subscribeToClientDiagnostics((event) => {
      if (!isBackendDiagnostic(event)) return;

      if (event?.type === 'api.network_error') {
        setStatus(createUnavailableStatus({
          reference: event.serverRequestId || event.requestId || '',
          detail: event?.error?.message || '',
          checkedAt: event?.timestamp,
        }));
        return;
      }

      if (event?.type === 'api.response_error' && OUTAGE_STATUSES.has(Number(event.status || 0))) {
        setStatus(createUnavailableStatus({
          reference: event.serverRequestId || event.requestId || '',
          detail: `HTTP ${event.status}`,
          checkedAt: event?.timestamp,
        }));
      }
    });

    return () => {
      window.clearInterval(intervalId);
      unsubscribe();
    };
  }, [runHealthCheck]);

  const checkedAtLabel = useMemo(() => formatCheckedAt(status?.checkedAt), [status?.checkedAt]);

  if (!status) {
    return null;
  }

  const Icon = status.level === 'degraded' ? ServerCrash : WifiOff;

  return (
    <div className="fixed inset-x-3 top-[5.25rem] z-40 sm:inset-x-6">
      <div
        className={cn(
          'mx-auto max-w-5xl rounded-2xl border px-4 py-3 shadow-[0_16px_50px_rgba(2,8,23,0.45)] backdrop-blur-2xl',
          status.level === 'degraded'
            ? 'border-amber-300/25 bg-amber-500/12'
            : 'border-neo-rose/25 bg-neo-rose/12'
        )}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-xl border',
                  status.level === 'degraded'
                    ? 'border-amber-300/25 bg-amber-300/12 text-amber-100'
                    : 'border-neo-rose/25 bg-neo-rose/12 text-neo-rose'
                )}
              >
                <Icon className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">
                  Runtime Status
                </p>
                <h2 className="truncate text-sm font-black text-white sm:text-base">
                  {status.title}
                </h2>
              </div>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-slate-200">
              {status.message}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              {status.reference ? (
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                  Debug Ref {status.reference}
                </span>
              ) : null}
              {status.detail ? (
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                  {status.detail}
                </span>
              ) : null}
              {checkedAtLabel ? (
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                  Checked {checkedAtLabel}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runHealthCheck}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12]"
            >
              <RefreshCw className={cn('h-4 w-4', isChecking && 'animate-spin')} />
              Retry Check
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-black/20 px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-black/30 hover:text-white"
            >
              Reload App
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BackendStatusBanner;
