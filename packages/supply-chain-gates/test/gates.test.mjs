import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { checkAllowScripts } from '../lib/allow-scripts-gate.mjs';
import { checkRegistry } from '../lib/registry-gate.mjs';
import { checkFreshness, fetchPublishTime } from '../lib/freshness-gate.mjs';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(pkgRoot, 'bin', 'aurasec-supply-chain.js');
const fixture = (...parts) => join(pkgRoot, 'test', 'fixtures', ...parts);

// ---------------------------------------------------------------- allow-scripts

test('allow-scripts: all install-script packages allowlisted passes', () => {
    const result = checkAllowScripts({
        workspaces: [{ name: 'clean', lockfile: fixture('allow-scripts', 'clean', 'package-lock.json'), packageJson: fixture('allow-scripts', 'clean', 'package.json') }],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    assert.match(result.logs[0], /1 install-script package\(s\), all allowlisted/);
});

test('allow-scripts: unallowlisted install-script package fails', () => {
    const result = checkAllowScripts({
        workspaces: [{ name: 'violation', lockfile: fixture('allow-scripts', 'violation', 'package-lock.json'), packageJson: fixture('allow-scripts', 'violation', 'package.json') }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /install-script package "esbuild".*is not allowlisted/);
});

test('allow-scripts: stale allowlist entry with no matching package fails', () => {
    const result = checkAllowScripts({
        workspaces: [{ name: 'stale', lockfile: fixture('allow-scripts', 'stale-entry', 'package-lock.json'), packageJson: fixture('allow-scripts', 'stale-entry', 'package.json') }],
    });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /allowScripts entry "left-the-tree" covers no install-script package/);
});

test('allow-scripts: missing lockfile fails with a clear message', () => {
    const result = checkAllowScripts({
        workspaces: [{ name: 'ghost', lockfile: fixture('allow-scripts', 'does-not-exist.json'), packageJson: fixture('allow-scripts', 'clean', 'package.json') }],
    });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /lockfile missing/);
});

// ---------------------------------------------------------------- registry

test('registry: clean lockfile passes, link entries and root skipped', () => {
    const result = checkRegistry({ lockfiles: [fixture('registry', 'clean', 'package-lock.json')] });
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    assert.match(result.logs[0], /2 registry entr\(ies\) verified/);
});

test('registry: non-registry host fails', () => {
    const result = checkRegistry({ lockfiles: [fixture('registry', 'bad-host', 'package-lock.json')] });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /resolves outside https:\/\/registry\.npmjs\.org/);
});

test('registry: missing integrity hash fails', () => {
    const result = checkRegistry({ lockfiles: [fixture('registry', 'missing-integrity', 'package-lock.json')] });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /missing a sha512 integrity hash/);
});

test('registry: tarball path not matching name@version fails', () => {
    const result = checkRegistry({ lockfiles: [fixture('registry', 'tarball-mismatch', 'package-lock.json')] });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /tarball path does not match lodash@4\.17\.21/);
});

// ---------------------------------------------------------------- freshness

const NOW = Date.parse('2026-10-04T12:00:00.000Z');
const HEAD_LOCK = {
    packages: {
        'node_modules/lodash': { version: '4.17.21', resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz' },
    },
};
const makeGit = (headLock, baseLock) => (args) => {
    if (args[0] === 'rev-parse' && args[1] === '--verify') return '0123456789abcdef0123456789abcdef01234567';
    if (args[0] === 'show') {
        const [ref] = args[1].split(':');
        return JSON.stringify(ref === 'HEAD' ? headLock : baseLock);
    }
    throw new Error(`unexpected git invocation: ${args.join(' ')}`);
};
const makeFetch = (publishedIso) => async () => ({
    ok: true,
    json: async () => ({ time: { '4.17.21': publishedIso } }),
});

test('freshness: no changed versions passes without registry lookups', async () => {
    const result = await checkFreshness({
        lockfiles: ['package-lock.json'],
        git: makeGit(HEAD_LOCK, HEAD_LOCK),
        now: NOW,
    });
    assert.equal(result.ok, true);
    assert.ok(result.logs.some((line) => /no lockfile versions changed/.test(line)));
});

test('freshness: version older than the cooldown passes', async () => {
    const result = await checkFreshness({
        lockfiles: ['package-lock.json'],
        minAgeDays: 7,
        git: makeGit(HEAD_LOCK, { packages: {} }),
        fetchImpl: makeFetch('2026-09-01T00:00:00.000Z'),
        now: NOW,
    });
    assert.equal(result.ok, true);
});

test('freshness: version fresher than the cooldown fails', async () => {
    const result = await checkFreshness({
        lockfiles: ['package-lock.json'],
        minAgeDays: 7,
        git: makeGit(HEAD_LOCK, { packages: {} }),
        fetchImpl: makeFetch('2026-10-03T00:00:00.000Z'),
        now: NOW,
    });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /lodash@4\.17\.21 published 2026-10-03 \(1\.5d ago, cooldown 7d\)/);
});

