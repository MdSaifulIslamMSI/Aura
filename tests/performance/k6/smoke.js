import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

const hardErrors = new Rate('hard_errors');
const p95Ms = Number(__ENV.PERF_P95_MS || 500);
const errorRate = Number(__ENV.PERF_ERROR_RATE || 0.01);
const baseUrl = String(__ENV.PERF_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const apiBaseUrl = String(__ENV.PERF_API_BASE_URL || baseUrl).replace(/\/+$/, '');

export const options = {
  vus: 2,
  duration: '20s',
  thresholds: {
    http_req_duration: [`p(95)<${p95Ms}`],
    hard_errors: [`rate<${errorRate}`],
  },
};

const endpoints = [
  `${apiBaseUrl}/health`,
  `${baseUrl}/`,
  `${apiBaseUrl}/api/status/public`,
  `${apiBaseUrl}/api/products?limit=1`,
];

export default function () {
  for (const url of endpoints) {
    const res = http.get(url, { tags: { endpoint: url.replace(baseUrl, '') } });
    const missing = res.status === 404;
    hardErrors.add(!missing && (res.status === 0 || res.status >= 500));
    check(res, {
      'reachable or cleanly missing': (response) => response.status > 0 && response.status < 500,
    });
  }
  sleep(1);
}
