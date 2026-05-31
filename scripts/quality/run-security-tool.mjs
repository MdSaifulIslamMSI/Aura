import { spawnSync } from 'node:child_process';

const tool = String(process.argv[2] || '').trim();
const strict = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.QUALITY_EXTERNAL_TOOLS_REQUIRED || '').trim().toLowerCase()
);
const allowedTools = new Set(['semgrep', 'trivy', 'hadolint']);

if (!allowedTools.has(tool)) {
  console.error(`[quality] Unsupported Docker-backed security tool: ${tool || '(missing)'}`);
  process.exit(2);
}

const lookup = (command) => spawnSync(
  process.platform === 'win32' ? 'where.exe' : 'which',
  [command],
  { encoding: 'utf8', shell: false }
);
const dockerAvailable = lookup('docker').status === 0
  && spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
    shell: false,
  }).status === 0;

if (!dockerAvailable) {
  const message = `[quality:${tool}] skipped: Docker engine is unavailable.`;
  if (strict) {
    console.error(`${message} CI requires this scanner.`);
    process.exit(1);
  }
  console.log(`${message} Start Docker and rerun npm run quality:${tool} for the full local scan.`);
  process.exit(0);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error(`[quality:${tool}] Run this wrapper through npm run quality:${tool}.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [npmCli, 'run', `security:${tool}`], {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status || 0);
