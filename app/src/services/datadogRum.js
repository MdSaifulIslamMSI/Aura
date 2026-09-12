import { releaseInfo } from '../config/releaseInfo';
import { CLIENT_DIAGNOSTIC_EVENT } from './clientObservability';

const INIT_FLAG = '__AURA_DATADOG_RUM_INITIALIZED__';
const BRIDGE_FLAG = '__AURA_DATADOG_RUM_BRIDGE_ATTACHED__';
const SCRIPT_ID = 'aura-datadog-rum';

let initState = { enabled: false, configured: false };

const trimValue = (value = '') => (typeof value === 'string' ? value.trim() : '');

const toBool = (value, fallback = true) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const clampSampleRate = (value, fallback = 10) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, parsed));
};

// Official browser-agent CDN hosts per Datadog site (v5 bundle).
const CDN_HOSTS = {
  'datadoghq.com': 'https://www.datadoghq-browser-agent.com/us1/v5/datadog-rum.js',
  'us1.datadoghq.com': 'https://www.datadoghq-browser-agent.com/us1/v5/datadog-rum.js',
  'us3.datadoghq.com': 'https://www.datadoghq-browser-agent.com/us3/v5/datadog-rum.js',
  'us5.datadoghq.com': 'https://www.datadoghq-browser-agent.com/us5/v5/datadog-rum.js',
  'datadoghq.eu': 'https://www.datadoghq-browser-agent.com/eu1/v5/datadog-rum.js',
  'eu1.datadoghq.eu': 'https://www.datadoghq-browser-agent.com/eu1/v5/datadog-rum.js',
  'ap1.datadoghq.com': 'https://www.datadoghq-browser-agent.com/ap1/v5/datadog-rum.js',
  'ap2.datadoghq.com': 'https://www.datadoghq-browser-agent.com/ap2/v5/datadog-rum.js',
  'ddog-gov.com': 'https://www.datadoghq-browser-agent.com/ddog-gov/v5/datadog-rum.js',
};

export const datadogRumCdnUrl = (site = 'datadoghq.com') => (
  CDN_HOSTS[String(site || '').trim().toLowerCase()] || CDN_HOSTS['datadoghq.com']
);

export const resolveDatadogRumConfig = (env = import.meta.env, release = releaseInfo) => {
  const applicationId = trimValue(env?.VITE_DD_APPLICATION_ID);
  const clientToken = trimValue(env?.VITE_DD_CLIENT_TOKEN);
  const mode = String(env?.MODE || '');
  const isTest = mode === 'test' || Boolean(env?.VITEST);
  const enabled = Boolean(applicationId && clientToken)
    && !isTest
    && toBool(env?.VITE_DD_ENABLED, true);
  return {
    applicationId,
    clientToken,
    configured: Boolean(applicationId && clientToken),
    enabled,
    site: trimValue(env?.VITE_DD_SITE) || 'datadoghq.com',
    service: trimValue(env?.VITE_DD_SERVICE) || 'aura-marketplace-frontend',
    env: trimValue(env?.VITE_DD_ENV || release?.channel) || 'production',
    version: trimValue(env?.VITE_DD_VERSION || release?.id) || 'frontend-unknown',
    // Cost-conscious defaults: 10% of sessions, 20% replay. Override per env.
    sessionSampleRate: enabled ? clampSampleRate(env?.VITE_DD_SESSION_SAMPLE_RATE, 10) : 0,
    sessionReplaySampleRate: enabled ? clampSampleRate(env?.VITE_DD_SESSION_REPLAY_SAMPLE_RATE, 20) : 0,
    trackUserInteractions: enabled ? toBool(env?.VITE_DD_TRACK_INTERACTIONS, true) : false,
  };
};

