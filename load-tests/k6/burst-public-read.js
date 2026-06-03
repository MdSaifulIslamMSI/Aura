import http from 'k6/http';
import { sleep } from 'k6';
import { safeBaseUrl, smokeOptions } from './_safe.js';

export const options = { vus: 5, duration: '20s', ...smokeOptions };

export default function () {
  const baseUrl = safeBaseUrl();
  http.get(`${baseUrl}/api/products?limit=20`);
  sleep(0.5);
}
