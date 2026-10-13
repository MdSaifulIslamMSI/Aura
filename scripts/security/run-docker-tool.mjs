import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { extractJsonReport } from './report-utils.mjs';
import {
  countNucleiGatingFindings,
  filterNucleiJsonlReport,
  filterNucleiSarifReport,
  isAcceptedNucleiFinding,
  loadNucleiExceptions,
  markNucleiSarifExecutionSuccessful,
  nucleiMatchedHost,
  nucleiTemplateId,
  readNucleiJsonlFindings,
} from './nuclei-baseline.mjs';

const tool = process.argv[2] || '';
const extraArgs = process.argv.slice(3);

const run = (command, args, options = {}) => {
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  // This local security harness only runs allowlisted Docker/Git commands with shell disabled.
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    input: options.input,
    encoding: options.input ? 'utf8' : undefined,
    stdio: options.capture ? ['pipe', 'pipe', 'pipe'] : (options.input ? ['pipe', 'pipe', 'pipe'] : 'inherit'),
  });

  if (options.capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  } else if (options.input) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }

  if (result.error) {
    console.error(`${command} failed: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
  return result;
};

const repoRoot = (() => {
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  // Fixed git command used only to locate the repository root.
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }
  return process.cwd();
})();

const hostPath = (value) => path.resolve(value).replace(/\\/g, '/');
const reportDir = path.join(repoRoot, 'security-reports');
const trivyCacheDir = path.join(repoRoot, '.trivycache');

fs.mkdirSync(reportDir, { recursive: true });
fs.mkdirSync(trivyCacheDir, { recursive: true });

const repoMount = `${hostPath(repoRoot)}:/project`;
const repoAsSrcMount = `${hostPath(repoRoot)}:/src`;
const repoAsRepoMount = `${hostPath(repoRoot)}:/repo`;
const reportMount = `${hostPath(reportDir)}:/zap/wrk`;
const cacheMount = `${hostPath(trivyCacheDir)}:/root/.cache/`;

const images = {
  gitleaks: process.env.GITLEAKS_IMAGE || 'ghcr.io/gitleaks/gitleaks:v8.30.1',
  semgrep: process.env.SEMGREP_IMAGE || 'semgrep/semgrep:1.163.0',
  trivy: process.env.TRIVY_IMAGE || 'aquasec/trivy:0.69.3',
  zap: process.env.ZAP_IMAGE || 'ghcr.io/zaproxy/zaproxy:stable',
  hadolint: process.env.HADOLINT_IMAGE || 'hadolint/hadolint:v2.14.0-debian',
  checkov: process.env.CHECKOV_IMAGE || 'bridgecrew/checkov:3.2.485',
  tfsec: process.env.TFSEC_IMAGE || 'aquasec/tfsec:v1.28.14',
  terrascan: process.env.TERRASCAN_IMAGE || 'tenable/terrascan:1.19.9',
  zizmor: process.env.ZIZMOR_IMAGE || 'ghcr.io/zizmorcore/zizmor:1.29.0',
  nuclei: process.env.NUCLEI_IMAGE || 'projectdiscovery/nuclei:v3.11.1',
};

const acceptedCheckovFindings = [
  {
    ruleId: 'CKV_K8S_35',
    path: 'k8s/base/deployment.yaml',
    reason: 'Runtime configuration intentionally comes from ConfigMap and Kubernetes Secret refs.',
  },
  {
    ruleId: 'CKV_K8S_43',
    path: 'k8s/base/deployment.yaml',
    reason: 'Base manifest uses a version tag as a deploy template; promoted images are controlled by release automation.',
  },
  {
    ruleId: 'CKV_AWS_18',
    path: 'infra/aws/cloudformation-bootstrap.yml',
    reason: 'AccessLogBucket is the dedicated S3 server access log sink; recursive logging is intentionally avoided.',
  },
  {
    ruleId: 'CKV_AWS_111',
    path: 'infra/aws/cloudformation-bootstrap.yml',
    reason: "Bootstrap EC2 create and describe actions require Resource '*'; IAM, S3, KMS, and SSM permissions remain scoped.",
  },
  // CKV_GHA_7: graph checks ignore inline `# checkov:skip=` comments, so the
  // operator-controlled workflow_dispatch inputs below are accepted here.
  // Each input only gates job-level `if` conditions and is never interpolated
  // into build steps. See docs/security/code-scanning-triage-2026-09-14.md.
  {
    ruleId: 'CKV_GHA_7',
    path: '.github/workflows/production-on-push.yml',
    reason: 'confirm_production gates production deploys behind typed confirmation in job-level if conditions; never interpolated into build steps.',
  },
  {
    ruleId: 'CKV_GHA_7',
    path: '.github/workflows/production-db-backup.yml',
    reason: 'run_drill is a boolean gate for the isolated restore-drill job; never interpolated into build steps.',
  },
  // CKV_GHA_7: graph checks ignore inline `# checkov:skip=` comments, so the
  // operator-controlled workflow_dispatch inputs below are accepted here.
  // Verified for every entry: each input is referenced only in job-level
  // `if:` conditions, `ref:` fields, or `env:` assignments — never
  // interpolated into a `run:` step body.
  {
    ruleId: 'CKV_GHA_7',
    path: '.github/workflows/npm-publish.yml',
    reason: 'workflow_dispatch inputs (package, dry_run) are read via env vars and gate job-level if conditions; never interpolated into run steps.',
  },
  {
    ruleId: 'CKV_GHA_7',
    path: '.github/workflows/staging-aws-deploy.yml',
    reason: 'workflow_dispatch inputs gate job-level if conditions and ref fields only; never interpolated into run steps.',
  },
  {
    ruleId: 'CKV_GHA_7',
    path: '.github/workflows/render-edge-config-sync.yml',
    reason: 'the apply input is passed as an env var and deliberately not interpolated into the script body (see the comment at the step).',
  },
  {
    ruleId: 'CKV_GHA_7',
    path: '.github/workflows/mobile-release.yml',
    reason: 'signing inputs are passed as env vars to the release tooling; never interpolated into run steps.',
  },
  {
    ruleId: 'CKV_GHA_7',
    path: '.github/workflows/deploy-frontend-aws.yml',
    reason: 'the deploy input only selects the concurrency group and release-channel env value; never interpolated into run steps.',
  },
  {
    ruleId: 'CKV_GHA_7',
    path: '.github/workflows/nuclei-scan.yml',
    reason: 'the enforce and target inputs are passed as env vars to the scan runner; never interpolated into run steps.',
  },
  {
    ruleId: 'CKV_GHA_7',
    path: '.github/workflows/production-db-maintenance.yml',
    reason: 'action, retention_days and git_ref gate job-level if conditions and ref fields; never interpolated into run steps.',
  },
  {
    ruleId: 'CKV_GHA_7',
    path: '.github/workflows/deploy-backend-aws.yml',
    reason: 'deploy_strategy is passed as an env var with a default; never interpolated into run steps.',
  },
  {
    ruleId: 'CKV_GHA_7',
    path: '.github/workflows/production-admin-access.yml',
    reason: 'confirm_production gates production actions behind typed confirmation in job-level if conditions; the allowlist input is passed as an env var. Never interpolated into run steps.',
  },
  {
    ruleId: 'CKV_GHA_7',
    path: '.github/workflows/dependency-automerge.yml',
    reason: 'the dry_run input is declared but never referenced; no interpolation surface exists.',
  },
  {
    ruleId: 'CKV_GHA_7',
    path: '.github/workflows/vercel-storage-prune.yml',
    reason: 'apply, keep and confirm gate the deletion step behind explicit typed confirmation in job-level if conditions; never interpolated into run steps.',
  },
  {
    ruleId: 'CKV_GHA_7',
    path: '.github/workflows/authenticated-security-testing.yml',
    reason: 'the target override is passed as an env var to the DAST runner; never interpolated into run steps.',
  },
  {
    ruleId: 'CKV_GHA_7',
    path: '.github/workflows/observability-activation.yml',
    reason: 'probe_only/fire_test_alert booleans gate read-only discovery versus activation; never interpolated into build steps.',
  },
];

const acceptedTerrascanFindings = [
  // Docker: the non-root runtime needs its files owned by the node user, so
  // COPY --chown=node:node is required (removing it breaks the non-root
  // container). The rule fires on every such COPY.
  {
    ruleId: 'AC_DOCKER_00024',
    path: 'Dockerfile',
    reason: 'COPY --chown=node:node grants the non-root runtime user ownership of its own files; required for the non-root container to run.',
  },
  {
    ruleId: 'AC_DOCKER_00024',
    path: 'server/Dockerfile',
    reason: 'COPY --chown=node:node grants the non-root runtime user ownership of its own files; required for the non-root container to run.',
  },
  // Docker: false positive — terrascan counts the CMD inside the HEALTHCHECK
  // instruction as a second CMD. Each Dockerfile declares exactly one real
  // CMD (verified: Dockerfile:44, server/Dockerfile:39).
  {
    ruleId: 'AC_DOCKER_0053',
    path: 'Dockerfile',
    reason: 'False positive: terrascan parses the CMD inside "HEALTHCHECK ... CMD node -e ..." as a second CMD instruction. Exactly one real CMD exists.',
  },
  {
    ruleId: 'AC_DOCKER_0053',
    path: 'server/Dockerfile',
    reason: 'False positive: terrascan parses the CMD inside "HEALTHCHECK ... CMD node -e ..." as a second CMD instruction. Exactly one real CMD exists.',
  },
  {
    ruleId: 'AC_DOCKER_0053',
    path: 'infra/labs/pqc/openssl-35.Dockerfile',
    reason: 'False positive: same HEALTHCHECK-CMD misparse as the service Dockerfiles; exactly one real CMD exists.',
  },
  // K8s: false positive — the pod-level securityContext sets
  // seccompProfile.type=RuntimeDefault (k8s/base/deployment.yaml:43), which is
  // the Kubernetes-recommended placement and applies to every container.
  {
    ruleId: 'AC_K8S_0080',
    path: 'k8s/base/deployment.yaml',
    reason: 'False positive: seccompProfile.type=RuntimeDefault is set at the pod securityContext (line 43), the recommended placement that covers all containers.',
  },
  // K8s: false positive — the ingress declares a tls: block with secretName
  // aura-api-tls (k8s/base/ingress.yaml:25).
  {
    ruleId: 'AC_K8S_0002',
    path: 'k8s/base/ingress.yaml',
    reason: 'False positive: the ingress declares a tls: block with secretName aura-api-tls (line 25); TLS is enforced.',
  },
  // K8s: the base manifest is a deploy template; promoted images are
  // digest-pinned by release automation (same rationale as the accepted
  // CKV_K8S_43 entry above).
  {
    ruleId: 'AC_K8S_0069',
    path: 'k8s/base/deployment.yaml',
    reason: 'Base manifest uses a version tag as a deploy template; promoted images are digest-pinned by release automation.',
  },
  // AWS: known hardening gaps, triaged rather than silently ignored. These
  // predate this change and are follow-up work, not accepted as ideal.
  {
    ruleId: 'AC_AWS_0214',
    path: 'infra/aws/cloudformation-bootstrap.yml',
    reason: 'Known gap: S3 versioning not yet enabled on the bootstrap buckets. Follow-up hardening item, tracked.',
  },
  {
    ruleId: 'AC_AWS_0214',
    path: 'infra/opentofu/main.tf',
    reason: 'Known gap: S3 versioning not yet enabled on the opentofu-managed bucket. Follow-up hardening item, tracked.',
  },
  {
    ruleId: 'AC_AWS_0229',
    path: 'infra/opentofu/main.tf',
    reason: 'Known gap: the bootstrap security group allows HTTPS/443 broadly. Follow-up: scope to CloudFront prefix lists.',
  },
  {
    ruleId: 'AC_AWS_0207',
    path: 'infra/aws/cloudformation-bootstrap.yml',
    reason: 'Known gap: SSE-KMS not yet configured on the bootstrap bucket. Follow-up hardening item, tracked.',
  },
  {
    ruleId: 'AC_AWS_0462',
    path: 'infra/opentofu/main.tf',
    reason: 'Known gap: ECR repository has no resource policy attached. Follow-up hardening item, tracked.',
  },
];

const isAcceptedTerrascanFinding = (ruleId = '', filePath = '') => (
  acceptedTerrascanFindings.some((finding) => (
    finding.ruleId === ruleId && finding.path === normalizeCheckovPath(filePath)
  ))
);

const filterTerrascanReport = (reportPath) => {
  if (!fs.existsSync(reportPath)) return 0;
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const removed = filterAcceptedTerrascanViolations(report, isAcceptedTerrascanFinding);
  // The filter mutates the parsed report in memory; it must be written back
  // or the gate re-reads the unfiltered file and still counts every accepted
  // violation. (Dropping this write-back is what failed #639's final CI run.)
  if (removed > 0) {
    replaceReportFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return removed;
};

const acceptedSemgrepFindings = [
  {
    ruleId: 'javascript.lang.security.detect-child-process.detect-child-process',
    path: 'scripts/auth-runner.js',
    line: 111,
    reason: 'Auth runner only dispatches allowlisted npm/node commands with shell disabled.',
  },
  {
    ruleId: 'typescript.react.security.react-insecure-request.react-insecure-request',
    path: 'scripts/student-pack-cli-doctor.mjs',
    line: 162,
    reason: 'LocalStack health check is loopback-only developer diagnostics.',
  },
  {
    ruleId: 'javascript.lang.security.detect-child-process.detect-child-process',
    path: 'server/services/externalCatalogService.js',
    line: 106,
    reason: 'External catalog import command is allowlisted and rejects shell metacharacters with shell disabled.',
  },
  {
    ruleId: 'javascript.lang.security.detect-child-process.detect-child-process',
    path: 'server/services/malwareScanService.js',
    line: 209,
    reason: 'YARA execution uses an allowlisted binary, generated temp file, and shell disabled.',
  },
];

const normalizeCheckovPath = (value = '') => String(value || '')
  .replace(/\\/g, '/')
  .replace(/^\/?(repo|src)\//, '')
  .replace(/^\/+/, '');

const replaceReportFile = (reportPath, contents) => {
  const tempPath = `${reportPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, contents);
  fs.renameSync(tempPath, reportPath);
};

const isAcceptedCheckovFinding = (ruleId = '', filePath = '') => {
  const normalizedPath = normalizeCheckovPath(filePath);
  return acceptedCheckovFindings.some((finding) => (
    finding.ruleId === ruleId && finding.path === normalizedPath
  ));
};

const isAcceptedSemgrepFinding = (ruleId = '', filePath = '', lineNumber = 0) => {
  const normalizedPath = normalizeCheckovPath(filePath);
  const normalizedLine = Number(lineNumber);
  return acceptedSemgrepFindings.some((finding) => (
    finding.ruleId === ruleId
    && finding.path === normalizedPath
    && finding.line === normalizedLine
  ));
};

// Checkov's --compact JSON output is an ARRAY of per-check_type entries
// ({check_type, results:{failed_checks:[...]}}); the plain object form carries
// the same shape at the top level. The parsing helpers live in a unit-testable
// module so the gate logic can be exercised without a Docker engine.
const {
    filterAcceptedCheckovChecks,
    filterAcceptedTerrascanViolations,
    countCheckovFailedChecks,
    countTfsecFindings,
    countTerrascanViolations,
} = await import('./iac-report-parsing.mjs');

const filterCheckovJsonReport = (reportPath) => {
  if (!fs.existsSync(reportPath)) return 0;
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const removed = filterAcceptedCheckovChecks(report, isAcceptedCheckovFinding);
  if (removed > 0) {
    if (!Array.isArray(report) && report.summary && Number.isFinite(Number(report.summary.failed))) {
      report.summary.failed = Math.max(0, Number(report.summary.failed) - removed);
    }
    replaceReportFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return removed;
};

const filterSemgrepJsonReport = (reportPath) => {
  if (!fs.existsSync(reportPath)) return 0;
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (!Array.isArray(report.results)) return 0;
  const keptResults = report.results.filter((result) => !isAcceptedSemgrepFinding(
    result.check_id,
    result.path,
    result.start?.line,
  ));
  const removed = report.results.length - keptResults.length;
  if (removed > 0) {
    report.results = keptResults;
    replaceReportFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return removed;
};

const filterSemgrepSarifReport = (reportPath) => {
  if (!fs.existsSync(reportPath)) return 0;
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  let removed = 0;
  for (const runReport of report.runs || []) {
    if (!Array.isArray(runReport.results)) continue;
    const keptResults = runReport.results.filter((result) => {
      const ruleId = result.ruleId || result.rule?.id || '';
      const resultAccepted = (result.locations || []).some((location) => (
        isAcceptedSemgrepFinding(
          ruleId,
          location.physicalLocation?.artifactLocation?.uri,
          location.physicalLocation?.region?.startLine,
        )
      ));
      if (resultAccepted) removed += 1;
      return !resultAccepted;
    });
    runReport.results = keptResults;
  }
  if (removed > 0) {
    replaceReportFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return removed;
};

const countSemgrepJsonFindings = (reportPath) => {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Semgrep report was not produced: ${reportPath}`);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  return Array.isArray(report.results) ? report.results.length : 0;
};

const filterCheckovSarifReport = (reportPath) => {
  if (!fs.existsSync(reportPath)) return 0;
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  let removed = 0;
  for (const runReport of report.runs || []) {
    if (!Array.isArray(runReport.results)) continue;
    const keptResults = runReport.results.filter((result) => {
      const ruleId = result.ruleId || result.rule?.id || '';
      const resultAccepted = (result.locations || []).some((location) => (
        isAcceptedCheckovFinding(ruleId, location.physicalLocation?.artifactLocation?.uri)
      ));
      if (resultAccepted) removed += 1;
      return !resultAccepted;
    });
    runReport.results = keptResults;
  }
  if (removed > 0) {
    replaceReportFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return removed;
};

const filterAcceptedCheckovFindings = ({ jsonReport, sarifReport }) => {
  const removedJson = filterCheckovJsonReport(jsonReport);
  const removedSarif = filterCheckovSarifReport(sarifReport);
  if (removedJson > 0 || removedSarif > 0) {
    console.log(`[security:iac] Filtered accepted Checkov baseline findings: json=${removedJson}, sarif=${removedSarif}`);
  }
};

const filterAcceptedSemgrepFindings = ({ jsonReport, sarifReport }) => {
  const removedJson = filterSemgrepJsonReport(jsonReport);
  const removedSarif = filterSemgrepSarifReport(sarifReport);
  if (removedJson > 0 || removedSarif > 0) {
    console.log(`[security:semgrep] Filtered accepted Semgrep baseline findings: json=${removedJson}, sarif=${removedSarif}`);
  }
};

// Baseline exception/expiry rules live in the unit-testable module
// (node --test scripts/security/nuclei-baseline.test.mjs) so they can be
// exercised without a Docker engine.
const loadNucleiExceptionsWithPath = () => loadNucleiExceptions(path.join(repoRoot, 'nuclei-exceptions.json'));

const runDocker = (args, options = {}) => run('docker', args, options);

const runDockerReportOnly = (args, reportPath, options = {}) => {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const rawReportOutput = options.stdoutOnly ? (result.stdout || '') : output;
  const reportOutput = options.jsonOnly && rawReportOutput.trim()
    ? extractJsonReport(rawReportOutput)
    : rawReportOutput;
  if (reportPath && reportOutput.trim()) {
    fs.writeFileSync(reportPath, reportOutput);
  }
  if (options.printOutput !== false) {
    process.stdout.write(output);
  }

  if (result.error) {
    console.error(`docker failed: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.warn(`IaC scanner exited with status ${result.status}; report captured for triage.`);
  }
};

const gitleaksArgs = ({ reportFormat, reportPath, exitCode }) => {
  const args = [
    'run', '--rm',
    '-v', repoAsRepoMount,
    images.gitleaks,
    'detect',
    '--source=/repo',
    `--report-format=${reportFormat}`,
    `--report-path=/repo/security-reports/${reportPath}`,
    '--redact',
    `--exit-code=${exitCode}`,
  ];

  if (fs.existsSync(path.join(repoRoot, '.gitleaks.toml'))) {
    args.push('--config=/repo/.gitleaks.toml');
  }
  if (fs.existsSync(path.join(repoRoot, '.gitleaks-baseline.json'))) {
    args.push('--baseline-path=/repo/.gitleaks-baseline.json');
  }

  return args;
};

const runGitleaks = () => {
  runDocker(gitleaksArgs({
    reportFormat: 'sarif',
    reportPath: 'gitleaks-report.sarif',
    exitCode: 0,
  }));
  runDocker(gitleaksArgs({
    reportFormat: 'json',
    reportPath: 'gitleaks-report.json',
    exitCode: 1,
  }));
};

const runSemgrep = () => {
  const scanRoot = prepareSemgrepScanRoot();
  const scanMount = `${hostPath(scanRoot)}:/src`;
  const semgrepReportMount = `${hostPath(reportDir)}:/src/security-reports`;
  const semgrepJsonReport = path.join(reportDir, 'semgrep-report.json');
  const semgrepSarifReport = path.join(reportDir, 'semgrep-report.sarif');

  for (const reportPath of [semgrepJsonReport, semgrepSarifReport]) {
    fs.rmSync(reportPath, { recursive: true, force: true });
  }

  runDocker([
    'run', '--rm',
    '-v', scanMount,
    '-v', semgrepReportMount,
    '-w', '/src',
    images.semgrep,
    'semgrep', 'scan',
    '--config', 'auto',
    '--config', '/src/semgrep-rules/aura-security.yml',
    '--severity', 'ERROR',
    '--disable-version-check',
    '--timeout', '30',
    '--timeout-threshold', '3',
    '--max-target-bytes', '1000000',
    '--exclude', 'security-reports',
    '--json-output', '/src/security-reports/semgrep-report.json',
    '--sarif-output', '/src/security-reports/semgrep-report.sarif',
    '/src',
  ]);
  filterAcceptedSemgrepFindings({ jsonReport: semgrepJsonReport, sarifReport: semgrepSarifReport });
  const findingCount = countSemgrepJsonFindings(semgrepJsonReport);
  if (findingCount > 0) {
    console.error(`[security:semgrep] Found ${findingCount} unaccepted Semgrep ERROR finding(s). See security-reports/semgrep-report.json.`);
    process.exit(1);
  }
};

const shouldCopyToTrivyScanRoot = (relativePath) => {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('../') || path.isAbsolute(normalized)) return false;
  return ![
    '.git/',
    '.trivycache/',
    'security-reports/',
    'node_modules/',
    'app/node_modules/',
    'server/node_modules/',
    'app/dist/',
    'app/android/.gradle/',
    'desktop-release/',
    'generated/',
    'output/',
    'server/data/',
    'server/uploads/',
  ].some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
};

const shouldCopyToSemgrepScanRoot = (relativePath) => {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  if (!shouldCopyToTrivyScanRoot(normalized)) return false;
  if (normalized.startsWith('semgrep-rules/')) return true;
  if (normalized.startsWith('.github/workflows/')) return /\.ya?ml$/i.test(normalized);

  if (![
    'app/src/',
    'desktop/',
    'gateway/',
    'infra/',
    'scripts/',
    'server/',
    'tests/',
  ].some((prefix) => normalized.startsWith(prefix))) {
    return [
      'package.json',
      'server/package.json',
      'app/package.json',
      'Dockerfile',
      'docker-compose.yml',
      'docker-compose.split-runtime.yml',
      'netlify.toml',
      'vercel.json',
    ].includes(normalized);
  }

  if (/(^|\/)(package-lock|npm-shrinkwrap|yarn\.lock|pnpm-lock)\.(json|ya?ml)$/.test(normalized)) return false;
  if (/\.(png|jpe?g|gif|webp|ico|svg|mp4|mov|pdf|zip|gz|tgz|tar|db|sqlite|map)$/i.test(normalized)) return false;

  return /(^|\/)(Dockerfile|docker-compose[^/]*)$/i.test(normalized)
    || /\.(cjs|mjs|js|jsx|ts|tsx|json|ya?ml|toml|sh|bash|ps1|py|sql)$/i.test(normalized);
};

const prepareSemgrepScanRoot = () => prepareScanRoot('semgrep-source', shouldCopyToSemgrepScanRoot);

const shouldCopyToIacScanRoot = (relativePath) => {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('../') || path.isAbsolute(normalized)) return false;
  if (normalized.startsWith('.github/workflows/')) return true;
  if (normalized.startsWith('infra/')) return true;
  if (normalized === 'Dockerfile' || normalized.endsWith('/Dockerfile')) return true;
  if (/(^|\/)(docker-compose|compose)(\.[^.]+)?\.ya?ml$/i.test(normalized)) return true;
  if (/\.(tf|tfvars)$/i.test(normalized)) return true;
  if (/(^|\/)(k8s|kubernetes|helm)\//i.test(normalized)) return true;
  return false;
};

const prepareScanRoot = (directoryName, shouldCopy) => {
  const scanRoot = path.join(reportDir, directoryName);
  fs.rmSync(scanRoot, { recursive: true, force: true });
  fs.mkdirSync(scanRoot, { recursive: true });

  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  // Fixed git command lists source files; copied paths are constrained before filesystem writes.
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repoRoot,
    encoding: 'buffer',
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || 'git ls-files failed while preparing scan root');
  }

  const files = result.stdout.toString('utf8').split('\0').filter(shouldCopy);
  for (const relativePath of files) {
    const sourcePath = path.join(repoRoot, relativePath);
    const destinationPath = path.join(scanRoot, relativePath);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) continue;
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }
  return scanRoot;
};

const prepareTrivyScanRoot = () => {
  return prepareScanRoot('trivy-source', shouldCopyToTrivyScanRoot);
};

const trivyCommon = [
  'fs', '/scan',
  '--scanners', 'vuln,secret,misconfig',
  '--ignorefile', '/scan/.trivyignore.yaml',
];

const runTrivyFs = () => {
  const scanRoot = prepareTrivyScanRoot();
  const scanMount = `${hostPath(scanRoot)}:/scan`;

  runDocker([
    'run', '--rm',
    '-v', scanMount,
    '-v', repoMount,
    '-v', cacheMount,
    images.trivy,
    ...trivyCommon,
    '--severity', 'LOW,MEDIUM,HIGH,CRITICAL',
    '--format', 'table',
    '--output', '/project/security-reports/trivy-fs-table.txt',
    '--exit-code', '0',
  ]);

  runDocker([
    'run', '--rm',
    '-v', scanMount,
    '-v', repoMount,
    '-v', cacheMount,
    images.trivy,
    ...trivyCommon,
    '--severity', 'HIGH,CRITICAL',
    '--format', 'sarif',
    '--output', '/project/security-reports/trivy-fs.sarif',
    '--exit-code', '0',
  ]);

  const tablePath = path.join(reportDir, 'trivy-fs-table.txt');
  if (fs.existsSync(tablePath)) {
    process.stdout.write(fs.readFileSync(tablePath, 'utf8'));
  }

  runDocker([
    'run', '--rm',
    '-v', scanMount,
    '-v', repoMount,
    '-v', cacheMount,
    images.trivy,
    ...trivyCommon,
    '--severity', 'HIGH,CRITICAL',
    '--format', 'json',
    '--output', '/project/security-reports/trivy-fs.json',
    '--exit-code', '1',
  ]);
};

const runTrivyImage = () => {
  const imageName = extraArgs[0] || 'app-security-local:latest';
  const rootDockerfile = path.join(repoRoot, 'Dockerfile');
  const serverDockerfile = path.join(repoRoot, 'server', 'Dockerfile');
  const imageTar = path.join(reportDir, 'app-security-local.tar');

  if (fs.existsSync(rootDockerfile)) {
    run('docker', ['build', '-t', imageName, repoRoot]);
  } else if (fs.existsSync(serverDockerfile)) {
    run('docker', ['build', '-f', serverDockerfile, '-t', imageName, path.join(repoRoot, 'server')]);
  } else {
    console.log('No Dockerfile found. Skipping Trivy image scan.');
    return;
  }

  run('docker', ['save', '-o', imageTar, imageName]);

  runDocker([
    'run', '--rm',
    '-v', repoMount,
    '-v', cacheMount,
    images.trivy,
    'image',
    '--input', '/project/security-reports/app-security-local.tar',
    '--scanners', 'vuln,secret,misconfig',
    '--severity', 'HIGH,CRITICAL',
    '--format', 'table',
    '--output', '/project/security-reports/trivy-image-table.txt',
    '--exit-code', '0',
  ]);

  const tablePath = path.join(reportDir, 'trivy-image-table.txt');
  if (fs.existsSync(tablePath)) {
    process.stdout.write(fs.readFileSync(tablePath, 'utf8'));
  }

  runDocker([
    'run', '--rm',
    '-v', repoMount,
    '-v', cacheMount,
    images.trivy,
    'image',
    '--input', '/project/security-reports/app-security-local.tar',
    '--scanners', 'vuln,secret,misconfig',
    '--severity', 'HIGH,CRITICAL',
    '--format', 'sarif',
    '--output', '/project/security-reports/trivy-image.sarif',
    '--exit-code', '0',
  ]);

  runDocker([
    'run', '--rm',
    '-v', repoMount,
    '-v', cacheMount,
    images.trivy,
    'image',
    '--input', '/project/security-reports/app-security-local.tar',
    '--scanners', 'vuln,secret,misconfig',
    '--severity', 'HIGH,CRITICAL',
    '--format', 'json',
    '--output', '/project/security-reports/trivy-image.json',
    '--exit-code', '1',
  ]);
};

const isZapTargetAllowed = (targetUrl) => {
  const normalized = String(targetUrl || '').toLowerCase();
  return normalized.includes('localhost')
    || normalized.includes('127.0.0.1')
    || normalized.includes('host.docker.internal')
    || normalized.includes('staging')
    || normalized.includes('preview');
};

const runZap = () => {
  const targetUrl = extraArgs[0] || 'http://host.docker.internal:3000';
  if (!isZapTargetAllowed(targetUrl)) {
    console.error(`Refusing OWASP ZAP baseline for non-local/non-staging target: ${targetUrl}`);
    process.exit(2);
  }
  const scanTarget = targetUrl
    .replaceAll('localhost', 'host.docker.internal')
    .replaceAll('127.0.0.1', 'host.docker.internal');

  console.log(`Running OWASP ZAP baseline against ${scanTarget}`);
  runDocker([
    'run', '--rm',
    '--add-host=host.docker.internal:host-gateway',
    '--user', '0:0',
    '-v', reportMount,
    images.zap,
    'zap-baseline.py',
    '-t', scanTarget,
    '-I',
    '-r', 'zap-baseline.html',
    '-J', 'zap-baseline.json',
    '-w', 'zap-baseline.md',
  ]);
};

const runNuclei = () => {
  // Flags may appear before or after the target (`npm run security:nuclei:strict -- <url>`
  // appends --strict after it), so select the first positional argument.
  const nucleiFlags = extraArgs.filter((arg) => String(arg).startsWith('--'));
  const targetArg = extraArgs.find((arg) => !String(arg).startsWith('--'));
  const targetUrl = targetArg || process.env.NUCLEI_TARGET || 'http://host.docker.internal:4173';
  if (!isZapTargetAllowed(targetUrl)) {
    console.error(`Refusing Nuclei scan for non-local/non-staging target: ${targetUrl}`);
    process.exit(2);
  }
  const scanTarget = targetUrl
    .replaceAll('localhost', 'host.docker.internal')
    .replaceAll('127.0.0.1', 'host.docker.internal');

  const strict = nucleiFlags.includes('--strict') || process.env.NUCLEI_STRICT === '1';
  const jsonlReport = path.join(reportDir, 'nuclei-report.jsonl');
  const sarifReport = path.join(reportDir, 'nuclei-report.sarif');
  const tableReport = path.join(reportDir, 'nuclei-report.txt');
  const nucleiReportMount = `${hostPath(reportDir)}:/reports`;
  // The nuclei image does not bundle templates; sync them into a host cache so
  // repeat runs (local and CI) do not re-download the full set every time.
  const nucleiCacheDir = path.join(repoRoot, '.nucleicache');
  fs.mkdirSync(nucleiCacheDir, { recursive: true });
  const nucleiTemplateMount = `${hostPath(nucleiCacheDir)}:/root/nuclei-templates`;

  for (const reportPath of [jsonlReport, sarifReport, tableReport]) {
    fs.rmSync(reportPath, { recursive: true, force: true });
  }

  // Pin HOME so the host's Windows HOME does not leak into the container; nuclei
  // resolves its template directory from HOME (/root/nuclei-templates).
  const dockerOverrides = ['-e', 'HOME=/root'];

  // Sync templates only when the cache is empty. `-update-templates` against a
  // full 14k-template set can hang for many minutes (observed: 12+ min with no
  // cache growth while GitHub was reachable), and on CI the cache is restored
  // from actions/cache anyway. Set NUCLEI_SYNC_TEMPLATES=1 to force a refresh.
  const hasCachedTemplates = fs.existsSync(path.join(nucleiCacheDir, 'http'));
  const forceTemplateSync = ['1', 'true', 'yes'].includes(
    String(process.env.NUCLEI_SYNC_TEMPLATES || '').toLowerCase()
  );

  if (!hasCachedTemplates || forceTemplateSync) {
    console.log(forceTemplateSync
      ? 'Nuclei templates: syncing (NUCLEI_SYNC_TEMPLATES requested)'
      : 'Nuclei templates: no local cache, syncing');
    runDocker([
      'run', '--rm',
      '-v', nucleiTemplateMount,
      ...dockerOverrides,
      images.nuclei,
      '-update-templates',
    ]);
  } else {
    console.log('Nuclei templates: using cached set (set NUCLEI_SYNC_TEMPLATES=1 to refresh)');
  }

  console.log(`Running Nuclei ${images.nuclei} against ${scanTarget} (${strict ? 'strict' : 'baseline'} mode)`);
  runDocker([
    'run', '--rm',
    '--add-host=host.docker.internal:host-gateway',
    '--user', '0:0',
    '-v', nucleiReportMount,
    '-v', nucleiTemplateMount,
    ...dockerOverrides,
    images.nuclei,
    '-target', scanTarget,
    '-tags', 'cves,exposures,misconfiguration,default-login,exposure',
    '-etags', 'intrusive,dos,fuzz,headless,oast',
    '-severity', 'critical,high,medium',
    // No OAST callbacks, no unsigned templates, no auto-update checks.
    '-ni',
    '-dut',
    '-duc',
    '-or',
    '-rl', '25',
    '-c', '10',
    '-timeout', '5',
    '-stats', '-si', '0',
    '-silent',
    '-jsonl-export', '/reports/nuclei-report.jsonl',
    '-sarif-export', '/reports/nuclei-report.sarif',
    '-o', '/reports/nuclei-report.txt',
  ]);

  if (!fs.existsSync(jsonlReport)) {
    fs.writeFileSync(tableReport, 'Nuclei scan did not produce a JSONL report.\n');
    console.error('[security:nuclei] Scan did not produce security-reports/nuclei-report.jsonl');
    process.exit(1);
  }

  const exceptions = loadNucleiExceptionsWithPath();
  const removedJson = filterNucleiJsonlReport(jsonlReport, exceptions);
  const removedSarif = filterNucleiSarifReport(sarifReport, exceptions);
  if (removedJson > 0 || removedSarif > 0) {
    console.log(`[security:nuclei] Filtered accepted baseline findings: jsonl=${removedJson}, sarif=${removedSarif}`);
  }
  // Nuclei's SARIF export always records executionSuccessful: false; GitHub
  // turns that into an "unsuccessful tool execution" warning on the uploaded
  // analysis and flags the tool on the code scanning tool status page. The
  // scan container exited cleanly to reach this point, so correct the flag
  // before the workflow uploads the report.
  markNucleiSarifExecutionSuccessful(sarifReport);

  const gatingFindings = countNucleiGatingFindings(jsonlReport);
  const tablePath = path.join(reportDir, 'nuclei-report.txt');
  if (fs.existsSync(tablePath) && fs.readFileSync(tablePath, 'utf8').trim()) {
    process.stdout.write(fs.readFileSync(tablePath, 'utf8'));
  }
  if (gatingFindings.length > 0) {
    console.error(`[security:nuclei] ${gatingFindings.length} unsuppressed high/critical finding(s):`);
    for (const finding of gatingFindings.slice(0, 20)) {
      console.error(`- [${finding?.info?.severity}] ${nucleiTemplateId(finding)} ${nucleiMatchedHost(finding)}`);
    }
    console.error('Triage each finding and add a justified, expiring entry to nuclei-exceptions.json.');
    if (strict) {
      process.exit(1);
    }
    return;
  }

  console.log('[security:nuclei] No unsuppressed high/critical findings.');
};

// Production-origin denylist, sourced from the single staging-safety source of
// truth rather than duplicated here: duplicating the hostnames inside a
// security/ file trips the staging-prod fallback scanner (production host in a
// staging context). assert_staging_smoke_safety.js is CJS and owns the list.
const KNOWN_PRODUCTION_HOSTS_PATH = 'server/scripts/assert_staging_smoke_safety.js';

const loadKnownProductionHosts = () => {
  try {
    const source = fs.readFileSync(path.join(repoRoot, KNOWN_PRODUCTION_HOSTS_PATH), 'utf8');
    const start = source.indexOf('const KNOWN_PRODUCTION_HOSTS = [');
    if (start < 0) return [];
    const open = source.indexOf('[', start);
    const close = source.indexOf(']', open);
    if (close < 0) return [];
    // Extract the quoted hostnames rather than JSON.parse-ing the slice: the
    // array is multi-line, and a failed parse would silently yield an empty
    // denylist and disable the production-origin guard.
    return [...source.slice(open + 1, close).matchAll(/'([^']+)'/g)].map((match) => match[1]);
  } catch {
    return [];
  }
};

const isKnownProductionHost = (targetUrl) => {
  let hostname = '';
  try {
    hostname = new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return loadKnownProductionHosts().some((host) => hostname === host || hostname.endsWith(`.${host}`));
};

// Word-boundary pattern matches server/scripts/assert_staging_smoke_safety.js
// (PRODUCTION_TOKEN_PATTERN) so "products" in a hostname is not rejected.
const productionTokenPattern = /(^|[^a-z0-9])(prod|production|live)([^a-z0-9]|$)/i;

// Mint a Firebase ID token with the same REST exchange the storefront uses, so
// the scan context can authenticate with a bearer header. Done host-side with
// plain fetch: no SDK, and no ZAP script engine (the stable image does not
// enable the GraalJS alpha add-on that script-based authentication requires).
const mintFirebaseIdToken = async ({ apiKey, origin, email, password }) => {
  // The Auth Emulator serves the same REST surface under an explicit
  // /identitytoolkit.googleapis.com path prefix; the hosted endpoint has that
  // host in the origin already.
  const base = origin.includes('identitytoolkit.googleapis.com')
    ? origin
    : `${origin.replace(/\/+$/, '')}/identitytoolkit.googleapis.com`;
  const url = `${base}/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!response.ok) {
    throw new Error(`Firebase sign-in failed with HTTP ${response.status}`);
  }
  const body = await response.json();
  const idToken = String(body?.idToken || '');
  if (!idToken) {
    throw new Error('Firebase sign-in response contained no idToken');
  }
  return idToken;
};

const runZapAuth = async () => {
  // Same flag/target split as nuclei: tolerate extra flags before or after the URL.
  const targetArg = extraArgs.find((arg) => !String(arg).startsWith('--'));
  const targetUrl = targetArg || process.env.ZAP_AUTH_TARGET || '';
  const username = process.env.ZAP_AUTH_USERNAME || '';
  const password = process.env.ZAP_AUTH_PASSWORD || '';
  const firebaseApiKey = process.env.ZAP_AUTH_FIREBASE_API_KEY || '';
  const firebaseOrigin = process.env.ZAP_AUTH_FIREBASE_ORIGIN || '';
  const syncPath = process.env.ZAP_AUTH_SYNC_PATH || '/api/auth/sync';

  if (!targetUrl) {
    console.error('Refusing authenticated ZAP scan: ZAP_AUTH_TARGET is not set.');
    process.exit(2);
  }
  if (!isZapTargetAllowed(targetUrl)) {
    console.error(`Refusing authenticated ZAP scan for non-local/non-staging target: ${targetUrl}`);
    process.exit(2);
  }
  if (productionTokenPattern.test(targetUrl) || isKnownProductionHost(targetUrl)) {
    console.error(`Refusing authenticated ZAP scan for known production target: ${targetUrl}`);
    process.exit(2);
  }
  if (!username || !password || !firebaseApiKey) {
    console.error('Refusing authenticated ZAP scan: ZAP_AUTH_USERNAME, ZAP_AUTH_PASSWORD, and ZAP_AUTH_FIREBASE_API_KEY must all be set (seeded smoke account).');
    process.exit(2);
  }

  let scanTarget = targetUrl.replace(/\/+$/, '');
  scanTarget = scanTarget.replace(/:443$/, '').replace(/:80$/, '');
  scanTarget = scanTarget
    .replaceAll('localhost', 'host.docker.internal')
    .replaceAll('127.0.0.1', 'host.docker.internal');

  const reportPath = path.join(reportDir, 'zap-auth-report.html');
  fs.rmSync(reportPath, { recursive: true, force: true });

  const tokenOrigin = firebaseOrigin || 'https://identitytoolkit.googleapis.com';
  let idToken = process.env.ZAP_AUTH_TOKEN || '';
  if (!idToken) {
    console.log(`Signing in the seeded account via ${tokenOrigin} to mint a scan token`);
    try {
      idToken = await mintFirebaseIdToken({
        apiKey: firebaseApiKey,
        origin: tokenOrigin,
        email: username,
        password,
      });
    } catch (error) {
      console.error(`[security:zap:auth] ${error.message}`);
      process.exit(1);
    }
  } else {
    console.log('Using the pre-supplied ZAP_AUTH_TOKEN (no sign-in performed)');
  }

  console.log(`Running authenticated OWASP ZAP scan against ${scanTarget}`);
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  // Fixed ZAP invocation with an allowlisted, pinned image and shell disabled.
  const result = spawnSync('docker', [
    'run', '--rm',
    '--add-host=host.docker.internal:host-gateway',
    '--user', '0:0',
    // The plan and the report destination both live under the repo root, so
    // mount it at /zap/wrk (the path the plan references).
    '-v', `${hostPath(repoRoot)}:/zap/wrk`,
    '-e', `ZAP_AUTH_TARGET=${scanTarget}`,
    '-e', `ZAP_AUTH_TOKEN=${idToken}`,
    // The zaproxy image exposes no entrypoint, so -cmd would be exec'd as a
    // binary. Invoke zap.sh explicitly for the Automation Framework plan.
    // (All docker run options must precede the image name.)
    '--entrypoint', '/bin/bash',
    images.zap,
    '-c',
    // zap.sh forwards remaining args to ZAP; -cmd keeps it headless and exits.
    '/zap/zap.sh -cmd -autorun /zap/wrk/scripts/security/zap-auth-plan.yaml',
  ], { encoding: 'utf8' });

  if (result.error) {
    console.error(`docker failed: ${result.error.message}`);
    process.exit(1);
  }
  // Surface ZAP's own diagnostics: without this a plan/script failure exits
  // silently and the operator has nothing to triage.
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  // ZAP exit codes: 0 clean, 1 plan errors, 2 plan warnings. Warnings still
  // produce a usable report (e.g. a deprecated job parameter), so only hard
  // plan errors fail this runner.
  if (result.status === 1) {
    console.error('[security:zap:auth] ZAP reported plan errors.');
    process.exit(1);
  }
  if (result.status !== 0 && result.status !== 2) {
    process.exit(result.status);
  }
  if (!fs.existsSync(reportPath)) {
    console.error('[security:zap:auth] Authenticated scan did not produce security-reports/zap-auth-report.html');
    process.exit(1);
  }
  if (result.status === 2) {
    console.log('[security:zap:auth] ZAP reported warnings; the report was still produced. Review it before promotion.');
  }
};

const runHadolint = () => {
  const dockerfile = fs.existsSync(path.join(repoRoot, 'Dockerfile'))
    ? path.join(repoRoot, 'Dockerfile')
    : path.join(repoRoot, 'server', 'Dockerfile');
  const reportPath = path.join(reportDir, 'hadolint.txt');

  if (!fs.existsSync(dockerfile)) {
    fs.writeFileSync(reportPath, 'No Dockerfile found. Skipping Hadolint.\n');
    process.stdout.write(fs.readFileSync(reportPath, 'utf8'));
    return;
  }

  const dockerfileContents = fs.readFileSync(dockerfile, 'utf8');
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  // Fixed Docker invocation feeds the selected Dockerfile to Hadolint over stdin.
  const result = spawnSync('docker', ['run', '--rm', '-i', images.hadolint], {
    input: dockerfileContents,
    encoding: 'utf8',
  });

  const output = `${result.stdout || ''}${result.stderr || ''}`;
  fs.writeFileSync(reportPath, output);
  process.stdout.write(output);
  if (result.error) {
    console.error(`docker failed: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
};

const runIac = () => {
  const checkovReport = path.join(reportDir, 'checkov-report.json');
  const checkovSarifReport = path.join(reportDir, 'checkov-report.sarif');
  const checkovDefaultSarifReport = path.join(reportDir, 'results.sarif');
  const tfsecReport = path.join(reportDir, 'tfsec-report.json');
  const terrascanReport = path.join(reportDir, 'terrascan-report.json');
  const scanRoot = prepareScanRoot('iac-source', shouldCopyToIacScanRoot);
  const iacScanMount = `${hostPath(scanRoot)}:/repo:ro`;
  const iacSrcMount = `${hostPath(scanRoot)}:/src:ro`;
  const iacReportMount = `${hostPath(reportDir)}:/reports`;

  for (const reportPath of [checkovReport, checkovSarifReport, checkovDefaultSarifReport, tfsecReport, terrascanReport]) {
    fs.rmSync(reportPath, { recursive: true, force: true });
  }

  runDockerReportOnly([
    'run', '--rm',
    '-v', iacScanMount,
    images.checkov,
    '-d', '/repo',
    '--quiet',
    '--compact',
    '--framework', 'cloudformation,dockerfile,github_actions,secrets,kubernetes',
    '--output', 'json',
    '--soft-fail',
  ], checkovReport, { stdoutOnly: true, jsonOnly: true });

  runDocker([
    'run', '--rm',
    '-v', iacScanMount,
    '-v', iacReportMount,
    '-w', '/reports',
    images.checkov,
    '-d', '/repo',
    '--quiet',
    '--compact',
    '--framework', 'cloudformation,dockerfile,github_actions,secrets,kubernetes',
    '--output', 'sarif',
    '--soft-fail',
  ]);
  if (!fs.existsSync(checkovDefaultSarifReport)) {
    throw new Error('Checkov SARIF scan did not produce security-reports/results.sarif');
  }
  fs.renameSync(checkovDefaultSarifReport, checkovSarifReport);
  filterAcceptedCheckovFindings({ jsonReport: checkovReport, sarifReport: checkovSarifReport });

  runDockerReportOnly([
    'run', '--rm',
    // tfsec's image runs as a non-root user that cannot write to the
    // runner-owned reports bind mount, so the scan fails with
    // "permission denied" and no report is produced. Run it as root; the
    // source mount stays read-only.
    '--user', '0:0',
    '-v', iacSrcMount,
    '-v', iacReportMount,
    images.tfsec,
    '/src',
    '--format', 'json',
    '--out', '/reports/tfsec-report.json',
    '--soft-fail',
  ]);

  runDockerReportOnly([
    'run', '--rm',
    '-v', iacScanMount,
    images.terrascan,
    'scan',
    '-d', '/repo',
    '-o', 'json',
    // Terrascan interleaves opa warn lines with its JSON on stdout, so the
    // report must be extracted from stdout only.
  ], terrascanReport, { stdoutOnly: true, jsonOnly: true });
  const terrascanRemoved = filterTerrascanReport(terrascanReport);
  if (terrascanRemoved > 0) {
    console.log(`[security:iac] Filtered accepted Terrascan baseline findings: ${terrascanRemoved}`);
  }

  for (const reportPath of [checkovReport, tfsecReport, terrascanReport]) {
    try {
      fs.writeFileSync(reportPath, JSON.stringify({
        tool: path.basename(reportPath, '.json'),
        status: 'no-report-produced',
        generatedAt: new Date().toISOString(),
      }, null, 2), { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  // Gating: --soft-fail keeps scanner reports intact for triage and SARIF
  // upload, but a finding that survives baseline filtering must still turn
  // the build red. Previously every unaccepted finding was uploaded to code
  // scanning and the job stayed green — even a crashed scanner passed. A
  // report that is missing, unparseable, or a no-report stub (the scanner
  // produced nothing at all) fails closed rather than silently passing.
  const countIacReportFindings = (reportPath, extractor) => {
    if (!fs.existsSync(reportPath)) return { count: 0, unparseable: true };
    try {
      const parsed = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      if (parsed?.status === 'no-report-produced') return { count: 0, unparseable: true };
      const count = Number(extractor(parsed) || 0);
      if (!Number.isFinite(count) || count < 0) return { count: 0, unparseable: true };
      return { count, unparseable: false };
    } catch {
      return { count: 0, unparseable: true };
    }
  };

  const iacCounts = {
    checkov: countIacReportFindings(checkovReport, countCheckovFailedChecks),
    tfsec: countIacReportFindings(tfsecReport, countTfsecFindings),
    terrascan: countIacReportFindings(terrascanReport, countTerrascanViolations),
  };
  const iacUnparseable = Object.values(iacCounts).some((entry) => entry.unparseable);
  const iacTotal = iacCounts.checkov.count + iacCounts.tfsec.count + iacCounts.terrascan.count;

  if (iacUnparseable || iacTotal > 0) {
    console.error(`[security:iac] ${iacTotal} unaccepted finding(s) — checkov=${iacCounts.checkov.count}, tfsec=${iacCounts.tfsec.count}, terrascan=${iacCounts.terrascan.count}${iacUnparseable ? ' (unparseable or missing report)' : ''}`);
    throw new Error(`IaC scan failed: ${iacTotal} unaccepted finding(s). Triage them or add justified, expiring entries to the security-audit exceptions.`);
  }

  console.log('[security:iac] No unaccepted findings.');
};

const runZizmor = () => {
  const reportPath = path.join(reportDir, 'zizmor-report.sarif');
  runDocker([
    'run', '--rm',
    '-v', repoAsSrcMount,
    '-v', reportMount,
    images.zizmor,
    '--no-progress',
    '--format', 'sarif',
    '--config', '/src/.github/zizmor.yml',
    '--output', '/zap/wrk/zizmor-report.sarif',
    '/src/.github/workflows/',
  ]);
  if (!fs.existsSync(reportPath)) {
    throw new Error('zizmor SARIF scan did not produce security-reports/zizmor-report.sarif');
  }
};

const commands = {
  gitleaks: runGitleaks,
  semgrep: runSemgrep,
  trivy: runTrivyFs,
  'trivy:image': runTrivyImage,
  zap: runZap,
  hadolint: runHadolint,
  iac: runIac,
  zizmor: runZizmor,
  nuclei: runNuclei,
  'zap:auth': runZapAuth,
};

if (!commands[tool]) {
  console.error(`Unknown security Docker tool: ${tool || '(missing)'}`);
  console.error(`Available tools: ${Object.keys(commands).join(', ')}`);
  process.exit(2);
}

await commands[tool]();
