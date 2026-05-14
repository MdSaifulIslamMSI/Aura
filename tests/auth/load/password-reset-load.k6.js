import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: Number(__ENV.AUTH_LOAD_VUS || 1),
  iterations: Number(__ENV.AUTH_LOAD_ITERATIONS || 10),
  thresholds: {
    http_req_duration: ['p(95)<2000'],
  },
};

const baseUrl = (__ENV.AUTH_LOAD_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');

export default function () {
  const response = http.post(`${baseUrl}/api/auth/otp/reset-password`, JSON.stringify({
    email: 'unknown@example.test',
    otp: '000000',
    newPassword: 'Reset-Password-123!',
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(response, {
    'reset attempt rejected safely': (res) => [400, 401, 403, 404, 429].includes(res.status),
  });
  sleep(1);
}
