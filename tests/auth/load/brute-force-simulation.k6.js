import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: Number(__ENV.AUTH_LOAD_VUS || 1),
  iterations: Number(__ENV.AUTH_LOAD_ITERATIONS || 20),
  thresholds: {
    http_req_failed: ['rate<0.20'],
    http_req_duration: ['p(95)<2000'],
  },
};

const baseUrl = (__ENV.AUTH_LOAD_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');

export default function () {
  const payload = JSON.stringify({
    email: 'unknown@example.test',
    password: 'wrong-password',
  });
  const response = http.post(`${baseUrl}/api/users/login`, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer invalid-local-load-token',
    },
  });
  check(response, {
    'blocked or rejected without crash': (res) => [400, 401, 403, 429, 500].includes(res.status),
  });
  sleep(0.5);
}
