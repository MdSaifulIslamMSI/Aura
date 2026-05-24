import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const reportsDir = path.join(repoRoot, 'security-reports');
mkdirSync(reportsDir, { recursive: true });

if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
  throw new Error('Refusing to run free security scanners with NODE_ENV=production');
}

const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
const isCi = isTruthy(process.env.CI) || isTruthy(process.env.GITHUB_ACTIONS);
const scannersRequired = isTruthy(process.env.FREE_SECURITY_SCANNERS_REQUIRED) || isCi;
const dockerImagePrefix = String(process.env.FREE_SECURITY_SCANNER_IMAGE_PREFIX || '').trim();
const stagingUrl = String(process.env.STAGING_URL || '').trim();
const scannerImages = {
  osv: process.env.FREE_SECURITY_OSV_IMAGE || 'ghcr.io/google/osv-scanner:v2.3.6',
  trivy: process.env.FREE_SECURITY_TRIVY_IMAGE || 'aquasec/trivy:0.69.3',
  semgrep: process.env.FREE_SECURITY_SEMGREP_IMAGE || 'semgrep/semgrep:1.163.0',
  zap: process.env.FREE_SECURITY_ZAP_IMAGE || 'ghcr.io/zaproxy/zaproxy:stable',
};

const run = (command, args, options = {}) => spawnSync(command, args, {
  cwd: options.cwd || repoRoot,
  encoding: 'utf8',
  shell: false,
  env: process.env,
});

const hasCommand = (command) => {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = run(lookup, [command]);
  return result.status === 0;
};

const dockerServerAvailable = () => {
  if (!hasCommand('docker')) return false;
  const result = run('docker', ['version', '--format', '{{.Server.Version}}']);
  return result.status === 0;
};

const dockerMount = `${repoRoot}:/src:ro`;
const dockerAvailable = dockerServerAvailable();

const dockerImage = (image) => dockerImagePrefix ? `${dockerImagePrefix}${image}` : image;

const shouldCopyToScannerSource = (relativePath) => {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('../') || path.isAbsolute(normalized)) return false;
  return ![
    '.agents/',
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

const prepareScannerSource = () => {
  const scanRoot = path.join(reportsDir, 'free-scanner-source');
  rmSync(scanRoot, { recursive: true, force: true });
  mkdirSync(scanRoot, { recursive: true });

  const result = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || 'git ls-files failed while preparing free scanner source');
  }

  const files = Buffer.from(result.stdout || '', 'utf8')
    .toString('utf8')
    .split('\0')
    .filter(shouldCopyToScannerSource);

  for (const relativePath of files) {
    const sourcePath = path.join(repoRoot, relativePath);
    const destinationPath = path.join(scanRoot, relativePath);
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) continue;
    mkdirSync(path.dirname(destinationPath), { recursive: true });
    copyFileSync(sourcePath, destinationPath);
  }

  return scanRoot;
};

const scannerSource = prepareScannerSource();
const scannerSourceMount = `${scannerSource}:/scan:ro`;

const scanners = [
  {
    name: 'osv-scanner',
    binary: 'osv-scanner',
    binaryArgs: ['-r', '.'],
    dockerArgs: ['run', '--rm', '-v', dockerMount, dockerImage(scannerImages.osv), '-r', '/src'],
  },
  {
    name: 'trivy',
    binary: 'trivy',
    binaryArgs: ['fs', scannerSource],
    dockerArgs: ['run', '--rm', '-v', scannerSourceMount, dockerImage(scannerImages.trivy), 'fs', '/scan'],
  },
  {
    name: 'semgrep',
    binary: 'semgrep',
    binaryArgs: ['--config', 'p/owasp-top-ten', '.'],
    dockerArgs: ['run', '--rm', '-v', dockerMount, '-w', '/src', dockerImage(scannerImages.semgrep), 'semgrep', '--config', 'p/owasp-top-ten', '/src'],
  },
];

const isUnsafeZapTarget = (value) => {
  if (!value) return false;
  if (isTruthy(process.env.ZAP_TARGET_IS_PRODUCTION)) return true;

  const productionCandidates = [
    process.env.PRODUCTION_URL,
    process.env.PUBLIC_PRODUCTION_URL,
    process.env.APP_PRODUCTION_URL,
  ].map((entry) => String(entry || '').trim()).filter(Boolean);

  try {
    const target = new URL(value);
    return productionCandidates.some((candidate) => {
      try {
        const production = new URL(candidate);
        return production.hostname && production.hostname === target.hostname;
      } catch {
        return false;
      }
    });
  } catch {
    return true;
  }
};

