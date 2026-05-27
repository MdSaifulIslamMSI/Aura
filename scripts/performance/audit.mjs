import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const requiredFiles = [
  'docs/performance-inventory.md',
  'docs/performance-contract.md',
  'docs/performance-runbook.md',
  'config/environments/performance.example.env',
  'server/performance/cache.js',
  'server/performance/middleware.js',
  'server/performance/otel.js',
  'server/tests/performanceCache.test.js',
  'tests/performance/k6/smoke.js',
  'tests/performance/k6/stress.js',
  'tests/performance/k6/spike.js',
  'infra/performance/nginx/nginx.conf.template',
  'infra/performance/docker-compose.performance.yml',
  'infra/performance/pgbouncer/pgbouncer.ini',
  'infra/performance/pgbouncer/userlist.txt.example',
  'infra/performance/prometheus/prometheus.yml',
  'infra/performance/grafana/dashboards/app-performance.json',
  'infra/performance/otel/collector.yml',
  'scripts/performance/cloudflare-cache-plan.mjs',
  '.github/workflows/performance-smoke.yml',
  '.github/workflows/performance-nightly.yml',
  'lighthouserc.js',
];

const requiredEnvVars = [
  'PERFORMANCE_STACK_ENABLED',
  'REDIS_URL',
  'CACHE_PROVIDER',
  'CACHE_ENABLED',
  'CACHE_DEFAULT_TTL_SECONDS',
  'CACHE_PUBLIC_GET_TTL_SECONDS',
  'CACHE_STALE_WHILE_REVALIDATE_SECONDS',
  'CACHE_MAX_VALUE_BYTES',
  'CACHE_BYPASS_AUTH',
  'CACHE_BYPASS_COOKIE',
  'CACHE_BYPASS_PRIVATE_ROUTES',
  'CACHE_ALLOWED_PATH_PREFIXES',
  'CACHE_DENIED_PATH_PREFIXES',
  'PGBOUNCER_ENABLED',
  'PGBOUNCER_DATABASE_URL',
  'DATABASE_URL',
  'OTEL_ENABLED',
  'OTEL_SERVICE_NAME',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'METRICS_ENABLED',
  'METRICS_PATH',
  'PERF_BASE_URL',
  'PERF_API_BASE_URL',
  'PERF_P95_MS',
  'PERF_ERROR_RATE',
  'LIGHTHOUSE_MIN_PERFORMANCE',
];

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length > 0) {
  console.error('Missing required performance files:');
  missing.forEach((file) => console.error(`- ${file}`));
  process.exit(1);
}

const envExample = fs.readFileSync(path.join(root, 'config/environments/performance.example.env'), 'utf8');
const missingEnv = requiredEnvVars.filter((name) => !new RegExp(`^${name}=`, 'm').test(envExample));
if (missingEnv.length > 0) {
  console.error('Missing required performance env vars:');
  missingEnv.forEach((name) => console.error(`- ${name}`));
  process.exit(1);
}

const cacheSource = fs.readFileSync(path.join(root, 'server/performance/cache.js'), 'utf8');
[
  'authorization',
  'cookie',
  'set-cookie',
  'no-store',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'X-Cache',
].forEach((needle) => {
  if (!cacheSource.toLowerCase().includes(needle.toLowerCase())) {
    console.error(`Cache safety source is missing marker: ${needle}`);
    process.exit(1);
  }
});

console.log('Performance audit passed.');
