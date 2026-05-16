#!/usr/bin/env node

const trimTrailingSlash = (value = '') => String(value || '').trim().replace(/\/+$/, '');

const edgeOrigin = trimTrailingSlash(
  process.env.AURA_EDGE_ORIGIN
  || process.env.AURA_PRODUCTION_FRONTEND_ORIGIN
  || process.env.PRODUCTION_FRONTEND_ORIGIN
);

const directOrigin = trimTrailingSlash(
  process.env.AURA_DIRECT_BACKEND_ORIGIN
  || process.env.AURA_BACKEND_ORIGIN
  || process.env.AWS_BACKEND_BASE_URL
);

const timeoutMs = Number(process.env.ORIGIN_PROTECTION_SMOKE_TIMEOUT_MS || 15000);

const checks = [];

const addCheck = (name, ok, detail = {}) => {
  checks.push({ name, ok: Boolean(ok), ...detail });
};

const request = async (origin, path, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${origin}${path}`, {
      redirect: 'manual',
      signal: controller.signal,
      ...options,
      headers: {
        accept: 'application/json',
        ...(options.headers || {}),
      },
    });
    const body = await response.text();
    return {
      status: response.status,
      body,
      headers: Object.fromEntries(response.headers.entries()),
    };
  } finally {
    clearTimeout(timer);
  }
};

if (!edgeOrigin || !directOrigin) {
  console.error(JSON.stringify({
    ok: false,
    error: 'Set AURA_EDGE_ORIGIN and AURA_DIRECT_BACKEND_ORIGIN before running origin protection smoke.',
  }, null, 2));
  process.exit(1);
}

try {
  const edgeStatus = await request(edgeOrigin, '/api/emergency/status');
  addCheck('cloudfront emergency status is reachable', edgeStatus.status === 200, {
    status: edgeStatus.status,
  });
  addCheck('public emergency status does not leak internalReason', !/internalReason/i.test(edgeStatus.body), {
    status: edgeStatus.status,
  });

  const directApi = await request(directOrigin, '/api/emergency/status');
  addCheck('direct backend API is blocked by origin protection', (
    directApi.status === 403 && /ORIGIN_PROTECTION_REQUIRED/.test(directApi.body)
  ), {
    status: directApi.status,
  });

  const directHealth = await request(directOrigin, '/health/live');
  addCheck('direct liveness stays reachable', directHealth.status === 200, {
    status: directHealth.status,
  });

  const edgeAdmin = await request(edgeOrigin, '/api/admin/emergency-controls');
  addCheck('anonymous emergency admin is not accessible through CloudFront', [401, 403].includes(edgeAdmin.status), {
    status: edgeAdmin.status,
  });

  const directStripeWebhook = await request(directOrigin, '/api/payments/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  addCheck('direct payment webhook bypass is signature-gated, not origin-protection blocked', (
    directStripeWebhook.status >= 400
    && !/ORIGIN_PROTECTION_REQUIRED/.test(directStripeWebhook.body)
  ), {
    status: directStripeWebhook.status,
  });

  const ok = checks.every((check) => check.ok);
  console.log(JSON.stringify({
    ok,
    edgeOrigin,
    directOrigin,
    checks,
    timestamp: new Date().toISOString(),
  }, null, 2));

  if (!ok) process.exit(1);
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || String(error),
    checks,
    timestamp: new Date().toISOString(),
  }, null, 2));
  process.exit(1);
}
