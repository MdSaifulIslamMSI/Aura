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
  // Templates alone cannot attest to the deployed viewer edge: CloudFront's
  // default certificate forces TLSv1 regardless of a claimed modern policy.
  'infra/aws/cloudfront-edge-replica.json',
  'app/Caddyfile',
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
  // CDN TLS vocabulary must not bypass the minimum gate as "not terminating".
  || /"MinimumProtocolVersion"/i.test(content)
  || /\bOriginSslProtocols\b/i.test(content)
  || /"ViewerCertificate"/i.test(content)
);

const hasTls13Minimum = (content) => (
  /\bssl_protocols\s+TLSv1\.3\s*;/i.test(content)
  || /\bprotocols\s+tls1\.3\b/i.test(content)
  || /\bssl-min-ver\s+TLSv1\.3\b/i.test(content)
);

const hasHsts = (content) => /Strict-Transport-Security/i.test(content);

const cloudFrontViewerPolicies = new Set([
  'SSLv3', 'TLSv1', 'TLSv1_2016', 'TLSv1.1_2016', 'TLSv1.2_2018',
  'TLSv1.2_2019', 'TLSv1.2_2021', 'TLSv1.2_2025', 'TLSv1.3_2025',
]);
const cloudFrontOriginProtocols = new Set(['SSLv3', 'TLSv1', 'TLSv1.1', 'TLSv1.2']);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const inspectCloudFrontOrigins = (distribution) => {
  const origins = distribution?.Origins;
  if (origins === undefined) return null;
  const errors = [];
  const protocols = [];
  let customOrigins = 0;
  const items = origins?.Items ?? [];
  if (!isRecord(origins) || !Array.isArray(items) || origins.Quantity !== items.length) {
    errors.push('Origins must have an Items array matching Quantity.');
  } else {
    for (const [index, origin] of items.entries()) {
      const field = `Origins.Items[${index}].CustomOriginConfig.OriginSslProtocols`;
      if (!isRecord(origin)) {
        errors.push(`Origins.Items[${index}] must be an object.`);
        continue;
      }
      if (origin.CustomOriginConfig === undefined) continue;
      customOrigins += 1;
      const ssl = origin.CustomOriginConfig?.OriginSslProtocols;
      if (!isRecord(ssl) || !Array.isArray(ssl.Items) || ssl.Items.length === 0 || ssl.Quantity !== ssl.Items.length) {
        errors.push(`${field} must have nonempty Items and a matching Quantity.`);
        continue;
      }
      for (const protocol of ssl.Items) {
        if (cloudFrontOriginProtocols.has(protocol)) protocols.push(protocol);
        else errors.push(`${field} has invalid enum ${JSON.stringify(protocol)}.`);
      }
    }
  }
  if (customOrigins === 0 && errors.length === 0) return null;
  return {
    valid: errors.length === 0,
    protocols,
    summary: errors.length
      ? `Invalid CloudFront OriginSslProtocols: ${errors.join(' ')} Allowed API enums: SSLv3, TLSv1, TLSv1.1, TLSv1.2; TLSv1.3 and viewer-policy suffixes are not origin enums.`
      : `Uses valid CloudFront OriginSslProtocols API enums (${protocols.join(', ')}); allowed origin protocols do not prove a TLS 1.3 minimum or an observed handshake.`,
  };
};

