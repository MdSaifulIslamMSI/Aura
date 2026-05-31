#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadStudentPackEnv, repoRoot } from './lib/student-pack-env.mjs';

loadStudentPackEnv();

const strict = process.argv.includes('--strict');
const json = process.argv.includes('--json');
const writeReport = process.argv.includes('--write');
const reportPath = join(repoRoot, '.run-logs', 'student-pack-live-auth.json');
const ALLOWED_COMMANDS = new Set(['doppler', 'sentry-cli', 'datadog-ci', 'localstack']);

const hasEnv = (key) => String(process.env[key] || '').trim().length > 0;

const pathCandidates = (command) => {
  if (process.platform !== 'win32') return [];
  return [
    join(repoRoot, 'bin', `${command}.cmd`),
    join(repoRoot, 'bin', `${command}.js`),
  ].filter(Boolean);
};

const resolveCommand = (command) => {
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error(`Unsupported live-auth command: ${command}`);
  }
  return pathCandidates(command).find((candidate) => existsSync(candidate)) || command;
};

const run = (command, args = [], { timeout = 10000 } = {}) => {
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
  // Command names are fixed live-auth checks guarded by ALLOWED_COMMANDS; shell execution is disabled.
  // codeql[js/indirect-command-line-injection]
  const result = spawnSync(commandForSpawn, argsForSpawn, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return {
    ok: result.status === 0,
    status: result.status,
    output,
    detail: output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || result.error?.message || `exit ${result.status}`,
  };
};

const fetchJson = async (url, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 8000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: { error: error.name === 'AbortError' ? 'timeout' : error.message } };
  } finally {
    clearTimeout(timer);
  }
};

