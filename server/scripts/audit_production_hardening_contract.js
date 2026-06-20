#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const readText = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(readText(relativePath));

const failures = [];
const addFailure = (message) => failures.push(message);

const requireIncludes = (content, needle, message) => {
    if (!content.includes(needle)) {
        addFailure(message);
    }
};

const requireNotIncludes = (content, needle, message) => {
    if (content.includes(needle)) {
        addFailure(message);
    }
};

const requireRegex = (content, pattern, message) => {
    if (!pattern.test(content)) {
        addFailure(message);
    }
};

const trackedFiles = () => execSync('git ls-files', {
    cwd: repoRoot,
    encoding: 'utf8',
})
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const tracked = trackedFiles();
const packageJson = readJson('package.json');
const desktopReleaseWorkflow = readText('.github/workflows/desktop-release.yml');
const mobileReleaseWorkflow = readText('.github/workflows/mobile-release.yml');
const productionCicdWorkflow = readText('.github/workflows/production-cicd.yml');
const mobileDeliveryDocs = readText('docs/mobile-app-delivery.md');
const androidBuildGradle = readText('app/android/app/build.gradle');
const routingContract = readText('app/config/vercelRoutingContract.mjs');
const rootVercel = readText('vercel.json');
const appVercel = readText('app/vercel.json');
const rootNetlify = readText('netlify.toml');
const appNetlify = readText('app/netlify.toml');
const desktopRuntimeServer = readText('desktop/runtimeServer.cjs');
const serverDockerfile = readText('server/Dockerfile');
const serverIndex = readText('server/index.js');
const healthReadinessService = readText('server/services/healthReadinessService.js');
const healthDisclosureService = readText('server/services/healthDisclosureService.js');
const internalAiTokenService = readText('server/services/internalAiTokenService.js');
const orderPlacementService = readText('server/services/orderPlacementService.js');
const marketplaceIntegrityService = readText('server/services/marketplaceIntegrityService.js');
const deployFrontendS3 = readText('infra/aws/deploy-frontend-s3.ps1');
const deployReleaseScript = readText('infra/aws/deploy-release.sh');
const bootstrapSecurityPosture = readText('infra/aws/bootstrap-security-posture.ps1');
const backendDeployWorkflow = readText('.github/workflows/deploy-backend-aws.yml');
const deployNetlifyWorkflow = readText('.github/workflows/deploy-netlify.yml');
const deployFrontendAwsWorkflow = readText('.github/workflows/deploy-frontend-aws.yml');
const backendConnectivityDoctor = readText('app/scripts/check_backend_connectivity.mjs');
const productionLoginSmoke = readText('scripts/smoke-production-login.mjs');
const stagingSmoke = readText('server/scripts/staging_smoke.js');
const readme = readText('README.md');
const incidentRunbook = readText('docs/incident-runbook.md');
const awsBackendDocs = readText('docs/aws-backend-deployment.md');

