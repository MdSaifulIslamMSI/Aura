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
  'rollback-storefront-vercel.yml',
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
const ciWorkflow = read('.github/workflows/ci.yml');
const desktop = read('.github/workflows/desktop-release.yml');
const mobile = read('.github/workflows/mobile-release.yml');
const gateway = read('.github/workflows/deploy-gateway-vercel.yml');
const deployBackend = read('.github/workflows/deploy-backend-aws.yml');
const deployFrontendNetlify = read('.github/workflows/deploy-netlify.yml');
const deployFrontendAws = read('.github/workflows/deploy-frontend-aws.yml');
const rollbackNetlify = read('.github/workflows/rollback-netlify.yml');
const rollbackFrontendAws = read('.github/workflows/rollback-frontend-aws.yml');
const rollbackFrontendAwsScript = read('infra/aws/rollback-frontend-s3.sh');
const rollbackStorefrontVercel = read('.github/workflows/rollback-storefront-vercel.yml');
const rollbackGateway = read('.github/workflows/rollback-gateway-vercel.yml');
const rollbackStorefrontVercelScript = read('scripts/rollback-storefront-vercel.sh');
const ciCdDocs = read('docs/ci-cd.md');
const productionInstallDocs = read('docs/production-cicd-install.md');
const rootDockerignore = read('.dockerignore');
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

const leadingSpaces = (line) => line.match(/^\s*/)?.[0].length || 0;

const workflowDispatchInputNames = (workflow) => {
  const lines = workflow.split(/\r?\n/);
  const dispatchIndex = lines.findIndex((line) => /^\s*workflow_dispatch:\s*$/.test(line));
  if (dispatchIndex === -1) {
    return [];
  }

  const dispatchIndent = leadingSpaces(lines[dispatchIndex]);
  let inputsIndex = -1;
  for (let index = dispatchIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }

    const indent = leadingSpaces(line);
    if (indent <= dispatchIndent) {
      break;
    }

    if (indent === dispatchIndent + 2 && line.trim() === 'inputs:') {
      inputsIndex = index;
      break;
    }
  }

  if (inputsIndex === -1) {
    return [];
  }

  const inputsIndent = leadingSpaces(lines[inputsIndex]);
  const inputIndent = inputsIndent + 2;
  const inputNames = [];
  for (let index = inputsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }

    const indent = leadingSpaces(line);
    if (indent <= inputsIndent) {
      break;
    }

    const match = line.match(new RegExp(`^\\s{${inputIndent}}([A-Za-z0-9_-]+):\\s*$`));
    if (match) {
      inputNames.push(match[1]);
    }
  }

  return inputNames;
};

const workflowJobSection = (workflow, jobName) => {
  const match = workflow.match(new RegExp(`\\n  ${jobName}:\\n[\\s\\S]*?(?=\\n  [a-zA-Z0-9_-]+:\\n|$)`));
  return match?.[0] || '';
};

const productionDispatchInputs = workflowDispatchInputNames(production);
const productionQualityGates = workflowJobSection(production, 'quality-gates');

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
  'manual production command center fits GitHub dispatch input limit',
  productionDispatchInputs.length > 0 &&
    productionDispatchInputs.length <= 10 &&
    ['deploy_targets', 'release_targets', 'rollback_targets'].every((input) =>
      productionDispatchInputs.includes(input)
    ),
  `inputs=${productionDispatchInputs.length}/10; target inputs collapse selected deploy/release/rollback lanes`
);

addCheck(
  'root backend build context excludes local student credentials',
  rootDockerignore.split(/\r?\n/).includes('.student-pack.local.env') &&
    ciWorkflow.includes('- ".dockerignore"') &&
    ciWorkflow.includes('Dockerfile|.dockerignore|Makefile'),
  '.dockerignore is secret-safe and routes root context policy changes through backend CI'
);

addCheck(
  'production storefront target is one non-overlapping multi-host lane',
  production.includes('backend, frontend-multihost, gateway') &&
    production.includes('INPUT_DEPLOY_FRONTEND_NETLIFY="$(target_selected "${INPUT_DEPLOY_TARGETS}" frontend-multihost storefront)"') &&
    production.includes('INPUT_DEPLOY_FRONTEND_AWS="false"') &&
    !production.includes('frontend-netlify netlify storefront') &&
    !production.includes('frontend-aws aws-frontend'),
  'the command center cannot concurrently dispatch two writers to the AWS storefront bucket'
);

addCheck(
  'production command center rejects deploy and rollback overlap',
  production.includes('reject_overlapping_lane backend "${INPUT_DEPLOY_BACKEND}" "${INPUT_ROLLBACK_BACKEND}"') &&
    production.includes('reject_overlapping_lane frontend-multihost "${INPUT_DEPLOY_FRONTEND_NETLIFY}" "${INPUT_ROLLBACK_FRONTEND_NETLIFY}"') &&
    production.includes('reject_overlapping_lane gateway "${INPUT_DEPLOY_GATEWAY}" "${INPUT_ROLLBACK_GATEWAY}"'),
  'a provider lane cannot deploy and roll back in the same workflow run'
);

