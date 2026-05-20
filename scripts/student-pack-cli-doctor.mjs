#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStudentPackEnv } from './lib/student-pack-env.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const strict = process.argv.includes('--strict');
const loadedEnvFiles = loadStudentPackEnv();

const checks = [
  {
    name: 'Doppler',
    command: 'doppler',
    args: ['--version'],
    envGroups: [['DOPPLER_TOKEN'], ['DOPPLER_PROJECT', 'DOPPLER_CONFIG']],
    purpose: 'Secret injection for local backend/frontend starts.',
  },
  {
    name: 'Sentry CLI',
    command: 'sentry-cli',
    args: ['--version'],
    envGroups: [['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'], ['SENTRY_DSN']],
    purpose: 'Release creation and sourcemap uploads after frontend builds.',
  },
  {
    name: 'Datadog CI',
    command: 'datadog-ci',
    args: ['version'],
    envGroups: [['DATADOG_API_KEY'], ['DD_API_KEY']],
    purpose: 'Uploading test/CI artifacts and observability metadata.',
  },
  {
    name: 'Testmail.app API',
    command: 'node',
    args: ['scripts/student-pack-testmail-check.mjs', '--doctor'],
    envGroups: [['TESTMAIL_APIKEY', 'TESTMAIL_NAMESPACE']],
    purpose: 'OTP/order-email test mailbox checks.',
  },
  {
    name: 'LambdaTest Tunnel',
    command: 'node',
    args: ['-e', "require('./app/node_modules/@lambdatest/node-tunnel'); console.log('@lambdatest/node-tunnel installed')"],
    envGroups: [['LT_USERNAME', 'LT_ACCESS_KEY'], ['LT_USERNAME', 'LAMBDATEST_ACCESS_KEY']],
    purpose: 'Local tunnel for cross-browser E2E runs.',
  },
  {
    name: 'LocalStack CLI',
    command: 'localstack',
    args: ['--version'],
    envGroups: [['LOCALSTACK_AUTH_TOKEN'], ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']],
    purpose: 'Local AWS emulation for S3/SSM workflows.',
  },
  {
    name: 'AWS Local',
    command: 'awslocal',
    args: ['--version'],
    envGroups: [['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']],
    purpose: 'Convenience wrapper for bootstrapping LocalStack resources.',
    optional: true,
  },
];

const installHints = {
  doppler: 'Install Doppler CLI, then run: doppler login && doppler setup',
  'sentry-cli': 'Install sentry-cli or use: npm exec --yes @sentry/cli -- --version',
  'datadog-ci': 'Install datadog-ci or use: npm exec --yes @datadog/datadog-ci -- version',
  node: 'Node.js is required for repo-provided provider helpers.',
  localstack: 'Install LocalStack CLI, or let npm run student-pack:start use the Docker fallback.',
  awslocal: 'Install awscli-local, or use aws --endpoint-url=http://127.0.0.1:4566.',
};

const pathCandidates = (command) => {
  const appData = process.env.APPDATA || '';
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [];

  if (process.platform === 'win32') {
    candidates.push(
      join(appData, 'npm', `${command}.cmd`),
      join(appData, 'npm', `${command}.ps1`),
      join(appData, 'Python', 'Python312', 'Scripts', `${command}.exe`),
      join(appData, 'Python', 'Python312', 'Scripts', `${command}.bat`),
    );

    if (command === 'doppler') {
      candidates.push(join(
        localAppData,
        'Microsoft',
        'WinGet',
        'Packages',
        'Doppler.doppler_Microsoft.Winget.Source_8wekyb3d8bbwe',
        'doppler.exe',
      ));
    }

    if (command === 'localstack') {
      candidates.push(join(
        localAppData,
        'Microsoft',
        'WinGet',
        'Packages',
        'LocalStack.localstack-cli_Microsoft.Winget.Source_8wekyb3d8bbwe',
        'localstack.exe',
      ));
    }
  }

  return candidates.filter(Boolean);
};

const resolveCommand = (command) => {
  for (const candidate of pathCandidates(command)) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return command;
};

const run = (command, args = []) => {
  const executable = resolveCommand(command);
  const isWindowsShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
  const isPowerShellScript = process.platform === 'win32' && /\.ps1$/i.test(executable);
  const commandForSpawn = isWindowsShim
    ? 'cmd.exe'
    : isPowerShellScript
      ? 'powershell.exe'
      : executable;
  const argsForSpawn = isWindowsShim
    ? ['/d', '/c', executable, ...args]
    : isPowerShellScript
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', executable, ...args]
      : args;

  const result = spawnSync(commandForSpawn, argsForSpawn, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 8000,
    windowsHide: true,
  });

  if (result.error) {
    return {
      ok: false,
      detail: result.error.code || result.error.message,
    };
  }

  const output = `${result.stdout || ''}${result.stderr || ''}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0] || `exit ${result.status}`;

  return {
    ok: result.status === 0,
    detail: executable === command ? output : `${output} (${executable})`,
  };
};

const envGroupStatus = (groups = []) => groups.map((group) => {
  const configured = group.filter((key) => Boolean(process.env[key]));
  const missing = group.filter((key) => !configured.includes(key));
  return {
    keys: group,
    configured,
    missing,
    ok: missing.length === 0,
  };
});

const statusIcon = (ok) => (ok ? 'OK' : 'WARN');

const renderEnvGroups = (groups = []) => {
  if (groups.length === 0) return 'not required';
  return groups
    .map(({ keys, configured, missing, ok }) => {
      if (ok) return `set(${keys.join('+')})`;
      if (configured.length > 0) {
        return `partial(set ${configured.join('+')}; missing ${missing.join('+')})`;
      }
      return `missing(${keys.join('+')})`;
    })
    .join(' or ');
};

const localstackHealth = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch('http://127.0.0.1:4566/_localstack/health', {
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, detail: `HTTP ${response.status}` };
    }
    const body = await response.json().catch(() => ({}));
    const serviceCount = Object.keys(body.services || {}).length;
    return { ok: true, detail: `running (${serviceCount} services reported)` };
  } catch (error) {
    return { ok: false, detail: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timeout);
  }
};

const repoFiles = [
  'package.json',
  'app/package.json',
  'server/package.json',
  'docker-compose.split-runtime.yml',
  'app/playwright.config.js',
];

console.log('Aura student-pack CLI doctor');
console.log(`Repo: ${repoRoot}`);
if (loadedEnvFiles.length) {
  console.log(`Loaded local provider env files: ${loadedEnvFiles.length}`);
}
console.log('');

console.log('Repository checks');
for (const relativePath of repoFiles) {
  const ok = existsSync(join(repoRoot, relativePath));
  console.log(`- ${statusIcon(ok)} ${relativePath}`);
}

console.log('');
console.log('CLI checks');

let missingRequiredCli = false;
for (const check of checks) {
  const commandResult = run(check.command, check.args);
  const envStatus = envGroupStatus(check.envGroups);
  const envReady = envStatus.length === 0 || envStatus.some((group) => group.ok);
  const ok = commandResult.ok;

  if (!ok && !check.optional) {
    missingRequiredCli = true;
  }

  console.log(`- ${statusIcon(ok)} ${check.name}: ${commandResult.detail}`);
  console.log(`  purpose: ${check.purpose}`);
  console.log(`  env: ${renderEnvGroups(envStatus)}`);

  if (!ok) {
    console.log(`  hint: ${installHints[check.command] || 'Install the CLI and rerun this doctor.'}`);
  } else if (!envReady) {
    console.log('  hint: put the needed values in Doppler or your shell before running provider actions.');
  }
}

console.log('');
console.log('Docker runtime');
const docker = run('docker', ['version', '--format', '{{.Server.Version}}']);
console.log(`- ${statusIcon(docker.ok)} docker daemon: ${docker.detail}`);

console.log('');
console.log('LocalStack endpoint');
const health = await localstackHealth();
console.log(`- ${statusIcon(health.ok)} http://127.0.0.1:4566/_localstack/health: ${health.detail}`);

console.log('');
console.log('Useful next commands');
console.log('- npm run student-pack:start');
console.log('- npm run student-pack:doctor -- --strict');
console.log('- npm --prefix app run test:e2e');

if (strict && missingRequiredCli) {
  process.exitCode = 1;
}
