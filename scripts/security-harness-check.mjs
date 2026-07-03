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
const supplyChainPinCheck = read('scripts/security/check-supply-chain-pins.mjs');
const securityDockerTool = read('scripts/security/run-docker-tool.mjs');
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
const freeScannerWorkflow = read('.github/workflows/free-security-scanners.yml');
const stagingOpsWatchWorkflow = read('.github/workflows/staging-ops-watch.yml');
const freeScannerScript = read('scripts/security-free-scanners.mjs');
const edgeNginx = read('infra/edge/nginx/auth-rate-limit.conf');
const edgeCrsCompose = read('infra/edge/modsecurity-crs/docker-compose.example.yml');
const edgeCrowdsec = read('infra/edge/crowdsec/acquis.yaml');
const splitRuntimeCompose = read('docker-compose.split-runtime.yml');
const awsRuntimeCompose = read('infra/aws/docker-compose.ec2.yml');
const observabilityAlerts = read('infra/observability/prometheus/alerts/login-security.yml');

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
  ['security:malware-runtime', 'node scripts/validate-upload-malware-runtime.mjs'],
  ['security:edge-assets', 'node scripts/validate-edge-security-assets.mjs'],
  ['security:post-merge-smoke', 'node scripts/post-merge-security-smoke.mjs'],
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
  'edge-assets',
  'malware-runtime',
  'free-scanners',
  'secrets',
  'deps',
];