addCheck(
  'production mutations share one non-canceling parent lock',
  production.includes('group: aura-production-mutation') &&
    production.includes('cancel-in-progress: false') &&
    (production.match(/parent_holds_production_lock: true/g) || []).length === 7 &&
    [deployFrontendAws, rollbackNetlify, rollbackFrontendAws, rollbackStorefrontVercel, rollbackGateway]
      .every((workflow) =>
        workflow.includes('parent_holds_production_lock:') &&
        workflow.includes("|| 'aura-production-mutation'") &&
        workflow.includes('cancel-in-progress: false')
      ) &&
    (deployFrontendNetlify.match(/parent_holds_production_lock: true/g) || []).length === 3,
  'command-center and standalone frontend/gateway operations serialize without child reusable-workflow deadlock'
);

addCheck(
  'production deploys queue while previews retain cancellation',
  [deployFrontendNetlify, gateway].every((workflow) =>
    workflow.includes("inputs.target == 'production' && 'aura-production-mutation'") &&
    workflow.includes("cancel-in-progress: ${{ inputs.target != 'production' }}")
  ) &&
    deployFrontendNetlify.includes("format('frontend-{0}'") &&
    gateway.includes("format('gateway-vercel-{0}'"),
  'production multi-host and gateway runs never cancel in-flight; preview runs still supersede stale work'
);

addCheck(
  'production command-center docs use canonical lanes and rollback refs',
  [ciCdDocs, productionInstallDocs].every((document) =>
    document.includes('deploy_targets=backend,frontend-multihost,gateway') &&
    document.includes('rollback_targets=backend,frontend-multihost,gateway') &&
    document.includes('rollback_refs_json={"backend":"sha"') &&
    document.includes('parent_holds_production_lock') &&
    !document.includes('deploy_targets=backend,frontend-netlify,gateway') &&
    !document.includes('rollback_targets=backend,frontend-netlify,frontend-aws,gateway')
  ),
  'operator docs match the accepted target vocabulary, per-provider refs, and same-lane rejection policy'
);

addCheck(
  'production rollback refs are provider-specific',
  productionDispatchInputs.includes('rollback_refs_json') &&
    !productionDispatchInputs.includes('rollback_ref') &&
    ['rollback_backend_ref', 'rollback_netlify_ref', 'rollback_vercel_storefront_ref', 'rollback_aws_frontend_ref', 'rollback_gateway_ref']
      .every((name) => production.includes(`${name}: \${{ steps.plan.outputs.${name} }}`)),
  'one JSON object carries independently keyed backend and provider rollback identifiers'
);

addCheck(
  'multi-host storefront auto rollback covers every mutated provider',
  deployFrontendNetlify.includes('Capture provider-specific production rollback targets') &&
    deployFrontendNetlify.includes('rollback-netlify-on-production-failure:') &&
    deployFrontendNetlify.includes('rollback-vercel-storefront-on-production-failure:') &&
    deployFrontendNetlify.includes('rollback-aws-storefront-on-production-failure:') &&
    production.includes('rollback-frontend-netlify:') &&
    production.includes('rollback-frontend-vercel-storefront:') &&
    production.includes('rollback-frontend-aws:') &&
    rollbackStorefrontVercel.includes('scripts/rollback-storefront-vercel.sh') &&
    rollbackStorefrontVercelScript.includes('npx vercel rollback') &&
    (deployFrontendNetlify.match(/deployment_attempted: \$\{\{ steps\.mutation\.outputs\.attempted \}\}/g) || []).length === 3 &&
    deployFrontendNetlify.includes("needs.deploy-production.outputs.deployment_attempted == 'true'") &&
    deployFrontendNetlify.includes("needs.deploy-vercel-production.outputs.deployment_attempted == 'true'") &&
    deployFrontendNetlify.includes("needs.deploy-aws-production.outputs.deployment_attempted == 'true'"),
  'partial deploy failures and post-deploy smoke failures restore Netlify, Vercel, and AWS independently'
);

addCheck(
  'storefront rollback targets are captured and bound immutably',
  deployFrontendNetlify.includes('https://api.vercel.com/v4/aliases/${vercel_production_host}') &&
    deployFrontendNetlify.includes(".deploymentId // .deployment.id // empty") &&
    deployFrontendNetlify.includes('test "${vercel_project_id}" = "${VERCEL_PROJECT_ID}"') &&
    !deployFrontendNetlify.includes('api.vercel.com/v6/deployments') &&
    rollbackStorefrontVercelScript.includes('require_env VERCEL_ORG_ID') &&
    rollbackStorefrontVercelScript.includes('require_env VERCEL_PROJECT_ID') &&
    rollbackStorefrontVercelScript.includes('--project "${VERCEL_PROJECT_ID}"') &&
    rollbackStorefrontVercelScript.includes('VERCEL_LINK_FILE="${vercel_link_file}" node') &&
    rollbackStorefrontVercelScript.includes('npx vercel rollback status "${VERCEL_PROJECT_ID}"') &&
    !rollbackStorefrontVercelScript.includes('--scope'),
  'Vercel restores the deployment currently bound to production and verifies immutable org/project ids'
);

