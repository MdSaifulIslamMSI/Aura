import https from 'node:https';
import tls from 'node:tls';
import path from 'node:path';
import { URL } from 'node:url';
import {
  check,
  defaultRepoRoot,
  isMainModule,
  parseReadinessArgs,
  renderChecksMarkdown,
  shouldFail,
  summarizeChecks,
  writeReadinessReports,
} from './pqc-readiness-utils.mjs';

export const TLS_ENDPOINT_REPORT_BASENAME = 'tls-endpoint-pqc-readiness';

const disabledModes = new Set(['', '0', 'false', 'off', 'disabled', 'skip', 'skipped']);

const readArgValue = (argv, name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : '';
};

const parseTlsEndpointArgs = (argv) => ({
  ...parseReadinessArgs(argv),
  tlsEndpointMode: readArgValue(argv, '--tls-endpoint-mode') || readArgValue(argv, '--mode'),
  tlsTargetUrl: readArgValue(argv, '--target-url') || readArgValue(argv, '--url'),
  tlsTimeoutMs: Number(readArgValue(argv, '--timeout-ms') || 7000),
});

const redactUrl = (value) => {
  if (!value) return '[not configured]';
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//[configured-host]${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname && parsed.pathname !== '/' ? '/[path]' : ''}`;
  } catch {
    return '[invalid target url]';
  }
};

const resolveTarget = (options, env = process.env) => {
  const targetUrl = String(options.tlsTargetUrl || env.PQC_TLS_TARGET_URL || '').trim();
  const mode = String(options.tlsEndpointMode || env.PQC_TLS_PROOF_MODE || (targetUrl ? 'readonly' : 'disabled')).trim().toLowerCase();
  return {
    targetUrl,
    mode,
    enabled: !disabledModes.has(mode),
    timeoutMs: Number(options.tlsTimeoutMs || env.PQC_TLS_TIMEOUT_MS || 7000),
    requireTls13: String(env.PQC_TLS_REQUIRE_TLS13 ?? 'true').trim().toLowerCase() !== 'false',
  };
};

const parseHttpsTarget = (targetUrl) => {
  if (!targetUrl) return null;
  const parsed = new URL(targetUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('PQC_TLS_TARGET_URL must use https:// for endpoint readiness proof.');
  }
  return {
    hostname: parsed.hostname,
    port: Number(parsed.port || 443),
    servername: parsed.hostname,
    path: `${parsed.pathname || '/'}${parsed.search || ''}`,
  };
};

const connectTls = (target, options = {}) => new Promise((resolve) => {
  let socket;
  try {
    socket = tls.connect({
      host: target.hostname,
      port: target.port,
      servername: target.servername,
      minVersion: options.minVersion,
      maxVersion: options.maxVersion,
      rejectUnauthorized: options.rejectUnauthorized ?? true,
      timeout: options.timeoutMs || 7000,
    });
  } catch (error) {
    resolve({ ok: false, error: error.message, protocol: '', cipher: null, authorized: false, cert: null });
    return;
  }

  socket.once('secureConnect', () => {
    const cert = socket.getPeerCertificate();
    const cipher = socket.getCipher();
    resolve({
      ok: true,
      protocol: socket.getProtocol() || '',
      cipher,
      authorized: socket.authorized,
      authorizationError: socket.authorizationError || '',
      cert: cert && Object.keys(cert).length > 0
        ? {
          validFrom: cert.valid_from || '',
          validTo: cert.valid_to || '',
          fingerprint256Present: Boolean(cert.fingerprint256),
        }
        : null,
    });
    socket.destroy();
  });
  socket.once('timeout', () => {
    socket.destroy();
    resolve({ ok: false, error: 'timeout', protocol: '', cipher: null, authorized: false, cert: null });
  });
  socket.once('error', (error) => {
    resolve({ ok: false, error: error.message, protocol: '', cipher: null, authorized: false, cert: null });
  });
});

