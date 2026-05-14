import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: Number(__ENV.AUTH_LOAD_VUS || 2),
  duration: __ENV.AUTH_LOAD_DURATION || '30s',
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
  },
};

const baseUrl = (__ENV.AUTH_LOAD_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');

export default function () {
  const response = http.get(`${baseUrl}/health`);
  check(response, {
    'health responds': (res) => res.status >= 200 && res.status < 500,
  });
  sleep(1);
}