addCheck(
  'AWS storefront snapshot fails closed and cleans partial state',
  deployFrontendNetlify.includes('id: snapshot') &&
    deployFrontendNetlify.includes('cleanup_partial_snapshot()') &&
    deployFrontendNetlify.includes('AWS frontend rollback snapshot failed; removing the partial snapshot.') &&
    deployFrontendNetlify.includes('echo "rollback_ref=${GITHUB_SHA}" >> "$GITHUB_OUTPUT"') &&
    !deployFrontendNetlify.includes('continuing with the new production deploy') &&
    rollbackFrontendAwsScript.includes('No completed AWS frontend rollback snapshot matched') &&
    rollbackFrontendAwsScript.includes('Refusing to execute target code in the credentialed restore job.') &&
    !rollbackFrontendAws.includes('Checkout rebuild rollback source') &&
    !rollbackFrontendAwsScript.includes('npm --prefix'),
  'the S3 publish and restore paths require a complete manifest-backed snapshot and never execute historical app code'
);

addCheck(
  'gateway production mutation captures and restores its previous deployment',
  gateway.includes('Capture current production gateway deployment') &&
    gateway.includes('Mark gateway production mutation attempt') &&
    gateway.includes('Restore previous gateway after a failed production mutation') &&
    gateway.includes('timeout-minutes: 60') &&
    gateway.includes('timeout --signal=TERM --kill-after=30s 30m npx vercel deploy') &&
    gateway.includes('https://api.vercel.com/v4/aliases/${VERCEL_GATEWAY_ALIAS}') &&
    gateway.indexOf('Capture current production gateway deployment') < gateway.indexOf('Mark gateway production mutation attempt') &&
    gateway.indexOf('Mark gateway production mutation attempt') < gateway.lastIndexOf('npx vercel deploy'),
  'gateway publish failures restore the exact deployment that owned the production alias before mutation'
);

addCheck(
  'backend rollback target is captured explicitly and never inferred by mtime',
    deployBackend.includes('Capture current backend rollback release') &&
    deployBackend.includes('backend_rollback_ref:') &&
    deployBackend.includes('timeout-minutes: 120') &&
    deployBackend.includes('Configure fresh AWS credentials for deployment') &&
    deployBackend.includes('Refresh AWS credentials for failure restoration') &&
    deployBackend.includes("steps.rollback_credentials.outcome == 'success'") &&
    (deployBackend.match(/InvocationDoesNotExist/g) || []).length >= 2 &&
    read('infra/aws/rollback-backend.sh').includes('InvocationDoesNotExist') &&
    deployBackend.includes('refusing a same-SHA redeploy that would overwrite rollback artifacts') &&
    deployBackend.indexOf('Capture current backend rollback release') < deployBackend.indexOf('Upload deployment artifacts to S3') &&
    read('infra/aws/deploy-release.sh').includes('same-SHA redeploys cannot preserve an immutable rollback target') &&
    deployBackend.includes('Restore previous backend after post-activation verification failure') &&
    deployBackend.indexOf('Build backend container image') < deployBackend.indexOf('Configure fresh AWS credentials for deployment') &&
    deployBackend.indexOf('Configure fresh AWS credentials for deployment') < deployBackend.indexOf('Upload deployment artifacts to S3') &&
    production.includes('needs.deploy-backend.outputs.backend_rollback_ref') &&
    production.includes('backend rollback requires rollback_refs_json.backend as a full known-good commit SHA.') &&
    !read('infra/aws/rollback-backend.sh').includes("find \"${releases_dir}\" -mindepth 1 -maxdepth 1 -type d ! -name \"${current_sha}\" -printf '%T@ %f\\n'"),
  'manual rollback requires a known-good SHA and automatic rollback uses the pre-mutation active SHA'
);

addCheck(
  'manual production command center grants CI reusable workflow permissions',
  productionQualityGates.includes('uses: ./.github/workflows/ci.yml') &&
    productionQualityGates.includes('contents: read') &&
    productionQualityGates.includes('pull-requests: read') &&
    ciWorkflow.includes('workflow_call:') &&
    ciWorkflow.includes('pull-requests: read'),
  'ci.yml workflow_call needs read-only pull request metadata; the caller must not under-grant it'
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
  'desktop release fails closed without Firebase auth configuration',
  desktop.includes('Validate desktop Firebase auth configuration')
    && desktop.includes('node scripts/release/validate-desktop-firebase-config.mjs'),
  'desktop-release.yml release-preflight'
);

addCheck(
  'desktop release defaults to a fast Windows x64 lane',
  desktop.includes('release_mode:')
    && desktop.includes('default: fast')
    && desktop.includes("inputs.release_mode == 'full'")
    && desktop.includes("'desktop:dist:win:all' || 'desktop:dist:win'"),
  'desktop-release.yml keeps full cross-platform publishing as an explicit mode'
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