for (const category of requiredRunnerCategories) {
  addCheck(
    `security runner category ${category}`,
    securityRunner.includes(`name: '${category}'`)
      && securityRunner.includes(`args: ['run', 'security:${category}']`),
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
  'desktop update signatures are verified by default',
  rootPackage.build?.win?.signAndEditExecutable === true
    && rootPackage.build?.win?.verifyUpdateCodeSignature === true,
  'package.json Windows desktop signing and updater verification defaults'
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
  includesAll(ciWorkflow, [
    "scripts/security-*.mjs",
    "scripts/validate-edge-security-assets.mjs",
    "scripts/validate-upload-malware-runtime.mjs",
    "infra/edge/**",
    "infra/security/**",
    "security-audit-exceptions.json",
    ".gitleaks.toml",
  ]),
  'security changes trigger backend/security surfaces'
);

addCheck(
  'free scanner Docker fallbacks are pinned',
  includesAll(freeScannerScript, [
    'ghcr.io/google/osv-scanner:v2.3.6',
    'aquasec/trivy:0.69.3',
    'semgrep/semgrep:1.163.0',
    'FREE_SECURITY_OSV_IMAGE',
    'FREE_SECURITY_TRIVY_IMAGE',
    'FREE_SECURITY_SEMGREP_IMAGE',
  ]),
  'OSV, Trivy, and Semgrep images avoid mutable latest defaults'
);

addCheck(
  'weekly free scanner workflow is scheduled',
  includesAll(freeScannerWorkflow, [
    'schedule:',
    'FREE_SECURITY_SCANNERS_REQUIRED: "true"',
    'npm run security:free-scanners',
    'free-security-scanner-reports',
  ]),
  '.github/workflows/free-security-scanners.yml'
);

addCheck(
  'staging ops watch runs live DAST',
  includesAll(stagingOpsWatchWorkflow, [
    'Run live staging DAST baseline',
    'STAGING_URL:',
    'FREE_SECURITY_SCANNERS_REQUIRED: "true"',
    'FREE_SECURITY_ZAP_BASELINE_REQUIRED: "true"',
    'FREE_SECURITY_ZAP_BASELINE_WARN_ONLY:',
    'npm run security:free-scanners -- --only=zap-baseline',
    'staging-dast-security-reports',
  ]) && includesAll(freeScannerScript, [
    'FREE_SECURITY_ZAP_BASELINE_WARN_ONLY',
    'hasZapFailFinding',
    'hasZapWarningFinding',
    'isZapBaselineWarningOnly',
    'zapBaselineStatus(result)',
    'warning-only scanner findings are recorded',
  ]),
  '.github/workflows/staging-ops-watch.yml'
);

addCheck(
  'staging ops watch action refs are immutable',
  includesAll(stagingOpsWatchWorkflow, [
    'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd',
    'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
    'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
  ]) && includesAll(supplyChainPinCheck, [
    'strictPinnedWorkflowFiles',
    'staging-ops-watch.yml',
    'strict workflow action refs',
  ]),
  '.github/workflows/staging-ops-watch.yml uses full action SHAs and the pin checker enforces it'
);

addCheck(
  'required ZAP baseline cannot silently skip without staging URL',
  includesAll(freeScannerScript, [
    'FREE_SECURITY_ZAP_BASELINE_REQUIRED',
    "status: zapBaselineRequired ? 'failed' : 'skipped'",
    'OWASP ZAP baseline requires an explicit non-production target',
  ]),
  'scripts/security-free-scanners.mjs'
);

addCheck(
  'accepted Checkov findings are scoped before SARIF upload',
  includesAll(securityDockerTool, [
    'acceptedCheckovFindings',
    "ruleId: 'CKV_K8S_35'",
    "path: 'k8s/base/deployment.yaml'",
    "ruleId: 'CKV_K8S_43'",
    "ruleId: 'CKV_AWS_18'",
    "path: 'infra/aws/cloudformation-bootstrap.yml'",
    "ruleId: 'CKV_AWS_111'",
    'filterCheckovSarifReport',
    'filterAcceptedCheckovFindings({ jsonReport: checkovReport, sarifReport: checkovSarifReport })',
  ]),
  'scripts/security/run-docker-tool.mjs filters only accepted Checkov baseline findings by rule and path'
);

addCheck(
  'Semgrep Docker wrapper does not scan generated reports',
  includesAll(securityDockerTool, [
    "'--exclude', 'security-reports'",
    "'--json-output', '/src/security-reports/semgrep-report.json'",
    "'--sarif-output', '/src/security-reports/semgrep-report.sarif'",
  ]),
  'Semgrep output mount is excluded from the scan target to avoid self-scanning generated report mirrors'
);

addCheck(
  'Semgrep accepted findings stay exact and reviewed',
  includesAll(securityDockerTool, [
    'acceptedSemgrepFindings',
    "ruleId: 'javascript.lang.security.detect-child-process.detect-child-process'",
    "path: 'scripts/auth-runner.js'",
    'line: 111',
    "path: 'scripts/student-pack-cli-doctor.mjs'",
    'line: 162',
    "path: 'server/services/externalCatalogService.js'",
    'line: 106',
    "path: 'server/services/malwareScanService.js'",
    'line: 209',
    'filterAcceptedSemgrepFindings({ jsonReport: semgrepJsonReport, sarifReport: semgrepSarifReport })',
    'Found ${findingCount} unaccepted Semgrep ERROR finding(s)',
  ]) && !securityDockerTool.includes("'--error'"),
  'Semgrep runs to a report, filters only reviewed rule/path/line findings, then fails on any remaining ERROR finding'
);

addCheck(
  'upload malware runtime validation is wired',
  includesAll(rootPackage.scripts?.['security:malware-runtime'] || '', ['validate-upload-malware-runtime.mjs'])
    && includesAll(splitRuntimeCompose, ['clamav/clamav:1.4', 'UPLOAD_MALWARE_SCAN_FAIL_CLOSED', 'YARA_RULES_PATH'])
    && includesAll(awsRuntimeCompose, ['clamav/clamav:1.4', 'UPLOAD_MALWARE_SCAN_FAIL_CLOSED', 'YARA_RULES_PATH']),
  'ClamAV/YARA config and runtime self-check'
);

addCheck(
  'upload security telemetry has Prometheus alerts',
  includesAll(observabilityAlerts, [
    'aura_upload_security_events_total',
    'AuraUploadMalwareBlocked',
    'AuraUploadScanUnavailable',
    'AuraUploadMimeMismatchBurst',
  ]),
  'infected, scan_failed, and mismatch upload alerts'
);

addCheck(
  'self-hosted edge security assets are present',
  includesAll(edgeNginx, ['limit_req_zone', 'aura_login_ip', 'aura_admin_ip', 'proxy_pass http://aura_waf'])
    && includesAll(edgeCrsCompose, ['owasp/modsecurity-crs:nginx', 'MODSEC_RULE_ENGINE', 'BLOCKING_PARANOIA'])
    && includesAll(edgeCrowdsec, ['type: nginx', 'type: caddy']),
  'NGINX limits, OWASP CRS, and CrowdSec templates'
);

addCheck(
  'production admin access requires passkey in runtime compose',
  includesAll(awsRuntimeCompose, ['ADMIN_REQUIRE_PASSKEY: "true"', 'AUTH_DEVICE_CHALLENGE_MODE: always']),
  'admin passkey enforcement remains enabled for EC2 runtime'
);

addCheck(
  'production AI chat defaults closed in runtime compose',
  awsRuntimeCompose.includes('AI_PUBLIC_CHAT_ACCESS_ENABLED: ${AI_PUBLIC_CHAT_ACCESS_ENABLED:-false}'),
  'infra/aws/docker-compose.ec2.yml keeps anonymous AI chat opt-in'
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

addCheck(
  'production reusable workflow calls use explicit secret maps',
  !productionWorkflow.includes('secrets: inherit') && [
    'AWS_DEPLOY_ROLE_ARN: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}',
    'AWS_FRONTEND_DEPLOY_ROLE_ARN: ${{ secrets.AWS_FRONTEND_DEPLOY_ROLE_ARN }}',
    'NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}',
    'VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}',
  ].every((needle) => productionWorkflow.includes(needle)),
  'production-cicd.yml avoids broad reusable-workflow secret inheritance'
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
