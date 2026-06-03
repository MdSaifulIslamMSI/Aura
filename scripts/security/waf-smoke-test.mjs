import path from 'node:path';
import {
  check,
  isMainModule,
  parseReadinessArgs,
  readTextIfExists,
  renderChecksMarkdown,
  repoPath,
  shouldFail,
  summarizeChecks,
  writeReadinessReports,
} from './pqc-readiness-utils.mjs';

const wafFiles = [
  'infra/waf/README.md',
  'infra/waf/nginx-modsecurity.conf',
  'infra/waf/owasp-crs/crs-setup.conf.example',
  'infra/waf/crowdsec/acquis.yaml.example',
];

const buildWafSmokeReport = (options = {}) => {
  const root = options.root;
  const checks = wafFiles.map((file) => check({
    id: `waf.file.${file}`,
    title: `${file} exists`,
    status: readTextIfExists(repoPath(root, file)) ? 'pass' : 'fail',
    scope: 'repo',
    severity: readTextIfExists(repoPath(root, file)) ? 'info' : 'high',
    summary: `${file} WAF artifact.`,
    evidence: { file },
  }));
  const readme = readTextIfExists(repoPath(root, 'infra/waf/README.md'));
  for (const term of ['detection mode', 'blocking mode', 'SQL injection', 'XSS', 'path traversal', 'webhook allowlist']) {
    checks.push(check({
      id: `waf.term.${term.replace(/[^a-z0-9]+/gi, '-')}`,
      title: `WAF docs cover ${term}`,
      status: readme.toLowerCase().includes(term.toLowerCase()) ? 'pass' : 'fail',
      scope: 'repo',
      severity: readme.toLowerCase().includes(term.toLowerCase()) ? 'info' : 'medium',
      summary: `WAF documentation coverage for ${term}.`,
      evidence: { file: 'infra/waf/README.md' },
    }));
  }
  const summary = summarizeChecks(checks);
  return {
    title: 'WAF Smoke Test',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    summary,
    checks,
    networkRequestsSent: false,
  };
};

const main = () => {
  const options = parseReadinessArgs(process.argv.slice(2));
  const report = buildWafSmokeReport(options);
  const markdown = renderChecksMarkdown(report, ['## Safety', '', '- This smoke test validates local artifacts only and sends no network traffic.']);
  const written = writeReadinessReports({ report, markdown, reportDir: options.reportDir, baseName: 'waf-smoke-test', options });
  console.log(`[waf-smoke-test] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) main();
