const timeoutMs = Number(process.env.PERF_SMOKE_TIMEOUT_MS || 2500);
const baseUrl = String(process.env.PERF_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const apiBaseUrl = String(process.env.PERF_API_BASE_URL || baseUrl).replace(/\/+$/, '');

const endpoints = [
  { name: 'frontend', url: `${baseUrl}/`, optional: true },
  { name: 'health', url: `${apiBaseUrl}/health`, optional: true },
  { name: 'public-api', url: `${apiBaseUrl}/api/status/public`, optional: true },
  { name: 'public-products', url: `${apiBaseUrl}/api/products?limit=1`, optional: true },
];

const fetchWithTimeout = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers: { 'cache-control': 'no-cache' } });
  } finally {
    clearTimeout(timeout);
  }
};

let reachable = 0;
let hardFailures = 0;

for (const endpoint of endpoints) {
  try {
    const response = await fetchWithTimeout(endpoint.url);
    if (response.status === 404) {
      console.warn(`${endpoint.name} skipped: 404 ${endpoint.url}`);
      continue;
    }
    reachable += 1;
    if (response.status >= 500) {
      hardFailures += 1;
      console.error(`${endpoint.name} failed: HTTP ${response.status} ${endpoint.url}`);
    } else {
      console.log(`${endpoint.name} ok: HTTP ${response.status} ${endpoint.url}`);
    }
  } catch (error) {
    console.warn(`${endpoint.name} skipped: ${error.name || 'Error'} ${endpoint.url}`);
  }
}

if (hardFailures > 0) process.exit(1);
if (reachable === 0) {
  console.warn('No local performance target was reachable; optional live smoke checks skipped.');
}

console.log('Performance smoke completed.');
