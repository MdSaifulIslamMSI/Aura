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
export const INTERNAL_SERVICE_EVIDENCE_REPORT_BASENAME = 'internal-service-encryption-evidence';

const disabledModes = new Set(['', '0', 'false', 'off', 'disabled', 'skip', 'skipped']);

const readArgValue = (argv, name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : '';
};

const parseInternalServiceArgs = (argv) => ({
  ...parseReadinessArgs(argv),
  internalEvidenceMode: readArgValue(argv, '--internal-evidence-mode') || readArgValue(argv, '--mode'),
  internalEnvFile: readArgValue(argv, '--env-file'),
});

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

const mergeRuntimeEnv = (root, options, env) => {
  if (options.internalEnvFile) {
    return {
      ...env,
      ...parseEnvExample(readTextIfExists(path.isAbsolute(options.internalEnvFile)
        ? options.internalEnvFile
        : repoPath(root, options.internalEnvFile))),
    };
  }
  return env;
};

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

export const buildInternalServiceEncryptionEvidenceReport = (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const env = mergeRuntimeEnv(root, options, options.env || process.env);
  const checks = [];
  const mode = String(
    options.internalEvidenceMode
    || env.PQC_INTERNAL_EVIDENCE_MODE
    || env.PQC_ENV_PROOF_MODE
    || 'disabled',
  ).trim().toLowerCase();
  const enabled = !disabledModes.has(mode);
  const docPath = 'docs/security/internal-service-encryption-readiness.md';
  const doc = readTextIfExists(repoPath(root, docPath));
  const databaseValue = env.DATABASE_URL || env.MONGO_URI || '';
  const mongoValue = env.MONGO_URI || env.DATABASE_URL || '';
  const redisValue = env.REDIS_URL || '';
  const privateNetworkDocumented = /private network/i.test(doc);

  checks.push(check({
    id: 'internal.environment-proof.mode',
    title: 'Internal service evidence mode is explicit',
    status: enabled ? 'pass' : 'skipped',
    scope: 'system',
    severity: enabled ? 'info' : 'medium',
    summary: enabled
      ? `Internal service evidence mode is ${mode}.`
      : 'Internal service environment evidence is disabled; set PQC_INTERNAL_EVIDENCE_MODE=staging with redacted env values to prove staging shape.',
    evidence: { mode },
  }));

  checks.push(check({
    id: 'internal.environment-proof.database-url-present',
    title: 'Database connection shape is present when evidence mode is enabled',
    status: enabled ? (databaseValue ? 'pass' : 'fail') : 'skipped',
    scope: enabled ? 'policy' : 'system',
    severity: enabled && !databaseValue ? 'high' : 'info',
    summary: enabled
      ? (databaseValue ? `Database connection shape is ${schemeOnly(databaseValue)}.` : 'DATABASE_URL or MONGO_URI is required for enabled internal evidence.')
      : 'Database connection shape is not required while evidence mode is disabled.',
    evidence: { valueShape: schemeOnly(databaseValue) },
  }));

  checks.push(check({
    id: 'internal.environment-proof.database-not-local-only',
    title: 'Configured database target is not local-only',
    status: enabled ? (databaseValue && !isLocalOnly(databaseValue) ? 'pass' : 'fail') : 'skipped',
    scope: enabled ? 'policy' : 'system',
    severity: enabled && (!databaseValue || isLocalOnly(databaseValue)) ? 'high' : 'info',
    summary: enabled
      ? (databaseValue && !isLocalOnly(databaseValue)
        ? `Configured database shape is non-local (${schemeOnly(databaseValue)}).`
        : 'Enabled internal evidence must not point at localhost-only database endpoints.')
      : 'Local-only database posture is not evaluated while evidence mode is disabled.',
    evidence: { valueShape: schemeOnly(databaseValue) },
  }));

  checks.push(check({
    id: 'internal.environment-proof.mongo-tls-shape',
    title: 'MongoDB shape is TLS/provider ready',
    status: enabled
      ? (/^mongodb\+srv:\/\//i.test(mongoValue) || /tls=true/i.test(mongoValue) || /ssl=true/i.test(mongoValue) ? 'pass' : 'warning')
      : 'skipped',
    scope: 'system',
    severity: /^mongodb\+srv:\/\//i.test(mongoValue) || /tls=true/i.test(mongoValue) || /ssl=true/i.test(mongoValue) ? 'info' : 'medium',
    summary: enabled
      ? 'MongoDB evidence is reduced to redacted URI shape; provider certificate details require a separate staged DB check.'
      : 'MongoDB live shape evidence is skipped.',
    evidence: { valueShape: schemeOnly(mongoValue) },
  }));

  checks.push(check({
    id: 'internal.environment-proof.redis-tls-or-private-network',
    title: 'Redis shape is TLS or private-network ready',
    status: enabled
      ? (/^rediss:\/\//i.test(redisValue) || privateNetworkDocumented ? 'pass' : 'fail')
      : 'skipped',
    scope: enabled ? 'policy' : 'system',
    severity: enabled && !/^rediss:\/\//i.test(redisValue) && !privateNetworkDocumented ? 'high' : 'info',
    summary: enabled
      ? (/^rediss:\/\//i.test(redisValue)
        ? 'Redis runtime shape uses a TLS scheme.'
        : 'Redis private-network posture is documented; provider runtime evidence should be attached to the staging run.')
      : 'Redis runtime shape evidence is skipped.',
    evidence: { valueShape: schemeOnly(redisValue), privateNetworkDocumented },
  }));

  const rawLeak = [databaseValue, mongoValue, redisValue].some((value) => value && JSON.stringify(checks).includes(value));
  checks.push(check({
    id: 'internal.environment-proof.no-raw-connection-values',
    title: 'Evidence report does not retain raw connection strings',
    status: rawLeak ? 'fail' : 'pass',
    scope: 'repo',
    severity: rawLeak ? 'critical' : 'info',
    summary: rawLeak
      ? 'A raw connection string was retained in the evidence object.'
      : 'Only redacted connection shapes are retained.',
    evidence: { redaction: 'scheme-only' },
  }));

  const summary = summarizeChecks(checks);
  return {
    title: 'Internal Service Encryption Environment Evidence',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    mode,
    sanitizedConnectionShapes: {
      database: schemeOnly(databaseValue),
      mongo: schemeOnly(mongoValue),
      redis: schemeOnly(redisValue),
    },
    summary,
    checks,
    limitations: [
      'This report validates redacted environment shape only; it does not open database or cache sockets.',
      'Hosted MongoDB and Redis TLS implementation details remain provider-dependent until staging evidence is attached.',
      'Raw connection strings are never written to JSON, Markdown, or stdout.',
    ],
  };
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

export const renderInternalServiceEncryptionEvidenceMarkdown = (report) => renderChecksMarkdown(report, [
  '## Sanitized Runtime Shapes',
  '',
  `- Database: ${report.sanitizedConnectionShapes.database}`,
  `- MongoDB: ${report.sanitizedConnectionShapes.mongo}`,
  `- Redis: ${report.sanitizedConnectionShapes.redis}`,
  '',
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
]);

const main = () => {
  const options = parseInternalServiceArgs(process.argv.slice(2));
  const report = buildInternalServiceEncryptionReport(options);
  const evidenceReport = buildInternalServiceEncryptionEvidenceReport(options);
  const markdown = renderInternalServiceEncryptionMarkdown(report);
  const written = [
    ...writeReadinessReports({
    report,
    markdown,
    reportDir: options.reportDir,
    baseName: INTERNAL_SERVICE_REPORT_BASENAME,
    options,
    }),
    ...writeReadinessReports({
      report: evidenceReport,
      markdown: renderInternalServiceEncryptionEvidenceMarkdown(evidenceReport),
      reportDir: options.reportDir,
      baseName: INTERNAL_SERVICE_EVIDENCE_REPORT_BASENAME,
      options,
    }),
  ];
  console.log(`[internal-service-encryption] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail' || evidenceReport.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) {
  main();
}
