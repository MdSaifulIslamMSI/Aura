import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const reportsDir = path.join(repoRoot, 'security-reports');
mkdirSync(reportsDir, { recursive: true });

if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
  throw new Error('Refusing to run Cloudflare security readiness with NODE_ENV=production');
}

const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(read(relativePath));
const hasFile = (relativePath) => existsSync(path.join(repoRoot, relativePath));

const checks = [];
const addCheck = (name, ok, detail = {}) => {
  checks.push({ name, ok: Boolean(ok), ...detail });
};

const includesAll = (text, needles) => needles.every((needle) => text.includes(needle));
const run = (command, args) => spawnSync(command, args, {
  cwd: repoRoot,
  encoding: 'utf8',
  shell: false,
});

const runConstantShellCommand = (command) => spawnSync(command, {
  cwd: repoRoot,
  encoding: 'utf8',
  shell: true,
  timeout: 15000,
});

const packageJson = readJson('package.json');
const ciWorkflow = read('.github/workflows/ci.yml');
const securityRunner = read('scripts/security-runner.mjs');
const originSmoke = read('scripts/smoke-origin-protection.mjs');
const serverIndex = read('server/index.js');
const originProtection = read('server/middleware/originProtectionMiddleware.js');
const turnstileMiddleware = hasFile('server/middleware/turnstileMiddleware.js')
  ? read('server/middleware/turnstileMiddleware.js')
  : '';
const turnstileFlags = hasFile('server/config/turnstileFlags.js')
  ? read('server/config/turnstileFlags.js')
  : '';
const headerSecurityTest = read('server/tests/config.headers.security.test.js');
const rootVercel = read('vercel.json');
const appVercel = read('app/vercel.json');
const rootNetlify = read('netlify.toml');
const appNetlify = read('app/netlify.toml');
const hardeningDoc = hasFile('docs/cloudflare-security-hardening.md')
  ? read('docs/cloudflare-security-hardening.md')
  : '';
const activationScript = hasFile('scripts/cloudflare-free-security-activate.mjs')
  ? read('scripts/cloudflare-free-security-activate.mjs')
  : '';
const freeRules = hasFile('infra/cloudflare/free-security-rules.json')
  ? read('infra/cloudflare/free-security-rules.json')
  : '';

addCheck('npm script security:cloudflare exists',
  packageJson.scripts?.['security:cloudflare']?.includes('node scripts/security-cloudflare-readiness.mjs'));
addCheck('security runner includes Cloudflare category',
  securityRunner.includes("['cloudflare', 'npm run security:cloudflare']"));
addCheck('CI runs Cloudflare security readiness',
  ciWorkflow.includes('npm run security:cloudflare'));
addCheck('Cloudflare hardening doc exists',
  Boolean(hardeningDoc));
addCheck('Cloudflare hardening doc covers required controls',
  includesAll(hardeningDoc, [
    'WAF',
    'Rate limiting',
    'Origin protection',
    'Authenticated Origin Pulls',
    'Turnstile',
    'Full strict TLS',
    'Manual Activation Checklist',
  ]));
addCheck('Cloudflare free-tier activation script exists',
  includesAll(activationScript, ['cloudflare-free-security-activation.json', 'http_request_firewall_custom', 'http_ratelimit']));
addCheck('Cloudflare free-tier rule plan exists',
  includesAll(freeRules, ['always_use_https', 'strict', 'aura_rate_limit_auth_and_otp', 'aura_block_obvious_injection_query']));
addCheck('origin protection middleware exists',
  includesAll(originProtection, ['ORIGIN_VERIFY_HEADER', 'ORIGIN_PROTECTION_REQUIRED']));
addCheck('origin protection smoke uses explicit configured origins',
  includesAll(originSmoke, ['AURA_EDGE_ORIGIN', 'AURA_DIRECT_BACKEND_ORIGIN']));
addCheck('Turnstile server validation middleware exists',
  includesAll(turnstileMiddleware + turnstileFlags, ['siteverify', 'TURNSTILE_SECRET_KEY', 'Human verification failed']));
addCheck('security:cloudflare runs Turnstile tests',
  packageJson.scripts?.['security:cloudflare']?.includes('tests/turnstileMiddleware.test.js'));
addCheck('Express installs Helmet security headers',
  serverIndex.includes('helmet({'));
addCheck('Vercel static deployments include CSP and frame protection',
  includesAll(rootVercel + appVercel, ['Content-Security-Policy', 'frame-ancestors', 'X-Content-Type-Options']));
addCheck('Netlify static deployments include CSP and frame protection',
  includesAll(rootNetlify + appNetlify, ['Content-Security-Policy', 'frame-ancestors', 'X-Content-Type-Options']));
addCheck('authenticated API surfaces are covered by no-store header tests',
  includesAll(headerSecurityTest, ['auth/account/admin responses are not cacheable', 'no-store', 'no-cache']));
addCheck('Cloudflare live credentials are not required for CI',
  !ciWorkflow.includes('CLOUDFLARE_API_TOKEN'));

const wranglerVersion = runConstantShellCommand('npx wrangler --version');
const wranglerWhoami = runConstantShellCommand('npx wrangler whoami');
const wranglerAuthenticated = wranglerWhoami.status === 0 && /You are logged in/i.test(`${wranglerWhoami.stdout}\n${wranglerWhoami.stderr}`);

addCheck('Wrangler CLI visibility is optional for local readiness',
  true,
  {
    available: wranglerVersion.status === 0,
    version: String(wranglerVersion.stdout || wranglerVersion.stderr || '').trim().split(/\r?\n/).at(-1) || '',
  });
addCheck('Wrangler authentication is optional for local readiness',
  true,
  { authenticated: wranglerAuthenticated });

const cloudflareEnvConfigured = Boolean(
  process.env.CLOUDFLARE_API_TOKEN
  || process.env.CLOUDFLARE_ACCOUNT_ID
  || process.env.CLOUDFLARE_ZONE_ID
);
if (cloudflareEnvConfigured) {
  addCheck('Cloudflare env is complete when any Cloudflare env is set',
    Boolean(process.env.CLOUDFLARE_API_TOKEN && (process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ZONE_ID)),
    {
      hasApiToken: Boolean(process.env.CLOUDFLARE_API_TOKEN),
      hasAccountId: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID),
      hasZoneId: Boolean(process.env.CLOUDFLARE_ZONE_ID),
    });
}

const report = {
  generatedAt: new Date().toISOString(),
  scanner: 'cloudflare-security-readiness',
  cloudflareEnvConfigured,
  checks,
};

writeFileSync(
  path.join(reportsDir, 'cloudflare-security-readiness.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);

const failed = checks.filter((check) => !check.ok);
if (failed.length > 0) {
  console.error(`Cloudflare security readiness failed with ${failed.length} failed check(s).`);
  console.error(`Report: ${path.join('security-reports', 'cloudflare-security-readiness.json')}`);
  process.exit(1);
}

console.log(`Cloudflare security readiness passed with ${checks.length} check(s).`);
