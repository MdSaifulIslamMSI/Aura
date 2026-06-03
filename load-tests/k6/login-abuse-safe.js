import http from 'k6/http';
import { safeBaseUrl, smokeOptions } from './_safe.js';

export const options = { vus: 1, iterations: 3, ...smokeOptions };

export default function () {
  const baseUrl = safeBaseUrl();
  http.post(`${baseUrl}/api/auth/login`, JSON.stringify({ email: 'sample@example.invalid' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