if (packageJson.build?.win?.signAndEditExecutable !== true) {
    addFailure('package.json must sign and edit Windows executables by default for production desktop artifacts.');
}
if (packageJson.build?.win?.verifyUpdateCodeSignature !== true) {
    addFailure('package.json must verify Windows update code signatures by default for production desktop artifacts.');
}
requireIncludes(productionCicdWorkflow, 'require_windows_signing: false', 'Production CI/CD must allow the free unsigned desktop release lane.');
requireIncludes(productionCicdWorkflow, 'require_macos_signing: false', 'Production CI/CD must skip macOS signing by default.');
requireIncludes(productionCicdWorkflow, 'require_android_signing: false', 'Production CI/CD must skip Android signing by default.');
requireIncludes(productionCicdWorkflow, 'require_ios_signing: false', 'Production CI/CD must skip iOS signing by default.');
requireIncludes(productionCicdWorkflow, 'publish_store_release: false', 'Production CI/CD must skip store publishing by default.');
requireIncludes(desktopReleaseWorkflow, 'AURA_WINDOWS_SIGNING_MODE=unsigned', 'Desktop release workflow must explicitly support unsigned Windows publishing.');
requireIncludes(desktopReleaseWorkflow, 'Windows signing skipped because require_windows_signing=false', 'Desktop release workflow must explain unsigned Windows release behavior.');
requireIncludes(desktopReleaseWorkflow, 'macOS signing/notarization skipped because require_macos_signing=false', 'Desktop release workflow must explain unsigned macOS release behavior.');
requireIncludes(desktopReleaseWorkflow, 'Store publishing skipped because publish_store_release=false', 'Desktop release workflow must skip store publishing by default.');
requireIncludes(desktopReleaseWorkflow, 'Verify Windows signatures', 'Desktop release workflow must verify Windows signatures.');
requireIncludes(desktopReleaseWorkflow, '--config.win.verifyUpdateCodeSignature=true', 'Desktop release workflow must preserve update signature verification for signed runs.');
requireIncludes(desktopReleaseWorkflow, '--config.win.verifyUpdateCodeSignature=false', 'Desktop release workflow must disable update signature verification for unsigned runs.');

const trackedAndroidSigningBlobs = tracked.filter((filePath) => (
    /^app\/android\/ci\/.*\.(base64|jks|keystore|p12)$/i.test(filePath)
    && fs.existsSync(path.join(repoRoot, filePath))
));
if (trackedAndroidSigningBlobs.length > 0) {
    addFailure(`Android signing blobs must not be tracked: ${trackedAndroidSigningBlobs.join(', ')}`);
}
requireIncludes(mobileReleaseWorkflow, 'Android signing skipped because require_android_signing=false', 'Mobile release workflow must allow unsigned Android debug artifacts when signing is disabled.');
requireIncludes(mobileReleaseWorkflow, 'Android signing is required but keystore secrets are incomplete', 'Mobile release workflow must fail closed when Android signing is explicitly required and secrets are absent.');
requireIncludes(mobileReleaseWorkflow, 'iOS signing skipped because require_ios_signing=false', 'Mobile release workflow must allow simulator-only iOS validation when signing is disabled.');
requireIncludes(mobileReleaseWorkflow, 'Store publishing skipped because publish_store_release=false', 'Mobile release workflow must skip store publishing by default.');
requireIncludes(mobileReleaseWorkflow, 'ANDROID_RELEASE_KEYSTORE_BASE64', 'Mobile release workflow must materialize Android signing only from GitHub secrets.');
requireNotIncludes(mobileReleaseWorkflow, 'aura-public-update', 'Mobile release workflow must not use a repo-stored public Android update key.');
requireNotIncludes(mobileReleaseWorkflow, 'aura-public-internal-update-keystore', 'Mobile release workflow must not materialize tracked Android signing key material.');
requireIncludes(androidBuildGradle, 'signingConfig hasReleaseKeystore ? signingConfigs.release : signingConfigs.debug', 'Android release build must allow local no-cert release builds while CI supplies the public update key.');
requireNotIncludes(mobileDeliveryDocs, 'public internal update key', 'Mobile delivery docs must not describe a repo-stored Android signing fallback.');
requireNotIncludes(mobileDeliveryDocs, 'public key material is intentionally in the repo', 'Mobile delivery docs must not normalize tracked signing key material.');