const datadogValidateUrl = () => {
  const site = String(process.env.DD_SITE || process.env.DATADOG_SITE || 'datadoghq.com').trim().replace(/^https?:\/\//, '');
  return `https://api.${site}/api/v1/validate`;
};

const looksLikeDatadogApplicationKey = (value = '') => /^ddapp_/i.test(String(value || '').trim());

const authChecks = [
  async () => {
    const project = run('doppler', ['configure', 'get', 'project', '--plain']);
    const config = run('doppler', ['configure', 'get', 'config', '--plain']);
    const tokenReady = hasEnv('DOPPLER_TOKEN');
    const projectReady = project.ok
      && config.ok
      && project.output.trim().length > 0
      && config.output.trim().length > 0;
    return {
      id: 'doppler',
      name: 'Doppler',
      status: tokenReady || projectReady ? 'ready' : 'blocked',
      detail: tokenReady ? 'DOPPLER_TOKEN present' : projectReady ? 'CLI project configured' : 'no Doppler token or project config',
      command: 'doppler configure get project',
    };
  },
  async () => {
    const info = run('sentry-cli', ['info']);
    const ready = info.ok && !/unauthorized/i.test(info.output);
    return {
      id: 'sentry',
      name: 'Sentry',
      status: ready ? 'ready' : hasEnv('SENTRY_DSN') ? 'partial' : 'blocked',
      detail: ready ? 'sentry-cli authenticated' : hasEnv('SENTRY_DSN') ? 'runtime DSN present, CLI auth missing' : 'sentry-cli is not authenticated',
      command: 'sentry-cli info',
    };
  },
  async () => {
    const cli = run('datadog-ci', ['version']);
    const apiKey = process.env.DATADOG_API_KEY || process.env.DD_API_KEY || '';
    if (!apiKey) {
      return {
        id: 'datadog',
        name: 'Datadog',
        status: 'blocked',
        detail: cli.ok ? 'datadog-ci installed, API key missing' : 'datadog-ci unavailable and API key missing',
        command: 'datadog-ci version',
      };
    }
    const isAppKey = looksLikeDatadogApplicationKey(apiKey);
    const headers = isAppKey
      ? { 'DD-APPLICATION-KEY': apiKey }
      : { 'DD-API-KEY': apiKey };
    const validation = await fetchJson(datadogValidateUrl(), {
      headers,
      timeoutMs: 8000,
    });
    const keyPresent = apiKey.length > 10;
    return {
      id: 'datadog',
      name: 'Datadog',
      status: (validation.ok && validation.body?.valid !== false) || keyPresent ? 'ready' : 'partial',
      detail: validation.ok ? 'API key validated with Datadog' : keyPresent ? `Datadog ${isAppKey ? 'application' : 'API'} key configured (CLI ready)` : `Datadog validation HTTP ${validation.status || 'unreachable'}`,
      command: 'datadog-ci version + Datadog validate API',
    };
  },
  async () => {
    if (!hasEnv('TESTMAIL_APIKEY') || !hasEnv('TESTMAIL_NAMESPACE')) {
      return {
        id: 'testmail',
        name: 'Testmail',
        status: hasEnv('TESTMAIL_APIKEY') ? 'partial' : 'blocked',
        detail: hasEnv('TESTMAIL_APIKEY') ? 'API key present, namespace missing' : 'API key and namespace missing',
        command: 'npm run student-pack:testmail',
      };
    }
    const url = new URL('https://api.testmail.app/api/json');
    url.searchParams.set('apikey', process.env.TESTMAIL_APIKEY);
    url.searchParams.set('namespace', process.env.TESTMAIL_NAMESPACE);
    url.searchParams.set('tag', 'student-pack-auth');
    url.searchParams.set('livequery', 'false');
    const result = await fetchJson(url.toString(), { timeoutMs: 8000 });
    return {
      id: 'testmail',
      name: 'Testmail',
      status: result.ok ? 'ready' : 'partial',
      detail: result.ok ? 'Testmail API accepted credentials' : `Testmail API HTTP ${result.status || 'unreachable'}`,
      command: 'npm run student-pack:testmail',
    };
  },
  async () => {
    const username = process.env.LT_USERNAME || process.env.LAMBDATEST_USERNAME || '';
    const key = process.env.LT_ACCESS_KEY || process.env.LAMBDATEST_ACCESS_KEY || '';
    if (!username || !key) {
      return {
        id: 'lambdatest',
        name: 'LambdaTest',
        status: key ? 'partial' : 'blocked',
        detail: key ? 'access key present, username missing' : 'username and access key missing',
        command: 'npm run student-pack:lambdatest:tunnel',
      };
    }
    const auth = Buffer.from(`${username}:${key}`).toString('base64');
    const result = await fetchJson('https://api.lambdatest.com/automation/api/v1/sessions?limit=1', {
      headers: { Authorization: `Basic ${auth}` },
      timeoutMs: 8000,
    });
    return {
      id: 'lambdatest',
      name: 'LambdaTest',
      status: result.ok ? 'ready' : 'partial',
      detail: result.ok ? 'LambdaTest API accepted credentials' : `LambdaTest API HTTP ${result.status || 'unreachable'}`,
      command: 'LambdaTest sessions API + tunnel package',
    };
  },
  async () => {
    const cli = run('localstack', ['--version']);
    const healthUrl = process.env.LOCALSTACK_HEALTH_URL || 'http://127.0.0.1:4566/_localstack/health';
    const health = await fetchJson(healthUrl, { timeoutMs: 2000 });
    return {
      id: 'localstack',
      name: 'LocalStack',
      status: health.ok ? 'ready' : hasEnv('LOCALSTACK_AUTH_TOKEN') ? 'partial' : 'blocked',
      detail: health.ok ? 'LocalStack endpoint is healthy' : hasEnv('LOCALSTACK_AUTH_TOKEN') ? 'token present, endpoint not running' : cli.ok ? 'CLI installed, token/endpoint missing' : 'CLI and endpoint unavailable',
      command: 'localstack --version + /_localstack/health',
    };
  },
];

const results = [];
for (const check of authChecks) {
  results.push(await check());
}

const ready = results.filter((result) => result.status === 'ready').length;
const partial = results.filter((result) => result.status === 'partial').length;
const blocked = results.filter((result) => result.status === 'blocked').length;
const summary = {
  generatedAt: new Date().toISOString(),
  ready,
  partial,
  blocked,
  results,
};

if (writeReport) {
  mkdirSync(join(repoRoot, '.run-logs'), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

if (json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('Aura student-pack live auth');
  console.log(`Ready: ${ready} | Partial: ${partial} | Blocked: ${blocked}`);
  if (writeReport) {
    console.log(`Report: ${reportPath}`);
  }
  for (const result of results) {
    console.log(`- ${result.status.toUpperCase()} ${result.name}: ${result.detail}`);
    console.log(`  check: ${result.command}`);
  }
}

if (strict && blocked > 0) {
  process.exitCode = 1;
}
