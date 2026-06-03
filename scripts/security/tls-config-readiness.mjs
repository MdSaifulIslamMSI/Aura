import path from 'node:path';
import {
  check,
  defaultRepoRoot,
  isMainModule,
  normalizePath,
  parseReadinessArgs,
  readTextIfExists,
  renderChecksMarkdown,
  repoPath,
  shouldFail,
  summarizeChecks,
  writeReadinessReports,
} from './pqc-readiness-utils.mjs';

export const TLS_REPORT_BASENAME = 'tls-config-readiness';

const defaultConfigFiles = [
  'infra/security/nginx-tls13-pqc-ready.conf.example',
  'infra/security/Caddyfile.tls13-pqc-ready.example',
  'infra/security/haproxy-tls13-pqc-ready.cfg.example',
  'infra/staging/nginx.conf.template',
  'infra/staging/nginx-frontend.conf.template',
  'infra/staging/frontend-container-nginx.conf',
  'infra/aws/Caddyfile',
  'infra/performance/nginx/nginx.conf.template',
];

const docFiles = [
  'docs/security/pqc-tls-edge-readiness.md',
  'docs/security/pqc-controlled-surface-matrix.md',
];

const legacyProtocolPatterns = [
  { label: 'legacy_tls_1_0', regex: /\bTLSv1(?:\.0)?\b(?!\.\d)|\bTLS\s+1\.0\b/i },
  { label: 'legacy_tls_1_1', regex: /\bTLSv1\.1\b|\bTLS\s+1\.1\b/i },
  { label: 'legacy_ssl_2', regex: /\bSSLv2\b/i },
  { label: 'legacy_ssl_3', regex: /\bSSLv3\b/i },
];

const weakCipherPattern = /\b(?:RC4|3DES|DES-CBC3|EXPORT|NULL-MD5|aNULL|eNULL)\b/i;