const productionRoutingSurfaces = [
    ['vercel.json', rootVercel],
    ['app/vercel.json', appVercel],
    ['netlify.toml', rootNetlify],
    ['app/netlify.toml', appNetlify],
    ['desktop/runtimeServer.cjs', desktopRuntimeServer],
];
for (const [name, content] of productionRoutingSurfaces) {
    if (/13\.206\.172\.186|3\.109\.181\.238|\.sslip\.io/i.test(content)) {
        addFailure(`${name} must not contain a single-host or temporary sslip.io production backend origin.`);
    }
}
requireIncludes(routingContract, 'assertDeployableHostedBackendOrigin', 'Routing contract must expose deployable-origin validation.');
requireIncludes(routingContract, "hostname.endsWith('.sslip.io')", 'Routing contract must reject temporary sslip.io origins.');
requireIncludes(deployFrontendS3, 'durable production edge hostname', 'AWS frontend deploy must reject temporary backend origins.');
requireIncludes(backendDeployWorkflow, 'node ./app/scripts/print_hosted_backend_origin.mjs', 'Backend deploy workflow must use the shared backend origin contract.');
for (const [name, content] of [
    ['deploy-backend-aws.yml', backendDeployWorkflow],
    ['deploy-netlify.yml', deployNetlifyWorkflow],
    ['deploy-frontend-aws.yml', deployFrontendAwsWorkflow],
]) {
    if (/942679464475|arn:aws:iam::\d{12}:role|E34Z9POGIQYOCS|dbtrhsolhec1s\.cloudfront\.net|aura-(backend|frontend)-[a-z0-9-]*\d{12}/i.test(content)) {
        addFailure(`${name} must not contain account-specific production deploy defaults.`);
    }
}

