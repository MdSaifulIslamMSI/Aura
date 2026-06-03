import http from 'k6/http';
import { safeBaseUrl, smokeOptions } from './_safe.js';

export const options = { vus: 1, iterations: 2, ...smokeOptions };

export default function () {
  const baseUrl = safeBaseUrl();
  http.post(`${baseUrl}/api/ai/chat`, JSON.stringify({ message: 'status' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
