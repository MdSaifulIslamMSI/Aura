#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStudentPackEnv } from './lib/student-pack-env.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const isWindows = process.platform === 'win32';

const DEFAULT_SERVICE = 'aura-marketplace';
const DEFAULT_SITE = 'datadoghq.com';

const getApiKey = (env = process.env) => env.DATADOG_API_KEY || env.DD_API_KEY || '';
const getService = (env = process.env) => env.DD_SERVICE || DEFAULT_SERVICE;
const getSite = (env = process.env) => env.DD_SITE || env.DATADOG_SITE || DEFAULT_SITE;

const resolveDatadogSpawn = (env = process.env) => {
  const binary = env.DATADOG_CI_BIN || 'datadog-ci';
  if (isWindows) {
    // .cmd shims cannot be spawned directly on Windows (EINVAL); route through
    // cmd.exe like scripts/student-pack-cli-doctor.mjs does.
    return { commandForSpawn: 'cmd.exe', argsPrefix: ['/d', '/c', binary], detail: binary };
  }
  return { commandForSpawn: binary, argsPrefix: [], detail: binary };
};

const run = (args, options = {}) => {
  const { commandForSpawn, argsPrefix } = resolveDatadogSpawn();
  // Command names are static CI checks; shell execution stays disabled.
  return spawnSync(commandForSpawn, [...argsPrefix, ...args], {
    cwd: repoRoot,
    stdio: options.stdio || 'inherit',
    encoding: options.encoding,
    timeout: options.timeout || 60_000,
    windowsHide: true,
  });
};

const usage = () => {
  console.log([
    'Usage:',
    '  node scripts/student-pack-datadog-ci.mjs doctor',
    '  node scripts/student-pack-datadog-ci.mjs junit [path] [--service NAME] [--env ENV] [--tags TAGS] [--dry-run]',
    '  node scripts/student-pack-datadog-ci.mjs coverage [paths...] [--dry-run]',
    '',
    'Env:',
    '  DATADOG_API_KEY or DD_API_KEY (required for uploads)',
    '  DD_SERVICE (default: aura-marketplace), DD_ENV (optional), DD_SITE (default: datadoghq.com)',
    '  DATADOG_CI_BIN (optional override for the datadog-ci binary, useful in tests)',
    '  STUDENT_PACK_ENV_SKIP_LOAD=1 skips loading local env files (tests)',
  ].join('\n'));
};

const parseUploadOptions = (argv) => {
  const paths = [];
  let service = '';
  let env = '';
  let tags = '';
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--service=')) {
      service = arg.slice('--service='.length);
    } else if (arg.startsWith('--env=')) {
      env = arg.slice('--env='.length);
    } else if (arg.startsWith('--tags=')) {
      tags = arg.slice('--tags='.length);
    } else if (arg === '--service' || arg === '--env' || arg === '--tags') {
      console.error(`Flag ${arg} requires a value. Use ${arg}=value.`);
      process.exit(2);
    } else if (arg.startsWith('--')) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(2);
    } else {
      paths.push(arg);
    }
  }
  return { paths, service, env, tags, dryRun };
};

const main = () => {
  if (!process.env.STUDENT_PACK_ENV_SKIP_LOAD) loadStudentPackEnv();
  const command = process.argv[2] || 'doctor';

  if (command === '--help' || command === '-h' || command === 'help') {
    usage();
    process.exit(0);
  }

  if (command === 'doctor') {
    const version = run(['version'], { stdio: 'pipe', encoding: 'utf8' });
    if (version.error || version.status !== 0) {
      console.error(version.error?.message || version.stderr || version.stdout || 'datadog-ci is not runnable.');
      console.error('Hint: npm exec --yes @datadog/datadog-ci -- version');
      process.exit(1);
    }
    console.log(String(version.stdout || '').trim());
    const apiKey = getApiKey();
    if (!apiKey) {
      console.error('Datadog API key env is missing. Set DATADOG_API_KEY or DD_API_KEY.');
      process.exit(1);
    }
    console.log('Datadog API key env is present.');
    console.log(`Site: ${getSite()} Service: ${getService()}${process.env.DD_ENV ? ` Env: ${process.env.DD_ENV}` : ''}`);
    process.exit(0);
  }

  if (command === 'junit' || command === 'coverage') {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.error('DATADOG_API_KEY or DD_API_KEY is required for upload.');
      process.exit(1);
    }
    const { paths, service, env, tags, dryRun } = parseUploadOptions(process.argv.slice(3));
    const resolvedService = service || getService();
    const resolvedEnv = env || process.env.DD_ENV || '';
    if (command === 'junit') {
      const junitPath = paths[0] || join(repoRoot, 'test-results');
      if (paths.length > 1) {
        console.error('junit accepts a single base path.');
        process.exit(2);
      }
      if (!existsSync(junitPath)) {
        console.error(`JUnit path does not exist: ${junitPath}`);
        console.error('Hint: run a test reporter that writes JUnit XML into test-results/ first.');
        process.exit(1);
      }
      const args = ['junit', 'upload', junitPath, '--service', resolvedService];
      if (resolvedEnv) args.push('--env', resolvedEnv);
      if (tags) args.push('--tags', tags);
      if (dryRun) args.push('--dry-run');
      const result = run(args);
      if (result.error || result.status !== 0) {
        console.error(result.error?.message || `datadog-ci junit upload failed with exit ${result.status}.`);
        process.exit(result.status || 1);
      }
      process.exit(0);
    }
    const coveragePaths = paths.length ? paths : [join(repoRoot, 'coverage')];
    const missing = coveragePaths.filter((candidate) => !existsSync(candidate));
    if (missing.length) {
      console.error(`Coverage path does not exist: ${missing.join(', ')}`);
      console.error('Hint: run coverage first, e.g. npm run quality:coverage, then point at the lcov/report dir.');
      process.exit(1);
    }
    const args = ['coverage', 'upload', ...coveragePaths];
    if (dryRun) args.push('--dry-run');
    const result = run(args);
    if (result.error || result.status !== 0) {
      console.error(result.error?.message || `datadog-ci coverage upload failed with exit ${result.status}.`);
      process.exit(result.status || 1);
    }
    process.exit(0);
  }

  console.error(`Unknown Datadog command: ${command}`);
  usage();
  process.exit(2);
};

main();