requireRegex(serverDockerfile, /^USER\s+node$/m, 'Backend container must drop root privileges.');
requireIncludes(serverIndex, 'buildStartupReadinessFailure', 'Readiness route must delegate startup readiness decisions to a focused service.');
requireIncludes(healthReadinessService, "runtimeNodeEnv === 'production'", 'Production readiness must have explicit production behavior.');
requireIncludes(healthReadinessService, '? 0', 'Production readiness must default to no boot grace period.');
requireIncludes(healthReadinessService, "reason: 'async_startup_failed'", 'Production readiness must expose async startup failure as not ready.');
requireIncludes(healthReadinessService, "reason: 'async_startup_incomplete'", 'Production readiness must fail closed until async startup completes.');
requireIncludes(serverIndex, 'shouldExposeDetailedHealth', 'Public health route must gate detailed production health output.');
requireIncludes(serverIndex, 'buildPublicHealthPayload', 'Public health route must use a reduced production health payload.');
requireIncludes(serverIndex, "reason: 'health_ready_token_not_configured'", 'Production readiness must fail closed when HEALTH_READY_TOKEN is missing.');
requireIncludes(healthDisclosureService, 'isProductionRuntime', 'Health disclosure service must keep explicit production behavior.');
requireIncludes(healthDisclosureService, 'hasDetailedHealthTokenAccess', 'Health disclosure service must require token access for detailed production health.');
requireIncludes(healthDisclosureService, 'shouldFailClosedMissingHealthReadyToken', 'Health disclosure service must model production readiness token fail-closed behavior.');
requireIncludes(deployReleaseScript, 'HEALTH_READY_TOKEN is required for production readiness checks.', 'EC2 rollout must require HEALTH_READY_TOKEN before readiness probes.');
requireIncludes(deployReleaseScript, '--header "x-health-token: ${health_ready_token}"', 'EC2 rollout readiness probe must send x-health-token.');
requireIncludes(deployReleaseScript, 'AURA_INFRA_BUNDLE_SHA256', 'EC2 rollout must require an expected infra artifact SHA-256.');
requireIncludes(deployReleaseScript, 'AURA_IMAGE_BUNDLE_SHA256', 'EC2 rollout must require an expected image artifact SHA-256.');
requireIncludes(deployReleaseScript, 'verify_sha256 "${release_dir}/infra.tar.gz"', 'EC2 rollout must verify the infra bundle digest before extraction.');
requireIncludes(deployReleaseScript, 'verify_sha256 "${release_dir}/image.tar.gz"', 'EC2 rollout must verify the image bundle digest before docker load.');
requireIncludes(bootstrapSecurityPosture, 'guardduty create-detector', 'AWS security posture bootstrap must enable GuardDuty.');
requireIncludes(bootstrapSecurityPosture, 'configservice put-configuration-recorder', 'AWS security posture bootstrap must configure AWS Config recording.');
requireIncludes(bootstrapSecurityPosture, 'ec2 create-flow-logs', 'AWS security posture bootstrap must enable backend VPC Flow Logs.');
requireIncludes(awsBackendDocs, 'bootstrap-security-posture.ps1', 'AWS backend docs must include the security posture bootstrap step.');
requireIncludes(backendDeployWorkflow, '${AWS_BACKEND_BASE_URL%/}/health"', 'External deploy smoke must use public health summary, not private readiness.');
requireIncludes(backendDeployWorkflow, 'sha256sum "${RUNNER_TEMP}/aura-infra-${GITHUB_SHA}.tar.gz"', 'Backend deploy workflow must compute the infra artifact SHA-256.');
requireIncludes(backendDeployWorkflow, 'sha256sum "${RUNNER_TEMP}/aura-image-${GITHUB_SHA}.tar.gz"', 'Backend deploy workflow must compute the image artifact SHA-256.');
requireIncludes(backendDeployWorkflow, 'sha256sum --check --status', 'Backend deploy workflow must verify the bootstrap infra bundle before extracting it on EC2.');
requireIncludes(backendDeployWorkflow, 'AURA_IMAGE_BUNDLE_SHA256', 'Backend deploy workflow must pass expected image artifact SHA-256 to EC2.');
requireIncludes(backendConnectivityDoctor, "name: 'summary health', path: '/health', critical: true", 'Backend doctor must treat public health summary as the critical unauthenticated probe.');
requireIncludes(backendConnectivityDoctor, "name: 'readiness', path: '/health/ready', critical: false", 'Backend doctor must keep private readiness non-critical unless token support is added.');
requireIncludes(productionLoginSmoke, 'proxied health summary is ok', 'Production login smoke must use the public health summary.');
requireIncludes(stagingSmoke, "'x-health-token': process.env.HEALTH_READY_TOKEN", 'Staging smoke must send HEALTH_READY_TOKEN when checking private readiness.');
requireIncludes(readme, 'production requires `x-health-token`', 'README must document token-protected production readiness.');
requireIncludes(incidentRunbook, '`x-health-token` header', 'Incident runbook must document readiness token usage.');
requireIncludes(awsBackendDocs, '`HEALTH_READY_TOKEN` is required in production Parameter Store', 'AWS backend docs must require production readiness token.');
requireIncludes(internalAiTokenService, "getRuntimeNodeEnv() === 'production'", 'Internal AI legacy auth must have explicit production behavior.');
requireIncludes(internalAiTokenService, '? false', 'Internal AI legacy auth must default off in production.');
requireNotIncludes(internalAiTokenService, 'parseBoolean(process.env.AI_INTERNAL_AUTH_ALLOW_LEGACY_SECRET, !hasSignedTokenConfig)', 'Internal AI legacy auth must not default allow when signed-token config is missing.');
requireNotIncludes(orderPlacementService, 'scanForMarketplaceAnomalies', 'Order placement must not run graph anomaly scans in the checkout transaction path.');
requireNotIncludes(orderPlacementService, 'integrityInsights', 'Order placement must not persist synthetic integrity insights in priceBreakdown.');
requireIncludes(marketplaceIntegrityService, 'limitedData.forEach', 'Marketplace integrity scans must iterate the bounded neighborhood only.');
requireIncludes(marketplaceIntegrityService, "protectionLevel: 'bounded-graph-heuristic'", 'Marketplace integrity scan output must not claim theatrical graph-isomorphism protection.');

const report = {
    checked: {
        trackedFileCount: tracked.length,
        productionRoutingSurfaces: productionRoutingSurfaces.map(([name]) => name),
        trackedAndroidSigningBlobs,
    },
    failures,
};

console.log(JSON.stringify(report, null, 2));

if (failures.length > 0) {
    process.exitCode = 1;
}