const inspectCloudFrontConfig = (relative, content) => {
  // Recognition may use text so malformed CDN JSON fails closed. Only parsed,
  // correctly located certificate fields can establish the viewer minimum.
  const recognized = /cloudfront[^/]*\.json$/i.test(relative)
    || /"(?:ViewerCertificate|MinimumProtocolVersion|OriginSslProtocols|CloudFrontDefaultCertificate|DistributionConfig)"/i.test(content);
  if (!recognized && !/\.json$/i.test(relative)) return null;
  let document;
  try {
    document = JSON.parse(content);
  } catch (error) {
    return recognized ? {
      minimum: false,
      minimumSummary: `Invalid CloudFront JSON; cannot establish a TLS 1.3 minimum: ${error.message}`,
      protocols: [],
    } : null;
  }
  const distribution = isRecord(document) && Object.hasOwn(document, 'DistributionConfig')
    ? document.DistributionConfig
    : isRecord(document) && Object.hasOwn(document, 'Distribution')
      ? document.Distribution?.DistributionConfig
      : document;
  const fields = ['ViewerCertificate', 'MinimumProtocolVersion', 'OriginSslProtocols', 'CloudFrontDefaultCertificate', 'DistributionConfig'];
  if (!recognized && !fields.some((field) => isRecord(distribution) && Object.hasOwn(distribution, field))) return null;

  const viewer = distribution?.ViewerCertificate;
  const errors = [];
  let effectiveViewerPolicy;
  if (!isRecord(viewer)) {
    errors.push('CloudFront ViewerCertificate must be an object specifying the viewer certificate and policy.');
  } else {
    const policy = viewer.MinimumProtocolVersion;
    if (policy !== undefined && !cloudFrontViewerPolicies.has(policy)) {
      errors.push(`Invalid CloudFront MinimumProtocolVersion ${JSON.stringify(policy)}; TLSv1.3_2025 is the valid TLS 1.3 minimum policy.`);
    }
    if (viewer.CloudFrontDefaultCertificate === true) {
      effectiveViewerPolicy = 'TLSv1';
      const otherFields = Object.keys(viewer).filter((field) => field !== 'CloudFrontDefaultCertificate');
      if (otherFields.length) errors.push(`With the default certificate, other ViewerCertificate fields must be unset: ${otherFields.join(', ')}.`);
    } else {
      if (viewer.CloudFrontDefaultCertificate !== undefined && typeof viewer.CloudFrontDefaultCertificate !== 'boolean') {
        errors.push('CloudFrontDefaultCertificate must be a boolean.');
      }
      const certificates = ['ACMCertificateArn', 'IAMCertificateId'].filter((field) => Object.hasOwn(viewer, field));
      if (certificates.length !== 1 || certificates.some((field) => typeof viewer[field] !== 'string' || !viewer[field].trim())) {
        errors.push('A custom ViewerCertificate requires exactly one nonempty ACMCertificateArn or IAMCertificateId string.');
      }
      if (viewer.SSLSupportMethod !== 'sni-only') {
        errors.push('SSLSupportMethod must be sni-only to prove a TLS 1.3 minimum from this config; non-SNI enforcement is not established.');
      }
      if (policy === undefined) errors.push('CloudFront ViewerCertificate lacks MinimumProtocolVersion.');
      if (cloudFrontViewerPolicies.has(policy)) effectiveViewerPolicy = policy;
    }
  }
  const minimum = errors.length === 0 && effectiveViewerPolicy === 'TLSv1.3_2025';
  const minimumSummary = viewer?.CloudFrontDefaultCertificate === true
    ? 'CloudFrontDefaultCertificate=true forces TLSv1 regardless of MinimumProtocolVersion; it cannot enforce the TLS 1.3 minimum.'
    : minimum
      ? 'Custom CloudFront ViewerCertificate with TLSv1.3_2025 enforces a configured TLS 1.3 minimum; this is not an observed handshake.'
      : `CloudFront cannot establish a TLS 1.3 minimum${effectiveViewerPolicy ? ` with viewer policy ${effectiveViewerPolicy}` : ''}.`;
  const origins = inspectCloudFrontOrigins(distribution);
  const viewerProtocols = ['SSLv3', 'TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];
  return {
    minimum,
    minimumSummary: [minimumSummary, ...errors].join(' '),
    configuredViewerPolicy: viewer?.MinimumProtocolVersion,
    effectiveViewerPolicy,
    protocols: [
      ...(effectiveViewerPolicy ? viewerProtocols.slice(viewerProtocols.indexOf(effectiveViewerPolicy.split('_')[0])) : []),
      ...(origins?.protocols || []),
    ],
    origins,
  };
};

const scanConfigFile = (root, relativeFile, content, repoOwned = true) => {
  const checks = [];
  const relative = normalizePath(relativeFile);
  const cloudFront = inspectCloudFrontConfig(relative, content);
  const terminatesTls = Boolean(cloudFront) || tlsTerminating(content);
  const isExample = /infra\/security\/.*(?:tls13|pqc).*\.example|Caddyfile\.tls13|haproxy-tls13/i.test(relative);

  for (const pattern of legacyProtocolPatterns) {
    const matched = cloudFront
      ? cloudFront.protocols.some((protocol) => pattern.regex.test(protocol))
      : pattern.regex.test(content);
    checks.push(check({
      id: `tls.${pattern.label}.${relative}`,
      title: `${relative} avoids ${pattern.label}`,
      status: matched ? 'fail' : 'pass',
      scope: repoOwned ? 'repo' : 'system',
      severity: matched ? 'high' : 'info',
      summary: cloudFront
        ? `${relative} ${matched ? 'permits' : 'does not configure'} ${pattern.label} in its effective viewer policy or allowed origin protocols.`
        : matched
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

  if (cloudFront?.origins) {
    const origins = cloudFront.origins;
    checks.push(check({
      id: `tls.cloudfront.origin-protocols.${relative}`,
      title: `${relative} uses valid CloudFront origin protocol enums`,
      status: origins.valid ? 'pass' : 'fail',
      scope: repoOwned ? 'repo' : 'system',
      severity: origins.valid ? 'info' : 'high',
      summary: origins.summary,
      evidence: { file: relative, protocols: origins.protocols },
    }));
  }

  if (terminatesTls || isExample) {
    const tls13 = cloudFront ? cloudFront.minimum : hasTls13Minimum(content);
    checks.push(check({
      id: `tls.minimum.${relative}`,
      title: `${relative} enforces TLS 1.3 where it terminates TLS`,
      status: tls13 ? 'pass' : 'fail',
      scope: repoOwned ? 'repo' : 'system',
      severity: tls13 ? 'info' : 'high',
      summary: cloudFront
        ? `${relative}: ${cloudFront.minimumSummary}`
        : tls13
          ? `${relative} has a TLS 1.3 minimum directive.`
          : `${relative} appears TLS-terminating but lacks a TLS 1.3 minimum directive.`,
      evidence: {
        file: relative,
        ...(cloudFront ? {
          configuredViewerPolicy: cloudFront.configuredViewerPolicy,
          effectiveViewerPolicy: cloudFront.effectiveViewerPolicy,
        } : {}),
      },
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
      'CloudFront policies are validated as configuration, not live handshake evidence; allowed origin protocols do not prove the negotiated TLS version.',
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
