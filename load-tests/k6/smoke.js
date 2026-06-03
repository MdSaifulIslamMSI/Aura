import http from 'k6/http';
import { sleep } from 'k6';
import { safeBaseUrl, smokeOptions } from './_safe.js';

export const options = { vus: 1, duration: '10s', ...smokeOptions };

export default function () {
  const baseUrl = safeBaseUrl();
  http.get(`${baseUrl}/health/live`);
  http.get(`${baseUrl}/api/status`);
  sleep(1);
}