const writeScannerOutput = (scanner, result) => {
  writeFileSync(path.join(reportsDir, `${scanner.name}.stdout.txt`), result.stdout || '');
  writeFileSync(path.join(reportsDir, `${scanner.name}.stderr.txt`), result.stderr || '');
};

const results = scanners.map((scanner) => {
  const hasBinary = hasCommand(scanner.binary);
  if (hasBinary) {
    const result = run(scanner.binary, scanner.binaryArgs);
    writeScannerOutput(scanner, result);
    return {
      name: scanner.name,
      command: `${scanner.binary} ${scanner.binaryArgs.join(' ')}`,
      status: result.status === 0 ? 'passed' : 'failed',
      exitCode: result.status,
      runner: 'binary',
    };
  }

  if (dockerAvailable) {
    const result = run('docker', scanner.dockerArgs);
    writeScannerOutput(scanner, result);
    return {
      name: scanner.name,
      command: `docker ${scanner.dockerArgs.join(' ')}`,
      status: result.status === 0 ? 'passed' : 'failed',
      exitCode: result.status,
      runner: 'docker',
    };
  }

  return {
    name: scanner.name,
    command: `${scanner.binary} ${scanner.binaryArgs.join(' ')}`,
    status: scannersRequired ? 'failed' : 'skipped',
    exitCode: scannersRequired ? 127 : 0,
    runner: 'unavailable',
    reason: 'No local scanner binary and Docker engine is unavailable',
  };
});

const runZapBaseline = () => {
  const scanner = {
    name: 'zap-baseline',
    binary: 'zap-baseline.py',
    binaryArgs: ['-t', stagingUrl],
    dockerArgs: ['run', '--rm', dockerImage(scannerImages.zap), 'zap-baseline.py', '-t', stagingUrl],
  };

  if (!stagingUrl) {
    return {
      name: scanner.name,
      command: 'zap-baseline.py -t $STAGING_URL',
      status: 'skipped',
      exitCode: 0,
      runner: 'unavailable',
      reason: 'STAGING_URL is not set; OWASP ZAP baseline skipped. Never run ZAP against production by default.',
    };
  }

  if (isUnsafeZapTarget(stagingUrl)) {
    return {
      name: scanner.name,
      command: `zap-baseline.py -t ${stagingUrl}`,
      status: 'failed',
      exitCode: 2,
      runner: 'guard',
      reason: 'Refusing OWASP ZAP baseline because the target looks like production or is invalid.',
    };
  }

  if (hasCommand(scanner.binary)) {
    const result = run(scanner.binary, scanner.binaryArgs);
    writeScannerOutput(scanner, result);
    return {
      name: scanner.name,
      command: `${scanner.binary} ${scanner.binaryArgs.join(' ')}`,
      status: result.status === 0 ? 'passed' : 'failed',
      exitCode: result.status,
      runner: 'binary',
    };
  }

  if (dockerAvailable) {
    const result = run('docker', scanner.dockerArgs);
    writeScannerOutput(scanner, result);
    return {
      name: scanner.name,
      command: `docker ${scanner.dockerArgs.join(' ')}`,
      status: result.status === 0 ? 'passed' : 'failed',
      exitCode: result.status,
      runner: 'docker',
    };
  }

  return {
    name: scanner.name,
    command: `zap-baseline.py -t ${stagingUrl}`,
    status: scannersRequired ? 'failed' : 'skipped',
    exitCode: scannersRequired ? 127 : 0,
    runner: 'unavailable',
    reason: 'STAGING_URL is set, but neither zap-baseline.py nor Docker engine is available',
  };
};

results.push(runZapBaseline());

const report = {
  generatedAt: new Date().toISOString(),
  required: scannersRequired,
  dockerAvailable,
  repoRoot,
  scannerImages,
  results,
};

writeFileSync(path.join(reportsDir, 'free-security-scanners.json'), `${JSON.stringify(report, null, 2)}\n`);

const failed = results.filter((result) => result.status === 'failed');
const skipped = results.filter((result) => result.status === 'skipped');

for (const result of results) {
  console.log(`[free-scanners] ${result.name}: ${result.status} via ${result.runner}`);
  if (result.reason) console.log(`[free-scanners] ${result.name}: ${result.reason}`);
}

if (skipped.length > 0 && !scannersRequired) {
  console.log('[free-scanners] skipped scanners are recorded in security-reports/free-security-scanners.json');
}

if (failed.length > 0) {
  console.error(`[free-scanners] ${failed.length} scanner(s) failed. See security-reports/free-security-scanners.json`);
  process.exit(1);
}

if (!existsSync(path.join(reportsDir, 'free-security-scanners.json'))) {
  throw new Error('Scanner report was not written');
}
