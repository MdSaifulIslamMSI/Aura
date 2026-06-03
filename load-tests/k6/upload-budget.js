import http from 'k6/http';
import { safeBaseUrl, smokeOptions } from './_safe.js';

export const options = { vus: 1, iterations: 2, ...smokeOptions };

export default function () {
  const baseUrl = safeBaseUrl();
  http.post(`${baseUrl}/api/uploads/review`, JSON.stringify({ filename: 'sample.txt' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
