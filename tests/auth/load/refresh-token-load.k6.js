import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: Number(__ENV.AUTH_LOAD_VUS || 1),
  duration: __ENV.AUTH_LOAD_DURATION || '20s',
  thresholds: {
    http_req_duration: ['p(95)<1500'],
  },
};

const baseUrl = (__ENV.AUTH_LOAD_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');

export default function () {
  const response = http.get(`${baseUrl}/api/auth/session`, {
    headers: {
      Authorization: 'Bearer invalid-local-load-token',
    },
  });
  check(response, {
    'invalid session rejected or challenged': (res) => [401, 403].includes(res.status),
  });
  sleep(1);
}
