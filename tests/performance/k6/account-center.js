import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

http.setResponseCallback(http.expectedStatuses(200));

const hardErrors = new Rate('account_center_hard_errors');
const baseUrl = String(__ENV.PERF_BASE_URL || '').replace(/\/+$/, '');
const authToken = String(__ENV.PERF_AUTH_TOKEN || '').trim();
const p95Ms = Number(__ENV.PERF_ACCOUNT_P95_MS || 1000);
const errorRate = Number(__ENV.PERF_ERROR_RATE || 0.01);

export const options = {
  scenarios: {
    authenticated_account_center: {
      executor: 'constant-vus',
      vus: 2,
      duration: '45s',
      gracefulStop: '10s',
    },
  },
  thresholds: {
    'http_req_duration{surface:account-center}': [`p(95)<${p95Ms}`],
    account_center_hard_errors: [`rate<${errorRate}`],
  },
};

const endpoints = [
  ['/api/account/summary', 'summary'],
  ['/api/users/profile', 'profile'],
  ['/api/account/preferences', 'preferences'],
  ['/api/account/marketplace', 'marketplace'],
  ['/api/account/sessions?limit=10', 'sessions'],
  ['/api/account/security-activity?limit=10', 'security-activity'],
];

export default function () {
  const [pathname, name] = endpoints[__ITER % endpoints.length];
  const response = http.get(`${baseUrl}${pathname}`, {
    headers: { Authorization: `Bearer ${authToken}` },
    tags: { surface: 'account-center', endpoint: name },
  });
  const ok = response.status === 200;
  hardErrors.add(!ok);
  if (!ok) {
    console.warn(`[account-center-load] endpoint=${name} status=${response.status}`);
  }
  check(response, {
    [`${name} returned 200`]: () => ok,
  });
  sleep(0.75);
}
