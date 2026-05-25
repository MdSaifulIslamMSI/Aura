import { apiFetch } from '../apiBase';
import { createIdempotencyKey, getAuthHeader } from './apiUtils';

const LAST_KNOWN_STATUS_KEY = 'aura.status.lastKnownGood';

const persistLastKnownStatus = (payload) => {
  if (typeof window === 'undefined' || !payload) return;
  try {
    window.localStorage.setItem(LAST_KNOWN_STATUS_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      payload,
    }));
  } catch {
    // Status fallback is best effort.
  }
};

const readLastKnownStatus = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_KNOWN_STATUS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.payload ? { ...parsed.payload, fallbackSource: 'localStorage', fallbackSavedAt: parsed.savedAt } : null;
  } catch {
    return null;
  }
};

const loadSnapshotStatus = async () => {
  if (typeof fetch === 'undefined') return null;
  const response = await fetch('/status-snapshot.json', {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload ? { ...payload, fallbackSource: 'snapshot' } : null;
};

export const statusApi = {
  getPublicStatus: async () => {
    try {
      const { data } = await apiFetch('/status/public', { timeoutMs: 8000 });
      persistLastKnownStatus(data);
      return { ...data, fallbackSource: 'live' };
    } catch (liveError) {
      const snapshot = await loadSnapshotStatus().catch(() => null);
      if (snapshot) {
        persistLastKnownStatus(snapshot);
        return snapshot;
      }
      const cached = readLastKnownStatus();
      if (cached) return cached;
      throw liveError;
    }
  },
  getHistory: async (params = {}) => {
    const { data } = await apiFetch('/status/history', { params, timeoutMs: 8000 });
    return data;
  },
  getIncident: async (slug) => {
    const { data } = await apiFetch(`/status/incidents/${encodeURIComponent(String(slug || ''))}`, { timeoutMs: 8000 });
    return data;
  },
  subscribe: async (payload = {}) => {
    const { data } = await apiFetch('/status/subscribe', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: 8000,
    });
    return data;
  },
  unsubscribe: async (token) => {
    const { data } = await apiFetch('/status/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ token }),
      timeoutMs: 8000,
    });
    return data;
  },
  verify: async (token) => {
    const { data } = await apiFetch('/status/subscribe/verify', {
      params: { token },
      timeoutMs: 8000,
    });
    return data;
  },
};

export const adminStatusApi = {
  getDashboard: async () => {
    const headers = await getAuthHeader();
    const { data } = await apiFetch('/admin/status', { headers, timeoutMs: 10000 });
    return data;
  },
  createComponent: async (payload = {}) => {
    const headers = await getAuthHeader();
    const { data } = await apiFetch('/admin/status/components', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': createIdempotencyKey('status-component') },
      body: JSON.stringify(payload),
      timeoutMs: 10000,
    });
    return data;
  },
  updateComponent: async (id, payload = {}) => {
    const headers = await getAuthHeader();
    const { data } = await apiFetch(`/admin/status/components/${encodeURIComponent(String(id))}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(payload),
      timeoutMs: 10000,
    });
    return data;
  },
  createIncident: async (payload = {}) => {
    const headers = await getAuthHeader();
    const { data } = await apiFetch('/admin/status/incidents', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': createIdempotencyKey('status-incident') },
      body: JSON.stringify(payload),
      timeoutMs: 10000,
    });
    return data;
  },
  updateIncident: async (id, payload = {}) => {
    const headers = await getAuthHeader();
    const { data } = await apiFetch(`/admin/status/incidents/${encodeURIComponent(String(id))}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(payload),
      timeoutMs: 10000,
    });
    return data;
  },
  addIncidentUpdate: async (id, payload = {}) => {
    const headers = await getAuthHeader();
    const { data } = await apiFetch(`/admin/status/incidents/${encodeURIComponent(String(id))}/updates`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      timeoutMs: 10000,
    });
    return data;
  },
  resolveIncident: async (id, payload = {}) => {
    const headers = await getAuthHeader();
    const { data } = await apiFetch(`/admin/status/incidents/${encodeURIComponent(String(id))}/resolve`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      timeoutMs: 10000,
    });
    return data;
  },
  createMaintenance: async (payload = {}) => {
    const headers = await getAuthHeader();
    const { data } = await apiFetch('/admin/status/maintenance', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': createIdempotencyKey('status-maintenance') },
      body: JSON.stringify(payload),
      timeoutMs: 10000,
    });
    return data;
  },
  generatePostmortem: async (id, payload = {}) => {
    const headers = await getAuthHeader();
    const { data } = await apiFetch(`/admin/status/incidents/${encodeURIComponent(String(id))}/postmortem`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': createIdempotencyKey('status-postmortem') },
      body: JSON.stringify(payload),
      timeoutMs: 10000,
    });
    return data;
  },
  runMonitor: async () => {
    const headers = await getAuthHeader();
    const { data } = await apiFetch('/admin/status/monitor/run', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      timeoutMs: 15000,
    });
    return data;
  },
  seedDefaults: async (payload = {}) => {
    const headers = await getAuthHeader();
    const { data } = await apiFetch('/admin/status/seed', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      timeoutMs: 15000,
    });
    return data;
  },
  listSubscribers: async () => {
    const headers = await getAuthHeader();
    const { data } = await apiFetch('/admin/status/subscribers', { headers, timeoutMs: 10000 });
    return data;
  },
  listChecks: async (params = {}) => {
    const headers = await getAuthHeader();
    const { data } = await apiFetch('/admin/status/checks', { headers, params, timeoutMs: 10000 });
    return data;
  },
};
