import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mode = process.argv.includes('--ci') ? 'ci' : 'local';
const requiredInCi = mode === 'ci';

const run = (command, args) => {
  const executable = process.platform === 'win32' && ['npm', 'npx'].includes(command)
    ? 'cmd.exe'
    : command;
  const executableArgs = process.platform === 'win32' && ['npm', 'npx'].includes(command)
    ? ['/c', command, ...args]
    : args;

  return spawnSync(executable, executableArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
    stdio: 'inherit',
  });
};

const hasCommand = (command) => {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(lookup, [command], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  });
  return result.status === 0;
};

const shouldCopyToScannerSource = (relativePath) => {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('../') || path.isAbsolute(normalized)) return false;
  return ![
    '.git/',
    '.trivycache/',
    'node_modules/',
    'app/node_modules/',
    'server/node_modules/',
    'app/dist/',
    'desktop-release/',
    'generated/',
    'output/',
    'reports/',
    'security-reports/',
    'server/data/',
    'server/uploads/',
  ].some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
};

const prepareGitleaksSource = () => {
  const scanRoot = mkdtempSync(path.join(os.tmpdir(), 'aura-pqc-gitleaks-'));
  const result = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: process.cwd(),
    encoding: 'buffer',
    shell: false,
  });
  if (result.status !== 0) {
    return {
      source: process.cwd(),
      cleanup: () => rmSync(scanRoot, { recursive: true, force: true }),
    };
  }

  const files = Buffer.from(result.stdout || '')
    .toString('utf8')
    .split('\0')
    .filter(shouldCopyToScannerSource);

  for (const file of files) {
    const sourcePath = path.join(process.cwd(), file);
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) continue;
    const destinationPath = path.join(scanRoot, file);
    mkdirSync(path.dirname(destinationPath), { recursive: true });
    copyFileSync(sourcePath, destinationPath);
  }

  return {
    source: scanRoot,
    cleanup: () => rmSync(scanRoot, { recursive: true, force: true }),
  };
};

const tools = [
  {
    name: 'gitleaks',
    command: 'gitleaks',
    args: () => {
      const scan = prepareGitleaksSource();
      return {
        args: [
          'detect',
          '--no-git',
          '--source',
          scan.source,
          '--redact',
          ...(existsSync('.gitleaks.toml') ? ['--config', path.join(process.cwd(), '.gitleaks.toml')] : []),
        ],
        cleanup: scan.cleanup,
      };
    },
    install: 'Install Gitleaks from https://github.com/gitleaks/gitleaks/releases or use the existing npm run security:gitleaks Docker wrapper.',
  },
  {
    name: 'trivy',
    command: 'trivy',
    args: ['fs', '.'],
    install: 'Install Trivy from https://github.com/aquasecurity/trivy or use the existing npm run security:trivy Docker wrapper.',
  },
  {
    name: 'osv-scanner',
    command: 'osv-scanner',
    args: ['-r', '.'],
    install: 'Install OSV-Scanner from https://github.com/google/osv-scanner or use the existing free scanner workflow.',
  },
  {
    name: 'semgrep',
    command: 'semgrep',
    args: ['scan', '--config', 'security/semgrep/pqc-crypto-policy.yml'],
    install: 'Install Semgrep CE with pipx install semgrep.',
  },
  {
    name: 'cryptodeps',
    command: 'cryptodeps',
    args: ['.'],
    install: 'Install cryptodeps from its open-source distribution if it is part of your local security toolchain.',
  },
];

const results = [];

const pqc = run('npm', ['run', 'security:pqc']);
results.push({ name: 'security:pqc', status: pqc.status === 0 ? 'passed' : 'failed', exitCode: pqc.status });

for (const tool of tools) {
  if (!hasCommand(tool.command)) {
    console.log(`[free-stack] ${tool.name}: missing. ${tool.install}`);
    results.push({
      name: tool.name,
      status: requiredInCi ? 'failed' : 'skipped',
      exitCode: requiredInCi ? 127 : 0,
    });
    continue;
  }

  const invocation = typeof tool.args === 'function' ? tool.args() : { args: tool.args };
  const result = run(tool.command, invocation.args);
  if (invocation.cleanup) invocation.cleanup();
  results.push({
    name: tool.name,
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
  });
}

const failed = results.filter((result) => result.status === 'failed');
for (const result of results) {
  console.log(`[free-stack] ${result.name}: ${result.status}`);
}

if (failed.length > 0) {
  process.exit(1);
}
