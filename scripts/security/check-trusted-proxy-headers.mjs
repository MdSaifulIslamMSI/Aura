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

const buildTrustedProxyHeaderReport = (options = {}) => {
  const root = options.root;
  const indexSource = readTextIfExists(repoPath(root, 'server/index.js'));
  const originDoc = readTextIfExists(repoPath(root, 'infra/security/cloudflare-origin-allowlist.md'));
  const checks = [
    check({
      id: 'proxy.origin-secret-before-ip-trust',
      title: 'Origin verification is documented as the direct-origin protection boundary',
      status: /originProtectionMiddleware/.test(indexSource) && /X-Forwarded-For/i.test(originDoc) ? 'pass' : 'fail',
      scope: 'repo',
      severity: /originProtectionMiddleware/.test(indexSource) && /X-Forwarded-For/i.test(originDoc) ? 'info' : 'high',
      summary: 'Direct origin exposure is treated as a critical failure; forwarded headers are trusted only behind the configured edge.',
      evidence: { files: ['server/index.js', 'infra/security/cloudflare-origin-allowlist.md'] },
    }),
    check({
      id: 'proxy.spoofing-test',
      title: 'Proxy header spoofing test exists',
      status: readTextIfExists(repoPath(root, 'server/tests/proxyHeaderSpoofing.test.js')) ? 'pass' : 'fail',
      scope: 'repo',
      severity: 'high',
      summary: 'Tests cover forwarded header spoofing behavior and origin verification boundaries.',
      evidence: { file: 'server/tests/proxyHeaderSpoofing.test.js' },
    }),
  ];
  const summary = summarizeChecks(checks);
  return {
    title: 'Trusted Proxy Header Check',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    summary,
    checks,
  };
};

const main = () => {
  const options = parseReadinessArgs(process.argv.slice(2));
  const report = buildTrustedProxyHeaderReport(options);
  const markdown = renderChecksMarkdown(report);
  const written = writeReadinessReports({ report, markdown, reportDir: options.reportDir, baseName: 'trusted-proxy-headers', options });
  console.log(`[trusted-proxy-headers] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) main();
