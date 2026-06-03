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

const buildOriginExposureReport = (options = {}) => {
  const root = options.root;
  const target = String(process.env.ORIGIN_EXPOSURE_TARGET_URL || '').trim();
  const indexSource = readTextIfExists(repoPath(root, 'server/index.js'));
  const checks = [
    check({
      id: 'origin.middleware.mounted',
      title: 'Origin protection middleware is mounted',
      status: /originProtectionMiddleware/.test(indexSource) ? 'pass' : 'fail',
      scope: 'repo',
      severity: /originProtectionMiddleware/.test(indexSource) ? 'info' : 'high',
      summary: 'Origin protection rejects direct origin access when the verification header is configured.',
      evidence: { file: 'server/index.js' },
    }),
    check({
      id: 'origin.docs.lockdown',
      title: 'Origin lockdown docs exist',
      status: readTextIfExists(repoPath(root, 'infra/security/origin-lockdown.md')) ? 'pass' : 'fail',
      scope: 'repo',
      severity: 'high',
      summary: 'Cloudflare/CDN allowlist and direct-origin block guidance is documented.',
      evidence: { file: 'infra/security/origin-lockdown.md' },
    }),
    check({
      id: 'origin.live-probe.disabled',
      title: 'Live origin exposure probe is disabled unless target is configured',
      status: target ? 'warning' : 'skipped',
      scope: 'system',
      severity: target ? 'medium' : 'info',
      summary: target
        ? 'A target is configured, but this script intentionally does not probe production in default CI.'
        : 'No live origin target is configured; no network probe is sent.',
      evidence: { targetConfigured: Boolean(target) },
    }),
  ];
  const summary = summarizeChecks(checks);
  return {
    title: 'Origin Exposure Check',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    summary,
    checks,
  };
};

const main = () => {
  const options = parseReadinessArgs(process.argv.slice(2));
  const report = buildOriginExposureReport(options);
  const markdown = renderChecksMarkdown(report);
  const written = writeReadinessReports({ report, markdown, reportDir: options.reportDir, baseName: 'origin-exposure-check', options });
  console.log(`[origin-exposure-check] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) main();
