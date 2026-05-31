import { spawnSync } from 'node:child_process';
import path from 'node:path';

const tool = String(process.argv[2] || '').trim();
const repoRoot = process.cwd();
const strict = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.QUALITY_EXTERNAL_TOOLS_REQUIRED || '').trim().toLowerCase()
);
const hostRepo = path.resolve(repoRoot).replace(/\\/g, '/');

const run = (command, args, options = {}) => spawnSync(command, args, {
  cwd: repoRoot,
  stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  encoding: options.capture ? 'utf8' : undefined,
  shell: false,
});
const hasCommand = (command) => (
  run(process.platform === 'win32' ? 'where.exe' : 'which', [command], { capture: true }).status === 0
);
const dockerAvailable = hasCommand('docker')
  && run('docker', ['version', '--format', '{{.Server.Version}}'], { capture: true }).status === 0;
const unavailable = () => {
  const message = `[quality:${tool}] skipped: install ${tool} or start Docker to run this local check.`;
  if (strict) {
    console.error(`${message} CI requires this scanner.`);
    process.exit(1);
  }
  console.log(message);
  process.exit(0);
};
const finish = (result) => {
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status || 0);
};

if (tool === 'actionlint') {
  if (hasCommand('actionlint')) {
    finish(run('actionlint', ['-shellcheck=']));
  }
  if (dockerAvailable) {
    finish(run('docker', [
      'run', '--rm',
      '-v', `${hostRepo}:/repo:ro`,
      '-w', '/repo',
      'rhysd/actionlint:1.7.12',
      '-shellcheck=',
    ]));
  }
  unavailable();
}

if (tool === 'shellcheck') {
  const filesResult = run('git', ['ls-files', '*.sh'], { capture: true });
  if (filesResult.status !== 0) {
    finish(filesResult);
  }
  const files = String(filesResult.stdout || '').split(/\r?\n/).filter(Boolean);
  if (files.length === 0) {
    console.log('[quality:shell] skipped: no tracked shell scripts found.');
    process.exit(0);
  }
  if (hasCommand('shellcheck')) {
    finish(run('shellcheck', ['-S', 'error', ...files]));
  }
  if (dockerAvailable) {
    finish(run('docker', [
      'run', '--rm',
      '-v', `${hostRepo}:/repo:ro`,
      'koalaman/shellcheck:v0.11.0',
      '-S', 'error',
      ...files.map((file) => `/repo/${file}`),
    ]));
  }
  unavailable();
}

console.error(`[quality] Unsupported external lint tool: ${tool || '(missing)'}`);
process.exit(2);
