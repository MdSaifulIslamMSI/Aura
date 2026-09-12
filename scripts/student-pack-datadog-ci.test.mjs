import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('./student-pack-datadog-ci.mjs', import.meta.url));

const cleanEnv = () => {
  const env = { ...process.env };
  delete env.DATADOG_API_KEY;
  delete env.DD_API_KEY;
  delete env.DD_SERVICE;
  delete env.DD_ENV;
  delete env.DD_SITE;
  delete env.DATADOG_SITE;
  env.STUDENT_PACK_ENV_SKIP_LOAD = '1';
  return env;
};

const runScript = (args, env) => spawnSync(process.execPath, [scriptPath, ...args], {
  encoding: 'utf8',
  timeout: 30_000,
  env: env || cleanEnv(),
});

const makeTempDir = (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aura-datadog-ci-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// Fake datadog-ci that records its args and exits 0. Windows routes through
// cmd.exe, so the stub must be a .cmd shim on win32.
const installFakeBin = (t, dir) => {
  const logFile = path.join(dir, 'invocations.log');
  if (process.platform === 'win32') {
    const stub = path.join(dir, 'fake-datadog-ci.cmd');
    writeFileSync(stub, `@echo off\r\necho %*>> "${logFile}"\r\nexit /b 0\r\n`);
    return { bin: 'fake-datadog-ci.cmd', logFile, pathPrepend: dir };
  }
  const stub = path.join(dir, 'fake-datadog-ci');
  writeFileSync(stub, `#!/bin/sh\necho "$@" >> "${logFile}"\n`);
  return { bin: 'fake-datadog-ci', logFile, pathPrepend: dir };
};

test('help exits 0 and documents doctor, junit, and coverage', () => {
  const result = runScript(['--help']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /doctor/);
  assert.match(result.stdout, /junit/);
  assert.match(result.stdout, /coverage/);
});

test('unknown command exits non-zero with usage hint', () => {
  const result = runScript(['bogus-command']);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /Unknown Datadog command/);
});

test('junit rejects an unknown flag without touching the network', () => {
  const env = cleanEnv();
  env.DATADOG_API_KEY = 'dummy-key-for-validation-only';
  const result = runScript(['junit', 'test-results', '--bogus-flag'], env);
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(`${result.stdout}${result.stderr}`, /Unknown flag/);
});

test('junit requires an API key', () => {
  const result = runScript(['junit', 'test-results']);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(`${result.stdout}${result.stderr}`, /DATADOG_API_KEY or DD_API_KEY is required/);
});

test('junit fails clearly when the report path is missing', () => {
  const env = cleanEnv();
  env.DATADOG_API_KEY = 'dummy-key-for-validation-only';
  const result = runScript(['junit', path.join(os.tmpdir(), 'aura-datadog-ci-definitely-missing')], env);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(`${result.stdout}${result.stderr}`, /JUnit path does not exist/);
});

test('coverage fails clearly when the report path is missing', () => {
  const env = cleanEnv();
  env.DATADOG_API_KEY = 'dummy-key-for-validation-only';
  const result = runScript(['coverage', path.join(os.tmpdir(), 'aura-datadog-ci-definitely-missing')], env);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(`${result.stdout}${result.stderr}`, /Coverage path does not exist/);
});

test('doctor reports a missing binary instead of crashing', () => {
  const env = cleanEnv();
  env.DATADOG_API_KEY = 'dummy-key-for-validation-only';
  env.DATADOG_CI_BIN = 'aura-datadog-ci-definitely-missing-binary';
  const result = runScript(['doctor'], env);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /not runnable|Hint/);
});

test('junit forwards service, env, and dry-run to datadog-ci', (t) => {
  const dir = makeTempDir(t);
  const junitDir = path.join(dir, 'test-results');
  mkdirSync(junitDir, { recursive: true });
  writeFileSync(path.join(junitDir, 'results.xml'), '<testsuite></testsuite>\n');
  const fake = installFakeBin(t, dir);
  const env = cleanEnv();
  env.DATADOG_API_KEY = 'dummy-key-for-validation-only';
  env.DATADOG_CI_BIN = fake.bin;
  env.PATH = `${fake.pathPrepend}${path.delimiter}${process.env.PATH || ''}`;
  const result = runScript(
    ['junit', junitDir, '--service=custom-service', '--env=ci', '--dry-run'],
    env,
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
