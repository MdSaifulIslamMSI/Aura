const p95 = Number(process.env.PERF_P95_MS || 500);
const errorRate = Number(process.env.PERF_ERROR_RATE || 0.01);
const lighthouseMin = Number(process.env.LIGHTHOUSE_MIN_PERFORMANCE || 0.85);

const failures = [];

if (!Number.isFinite(p95) || p95 <= 0) failures.push('PERF_P95_MS must be a positive number');
if (!Number.isFinite(errorRate) || errorRate < 0 || errorRate >= 1) failures.push('PERF_ERROR_RATE must be >= 0 and < 1');
if (!Number.isFinite(lighthouseMin) || lighthouseMin < 0 || lighthouseMin > 1) {
  failures.push('LIGHTHOUSE_MIN_PERFORMANCE must be between 0 and 1');
}

if (failures.length > 0) {
  failures.forEach((failure) => console.error(failure));
  process.exit(1);
}

console.log(`Performance budget config valid: p95<=${p95}ms, errorRate<${errorRate}, lighthouse>=${lighthouseMin}.`);