const redactText = (value = '') => String(value || '')
  .replace(/\b(sk_(?:live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._~+/=-]+)\b/g, '[REDACTED]')
  .replace(/([?&](?:access_token|auth|authorization|code|password|refresh_token|secret|session|token|api_key|apikey)=)[^&#\s]+/gi, '$1[REDACTED]');

const buildRumInitOptions = (config) => ({
  applicationId: config.applicationId,
  clientToken: config.clientToken,
  site: config.site,
  service: config.service,
  env: config.env,
  version: config.version,
  sessionSampleRate: config.sessionSampleRate,
  sessionReplaySampleRate: config.sessionReplaySampleRate,
  trackUserInteractions: config.trackUserInteractions,
  trackResources: true,
  trackLongTasks: true,
  // Payments-safe: mask all input text and block media in replays.
  defaultPrivacyLevel: 'mask',
});

const loadRumScript = (src) => new Promise((resolve, reject) => {
  if (typeof document === 'undefined') {
    reject(new Error('No document available for RUM script injection.'));
    return;
  }
  if (document.getElementById(SCRIPT_ID)) {
    resolve();
    return;
  }
  const script = document.createElement('script');
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = src;
  script.onload = () => resolve();
  script.onerror = () => reject(new Error('Datadog RUM CDN script failed to load.'));
  document.head.appendChild(script);
});

const getRumGlobal = () => {
  if (typeof window === 'undefined') return null;
  return window.DD_RUM || null;
};

const forwardDiagnosticToRum = (detail) => {
  const rum = getRumGlobal();
  if (!initState.enabled || !rum?.addError) return;
  try {
    const event = detail || {};
    const error = event.error instanceof Error
      ? event.error
      : new Error(redactText(event.error?.message || event.detail || event.type || 'Client error'));
    rum.addError(error, {
      aura_diagnostic_type: String(event.type || 'unknown'),
      aura_route: String(event.route || '').slice(0, 200),
      request_id: String(event.requestId || ''),
      url: String(event.url || '').split('?')[0].slice(0, 300),
    });
  } catch {
    // RUM forwarding must never break the app or diagnostics pipeline.
  }
};

const attachDiagnosticBridge = () => {
  if (typeof window === 'undefined' || window[BRIDGE_FLAG]) return;
  window[BRIDGE_FLAG] = true;
  window.addEventListener(CLIENT_DIAGNOSTIC_EVENT, (domEvent) => {
    forwardDiagnosticToRum(domEvent?.detail || null);
  });
};

export const captureRumError = (error, context = {}) => {
  const rum = getRumGlobal();
  if (!initState.enabled || !rum?.addError) return;
  try {
    rum.addError(error, context);
  } catch {
    // No-op: RUM must never throw into app code.
  }
};

export const isDatadogRumEnabled = () => initState.enabled;

export const resetDatadogRumForTests = () => {
  initState = { enabled: false, configured: false };
  if (typeof window !== 'undefined') {
    delete window[INIT_FLAG];
    delete window[BRIDGE_FLAG];
  }
  if (typeof document !== 'undefined') {
    document.getElementById(SCRIPT_ID)?.remove();
  }
};

export const initDatadogRum = async (overrides = {}) => {
  if (typeof window !== 'undefined' && window[INIT_FLAG]) return initState;
  const config = { ...resolveDatadogRumConfig(), ...overrides };
  initState = { enabled: false, configured: config.configured };

  if (!config.enabled) {
    if (typeof window !== 'undefined') window[INIT_FLAG] = true;
    return initState;
  }

  try {
    // Official CDN bundle: zero npm dep, zero app-bundle impact. Fail-open.
    await loadRumScript(datadogRumCdnUrl(config.site));
    const rum = getRumGlobal();
    if (!rum?.init) throw new Error('Datadog RUM global missing after script load.');
    rum.init(buildRumInitOptions(config));
    initState = { enabled: true, configured: true };
    if (typeof window !== 'undefined') window[INIT_FLAG] = true;
    attachDiagnosticBridge();
  } catch {
    initState = { enabled: false, configured: config.configured };
  }
  return initState;
};

export default initDatadogRum;
