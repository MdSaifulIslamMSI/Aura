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

export const PQC_PROVIDER_REGISTER_REPORT_BASENAME = 'pqc-provider-register-check';

const providerRegisterDoc = 'docs/security/pqc-provider-dependency-register.md';

const requiredHeaders = [
  'Provider/Surface',
  'Provider-Controlled Crypto',
  'Known PQC Support',
  'Aura Can Control',
  'Aura Cannot Control',
  'Risk Level',
  'Monitoring Owner',
  'Review Cadence',
  'Migration Trigger',
  'Fallback/Rollback Note',
];

const requiredProviders = [
  'Firebase/Auth',
  'Stripe',
  'Razorpay',
  'Resend/email',
  'MongoDB host',
  'Redis host',
  'Vercel/Netlify/CloudFront/Caddy/Nginx edge',
  'GitHub Actions',
  'AI providers',
  'Browser/WebPKI',
  'Mobile app stores',
];

const splitTableLine = (line) => line
  .trim()
  .replace(/^\|/, '')
  .replace(/\|$/, '')
  .split('|')
  .map((entry) => entry.trim());

export const parseProviderRegister = (content) => {
  const lines = content.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^\|\s*Provider\/Surface\s*\|/i.test(line));
  if (headerIndex < 0 || !lines[headerIndex + 1]) {
    return { headers: [], rows: [] };
  }
  const headers = splitTableLine(lines[headerIndex]);
  const rows = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim().startsWith('|')) break;
    const values = splitTableLine(line);
    if (values.length !== headers.length) continue;
    rows.push(Object.fromEntries(headers.map((header, headerIndexInRow) => [header, values[headerIndexInRow]])));
  }
  return { headers, rows };
};

const hasHonestUnknown = (value) => /unknown\/provider-dependent|provider-dependent|ecosystem-dependent/i.test(String(value || ''));

export const buildPqcProviderRegisterReport = (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const checks = [];
  const doc = readTextIfExists(repoPath(root, providerRegisterDoc));
  const parsed = parseProviderRegister(doc);

  checks.push(check({
    id: 'provider-register.doc.exists',
    title: 'Provider dependency register exists',
    status: doc ? 'pass' : 'fail',
    scope: 'repo',
    severity: doc ? 'info' : 'high',
    summary: doc ? `${providerRegisterDoc} exists.` : `${providerRegisterDoc} is missing.`,
    evidence: { file: providerRegisterDoc },
  }));

  for (const header of requiredHeaders) {
    const present = parsed.headers.includes(header);
    checks.push(check({
      id: `provider-register.header.${header.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: `Provider register includes ${header}`,
      status: present ? 'pass' : 'fail',
      scope: 'repo',
      severity: present ? 'info' : 'high',
      summary: present ? `Header ${header} is present.` : `Header ${header} is missing.`,
      evidence: { file: providerRegisterDoc },
    }));
  }

  for (const provider of requiredProviders) {
    const row = parsed.rows.find((entry) => entry['Provider/Surface'] === provider);
    checks.push(check({
      id: `provider-register.row.${provider.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: `${provider} is tracked`,
      status: row ? 'pass' : 'fail',
      scope: 'repo',
      severity: row ? 'info' : 'high',
      summary: row ? `${provider} has a provider register row.` : `${provider} is missing from the provider register.`,
      evidence: { file: providerRegisterDoc },
    }));
  }

  for (const [index, row] of parsed.rows.entries()) {
    const provider = row['Provider/Surface'] || `row-${index + 1}`;
    const requiredValues = [
      'Provider-Controlled Crypto',
      'Known PQC Support',
      'Aura Can Control',
      'Aura Cannot Control',
      'Risk Level',
      'Monitoring Owner',
      'Review Cadence',
      'Migration Trigger',
      'Fallback/Rollback Note',
    ];
    const missing = requiredValues.filter((header) => !String(row[header] || '').trim());
    checks.push(check({
      id: `provider-register.row-complete.${provider.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: `${provider} row has required fields`,
      status: missing.length === 0 ? 'pass' : 'fail',
      scope: 'repo',
      severity: missing.length === 0 ? 'info' : 'medium',
      summary: missing.length === 0
        ? `${provider} row has required ownership, trigger, and rollback fields.`
        : `${provider} row is missing: ${missing.join(', ')}.`,
      evidence: { provider, missing },
    }));

    const unknown = hasHonestUnknown(row['Known PQC Support']);
    checks.push(check({
      id: `provider-register.provider-known-pqc.${provider.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: `${provider} PQC support claim is honest`,
      status: unknown ? 'warning' : 'pass',
      scope: 'system',
      severity: unknown ? 'medium' : 'info',
      summary: unknown
        ? `${provider} remains provider-dependent; this lowers full end-to-end PQC score without failing repo evidence.`
        : `${provider} has a non-unknown PQC support note that should be backed by current provider evidence.`,
      evidence: { provider, knownPqcSupport: row['Known PQC Support'] || '' },
    }));
  }

  const unknownCount = parsed.rows.filter((row) => hasHonestUnknown(row['Known PQC Support'])).length;
  checks.push(check({
    id: 'provider-register.monitoring-rule',
    title: 'Provider-dependent monitoring rule is documented',
    status: /Provider-dependent does not mean ignored/i.test(doc) ? 'pass' : 'fail',
    scope: 'repo',
    severity: /Provider-dependent does not mean ignored/i.test(doc) ? 'info' : 'medium',
    summary: /Provider-dependent does not mean ignored/i.test(doc)
      ? 'Provider monitoring rule is documented.'
      : 'Provider monitoring rule is missing.',
    evidence: { file: providerRegisterDoc },
  }));

  const summary = summarizeChecks(checks);
  return {
    title: 'PQC Provider Dependency Register Check',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    providerRows: parsed.rows.length,
    providerUnknownCount: unknownCount,
    providerKnownCount: parsed.rows.length - unknownCount,
    summary,
    checks,
    limitations: [
      'Unknown/provider-dependent entries are warnings by design; they prevent inflated full end-to-end PQC claims.',
      'This checker validates the register structure and honesty, not live third-party roadmaps.',
      'Provider evidence must be refreshed during scheduled reviews before production migration decisions.',
    ],
  };
};

export const renderPqcProviderRegisterMarkdown = (report) => renderChecksMarkdown(report, [
  '## Provider Summary',
  '',
  `- Provider rows: ${report.providerRows}`,
  `- Provider-dependent/unknown rows: ${report.providerUnknownCount}`,
  `- Non-unknown rows: ${report.providerKnownCount}`,
  '',
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
]);

const main = () => {
  const options = parseReadinessArgs(process.argv.slice(2));
  const report = buildPqcProviderRegisterReport(options);
  const markdown = renderPqcProviderRegisterMarkdown(report);
  const written = writeReadinessReports({
    report,
    markdown,
    reportDir: options.reportDir,
    baseName: PQC_PROVIDER_REGISTER_REPORT_BASENAME,
    options,
  });
  console.log(`[pqc-provider-register] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) {
  main();
}
