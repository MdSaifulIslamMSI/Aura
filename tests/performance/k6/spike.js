import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

const hardErrors = new Rate('hard_errors');
const p95Ms = Number(__ENV.PERF_P95_MS || 500) * 3;
const errorRate = Number(__ENV.PERF_ERROR_RATE || 0.01);
const baseUrl = String(__ENV.PERF_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const apiBaseUrl = String(__ENV.PERF_API_BASE_URL || baseUrl).replace(/\/+$/, '');

export const options = {
  stages: [
    { duration: '10s', target: 50 },
    { duration: '20s', target: 50 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: [`p(95)<${p95Ms}`],
    hard_errors: [`rate<${errorRate}`],
  },
};

export default function () {
  const res = http.get(`${apiBaseUrl}/health`);
  hardErrors.add(res.status === 0 || res.status >= 500);
  check(res, {
    'health reachable': (response) => response.status > 0 && response.status < 500,
  });
  sleep(0.2);
}
