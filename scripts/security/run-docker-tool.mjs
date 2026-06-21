import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { extractJsonReport } from './report-utils.mjs';

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

const filterCheckovJsonReport = (reportPath) => {
  if (!fs.existsSync(reportPath)) return 0;
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const failedChecks = report?.results?.failed_checks;
  if (!Array.isArray(failedChecks)) return 0;
  const keptChecks = failedChecks.filter((check) => !isAcceptedCheckovFinding(check.check_id, check.file_path));
  const removed = failedChecks.length - keptChecks.length;
  if (removed > 0) {
    report.results.failed_checks = keptChecks;
    if (report.summary && Number.isFinite(Number(report.summary.failed))) {
      report.summary.failed = Math.max(0, Number(report.summary.failed) - removed);
    }
    replaceReportFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return removed;
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
    '--error',
    '--metrics', 'off',
    '--disable-version-check',
    '--timeout', '30',
    '--timeout-threshold', '3',
    '--max-target-bytes', '1000000',
    '--json-output', '/src/security-reports/semgrep-report.json',
    '--sarif-output', '/src/security-reports/semgrep-report.sarif',
    '/src',
  ]);
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
  ], terrascanReport);

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
};

const commands = {
  gitleaks: runGitleaks,
  semgrep: runSemgrep,
  trivy: runTrivyFs,
  'trivy:image': runTrivyImage,
  zap: runZap,
  hadolint: runHadolint,
  iac: runIac,
};

if (!commands[tool]) {
  console.error(`Unknown security Docker tool: ${tool || '(missing)'}`);
  console.error(`Available tools: ${Object.keys(commands).join(', ')}`);
  process.exit(2);
}

commands[tool]();
