import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const reportsDir = path.join(repoRoot, 'security-reports');
mkdirSync(reportsDir, { recursive: true });
const reportPath = path.join(reportsDir, 'duo-activation.json');

if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
  throw new Error('Refusing to run Duo activation checks with NODE_ENV=production');
}

const requireFromRoot = createRequire(import.meta.url);
const { getDuoFlags } = requireFromRoot('../server/config/duoFlags.js');
const { Client } = createRequire(path.join(repoRoot, 'server', 'package.json'))('@duosecurity/duo_universal');

const flags = getDuoFlags();
const required = flags.mode === 'oidc'
  ? ['DUO_CLIENT_ID', 'DUO_CLIENT_SECRET', 'DUO_OIDC_ISSUER', 'DUO_REDIRECT_URI']
  : ['DUO_CLIENT_ID', 'DUO_CLIENT_SECRET', 'DUO_API_HOST', 'DUO_REDIRECT_URI'];
const missing = required.filter((key) => !String(process.env[key] || '').trim());

const safeReportText = (value = '') => String(value || '')
  .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '?')
  .slice(0, 300);
const writeReport = (value) => {
  const safeValue = JSON.parse(JSON.stringify(value, (_key, entry) => (
    typeof entry === 'string' ? safeReportText(entry) : entry
  )));
  // Local activation evidence only; remote health data is reduced to booleans/enums above.
  writeFileSync(reportPath, `${JSON.stringify(safeValue, null, 2)}\n`);
};

const report = {
  generatedAt: new Date().toISOString(),
  command: 'duo:activate',
  enabled: flags.enabled,
  mode: flags.mode,
  configured: flags.configured,
  missing,
  healthCheck: 'not_run',
};

if (missing.length > 0) {
  writeReport(report);
  console.error(`Cisco Duo activation blocked. Missing runtime secret(s): ${missing.join(', ')}`);
  console.error('Create a Duo Universal Prompt Web SDK/OIDC application, then store these values in local/staging secrets and rerun npm run duo:activate.');
  process.exit(1);
}

let oidcActivationHandled = false;

if (flags.mode === 'oidc') {
  try {
    const response = await fetch(flags.discoveryUrl, {
      headers: { accept: 'application/json' },
    });
    const discovery = await response.json().catch(() => ({}));
    const requiredMetadata = ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri', 'userinfo_endpoint'];
    const missingMetadata = requiredMetadata.filter((key) => !String(discovery[key] || '').trim());
    const issuerMatches = String(discovery.issuer || '').replace(/\/+$/, '') === flags.oidcIssuer;

    report.healthCheck = response.ok && issuerMatches && missingMetadata.length === 0 ? 'passed' : 'failed';
    report.discovery = {
      reachable: response.ok,
      issuerMatches,
      requiredMetadataPresent: missingMetadata.length === 0,
    };
    report.readyToEnable = report.healthCheck === 'passed';
    writeReport(report);

    if (report.readyToEnable) {
      console.log('Cisco Duo OIDC discovery check passed. Store the rotated client secret in staging secrets before enforcing Duo.');
      oidcActivationHandled = true;
    } else {
      throw new Error('Duo OIDC discovery metadata did not validate.');
    }
  } catch {
    report.healthCheck = 'failed';
    report.errorCode = 'duo_oidc_discovery_failed';
    writeReport(report);
    console.error('Cisco Duo activation blocked. OIDC discovery check failed.');
    process.exit(1);
  }
}

if (!oidcActivationHandled) {
  const client = new Client({
    clientId: flags.clientId,
    clientSecret: flags.clientSecret,
    apiHost: flags.apiHost,
    redirectUrl: flags.redirectUri,
  });

  try {
    await client.healthCheck();
    report.healthCheck = 'passed';
    report.readyToEnable = true;
    writeReport(report);
    console.log('Cisco Duo health check passed. Set DUO_ENABLED=true in staging to enforce Duo on wired high-risk flows.');
  } catch {
    report.healthCheck = 'failed';
    report.errorCode = 'duo_health_check_failed';
    writeReport(report);
    console.error('Cisco Duo activation blocked. Duo health check failed.');
    process.exit(1);
  }
}
