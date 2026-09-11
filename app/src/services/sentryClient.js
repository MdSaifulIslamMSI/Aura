import { releaseInfo } from '../config/releaseInfo';
import { CLIENT_DIAGNOSTIC_EVENT } from './clientObservability';

const INIT_FLAG = '__AURA_SENTRY_INITIALIZED__';
const BRIDGE_FLAG = '__AURA_SENTRY_BRIDGE_ATTACHED__';

let sentryModule = null;
let initState = { enabled: false, dsnConfigured: false };

const trimValue = (value = '') => (typeof value === 'string' ? value.trim() : '');

const toBool = (value, fallback = true) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const clampSampleRate = (value, fallback = 0.1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
};

export const resolveSentryConfig = (env = import.meta.env, release = releaseInfo) => {
  const dsn = trimValue(env?.VITE_SENTRY_DSN || env?.SENTRY_DSN);
  const mode = String(env?.MODE || '');
  const isTest = mode === 'test' || Boolean(env?.VITEST);
  const enabled = Boolean(dsn)
    && !isTest
    && toBool(env?.VITE_SENTRY_ENABLED, true);
  return {
    dsn,
    dsnConfigured: Boolean(dsn),
    enabled,
    release: trimValue(env?.VITE_SENTRY_RELEASE || release?.id) || 'frontend-unknown',
    environment: trimValue(env?.VITE_SENTRY_ENVIRONMENT || release?.channel) || 'production',
    // Sampled by default: 10% of pageloads/navigations, replay on error only.
    tracesSampleRate: enabled ? clampSampleRate(env?.VITE_SENTRY_TRACES_SAMPLE_RATE, 0.1) : 0,
    replaysOnErrorSampleRate: enabled ? clampSampleRate(env?.VITE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE, 1) : 0,
  };
};

const redactText = (value = '') => String(value || '')
  .replace(/\b(sk_(?:live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._~+/=-]+)\b/g, '[REDACTED]')
  .replace(/([?&](?:access_token|auth|authorization|code|password|refresh_token|secret|session|token|api_key|apikey)=)[^&#\s]+/gi, '$1[REDACTED]');

const buildInitOptions = (config, Sentry) => ({
  dsn: config.dsn,
  release: config.release,
  environment: config.environment,
  integrations: [
    // Pageload + navigation spans (no per-route names without router wiring).
    Sentry.browserTracingIntegration(),
    // Error-only replay; text/media masked by default (payments-safe).
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
  ],
  tracesSampleRate: config.tracesSampleRate,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: config.replaysOnErrorSampleRate,
  sendDefaultPii: false,
  beforeSend: (event) => {
    try {
      if (event.message) event.message = redactText(event.message);
      const exceptionValues = event.exception?.values;
      if (Array.isArray(exceptionValues)) {
        exceptionValues.forEach((entry) => {
          if (entry.value) entry.value = redactText(entry.value);
        });
      }
    } catch {
      // Never let redaction break error reporting.
    }
    return event;
  },
});

const shouldForwardToSentry = (event = {}) => {
  const type = String(event.type || '');
  if (type === 'client.runtime_error') return true;
  if (type === 'api.network_error') return true;
  if (type === 'api.response_error' && Number(event.status || 0) >= 500) return true;
  return false;
};

const forwardDiagnosticToSentry = (event) => {
  if (!initState.enabled || !sentryModule || !shouldForwardToSentry(event)) return;
  try {
    const error = event.error instanceof Error
      ? event.error
      : new Error(redactText(event.error?.message || event.detail || event.type || 'Client error'));
    sentryModule.captureException(error, {
      tags: {
        aura_diagnostic_type: String(event.type || 'unknown'),
        aura_route: String(event.route || '').slice(0, 200),
      },
      extra: {
        requestId: String(event.requestId || ''),
        serverRequestId: String(event.serverRequestId || ''),
        status: event.status,
        url: String(event.url || '').split('?')[0].slice(0, 300),
      },
      level: event.severity === 'warn' ? 'warning' : 'error',
    });
  } catch {
    // Sentry forwarding must never break the app or diagnostics pipeline.
  }
};

const attachDiagnosticBridge = () => {
  if (typeof window === 'undefined' || window[BRIDGE_FLAG]) return;
  window[BRIDGE_FLAG] = true;
  window.addEventListener(CLIENT_DIAGNOSTIC_EVENT, (domEvent) => {
    forwardDiagnosticToSentry(domEvent?.detail || null);
  });
};

export const captureClientException = (error, context = {}) => {
  if (!initState.enabled || !sentryModule) return;
  try {
    sentryModule.captureException(error, { extra: context });
  } catch {
    // No-op: Sentry must never throw into app code.
  }
};

export const isSentryEnabled = () => initState.enabled;

export const resetSentryForTests = () => {
  sentryModule = null;
  initState = { enabled: false, dsnConfigured: false };
  if (typeof window !== 'undefined') {
    delete window[INIT_FLAG];
    delete window[BRIDGE_FLAG];
  }
};

export const initSentry = async (overrides = {}) => {
  if (typeof window !== 'undefined' && window[INIT_FLAG]) return initState;
  const config = { ...resolveSentryConfig(), ...overrides };
  initState = { enabled: false, dsnConfigured: config.dsnConfigured };

  if (!config.enabled) {
    if (typeof window !== 'undefined') window[INIT_FLAG] = true;
    return initState;
  }

  try {
    sentryModule = await import('@sentry/react');
    sentryModule.init(buildInitOptions(config, sentryModule));
    try {
      // Segments Capacitor native-webview issues from mobile-browser ones.
      // Full native-crash symbolication needs @sentry/capacitor + cap sync
      // (deferred: its pinned peer @sentry/react lags this repo's SDK).
      const platform = globalThis.Capacitor?.getPlatform?.() || (globalThis.Capacitor ? 'native' : 'web');
      sentryModule.setTag?.('aura.native_platform', String(platform));
    } catch {
      // Tagging must never break init.
    }
    initState = { enabled: true, dsnConfigured: true };
    if (typeof window !== 'undefined') window[INIT_FLAG] = true;
    attachDiagnosticBridge();
  } catch {
    sentryModule = null;
    initState = { enabled: false, dsnConfigured: config.dsnConfigured };
  }
  return initState;
};

export default initSentry;
