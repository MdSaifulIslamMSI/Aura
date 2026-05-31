import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflowDir = path.join(root, '.github', 'workflows');

const requiredWorkflows = [
  'ci.yml',
  'deploy-backend-aws.yml',
  'deploy-netlify.yml',
  'deploy-frontend-aws.yml',
  'deploy-gateway-vercel.yml',
  'rollback-backend-aws.yml',
  'rollback-netlify.yml',
  'rollback-frontend-aws.yml',
  'rollback-gateway-vercel.yml',
  'desktop-release.yml',
  'mobile-release.yml',
  'production-cicd.yml',
  'production-on-push.yml',
  'production-admin-access.yml',
];

const read = (relativePath) => {
  const absolutePath = path.join(root, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
};

const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

const production = read('.github/workflows/production-cicd.yml');
const productionOnPush = read('.github/workflows/production-on-push.yml');
const productionAdminAccess = read('.github/workflows/production-admin-access.yml');
const desktop = read('.github/workflows/desktop-release.yml');
const mobile = read('.github/workflows/mobile-release.yml');
const gateway = read('.github/workflows/deploy-gateway-vercel.yml');
const deployBackend = read('.github/workflows/deploy-backend-aws.yml');
const backendOidcBootstrap = read('infra/aws/bootstrap-github-oidc.ps1');
const packageJson = JSON.parse(read('package.json') || '{}');
const securityRunner = read('scripts/security-runner.mjs');

const checks = [];

const addCheck = (name, pass, detail) => {
  checks.push({
    name,
    pass: Boolean(pass),
    detail,
  });
};

for (const workflow of requiredWorkflows) {
  addCheck(
    `workflow exists: ${workflow}`,
    exists(path.join('.github', 'workflows', workflow)),
    path.join('.github', 'workflows', workflow)
  );
}

addCheck(
  'workflow directory exists',
  fs.existsSync(workflowDir),
  '.github/workflows'
);

addCheck(
  'manual production command center exists',
  production.includes('name: Manual Production Command Center') && production.includes('workflow_dispatch:'),
  '.github/workflows/production-cicd.yml'
);

addCheck(
  'automatic production push pipeline exists',
  productionOnPush.includes('name: Automatic Production Release On Main Push') && productionOnPush.includes('branches: ["main"]'),
  '.github/workflows/production-on-push.yml'
);

addCheck(
  'desktop release exposes signing-skip inputs',
  ['require_windows_signing', 'require_macos_signing', 'publish_store_release'].every((needle) =>
    desktop.includes(needle)
  ),
  'desktop-release.yml workflow_call inputs'
);

addCheck(
  'mobile release exposes signing-skip inputs',
  ['require_android_signing', 'require_ios_signing', 'publish_store_release'].every((needle) =>
    mobile.includes(needle)
  ),
  'mobile-release.yml workflow_call inputs'
);

addCheck(
  'mobile release validates iOS on macOS',
  mobile.includes('build-ios:') && mobile.includes('runs-on: macos-latest'),
  'iOS release validation is not tied to local Windows machines'
);

addCheck(
  'root mobile doctor is cross-platform aware',
  packageJson.scripts?.['mobile:doctor'] === 'node scripts/mobile-doctor.mjs' &&
    exists(path.join('scripts', 'mobile-doctor.mjs')),
  'Windows local doctor skips only the expected Xcode limitation'
);

addCheck(
  'production passes desktop signing false inputs',
  [
    'require_windows_signing: false',
    'require_macos_signing: false',
    'publish_store_release: false',
  ].every((needle) => production.includes(needle)),
  'release-desktop reusable call'
);

addCheck(
  'production passes mobile signing false inputs',
  [
    'require_android_signing: false',
    'require_ios_signing: false',
    'publish_store_release: false',
  ].every((needle) => production.includes(needle)),
  'release-mobile reusable call'
);

addCheck(
  'main push pipeline deploys all production surfaces',
  [
    'deploy-backend:',
    'deploy-storefront:',
    'deploy-gateway:',
    'release-desktop:',
    'release-mobile:',
    'production-summary:',
    '--workflow deploy-backend-aws.yml',
    '--workflow deploy-netlify.yml',
    '--workflow deploy-gateway-vercel.yml',
    '--workflow desktop-release.yml',
    '--workflow mobile-release.yml',
  ].every((needle) => productionOnPush.includes(needle)),
  'backend, storefront, gateway, desktop, mobile lanes on every main push'
);

addCheck(
  'main push desktop release is unsigned by default',
  [
    '"require_windows_signing":false',
    '"require_macos_signing":false',
    '"publish_store_release":false',
  ].every((needle) => productionOnPush.includes(needle)),
  'automatic desktop lane is safe for internal GitHub artifacts'
);

addCheck(
  'main push mobile release is unsigned by default',
  [
    '"require_android_signing":false',
    '"require_ios_signing":false',
    '"publish_store_release":false',
  ].every((needle) => productionOnPush.includes(needle)),
  'automatic mobile lane is safe for internal GitHub artifacts'
);

addCheck(
  'production admin access reuses branch-scoped AWS OIDC',
  productionAdminAccess.includes('confirm_production') &&
    productionAdminAccess.includes('Configure AWS credentials') &&
    !/environment:\s*\r?\n\s+name:\s+production/.test(productionAdminAccess),
  'admin allowlist workflow matches deploy role branch trust subject'
);

addCheck(
  'production admin access has runtime fallback',
  productionAdminAccess.includes('parameter_store_updated=false') &&
    productionAdminAccess.includes('Apply direct runtime admin allowlist fallback') &&
    productionAdminAccess.includes('ADMIN_REQUIRE_ALLOWLIST=true'),
  'admin recovery can proceed through SSM SendCommand when PutParameter is not deployed yet'
);

addCheck(
  'backend deploy uses native arm64 runner',
  deployBackend.includes('runs-on: ubuntu-24.04-arm') &&
    deployBackend.includes('RUNNER_ARCH_NAME: ${{ runner.arch }}') &&
    deployBackend.includes('linux/arm64 backend builds must run on an ARM64 GitHub runner.'),
  'prevents QEMU illegal instruction during npm ci in the backend image build'
);

addCheck(
  'backend deploy OIDC policy can update runtime parameters',
  backendOidcBootstrap.includes('"ssm:PutParameter"') &&
    backendOidcBootstrap.includes('$ParameterStorePathPrefix') &&
    backendOidcBootstrap.includes('RuntimeParameterUpdates'),
  'manual production admin access can write /aura/prod allowlist values after IAM bootstrap refresh'
);

addCheck(
  'gateway supports push deployment through orchestrator plan',
  [
    'gateway_changed',
    'should_deploy_gateway',
    'uses: ./.github/workflows/deploy-gateway-vercel.yml',
  ].every((needle) => production.includes(needle)) && gateway.includes('workflow_call:'),
  'gateway deploy is planned from changed gateway files and called as reusable workflow'
);

addCheck(
  'production summary exists',
  ['production-summary:', '### A. Run metadata', '### K. Production tag'].every((needle) =>
    production.includes(needle)
  ),
  'GitHub Step Summary tables'
);

addCheck(
  'CI/CD secrets docs exist',
  exists(path.join('docs', 'ci-cd-secrets.md')),
  'docs/ci-cd-secrets.md'
);

addCheck(
  'missing cloud config has no-op jobs',
  [
    'deploy-backend-noop:',
    'deploy-frontend-netlify-noop:',
    'deploy-frontend-aws-noop:',
    'deploy-gateway-noop:',
  ].every((needle) => production.includes(needle)),
  'paired deploy no-op jobs'
);

addCheck(
  'security gates remain in production workflow',
  ['Basic secret pattern scan', 'NPM production dependency audit', 'Generate npm SBOMs'].every((needle) =>
    production.includes(needle)
  ),
  'secret scan, npm audit, SBOM'
);

addCheck(
  'security harness contract remains wired',
  packageJson.scripts?.['security:harness'] === 'node scripts/security-harness-check.mjs'
    && (
      securityRunner.includes("['harness', 'npm run security:harness']")
      || (
        securityRunner.includes("name: 'harness'")
        && securityRunner.includes("args: ['run', 'security:harness']")
      )
    )
    && production.includes('uses: ./.github/workflows/ci.yml'),
  'security:harness script, security:all category, production CI reuse'
);

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
  console.error(`\n${failed.length} critical CI/CD structure check(s) failed.`);
  process.exit(1);
}

console.log('\nAll critical CI/CD structure checks passed.');
