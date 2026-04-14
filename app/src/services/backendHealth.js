import { buildServiceUrl, requestWithTrace } from './apiBase';

export const HEALTH_LIVE_URL = buildServiceUrl('/health/live');
const HEALTH_SNAPSHOT_TTL_MS = 10 * 1000;
const DEFAULT_HEALTH_TIMEOUT_MS = 4000;

let cachedSnapshot = null;
let cachedAt = 0;
let inFlightSnapshot = null;

const normalizeLiveHealthPayload = (payload = {}) => {
  const alive = Boolean(payload?.alive);
  const startupHealthy = Boolean(payload?.startup?.asyncStartupHealthy ?? true);
  const status = alive && startupHealthy ? 'ok' : 'degraded';

  return {
    status,
    alive,
    startupHealthy,
    uptime: Number(payload?.uptime || 0),
    timestamp: payload?.timestamp || null,
    topology: payload?.topology || {},
    startup: payload?.startup || {},
  };
};

const shouldReuseSnapshot = (force = false) => (
  !force
  && cachedSnapshot
  && (Date.now() - cachedAt) < HEALTH_SNAPSHOT_TTL_MS
);

export const clearBackendHealthSnapshotCache = () => {
  cachedSnapshot = null;
  cachedAt = 0;
  inFlightSnapshot = null;
};

export const getBackendHealthSnapshot = async (options = {}) => {
  const force = options?.force === true;
  const timeoutMs = Number(options?.timeoutMs || DEFAULT_HEALTH_TIMEOUT_MS);

  if (shouldReuseSnapshot(force)) {
    return cachedSnapshot;
  }

  if (!force && inFlightSnapshot) {
    return inFlightSnapshot;
  }

  const request = requestWithTrace(HEALTH_LIVE_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    timeoutMs,
    retries: 0,
    throwOnHttpError: false,
  })
    .then(async (response) => {
      const payload = await response.json();
      const snapshot = normalizeLiveHealthPayload(payload);
      cachedSnapshot = snapshot;
      cachedAt = Date.now();
      return snapshot;
    })
    .finally(() => {
      inFlightSnapshot = null;
    });

  inFlightSnapshot = request;
  return request;
};
