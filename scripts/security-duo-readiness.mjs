import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const reportsDir = path.join(repoRoot, 'security-reports');
mkdirSync(reportsDir, { recursive: true });

if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
  throw new Error('Refusing to run Cisco Duo readiness with NODE_ENV=production');
}

const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(read(relativePath));
const hasFile = (relativePath) => existsSync(path.join(repoRoot, relativePath));
const includesAll = (text, needles) => needles.every((needle) => text.includes(needle));

const checks = [];
const addCheck = (name, ok, detail = {}) => {
  checks.push({ name, ok: Boolean(ok), ...detail });
};

const packageJson = readJson('package.json');
const ciWorkflow = read('.github/workflows/ci.yml');
const envExample = read('server/.env.example');
const duoDoc = hasFile('docs/cisco-duo-security-hardening.md')
  ? read('docs/cisco-duo-security-hardening.md')
  : '';
const duoFlags = hasFile('server/config/duoFlags.js')
  ? read('server/config/duoFlags.js')
  : '';
const duoTests = hasFile('server/tests/duoFlags.test.js')
  ? read('server/tests/duoFlags.test.js')
  : '';
const duoActivation = hasFile('scripts/duo-activate.mjs')
  ? read('scripts/duo-activate.mjs')
  : '';

addCheck('npm script security:duo exists',
  packageJson.scripts?.['security:duo']?.includes('scripts/security-duo-readiness.mjs'));
addCheck('security runner includes Duo category',
  read('scripts/security-runner.mjs').includes("['duo', 'npm run security:duo']"));
addCheck('CI runs Duo readiness through security:all',
  ciWorkflow.includes('npm run security:all'));
addCheck('Cisco Duo hardening doc exists',
  Boolean(duoDoc));
addCheck('Cisco Duo hardening doc covers safe activation',
  includesAll(duoDoc, [
    'Universal Prompt',
    'DUO_CLIENT_SECRET',
    'secret manager',
    'staging',
    'Fail closed',
  ]));
addCheck('Duo backend config parser exists',
  includesAll(duoFlags, ['DUO_CLIENT_ID', 'DUO_CLIENT_SECRET', 'DUO_API_HOST', 'DUO_OIDC_ISSUER', 'DUO_DISCOVERY_URL', 'DUO_REDIRECT_URI', 'configured']));
addCheck('Duo config parser is tested',
  includesAll(duoTests, ['Cisco Duo configuration flags', 'DUO_CLIENT_SECRET', 'Generic OIDC relying party', 'configured: true']));
addCheck('Duo activation command performs official SDK health check',
  packageJson.scripts?.['duo:activate'] === 'node scripts/duo-activate.mjs'
  && includesAll(duoActivation, ['@duosecurity/duo_universal', 'healthCheck', 'DUO_OIDC_ISSUER', 'DUO_CLIENT_SECRET']));
addCheck('Duo secrets are in runtime secret contract',
  envExample.includes('DUO_CLIENT_SECRET')
  && envExample.includes('DUO_API_HOST')
  && envExample.includes('DUO_OIDC_ISSUER')
  && envExample.includes('DUO_DISCOVERY_URL')
  && envExample.includes('AWS_PARAMETER_STORE_SECRET_KEYS')
  && envExample.includes('DUO_CLIENT_SECRET'));
addCheck('Duo live credentials are not required for CI',
  !ciWorkflow.includes('DUO_CLIENT_SECRET'));

const duoEnvKeys = ['DUO_CLIENT_ID', 'DUO_CLIENT_SECRET', 'DUO_REDIRECT_URI'];
const duoWebSdkEnvKeys = [...duoEnvKeys, 'DUO_API_HOST'];
const duoOidcEnvKeys = [...duoEnvKeys, 'DUO_OIDC_ISSUER'];
const configuredKeys = duoEnvKeys.filter((key) => String(process.env[key] || '').trim());
const duoEnvTouched = [
  ...duoWebSdkEnvKeys,
  ...duoOidcEnvKeys,
  'DUO_DISCOVERY_URL',
].some((key) => String(process.env[key] || '').trim()) || String(process.env.DUO_ENABLED || '').trim();

if (duoEnvTouched) {
  addCheck('Duo env is complete when any Duo env is set',
    duoWebSdkEnvKeys.every((key) => String(process.env[key] || '').trim())
    || duoOidcEnvKeys.every((key) => String(process.env[key] || '').trim()),
    { configuredKeys });
}

const report = {
  generatedAt: new Date().toISOString(),
  scanner: 'cisco-duo-readiness',
  duoEnvConfigured: configuredKeys.length > 0,
  checks,
};

writeFileSync(
  path.join(reportsDir, 'duo-security-readiness.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);

const failed = checks.filter((check) => !check.ok);
if (failed.length > 0) {
  console.error(`Cisco Duo readiness failed with ${failed.length} failed check(s).`);
  console.error(`Report: ${path.join('security-reports', 'duo-security-readiness.json')}`);
  process.exit(1);
}

console.log(`Cisco Duo readiness passed with ${checks.length} check(s).`);
