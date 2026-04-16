import { buildServiceUrl, parseJsonSafely, requestWithTrace } from './apiBase';

export const HEALTH_LIVE_URL = buildServiceUrl('/health/live');
export const HEALTH_READY_URL = buildServiceUrl('/health/ready');
const HEALTH_SNAPSHOT_TTL_MS = 10 * 1000;
const DEFAULT_HEALTH_TIMEOUT_MS = 4000;

let cachedSnapshot = null;
let cachedAt = 0;
let inFlightSnapshot = null;

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeLiveHealthPayload = (payload = {}) => {
  if (!isPlainObject(payload)) {
    return null;
  }

  const startup = isPlainObject(payload?.startup) ? payload.startup : {};
  const alive = payload?.alive;
  const ready = payload?.ready;
  const startupHealthy = Boolean(startup?.asyncStartupHealthy ?? true);
  const resolvedAlive = Boolean(alive ?? ready ?? false);
  const status = resolvedAlive && startupHealthy ? 'ok' : 'degraded';

  return {
    status,
    alive: resolvedAlive,
    ready: Boolean(ready ?? resolvedAlive),
    startupHealthy,
    uptime: Number(payload?.uptime || 0),
    timestamp: payload?.timestamp || null,
    topology: isPlainObject(payload?.topology) ? payload.topology : {},
    startup,
  };
};

const fetchHealthSnapshot = async (url, timeoutMs) => {
  const response = await requestWithTrace(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    timeoutMs,
    retries: 0,
    throwOnHttpError: false,
  });
  const payload = await parseJsonSafely(response);
  return normalizeLiveHealthPayload(payload);
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

  const request = (async () => {
    let liveFailure = null;

    try {
      const liveSnapshot = await fetchHealthSnapshot(HEALTH_LIVE_URL, timeoutMs);
      if (liveSnapshot) {
        return liveSnapshot;
      }
    } catch (error) {
      liveFailure = error;
    }

    const readySnapshot = await fetchHealthSnapshot(HEALTH_READY_URL, timeoutMs);
    if (readySnapshot) {
      return readySnapshot;
    }

    throw liveFailure || new Error('Health endpoint returned an invalid payload');
  })()
    .then((snapshot) => {
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
