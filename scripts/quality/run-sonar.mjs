import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const scannerImage = process.env.SONAR_SCANNER_IMAGE || 'sonarsource/sonar-scanner-cli:12.1.0.3233_8.0.1';
const strict = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.QUALITY_SONAR_REQUIRED || '').trim().toLowerCase()
);
const hostUrl = String(process.env.SONAR_HOST_URL || '').trim();
const token = String(process.env.SONAR_TOKEN || '').trim();

if (!hostUrl || !token) {
  const message = '[quality:sonar] skipped: SONAR_HOST_URL and SONAR_TOKEN are not configured.';
  if (strict) {
    console.error(`${message} CI requires Sonar analysis.`);
    process.exit(1);
  }
  console.log(`${message} See docs/sonarqube-local.md.`);
  process.exit(0);
}

const dockerResult = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
  encoding: 'utf8',
  shell: false,
});
if (dockerResult.status !== 0) {
  const message = '[quality:sonar] skipped: Docker engine is unavailable.';
  if (strict) {
    console.error(`${message} CI requires Sonar analysis.`);
    process.exit(1);
  }
  console.log(`${message} Start Docker and rerun npm run quality:sonar.`);
  process.exit(0);
}

const hostRepo = path.resolve(repoRoot).replace(/\\/g, '/');
const result = spawnSync('docker', [
  'run', '--rm',
  '-e', 'SONAR_HOST_URL',
  '-e', 'SONAR_TOKEN',
  '-v', `${hostRepo}:/usr/src`,
  '-w', '/usr/src',
  scannerImage,
], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    SONAR_HOST_URL: hostUrl,
    SONAR_TOKEN: token,
  },
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status || 0);
