import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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
  hadolint: process.env.HADOLINT_IMAGE || 'hadolint/hadolint:latest-debian',
};

const runDocker = (args, options = {}) => run('docker', args, options);

const runGitleaks = () => {
  const args = [
    'run', '--rm',
    '-v', repoAsRepoMount,
    images.gitleaks,
    'detect',
    '--source=/repo',
    '--report-format=json',
    '--report-path=/repo/security-reports/gitleaks-report.json',
    '--redact',
    '--exit-code=1',
  ];

  if (fs.existsSync(path.join(repoRoot, '.gitleaks.toml'))) {
    args.push('--config=/repo/.gitleaks.toml');
  }
  if (fs.existsSync(path.join(repoRoot, '.gitleaks-baseline.json'))) {
    args.push('--baseline-path=/repo/.gitleaks-baseline.json');
  }

  runDocker(args);
};

const runSemgrep = () => runDocker([
  'run', '--rm',
  '-v', repoAsSrcMount,
  '-w', '/src',
  images.semgrep,
  'semgrep', 'scan',
  '--config', 'auto',
  '--severity', 'ERROR',
  '--error',
  '--json',
  '--output', '/src/security-reports/semgrep-report.json',
  '/src',
]);

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

const prepareTrivyScanRoot = () => {
  const scanRoot = path.join(reportDir, 'trivy-source');
  fs.rmSync(scanRoot, { recursive: true, force: true });
  fs.mkdirSync(scanRoot, { recursive: true });

  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  // Fixed git command lists source files; copied paths are constrained below before filesystem writes.
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repoRoot,
    encoding: 'buffer',
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || 'git ls-files failed while preparing Trivy source scan');
  }

  const files = result.stdout.toString('utf8').split('\0').filter(shouldCopyToTrivyScanRoot);
  for (const relativePath of files) {
    const sourcePath = path.join(repoRoot, relativePath);
    const destinationPath = path.join(scanRoot, relativePath);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) continue;
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }
  return scanRoot;
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
    '--exit-code', '1',
  ]);

  const tablePath = path.join(reportDir, 'trivy-image-table.txt');
  if (fs.existsSync(tablePath)) {
    process.stdout.write(fs.readFileSync(tablePath, 'utf8'));
  }
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

const commands = {
  gitleaks: runGitleaks,
  semgrep: runSemgrep,
  trivy: runTrivyFs,
  'trivy:image': runTrivyImage,
  zap: runZap,
  hadolint: runHadolint,
};

if (!commands[tool]) {
  console.error(`Unknown security Docker tool: ${tool || '(missing)'}`);
  console.error(`Available tools: ${Object.keys(commands).join(', ')}`);
  process.exit(2);
}

commands[tool]();
