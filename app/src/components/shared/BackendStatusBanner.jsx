import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ServerCrash, WifiOff } from 'lucide-react';
import { useMarket } from '@/context/MarketContext';
import { getBackendHealthSnapshot } from '@/services/backendHealth';
import {
  getBufferedClientDiagnostics,
  getErrorReference,
  subscribeToClientDiagnostics,
} from '@/services/clientObservability';
import { summarizeBackendFailureDetail } from '@/utils/backendFailurePresentation';
import { cn } from '@/lib/utils';

const HEALTH_POLL_INTERVAL_MS = 30000;
const HEALTH_TIMEOUT_MS = 4000;
const SOFT_FAILURE_MAX_ATTEMPTS = 2;
const FAILURE_RECOVERY_RECHECK_MS = 5000;
const DEGRADED_STATUS_THRESHOLD = import.meta.env.MODE === 'test' ? 1 : 3;
const OUTAGE_STATUSES = new Set([0, 500, 502, 503, 504]);
const TRANSIENT_NETWORK_PATTERNS = [
  /failed to fetch/i,
  /request timed out/i,
  /network\s*error/i,
  /load failed/i,
  /connection was closed unexpectedly/i,
  /econnrefused/i,
  /fetch failed/i,
];

const BACKEND_STATUS_BANNER_ENABLED = import.meta.env.VITE_ENABLE_BACKEND_STATUS_BANNER !== 'false';

const isBackendHealthDiagnostic = (event) => {
  const url = String(event?.url || '');
  return url.includes('/health');
};

const resolveRecentDiagnosticReference = () => {
  const recentEvent = [...getBufferedClientDiagnostics()]
    .reverse()
    .find((event) => isBackendHealthDiagnostic(event) && String(event?.requestId || event?.serverRequestId || '').trim());

  return recentEvent?.serverRequestId || recentEvent?.requestId || '';
};

const createUnavailableStatus = ({ reference = '', checkedAt = '', detail = '' } = {}) => ({
  level: 'unavailable',
  titleKey: 'status.banner.unavailableTitle',
  messageKey: 'status.banner.unavailableMessage',
  detail,
  reference,
  checkedAt: checkedAt || new Date().toISOString(),
});

const createWarmingStatus = ({ reference = '', checkedAt = '', detail = '' } = {}) => ({
  level: 'warming',
  titleKey: 'status.banner.warmingTitle',
  messageKey: 'status.banner.warmingMessage',
  detail,
  reference,
  checkedAt: checkedAt || new Date().toISOString(),
});

const createDegradedStatus = ({ reference = '', checkedAt = '', detail = '' } = {}) => ({
  level: 'degraded',
  titleKey: 'status.banner.degradedTitle',
  messageKey: 'status.banner.degradedMessage',
  detail,
  reference,
  checkedAt: checkedAt || new Date().toISOString(),
});

const normalizeDetail = (value = '') => String(value || '').trim();

const isTransientNetworkFailure = (detail = '') => {
  const normalized = normalizeDetail(detail);
  if (!normalized) return false;
  return TRANSIENT_NETWORK_PATTERNS.some((pattern) => pattern.test(normalized));
};

const resolveFailureStatus = ({
  reference = '',
  checkedAt = '',
  detail = '',
  failureCount = 1,
} = {}) => {
  const normalizedDetail = normalizeDetail(detail);
  if (failureCount <= SOFT_FAILURE_MAX_ATTEMPTS) {
    return createWarmingStatus({
      reference,
      checkedAt,
      detail: normalizedDetail || (isTransientNetworkFailure(normalizedDetail)
        ? 'Retrying backend wake-up'
        : 'Rechecking backend health'),
    });
  }

  return createUnavailableStatus({
    reference,
    checkedAt,
    detail: normalizedDetail,
  });
};

