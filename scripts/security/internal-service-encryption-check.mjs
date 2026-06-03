import path from 'node:path';
import {
  check,
  defaultRepoRoot,
  isMainModule,
  parseReadinessArgs,
  readTextIfExists,
  renderChecksMarkdown,
  repoPath,
  shouldFail,
  summarizeChecks,
  writeReadinessReports,
} from './pqc-readiness-utils.mjs';

export const INTERNAL_SERVICE_REPORT_BASENAME = 'internal-service-encryption-check';

const envFiles = {
  development: 'config/environments/development.example.env',
  staging: 'config/environments/staging.example.env',
  production: 'config/environments/production.example.env',
};

const parseEnvExample = (content) => Object.fromEntries(
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

const schemeOnly = (value) => {
  const match = /^([a-z0-9+.-]+):\/\//i.exec(String(value || ''));
  return match ? `${match[1]}://[redacted]` : '[redacted]';
};

const isLocalOnly = (value) => /(?:localhost|127\.0\.0\.1|mongo:27017|redis:6379)/i.test(String(value || ''));

export const buildInternalServiceEncryptionReport = (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const checks = [];
  const docPath = 'docs/security/internal-service-encryption-readiness.md';
  const doc = readTextIfExists(repoPath(root, docPath));
  const docLower = doc.toLowerCase();

  checks.push(check({
    id: 'repo.doc.internal-service-encryption',
    title: 'Internal service encryption runbook exists',
    status: doc ? 'pass' : 'fail',
    scope: 'repo',
    severity: doc ? 'info' : 'high',
    summary: doc ? `${docPath} exists.` : `${docPath} is missing.`,
    evidence: { file: docPath },
  }));

  for (const required of ['MongoDB', 'Redis', 'DATABASE_URL', 'MONGO_URI', 'REDIS_URL', 'rollback', 'rotation']) {
    checks.push(check({
      id: `repo.doc.mentions.${required.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: `Runbook documents ${required}`,
      status: docLower.includes(required.toLowerCase()) ? 'pass' : 'fail',
      scope: 'repo',
      severity: docLower.includes(required.toLowerCase()) ? 'info' : 'medium',
      summary: docLower.includes(required.toLowerCase()) ? `Runbook covers ${required}.` : `Runbook is missing ${required}.`,
      evidence: { file: docPath },
    }));
  }

  const parsedEnvs = {};
  for (const [name, relativeFile] of Object.entries(envFiles)) {
    const content = readTextIfExists(repoPath(root, relativeFile));
    parsedEnvs[name] = parseEnvExample(content);
    checks.push(check({
      id: `repo.env.${name}`,
      title: `${name} environment example exists`,
      status: content ? 'pass' : 'fail',
      scope: 'repo',
      severity: content ? 'info' : 'high',
      summary: content ? `${relativeFile} exists.` : `${relativeFile} is missing.`,
      evidence: { file: relativeFile },
    }));
  }

  const production = parsedEnvs.production || {};
  for (const key of ['DATABASE_URL', 'MONGO_URI', 'REDIS_URL']) {
    const value = production[key] || '';
    checks.push(check({
      id: `repo.production.${key}.not-local-only`,
      title: `Production ${key} is not local-only`,
      status: value && !isLocalOnly(value) ? 'pass' : 'fail',
      scope: 'repo',
      severity: value && !isLocalOnly(value) ? 'info' : 'high',
      summary: value && !isLocalOnly(value)
        ? `Production ${key} uses a non-local example endpoint (${schemeOnly(value)}).`
        : `Production ${key} must not point at a local-only endpoint.`,
      evidence: { file: envFiles.production, valueShape: schemeOnly(value) },
    }));
  }

  const redisValue = production.REDIS_URL || '';
  checks.push(check({
    id: 'repo.production.redis-private-or-tls',
    title: 'Production Redis is TLS/private-network ready',
    status: /^rediss:\/\//i.test(redisValue) || /private network/i.test(doc) ? 'pass' : 'warning',
    scope: 'repo',
    severity: /^rediss:\/\//i.test(redisValue) || /private network/i.test(doc) ? 'info' : 'medium',
    summary: /^rediss:\/\//i.test(redisValue)
      ? 'Production Redis example uses a TLS scheme.'
      : 'Redis TLS/private-network posture is documented but provider runtime must be verified.',
    evidence: { file: envFiles.production, valueShape: schemeOnly(redisValue) },
  }));

  const mongoValue = production.MONGO_URI || production.DATABASE_URL || '';
  checks.push(check({
    id: 'repo.production.mongo-tls-documented',
    title: 'Production MongoDB TLS posture is documented',
    status: /MongoDB TLS/i.test(doc) || /tls=true/i.test(mongoValue) || /^mongodb\+srv:\/\//i.test(mongoValue) ? 'pass' : 'warning',
    scope: 'repo',
    severity: 'medium',
    summary: 'MongoDB TLS readiness is documented; live provider validation is intentionally out of scope.',
    evidence: { file: docPath, valueShape: schemeOnly(mongoValue) },
  }));

  const summary = summarizeChecks(checks);
  const report = {
    title: 'Internal Service Encryption Readiness',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    summary,
    checks,
    sanitizedConnectionShapes: {
      productionMongo: schemeOnly(mongoValue),
      productionRedis: schemeOnly(redisValue),
    },
    limitations: [
      'This checker validates safe repo shape only and does not open database or cache connections.',
      'Hosted database TLS posture remains provider-dependent until verified in staging.',
      'Connection strings are redacted from reports and console output.',
    ],
  };

  return report;
};

export const renderInternalServiceEncryptionMarkdown = (report) => renderChecksMarkdown(report, [
  '## Sanitized Connection Shapes',
  '',
  `- Production MongoDB: ${report.sanitizedConnectionShapes.productionMongo}`,
  `- Production Redis: ${report.sanitizedConnectionShapes.productionRedis}`,
  '',
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
]);

const main = () => {
  const options = parseReadinessArgs(process.argv.slice(2));
  const report = buildInternalServiceEncryptionReport(options);
  const markdown = renderInternalServiceEncryptionMarkdown(report);
  const written = writeReadinessReports({
    report,
    markdown,
    reportDir: options.reportDir,
    baseName: INTERNAL_SERVICE_REPORT_BASENAME,
    options,
  });
  console.log(`[internal-service-encryption] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) {
  main();
}