test('freshness: fresh version covered by a live allowlist entry passes', async () => {
    const result = await checkFreshness({
        lockfiles: ['package-lock.json'],
        minAgeDays: 7,
        git: makeGit(HEAD_LOCK, { packages: {} }),
        fetchImpl: makeFetch('2026-10-03T00:00:00.000Z'),
        now: NOW,
    });
    assert.equal(result.ok, false); // sanity: without allowlist this fails

    const allowlisted = await checkFreshness({
        lockfiles: ['package-lock.json'],
        minAgeDays: 7,
        allowlistPath: fixture('freshness', 'allowlist-live.json'),
        git: makeGit(HEAD_LOCK, { packages: {} }),
        fetchImpl: makeFetch('2026-10-03T00:00:00.000Z'),
        now: NOW,
    });
    assert.equal(allowlisted.ok, true);
    assert.ok(allowlisted.logs.some((line) => /allowlisted: lodash@4\.17\.21/.test(line)));
});

test('freshness: expired allowlist entry fails the gate itself', async () => {
    const result = await checkFreshness({
        lockfiles: ['package-lock.json'],
        minAgeDays: 7,
        allowlistPath: fixture('freshness', 'allowlist-expired.json'),
        git: makeGit(HEAD_LOCK, { packages: {} }),
        fetchImpl: makeFetch('2026-10-03T00:00:00.000Z'),
        now: NOW,
    });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /expired at/);
});

test('freshness: reason-less allowlist entry fails the gate itself', async () => {
    const result = await checkFreshness({
        lockfiles: ['package-lock.json'],
        minAgeDays: 7,
        allowlistPath: fixture('freshness', 'allowlist-malformed.json'),
        git: makeGit(HEAD_LOCK, { packages: {} }),
        fetchImpl: makeFetch('2026-10-03T00:00:00.000Z'),
        now: NOW,
    });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /missing name\/reason\/expires/);
});

test('freshness: registry lookup failure fails closed', async () => {
    const result = await checkFreshness({
        lockfiles: ['package-lock.json'],
        minAgeDays: 7,
        git: makeGit(HEAD_LOCK, { packages: {} }),
        fetchImpl: async () => { throw new Error('boom'); },
        now: NOW,
    });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /registry lookup failed for lodash@4\.17\.21/);
});

test('freshness: non-positive cooldown is rejected', async () => {
    const result = await checkFreshness({ lockfiles: ['package-lock.json'], minAgeDays: 0 });
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /--min-age-days must be a positive number/);
});

test('fetchPublishTime: scoped packages use the registry packument URL format (%2F-encoded)', async () => {
    let capturedUrl;
    await fetchPublishTime('https://registry.npmjs.org', '@scope/pkg', '1.2.3', async (url) => {
        capturedUrl = url;
        throw new Error('stop');
    }).catch(() => {});
    assert.equal(capturedUrl, 'https://registry.npmjs.org/@scope%2Fpkg');
});

// ---------------------------------------------------------------- CLI

const runCli = (args, cwd) => spawnSync(process.execPath, [binPath, ...args], { cwd, encoding: 'utf8' });

test('cli: allow-scripts passes on a clean fixture (exit 0)', () => {
    const proc = runCli(['allow-scripts'], fixture('allow-scripts', 'clean'));
    assert.equal(proc.status, 0, proc.stderr || proc.stdout);
    assert.match(proc.stdout, /PASS/);
});

test('cli: allow-scripts fails on a violation fixture (exit 1)', () => {
    const proc = runCli(['allow-scripts'], fixture('allow-scripts', 'violation'));
    assert.equal(proc.status, 1);
    assert.match(proc.stderr, /FAILED/);
});

test('cli: registry passes on a clean fixture (exit 0)', () => {
    const proc = runCli(['registry'], fixture('registry', 'clean'));
    assert.equal(proc.status, 0, proc.stderr || proc.stdout);
    assert.match(proc.stdout, /PASS/);
});

test('cli: registry fails on a tampered fixture (exit 1)', () => {
    const proc = runCli(['registry'], fixture('registry', 'bad-host'));
    assert.equal(proc.status, 1);
    assert.match(proc.stderr, /resolves outside/);
});

test('cli: unknown gate is a usage error (exit 2)', () => {
    const proc = runCli(['nope']);
    assert.equal(proc.status, 2);
});

test('cli: allow-scripts with unmatched flag pairs is a usage error (exit 2)', () => {
    const proc = runCli(['allow-scripts', '--lockfile', 'package-lock.json'], fixture('allow-scripts', 'clean'));
    assert.equal(proc.status, 2);
    assert.match(proc.stderr, /matching pairs/);
});

test('cli: unknown flag is a usage error (exit 2)', () => {
    const proc = runCli(['registry', '--bogus', 'x'], fixture('registry', 'clean'));
    assert.equal(proc.status, 2);
    assert.match(proc.stderr, /unknown flag/);
});