const fetchHeaders = (target, timeoutMs) => new Promise((resolve) => {
  const request = https.request({
    hostname: target.hostname,
    port: target.port,
    servername: target.servername,
    path: target.path || '/',
    method: 'HEAD',
    timeout: timeoutMs,
  }, (response) => {
    response.resume();
    resolve({
      ok: true,
      statusCode: response.statusCode,
      hsts: response.headers['strict-transport-security'] || '',
    });
  });
  request.once('timeout', () => {
    request.destroy();
    resolve({ ok: false, error: 'timeout', hsts: '' });
  });
  request.once('error', (error) => {
    resolve({ ok: false, error: error.message, hsts: '' });
  });
  request.end();
});

export const buildTlsEndpointPqcReadinessReport = async (options = {}) => {
  const env = options.env || process.env;
  const checks = [];
  const targetConfig = resolveTarget(options, env);
  const redactedTarget = redactUrl(targetConfig.targetUrl);
  let parsedTarget = null;
  let parseError = '';

  if (targetConfig.enabled && targetConfig.targetUrl) {
    try {
      parsedTarget = parseHttpsTarget(targetConfig.targetUrl);
    } catch (error) {
      parseError = error.message;
    }
  }

  checks.push(check({
    id: 'tls.endpoint.mode',
    title: 'TLS endpoint proof mode is explicit',
    status: targetConfig.enabled ? 'pass' : 'skipped',
    scope: 'system',
    severity: targetConfig.enabled ? 'info' : 'medium',
    summary: targetConfig.enabled
      ? `TLS endpoint proof mode is ${targetConfig.mode}.`
      : 'TLS endpoint proof is disabled; set PQC_TLS_TARGET_URL for read-only staging or production evidence.',
    evidence: { mode: targetConfig.mode },
  }));

  checks.push(check({
    id: 'tls.endpoint.target-configured',
    title: 'HTTPS endpoint target is configured when endpoint proof is enabled',
    status: targetConfig.enabled ? (parsedTarget ? 'pass' : 'fail') : 'skipped',
    scope: targetConfig.enabled ? 'policy' : 'system',
    severity: targetConfig.enabled && !parsedTarget ? 'high' : 'info',
    summary: targetConfig.enabled
      ? (parsedTarget ? `TLS endpoint target is configured as ${redactedTarget}.` : (parseError || 'PQC_TLS_TARGET_URL is required.'))
      : 'No endpoint target is required while proof mode is disabled.',
    evidence: { target: redactedTarget },
  }));

  if (!targetConfig.enabled || !parsedTarget) {
    checks.push(check({
      id: 'tls.endpoint.handshake',
      title: 'TLS endpoint handshake is skipped without a target',
      status: 'skipped',
      scope: 'system',
      severity: 'info',
      summary: 'No read-only TLS connection was opened.',
      evidence: { target: redactedTarget },
    }));
    checks.push(check({
      id: 'tls.endpoint.legacy-protocol-rejection',
      title: 'Legacy TLS rejection probe is skipped without a target',
      status: 'skipped',
      scope: 'system',
      severity: 'info',
      summary: 'Legacy protocol rejection requires a configured HTTPS endpoint.',
      evidence: { target: redactedTarget },
    }));
  } else {
    const handshake = await connectTls(parsedTarget, { minVersion: 'TLSv1.2', timeoutMs: targetConfig.timeoutMs });
    checks.push(check({
      id: 'tls.endpoint.handshake',
      title: 'Read-only TLS handshake succeeds',
      status: handshake.ok ? 'pass' : 'fail',
      scope: 'policy',
      severity: handshake.ok ? 'info' : 'high',
      summary: handshake.ok
        ? `Read-only TLS handshake succeeded for ${redactedTarget}.`
        : `Read-only TLS handshake failed for ${redactedTarget}.`,
      evidence: { target: redactedTarget, protocol: handshake.protocol, authorized: handshake.authorized, error: handshake.ok ? '' : handshake.error },
    }));

    checks.push(check({
      id: 'tls.endpoint.negotiates-tls13',
      title: 'Endpoint negotiates TLS 1.3',
      status: handshake.ok && handshake.protocol === 'TLSv1.3'
        ? 'pass'
        : (targetConfig.requireTls13 ? 'fail' : 'warning'),
      scope: 'policy',
      severity: handshake.ok && handshake.protocol === 'TLSv1.3' ? 'info' : 'high',
      summary: handshake.ok
        ? `Endpoint negotiated ${handshake.protocol || 'unknown protocol'} for ${redactedTarget}.`
        : 'TLS version could not be proven because the handshake failed.',
      evidence: { target: redactedTarget, protocol: handshake.protocol, requireTls13: targetConfig.requireTls13 },
    }));

    checks.push(check({
      id: 'tls.endpoint.certificate-metadata',
      title: 'Endpoint certificate metadata is captured without certificate material',
      status: handshake.ok && handshake.cert ? 'pass' : 'warning',
      scope: 'system',
      severity: handshake.ok && handshake.cert ? 'info' : 'medium',
      summary: handshake.ok && handshake.cert
        ? 'Certificate validity metadata was captured without storing the certificate body.'
        : 'Certificate metadata could not be captured.',
      evidence: { target: redactedTarget, certificate: handshake.cert },
    }));

    const legacyTls10 = await connectTls(parsedTarget, {
      minVersion: 'TLSv1',
      maxVersion: 'TLSv1',
      timeoutMs: targetConfig.timeoutMs,
      rejectUnauthorized: false,
    });
    const legacyTls11 = await connectTls(parsedTarget, {
      minVersion: 'TLSv1.1',
      maxVersion: 'TLSv1.1',
      timeoutMs: targetConfig.timeoutMs,
      rejectUnauthorized: false,
    });
    const legacyAccepted = legacyTls10.ok || legacyTls11.ok;
    checks.push(check({
      id: 'tls.endpoint.legacy-protocol-rejection',
      title: 'Endpoint rejects legacy TLS probe attempts',
      status: legacyAccepted ? 'fail' : 'pass',
      scope: 'policy',
      severity: legacyAccepted ? 'high' : 'info',
      summary: legacyAccepted
        ? 'Endpoint accepted a TLS 1.0 or TLS 1.1 probe; keep production unchanged until remediated.'
        : 'TLS 1.0 and TLS 1.1 probes did not complete.',
      evidence: { target: redactedTarget, tls10Accepted: legacyTls10.ok, tls11Accepted: legacyTls11.ok },
    }));

    const headers = await fetchHeaders(parsedTarget, targetConfig.timeoutMs);
    checks.push(check({
      id: 'tls.endpoint.hsts',
      title: 'Endpoint exposes HSTS headers where applicable',
      status: headers.ok && headers.hsts ? 'pass' : 'warning',
      scope: 'system',
      severity: headers.ok && headers.hsts ? 'info' : 'medium',
      summary: headers.ok && headers.hsts
        ? 'Endpoint returned a Strict-Transport-Security header.'
        : 'Endpoint did not expose HSTS in the read-only header probe or the header probe failed.',
      evidence: { target: redactedTarget, statusCode: headers.statusCode || null, hstsPresent: Boolean(headers.hsts) },
    }));
  }

  const summary = summarizeChecks(checks);
  return {
    title: 'TLS Endpoint PQC Readiness Evidence',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    mode: targetConfig.mode,
    target: redactedTarget,
    summary,
    checks,
    limitations: [
      'This read-only probe verifies TLS 1.3 posture and legacy protocol rejection, not universal browser/WebPKI PQC support.',
      'Provider-managed certificates, browser PQC negotiation, and public CA policy remain ecosystem-dependent.',
      'No certificate private keys, response bodies, tokens, or secrets are written to the report.',
    ],
  };
};

export const renderTlsEndpointPqcReadinessMarkdown = (report) => renderChecksMarkdown(report, [
  '## Endpoint',
  '',
  `- Mode: ${report.mode}`,
  `- Target: ${report.target}`,
  '',
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
]);

const main = async () => {
  const options = parseTlsEndpointArgs(process.argv.slice(2));
  const report = await buildTlsEndpointPqcReadinessReport(options);
  const markdown = renderTlsEndpointPqcReadinessMarkdown(report);
  const written = writeReadinessReports({
    report,
    markdown,
    reportDir: options.reportDir,
    baseName: TLS_ENDPOINT_REPORT_BASENAME,
    options,
  });
  console.log(`[tls-endpoint-pqc-readiness] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) {
  await main();
}
