import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
  throw new Error('Refusing to audit the security harness with NODE_ENV=production');
}

const read = (relativePath) => {
  const absolutePath = path.join(repoRoot, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
};

const readJson = (relativePath) => JSON.parse(read(relativePath));

const rootPackage = readJson('package.json');
const ciWorkflow = read('.github/workflows/ci.yml');
const productionWorkflow = read('.github/workflows/production-cicd.yml');
const securityRunner = read('scripts/security-runner.mjs');
const secretScan = read('scripts/security-secret-scan.mjs');
const dependencyAudit = read('scripts/security-dependency-audit.mjs');
const gitleaksConfig = read('.gitleaks.toml');
const gitignore = read('.gitignore');
const dockerignore = read('server/.dockerignore');
const desktopRuntime = read('desktop/runtimeServer.cjs');
const statusService = read('server/services/statusService.js');
const statusPage = read('app/src/pages/Status/index.jsx');
const statusPageTests = read('app/src/pages/Status/Status.test.jsx');
const frontendAwsDeploy = read('.github/workflows/deploy-frontend-aws.yml');
const netlifyDeploy = read('.github/workflows/deploy-netlify.yml');
const desktopRelease = read('.github/workflows/desktop-release.yml');

const checks = [];

const addCheck = (name, pass, detail) => {
  checks.push({
    name,
    pass: Boolean(pass),
    detail,
  });
};

const includesAll = (text, needles) => needles.every((needle) => text.includes(needle));

const requiredScripts = [
  ['ci:doctor', 'node scripts/ci-cd-doctor.mjs'],
  ['security:all', 'node scripts/security-runner.mjs'],
  ['security:harness', 'node scripts/security-harness-check.mjs'],
  ['security:secrets', 'node scripts/security-secret-scan.mjs'],
  ['security:deps', 'node scripts/security-dependency-audit.mjs'],
  ['security:free-scanners', 'node scripts/security-free-scanners.mjs'],
  ['security:cloudflare', 'node scripts/security-cloudflare-readiness.mjs'],
  ['security:duo', 'node scripts/security-duo-readiness.mjs'],
  ['security:report', 'node scripts/security-report.mjs'],
];

for (const [scriptName, expectedCommand] of requiredScripts) {
  const actualCommand = rootPackage.scripts?.[scriptName] || '';
  addCheck(
    `root script ${scriptName}`,
    actualCommand.includes(expectedCommand),
    expectedCommand
  );
}

const requiredRunnerCategories = [
  'harness',
  'idor',
  'tokens',
  'auth',
  'admin',
  'webhooks',
  'business-logic',
  'otp-reset',
  'rate-limit',
  'cors-csrf',
  'headers',
  'cloudflare',
  'duo',
  'logging',
  'free-scanners',
  'secrets',
  'deps',
];

for (const category of requiredRunnerCategories) {
  addCheck(
    `security runner category ${category}`,
    securityRunner.includes(`['${category}', 'npm run security:${category}']`)
      || (category === 'harness' && securityRunner.includes("['harness', 'npm run security:harness']")),
    `scripts/security-runner.mjs includes ${category}`
  );
}

addCheck(
  'security runner refuses production env',
  securityRunner.includes("NODE_ENV=production") || securityRunner.includes("NODE_ENV || '').trim().toLowerCase() === 'production'"),
  'NODE_ENV=production guard'
);

addCheck(
  'secret scan covers tracked and untracked files',
  secretScan.includes("['ls-files', '-co', '--exclude-standard']"),
  'git ls-files -co --exclude-standard'
);

addCheck(
  'secret scan blocks committed env and key material',
  includesAll(secretScan, [
    'committed-env-file',
    'committed-sensitive-artifact',
    'private-key',
    'aws-access-key',
    'openai-api-key',
    'stripe-secret-key',
    'raw-jwt',
  ]),
  'custom high-signal secret patterns'
);

addCheck(
  'secret scan uses Gitleaks when installed',
  includesAll(secretScan, ['gitleaks', '--redact', '--report-format', 'json', '--config']),
  'optional local/pinned CI Gitleaks integration'
);

addCheck(
  'dependency audit checks every npm workspace',
  includesAll(dependencyAudit, [
    "{ name: 'root', cwd: repoRoot }",
    "{ name: 'app', cwd: path.join(repoRoot, 'app') }",
    "{ name: 'server', cwd: path.join(repoRoot, 'server') }",
    '--audit-level=high',
  ]),
  'root/app/server npm audit high gate'
);

addCheck(
  'dependency audit requires documented, expiring exceptions',
  includesAll(dependencyAudit, ['security-audit-exceptions.json', 'exception.reason', 'exception.expires']),
  'reason + expires exception contract'
);

addCheck(
  'Gitleaks defaults stay enabled',
  includesAll(gitleaksConfig, ['[extend]', 'useDefault = true']),
  '.gitleaks.toml default rules'
);

addCheck(
  'security reports remain local artifacts',
  gitignore.includes('security-reports/'),
  '.gitignore excludes security-reports/'
);

addCheck(
  'server container excludes env and private key material',
  includesAll(dockerignore, ['.env*', '*.pem', '*.key', '*.p12', '*.pfx', '*.jks', '*.keystore']),
  'server/.dockerignore secret artifact exclusions'
);

addCheck(
  'desktop proxy verifies TLS by default',
  includesAll(desktopRuntime, [
    'secure: !shouldAllowInsecureBackendProxy(backendOrigin)',
    "process.env.NODE_ENV !== 'production'",
    'isLoopbackBackendOrigin(backendOrigin)',
    'AURA_DESKTOP_ALLOW_INSECURE_BACKEND_PROXY',
  ]),
  'insecure backend proxy requires non-production loopback opt-in'
);

addCheck(
  'status page power is measured in public payload',
  includesAll(statusService, ['measureStatusPagePower', 'statusPower:', 'surface_coverage', 'health_signal_depth', 'history_depth']),
  'statusPower score, coverage, signal, and history dimensions'
);

addCheck(
  'status page renders power measurement',
  includesAll(statusPage, ['StatusPowerCard', 'payload.statusPower', 'Status power']),
  'public status page displays the score'
);

addCheck(
  'status power measurement has tests',
  includesAll(statusPageTests, ['StatusPowerCard', '96/100 powerhouse', 'Surface coverage']),
  'frontend status power component test'
);

addCheck(
  'CI security verification runs the full suite',
  includesAll(ciWorkflow, ['security-verification:', 'npm run security:all', 'Upload security reports']),
  '.github/workflows/ci.yml security-verification job'
);

addCheck(
  'CI installs pinned Gitleaks before secret scan',
  includesAll(ciWorkflow, [
    'GITLEAKS_VERSION=8.30.1',
    'GITLEAKS_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
    'sha256sum -c -',
    'gitleaks version',
  ]),
  'Gitleaks version and checksum pin'
);

addCheck(
  'CI path filters include security harness changes',
  includesAll(ciWorkflow, ["scripts/security-*.mjs", "security-audit-exceptions.json", ".gitleaks.toml"]),
  'security changes trigger backend/security surfaces'
);

addCheck(
  'production orchestrator reuses CI quality gates',
  includesAll(productionWorkflow, ['quality-gates:', 'uses: ./.github/workflows/ci.yml']),
  'production quality gates call CI workflow'
);

addCheck(
  'production release requires security gates before approval',
  includesAll(productionWorkflow, ['production-approval:', '- security-gates', "needs.security-gates.result == 'success'"]),
  'approval/release jobs depend on security-gates'
);

addCheck(
  'production security gates scan secrets, dependencies, and SBOM',
  includesAll(productionWorkflow, ['Basic secret pattern scan', 'NPM production dependency audit', 'Generate npm SBOMs', 'Upload SBOMs']),
  'production secret/audit/SBOM controls'
);

const firebaseConfigNeedles = [
  'secrets.VITE_FIREBASE_AUTH_DOMAIN',
  'secrets.VITE_FIREBASE_PROJECT_ID',
  'secrets.VITE_FIREBASE_STORAGE_BUCKET',
  'secrets.VITE_FIREBASE_MESSAGING_SENDER_ID',
  'secrets.VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_CONFIG',
  'VITE_FIREBASE_WEB_CONFIG',
];

for (const [name, workflowText] of [
  ['AWS frontend deploy', frontendAwsDeploy],
  ['Netlify frontend deploy', netlifyDeploy],
  ['desktop release', desktopRelease],
]) {
  addCheck(
    `${name} accepts Firebase vars or secrets`,
    includesAll(workflowText, firebaseConfigNeedles),
    'Firebase hosted auth config can be supplied as vars, secrets, or JSON'
  );
}

const nameWidth = Math.max(...checks.map((check) => check.name.length), 'Check'.length);
const statusWidth = 'Status'.length;

console.log(`${'Check'.padEnd(nameWidth)}  ${'Status'.padEnd(statusWidth)}  Detail`);
console.log(`${'-'.repeat(nameWidth)}  ${'-'.repeat(statusWidth)}  ${'-'.repeat(40)}`);

for (const check of checks) {
  console.log(
    `${check.name.padEnd(nameWidth)}  ${(check.pass ? 'PASS' : 'FAIL').padEnd(statusWidth)}  ${check.detail}`
  );
}

const failed = checks.filter((check) => !check.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} security harness contract check(s) failed.`);
  process.exit(1);
}

console.log('\nSecurity harness contract checks passed.');
