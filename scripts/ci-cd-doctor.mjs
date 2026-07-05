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
  'quality.yml',
  'codeql.yml',
  'security.yml',
  'security-gates.yml',
  'status-watch.yml',
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
const deployFrontendNetlify = read('.github/workflows/deploy-netlify.yml');
const deployFrontendAws = read('.github/workflows/deploy-frontend-aws.yml');
const backendOidcBootstrap = read('infra/aws/bootstrap-github-oidc.ps1');
const frontendOidcBootstrap = read('infra/aws/bootstrap-frontend-github-oidc.ps1');
const packageJson = JSON.parse(read('package.json') || '{}');
const securityRunner = read('scripts/security-runner.mjs');
const qualityWorkflow = read('.github/workflows/quality.yml');
const codeqlWorkflow = read('.github/workflows/codeql.yml');
const securityGatesWorkflow = read('.github/workflows/security-gates.yml');
const statusWatchWorkflow = read('.github/workflows/status-watch.yml');

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
  'production push gate pipeline exists',
  productionOnPush.includes('name: Production Release Gate On Main Push') && productionOnPush.includes('branches: ["main"]'),
  '.github/workflows/production-on-push.yml'
);

addCheck(
  'status watch observes current production and quality workflows',
  [
    'Production Release Gate On Main Push',
    'Quality Foundation',
    'Security Gates',
    'Deploy Backend To AWS',
    'Deploy Frontend To Netlify, Vercel, And AWS',
    'Deploy Gateway To Vercel',
    'Desktop Release',
    'Mobile Release',
  ].every((needle) => statusWatchWorkflow.includes(`- ${needle}`)),
  '.github/workflows/status-watch.yml'
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
  'manual production dispatch pipeline wires all production surfaces',
  [
    'workflow_dispatch:',
    'confirm_production:',
    'staging-promotion-gate:',
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
  'backend, storefront, gateway, desktop, mobile lanes are still available for confirmed manual dispatch'
);

addCheck(
  'main push pipeline requires manual confirmation before production dispatches',
  [
    "if: github.event_name == 'workflow_dispatch' && inputs.confirm_production == 'PRODUCTION'",
    'Production dispatch confirmation',
    'confirm_production=PRODUCTION required',
  ].every((needle) => productionOnPush.includes(needle)) &&
    (productionOnPush.match(/if: github\.event_name == 'workflow_dispatch' && inputs\.confirm_production == 'PRODUCTION'/g) || []).length >= 5,
  'main push runs preflight and staging gate only; deploy/release dispatch requires workflow_dispatch confirmation'
);

addCheck(
  'main push pipeline requires staging promotion before production deploys',
  [
    'staging-promotion-gate:',
    '--workflow staging-ops-watch.yml',
    '--label "Staging promotion gate"',
    'needs: staging-promotion-gate',
    'STAGING_RESULT: ${{ needs.staging-promotion-gate.result }}',
    '| Staging: same-commit promotion gate | ${STAGING_RESULT} |',
  ].every((needle) => productionOnPush.includes(needle)),
  'production-on-push dispatches and watches staging-ops-watch before production lanes'
);

addCheck(
  'main push pipeline runs business-critical release preflight',
  [
    'Validate business-critical release contracts',
    'npm --prefix server ci',
    'npm run security:routes:coverage:strict',
    'npm run payment:smoke',
    'npm run security:business-logic',
    'npm run security:webhooks',
    'tests/moneyMinorStorage.test.js',
    'tests/moneyMinorBackfillAudit.test.js',
  ].every((needle) => productionOnPush.includes(needle)),
  'production-on-push blocks production deploys on route, payment, business logic, webhook, and money-minor regressions'
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
  'CloudFront deploy verification tolerates unavailable invalidation read permission',
  [deployFrontendNetlify, deployFrontendAws].every((workflow) =>
    workflow.includes('--query "Invalidation.Id"') &&
    workflow.includes('if ! aws cloudfront wait invalidation-completed') &&
    workflow.includes('CloudFront invalidation wait was unavailable; continuing with HTTP readiness polling.') &&
    workflow.includes('READINESS_ATTEMPTS=30') &&
    workflow.includes('CloudFront did not serve the app shell after invalidation and readiness polling.')
  ),
  'prevents false failed main releases when the current deploy role can create invalidations but cannot read them yet'
);

addCheck(
  'frontend OIDC bootstrap grants CloudFront invalidation read',
  frontendOidcBootstrap.includes('"cloudfront:GetInvalidation"'),
  'future frontend deploy roles can use aws cloudfront wait invalidation-completed'
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

addCheck(
  'quality command surface exists',
  [
    'quality:lint',
    'quality:typecheck',
    'quality:test',
    'quality:coverage',
    'quality:deadcode',
    'quality:secrets',
    'quality:deps',
    'quality:semgrep',
    'quality:trivy',
    'quality:osv',
    'quality:dockerfile',
    'quality:shell',
    'quality:actions',
    'quality:sonar',
    'quality:all',
  ].every((script) => packageJson.scripts?.[script]),
  'package.json quality:* scripts'
);

addCheck(
  'quality foundation workflow exists',
  qualityWorkflow.includes('name: Quality Foundation') &&
    qualityWorkflow.includes('Quality, tests, and coverage') &&
    qualityWorkflow.includes('Repo hygiene') &&
    qualityWorkflow.includes('OSV dependency scan') &&
    qualityWorkflow.includes('Sonar quality gate'),
  '.github/workflows/quality.yml'
);

addCheck(
  'CodeQL advanced semantic analysis workflow exists',
  codeqlWorkflow.includes('name: CodeQL') &&
    codeqlWorkflow.includes('github/codeql-action/init@v4') &&
    codeqlWorkflow.includes('github/codeql-action/analyze@v4') &&
    codeqlWorkflow.includes('- javascript-typescript') &&
    codeqlWorkflow.includes('- actions') &&
    codeqlWorkflow.includes('queries: security-and-quality'),
  '.github/workflows/codeql.yml'
);

addCheck(
  'third-party SARIF contract validation remains wired',
  packageJson.scripts?.['security:sarif-contract'] === 'node scripts/security/validate-sarif-contract.mjs' &&
    securityGatesWorkflow.includes('npm run security:sarif-contract'),
  'security:sarif-contract script and Security Gates enforcement'
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