const BackendStatusBanner = () => {
  const { formatDateTime, t } = useMarket();
  const [status, setStatus] = useState(null);
  const [isChecking, setIsChecking] = useState(false);
  const failureCountRef = useRef(0);
  const degradedCountRef = useRef(0);

  const clearStatus = useCallback(() => {
    failureCountRef.current = 0;
    degradedCountRef.current = 0;
    setStatus(null);
  }, []);

  const registerFailure = useCallback(({ reference = '', checkedAt = '', detail = '' } = {}) => {
    failureCountRef.current += 1;
    degradedCountRef.current = 0;
    setStatus(resolveFailureStatus({
      reference,
      checkedAt,
      detail,
      failureCount: failureCountRef.current,
    }));
  }, []);

  const runHealthCheck = useCallback(async () => {
    setIsChecking(true);

    try {
      const data = await getBackendHealthSnapshot({
        force: true,
        timeoutMs: HEALTH_TIMEOUT_MS,
      });
      const fallbackReference = resolveRecentDiagnosticReference();
      const detail = summarizeBackendFailureDetail({
        status: data?.status === 'ok' ? 200 : 503,
        detail: data?.startupHealthy === false ? 'startup_unhealthy' : String(data?.status || '').trim(),
      });

      if (data?.status && data.status !== 'ok') {
        degradedCountRef.current += 1;
        failureCountRef.current = 0;

        if (degradedCountRef.current < DEGRADED_STATUS_THRESHOLD) {
          return;
        }

        setStatus(createDegradedStatus({
          reference: fallbackReference,
          detail,
        }));
        return;
      }

      clearStatus();
    } catch (error) {
      registerFailure({
        reference: getErrorReference(error) || resolveRecentDiagnosticReference(),
        detail: error?.message || '',
      });
    } finally {
      setIsChecking(false);
    }
  }, [clearStatus, registerFailure]);

  useEffect(() => {
    if (!BACKEND_STATUS_BANNER_ENABLED) {
      return undefined;
    }

    runHealthCheck();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      runHealthCheck();
    }, HEALTH_POLL_INTERVAL_MS);

    const unsubscribe = subscribeToClientDiagnostics((event) => {
      if (!isBackendHealthDiagnostic(event)) return;

      if (event?.type === 'api.network_error') {
        registerFailure({
          reference: event.serverRequestId || event.requestId || '',
          detail: event?.error?.message || '',
          checkedAt: event?.timestamp,
        });
        return;
      }

      if (event?.type === 'api.response_error' && OUTAGE_STATUSES.has(Number(event.status || 0))) {
        registerFailure({
          reference: event.serverRequestId || event.requestId || '',
          detail: `HTTP ${event.status}`,
          checkedAt: event?.timestamp,
        });
      }
    });

    return () => {
      window.clearInterval(intervalId);
      unsubscribe();
    };
  }, [registerFailure, runHealthCheck]);

  useEffect(() => {
    if (!BACKEND_STATUS_BANNER_ENABLED || !status) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      if (document.visibilityState === 'hidden') return;
      runHealthCheck();
    }, FAILURE_RECOVERY_RECHECK_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [runHealthCheck, status]);

  if (!BACKEND_STATUS_BANNER_ENABLED) {
    return null;
  }

  const checkedAtLabel = useMemo(() => formatDateTime(status?.checkedAt, undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }), [formatDateTime, status?.checkedAt]);

  if (!status) {
    return null;
  }

  const Icon = status.level === 'degraded'
    ? ServerCrash
    : status.level === 'warming'
      ? RefreshCw
      : WifiOff;
  const impactKey = status.level === 'degraded'
    ? 'status.banner.degradedImpact'
    : status.level === 'warming'
      ? 'status.banner.warmingImpact'
      : 'status.banner.unavailableImpact';
  const impactFallback = status.level === 'degraded'
    ? 'Browsing should still work while secure actions catch up.'
    : status.level === 'warming'
      ? 'Please wait a few seconds, then try again.'
      : 'Checkout, account, or support actions may be temporarily unavailable.';

  return (
    <div className="fixed inset-x-3 top-[5.25rem] z-40 sm:inset-x-6">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'mx-auto max-w-5xl rounded-2xl border px-4 py-3 shadow-[0_16px_50px_rgba(2,8,23,0.45)]',
          status.level === 'degraded'
            ? 'border-amber-300/25 bg-amber-500/12'
            : status.level === 'warming'
              ? 'border-cyan-300/25 bg-cyan-400/10'
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
                    : status.level === 'warming'
                      ? 'border-cyan-300/25 bg-cyan-300/12 text-cyan-100'
                    : 'border-neo-rose/25 bg-neo-rose/12 text-neo-rose'
                )}
              >
                <Icon className={cn('h-4.5 w-4.5', status.level === 'warming' && isChecking && 'animate-spin')} />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">
                  {t('status.bannerEyebrow', {}, 'Service Update')}
                </p>
                <h2 className="truncate text-sm font-black text-white sm:text-base">
                  {t(
                    status.titleKey,
                    {},
                    status.level === 'degraded'
                      ? 'Some secure actions may be slower right now'
                      : status.level === 'warming'
                        ? 'Secure services are reconnecting'
                        : "We're reconnecting secure services"
                  )}
                </h2>
              </div>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-slate-200">
              {t(
                status.messageKey,
                {},
                status.level === 'degraded'
                  ? 'Browsing should continue normally, but checkout, account, or support actions may take longer than usual for a moment.'
                  : status.level === 'warming'
                    ? 'A few account and checkout actions may take an extra moment while everything reconnects.'
                    : 'Account, checkout, or support actions are temporarily unavailable. Please try again in a moment.'
              )}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                {t(impactKey, {}, impactFallback)}
              </span>
              {checkedAtLabel ? (
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                  {t('status.bannerCheckedAt', { time: checkedAtLabel }, `Last checked ${checkedAtLabel}`)}
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
              {t('status.bannerRetry', {}, 'Check Again')}
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-black/20 px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-black/30 hover:text-white"
            >
              {t('status.bannerReload', {}, 'Refresh Page')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BackendStatusBanner;