const tlsTerminating = (content) => (
  /\bssl_protocols\b/i.test(content)
  || /\bprotocols\s+tls/i.test(content)
  || /\bssl-min-ver\b/i.test(content)
  || /\btls\s*\{/i.test(content)
);

const hasTls13Minimum = (content) => (
  /\bssl_protocols\s+TLSv1\.3\s*;/i.test(content)
  || /\bprotocols\s+tls1\.3\b/i.test(content)
  || /\bssl-min-ver\s+TLSv1\.3\b/i.test(content)
);

const hasHsts = (content) => /Strict-Transport-Security/i.test(content);

const scanConfigFile = (root, relativeFile, content, repoOwned = true) => {
  const checks = [];
  const relative = normalizePath(relativeFile);
  const terminatesTls = tlsTerminating(content);
  const isExample = /infra\/security\/.*(?:tls13|pqc).*\.example|Caddyfile\.tls13|haproxy-tls13/i.test(relative);

  for (const pattern of legacyProtocolPatterns) {
    const matched = pattern.regex.test(content);
    checks.push(check({
      id: `tls.${pattern.label}.${relative}`,
      title: `${relative} avoids ${pattern.label}`,
      status: matched ? 'fail' : 'pass',
      scope: repoOwned ? 'repo' : 'system',
      severity: matched ? 'high' : 'info',
      summary: matched
        ? `${relative} contains a legacy protocol token.`
        : `${relative} does not contain the ${pattern.label} token.`,
      evidence: { file: relative },
    }));
  }

  const weakCipher = weakCipherPattern.test(content);
  checks.push(check({
    id: `tls.weak-cipher.${relative}`,
    title: `${relative} avoids known weak cipher tokens`,
    status: weakCipher ? 'fail' : 'pass',
    scope: repoOwned ? 'repo' : 'system',
    severity: weakCipher ? 'high' : 'info',
    summary: weakCipher
      ? `${relative} contains a weak cipher token.`
      : `${relative} does not contain known weak cipher tokens.`,
    evidence: { file: relative },
  }));

  if (terminatesTls || isExample) {
    const tls13 = hasTls13Minimum(content);
    checks.push(check({
      id: `tls.minimum.${relative}`,
      title: `${relative} enforces TLS 1.3 where it terminates TLS`,
      status: tls13 ? 'pass' : 'fail',
      scope: repoOwned ? 'repo' : 'system',
      severity: tls13 ? 'info' : 'high',
      summary: tls13
        ? `${relative} has a TLS 1.3 minimum directive.`
        : `${relative} appears TLS-terminating but lacks a TLS 1.3 minimum directive.`,
      evidence: { file: relative },
    }));

    const hsts = hasHsts(content);
    checks.push(check({
      id: `tls.hsts.${relative}`,
      title: `${relative} documents or configures HSTS`,
      status: hsts ? 'pass' : 'warning',
      scope: 'repo',
      severity: hsts ? 'info' : 'medium',
      summary: hsts
        ? `${relative} includes HSTS guidance/configuration.`
        : `${relative} should document HSTS rollout once domain rollback is confirmed.`,
      evidence: { file: relative },
    }));
  } else {
    checks.push(check({
      id: `tls.not-terminating.${relative}`,
      title: `${relative} is not a TLS termination config`,
      status: 'skipped',
      scope: 'repo',
      severity: 'info',
      summary: `${relative} does not appear to terminate TLS; TLS 1.3 minimum is enforced at the edge template/provider layer.`,
      evidence: { file: relative },
    }));
  }

  return checks;
};

export const buildTlsConfigReadinessReport = (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const checks = [];
  const requestedConfigs = Array.isArray(options.configs) && options.configs.length > 0
    ? options.configs
    : defaultConfigFiles.map((relativeFile) => repoPath(root, relativeFile));

  for (const relativeFile of docFiles) {
    const content = readTextIfExists(repoPath(root, relativeFile));
    checks.push(check({
      id: `repo.doc.${relativeFile}`,
      title: `${relativeFile} exists`,
      status: content ? 'pass' : 'fail',
      scope: 'repo',
      severity: content ? 'info' : 'high',
      summary: content ? `${relativeFile} exists.` : `${relativeFile} is missing.`,
      evidence: { file: relativeFile },
    }));
  }

  for (const configPath of requestedConfigs) {
    const absolutePath = path.isAbsolute(configPath) ? configPath : repoPath(root, configPath);
    const relative = absolutePath.startsWith(root)
      ? normalizePath(path.relative(root, absolutePath))
      : normalizePath(absolutePath);
    const content = readTextIfExists(absolutePath);
    if (!content) {
      checks.push(check({
        id: `tls.missing.${relative}`,
        title: `${relative} exists`,
        status: options.configs?.length ? 'fail' : 'warning',
        scope: 'repo',
        severity: options.configs?.length ? 'high' : 'medium',
        summary: `${relative} is missing.`,
        evidence: { file: relative },
      }));
      continue;
    }
    checks.push(...scanConfigFile(root, relative, content, true));
  }

  const summary = summarizeChecks(checks);
  const report = {
    title: 'TLS 1.3 And Hybrid-PQC Edge Readiness',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    configsScanned: requestedConfigs.map((entry) => normalizePath(path.isAbsolute(entry) ? path.relative(root, entry) : entry)),
    summary,
    checks,
    limitations: [
      'Browser/WebPKI PQC support remains ecosystem-dependent.',
      'OQS/liboqs edge TLS experiments remain lab or staging only until explicitly approved.',
      'Plain HTTP internal templates are not treated as TLS termination configs.',
    ],
  };

  return report;
};

export const renderTlsConfigReadinessMarkdown = (report) => renderChecksMarkdown(report, [
  '## Configs Scanned',
  '',
  ...report.configsScanned.map((entry) => `- ${entry}`),
  '',
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
]);

const main = () => {
  const options = parseReadinessArgs(process.argv.slice(2));
  const report = buildTlsConfigReadinessReport(options);
  const markdown = renderTlsConfigReadinessMarkdown(report);
  const written = writeReadinessReports({
    report,
    markdown,
    reportDir: options.reportDir,
    baseName: TLS_REPORT_BASENAME,
    options,
  });
  console.log(`[tls-config-readiness] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) {
  main();
}
