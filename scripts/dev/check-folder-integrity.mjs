#!/usr/bin/env node
// Folder integrity gate.
//
// The failure this exists to prevent: work lands on origin/main, but the folder
// you actually edit and run commands in stays on an older commit with an empty
// node_modules. Every test run there then passes against code that is not
// deployed, and every "done" describes a tree nobody else has.
//
// Git will not warn you about this. A stale checkout is a perfectly valid
// checkout, and an empty node_modules is just an unprovisioned directory. So
// this gate asserts the three invariants that were silently false on
// 2026-11-09:
//
//   1. HEAD is not behind origin/main.
//   2. There is exactly one worktree, and no stash holds work elsewhere.
//   3. Every package in package-lock.json is installed in node_modules.
//
// Exit 0 = this folder is the canonical, provisioned working copy.
// Exit 1 = at least one invariant is false.
//
// Flags:
//   --strict    Treat local-only warnings (detached HEAD, extraneous packages)
//               as failures. Optional packages npm skips for this platform are
//               ignored in both modes: they are not load-bearing here.
//               Commits ahead of origin/main stay a warning in both modes:
//               that is local work, not drift.
//   --offline   Skip the network fetch and compare against the cached
//               origin/main ref. Reports the risk instead of hiding it.
//
// Environment:
//   FOLDER_CHECK_ROOT  Override the folder under test (used by fixture tests).
//   FOLDER_CHECK_REF   Override the comparison ref (default: origin/main).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = process.env.FOLDER_CHECK_ROOT
    ? path.resolve(process.env.FOLDER_CHECK_ROOT)
    : scriptRoot;
const strict = process.argv.includes('--strict');
const offline = process.argv.includes('--offline') || process.env.FOLDER_CHECK_OFFLINE === '1';
const compareRef = process.env.FOLDER_CHECK_REF || 'origin/main';

const failures = [];
const warnings = [];

const line = (status, area, detail) => {
    console.log(`${status.padEnd(6)} ${area.padEnd(20)} ${detail}`);
};
const pass = (area, detail) => line('[PASS]', area, detail);
const warn = (area, detail) => {
    line('[WARN]', area, detail);
    warnings.push(`${area}: ${detail}`);
};
const fail = (area, detail) => {
    line('[FAIL]', area, detail);
    failures.push(`${area}: ${detail}`);
};

const firstLine = (text) => (text || '').trim().split(/\r?\n/)[0] || '';

const git = (...args) => spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
});

const normalizePath = (value) => {
    try {
        return fs.realpathSync.native(value);
    } catch {
        return path.resolve(value);
    }
};

const samePath = (left, right) => {
    const leftNormalized = normalizePath(left);
    const rightNormalized = normalizePath(right);
    return process.platform === 'win32'
        ? leftNormalized.toLowerCase() === rightNormalized.toLowerCase()
        : leftNormalized === rightNormalized;
};

const readJson = (file) => {
    try {
        return { value: JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (error) {
        return { error };
    }
};

// ---------------------------------------------------------------------------
// Git invariants
// ---------------------------------------------------------------------------

if (!fs.existsSync(repoRoot)) {
    fail('repository', `${repoRoot} does not exist`);
} else {
    const inside = git('rev-parse', '--is-inside-work-tree');
    if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
        fail('repository', `${repoRoot} is not a git working tree`);
    } else {
        pass('repository', repoRoot);
        checkWorktrees();
        checkStashes();
        checkBranch();
        checkAlignment();
    }
}

function checkWorktrees() {
    const result = git('worktree', 'list', '--porcelain');
    if (result.status !== 0) {
        return fail('worktrees', `cannot list worktrees: ${firstLine(result.stderr)}`);
    }

    const entries = result.stdout
        .trim()
        .split(/\r?\n\r?\n/)
        .filter(Boolean)
        .map((block) => {
            const worktreeLine = block.split(/\r?\n/).find((item) => item.startsWith('worktree '));
            const branchLine = block.split(/\r?\n/).find((item) => item.startsWith('branch '));
            return {
                path: worktreeLine ? worktreeLine.slice('worktree '.length) : '',
                branch: branchLine ? branchLine.slice('branch '.length) : 'detached',
            };
        });

    if (entries.length > 1) {
        const extras = entries
            .filter((entry) => !samePath(entry.path, repoRoot))
            .map((entry) => `${entry.path} (${entry.branch.replace(/^refs\/heads\//, '')})`);
        fail('worktrees', `${entries.length} checkouts exist; only the primary is allowed. Extra: ${extras.join(', ')}`);
        return;
    }

    const primary = entries[0];
    if (primary && !samePath(primary.path, repoRoot)) {
        fail('worktrees', `this folder is not the primary checkout (primary: ${primary.path})`);
        return;
    }

    pass('worktrees', 'primary checkout only');
}

function checkStashes() {
    const result = git('stash', 'list', '--format=%gd %gs');
    if (result.status !== 0) {
        return fail('stashes', `cannot list stashes: ${firstLine(result.stderr)}`);
    }
    const stashes = result.stdout.split(/\r?\n/).filter(Boolean);
    if (stashes.length > 0) {
        return fail('stashes', `${stashes.length} stash entr${stashes.length === 1 ? 'y' : 'ies'} hold work outside the tree (${stashes[0]})`);
    }
    pass('stashes', 'none');
}

function checkBranch() {
    const result = git('symbolic-ref', '--quiet', '--short', 'HEAD');
    if (result.status === 0) {
        return pass('branch', result.stdout.trim());
    }
    if (strict) {
        return fail('branch', 'detached HEAD; check out a branch so commits cannot be orphaned');
    }
    warn('branch', 'detached HEAD; commits made here are easy to lose');
}

function checkAlignment() {
    const [remote, ...rest] = compareRef.split('/');
    const branch = rest.join('/');
    if (!remote || !branch) {
        return fail('alignment', `FOLDER_CHECK_REF must look like origin/main (received: ${compareRef})`);
    }

    if (offline) {
        warn('remote', `offline: comparing against cached ${compareRef}, which may itself be stale`);
    } else {
        const fetch = git('fetch', '--quiet', '--no-tags', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`);
        if (fetch.status === 0) {
            pass('remote', `fetched ${compareRef}`);
        } else {
            fail('remote', `cannot fetch ${compareRef}: ${firstLine(fetch.stderr) || 'unknown error'} (use --offline to compare cached refs)`);
        }
    }

    const head = git('rev-parse', '--verify', '--quiet', 'HEAD');
    if (head.status !== 0) {
        return fail('alignment', 'HEAD does not resolve to a commit');
    }

    const target = git('rev-parse', '--verify', '--quiet', `${compareRef}^{commit}`);
    if (target.status !== 0) {
        return fail('alignment', `${compareRef} is not available locally; cannot verify`);
    }

    const counts = git('rev-list', '--left-right', '--count', `HEAD...${compareRef}`);
    if (counts.status !== 0) {
        return fail('alignment', `cannot compare HEAD with ${compareRef}: ${firstLine(counts.stderr)}`);
    }

    const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number);
    const headSha = head.stdout.trim().slice(0, 8);
    const targetSha = target.stdout.trim().slice(0, 8);

    if (behind > 0) {
        const divergence = ahead > 0 ? `${ahead} ahead and ${behind} behind` : `${behind} commit(s) behind`;
        return fail('alignment', `HEAD ${headSha} is ${divergence} ${compareRef} ${targetSha}; sync before working here`);
    }

    if (ahead > 0) {
        return warn('alignment', `HEAD ${headSha} is ${ahead} commit(s) ahead of ${compareRef} ${targetSha} (local work, not drift)`);
    }

    pass('alignment', `HEAD ${headSha} == ${compareRef} ${targetSha}`);
}

// ---------------------------------------------------------------------------
// Dependency invariants
// ---------------------------------------------------------------------------

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];

const platformMatches = (meta) => {
    const matches = (values, actual) => {
        const positive = values.filter((value) => !value.startsWith('!'));
        const negative = values
            .filter((value) => value.startsWith('!'))
            .map((value) => value.slice(1));
        if (negative.includes(actual)) {
            return false;
        }
        return positive.length === 0 || positive.includes(actual);
    };

    if (Array.isArray(meta.os) && !matches(meta.os, process.platform)) {
        return false;
    }
    if (Array.isArray(meta.cpu) && !matches(meta.cpu, process.arch)) {
        return false;
    }
    return true;
};

const checkDependencies = ({ label, dir }) => {
    const nodeModules = path.join(dir, 'node_modules');
    if (!fs.existsSync(nodeModules) || !fs.statSync(nodeModules).isDirectory()) {
        return fail(label, 'node_modules is missing; run npm ci');
    }

    let installedDirs = 0;
    try {
        installedDirs = fs.readdirSync(nodeModules).length;
    } catch (error) {
        return fail(label, `cannot read node_modules: ${firstLine(error.message)}`);
    }
    if (installedDirs === 0) {
        return fail(label, 'node_modules is empty; run npm ci');
    }

    const packageJson = readJson(path.join(dir, 'package.json'));
    if (packageJson.error) {
        return fail(label, `cannot read package.json: ${firstLine(packageJson.error.message)}`);
    }

    const lockJson = readJson(path.join(dir, 'package-lock.json'));
    if (lockJson.error) {
        return fail(label, `cannot read package-lock.json: ${firstLine(lockJson.error.message)}`);
    }

    const hiddenJson = readJson(path.join(nodeModules, '.package-lock.json'));
    if (hiddenJson.error) {
        return fail(label, 'node_modules has no .package-lock.json; reinstall with npm ci');
    }

    const declared = new Set();
    for (const field of DEPENDENCY_FIELDS) {
        for (const name of Object.keys(packageJson.value[field] || {})) {
            declared.add(name);
        }
    }

    const locked = lockJson.value.packages || {};
    const installed = hiddenJson.value.packages || {};

    const unsynced = [...declared].filter((name) => !locked[`node_modules/${name}`]);
    if (unsynced.length > 0) {
        return fail(label, `package.json declares ${unsynced.join(', ')} but package-lock.json does not; run npm install`);
    }

    const lockedEntries = Object.entries(locked).filter(([key]) => key !== '');
    const skipped = [];
    const missing = [];
    const mismatched = [];
    let verified = 0;

    // A platform-mismatched optional package takes its whole subtree down with
    // it: npm never installs the children either, and those lock entries carry
    // no os/cpu of their own to explain the absence.
    const platformSkippedPrefixes = lockedEntries
        .filter(([, meta]) => meta.optional && !platformMatches(meta))
        .map(([key]) => key);
    const skippedByPlatform = (key) => platformSkippedPrefixes.some(
        (prefix) => key === prefix || key.startsWith(`${prefix}/`),
    );

    for (const [key, meta] of lockedEntries) {
        if (skippedByPlatform(key)) {
            skipped.push(key);
            continue;
        }

        const actual = installed[key];
        if (!actual) {
            // Optional packages npm declines to install (platform flags or an
            // --omit=optional install) are not load-bearing for this platform.
            if (meta.optional) {
                skipped.push(key);
                continue;
            }
            missing.push(key);
            continue;
        }

        const versionChanged = actual.version !== meta.version;
        const integrityChanged = meta.integrity && actual.integrity && actual.integrity !== meta.integrity;
        if (versionChanged || integrityChanged) {
            mismatched.push(`${key} (lock ${meta.version}, installed ${actual.version})`);
            continue;
        }

        if (!fs.existsSync(path.join(dir, key, 'package.json'))) {
            missing.push(`${key} (metadata present, directory missing)`);
            continue;
        }

        verified += 1;
    }

    if (missing.length > 0) {
        return fail(label, `${missing.length} locked package(s) not installed, e.g. ${missing.slice(0, 3).join(', ')}; run npm ci`);
    }

    if (mismatched.length > 0) {
        return fail(label, `${mismatched.length} package(s) differ from package-lock.json, e.g. ${mismatched.slice(0, 3).join(', ')}; run npm ci`);
    }

    const extraneous = Object.keys(installed).filter((key) => key && !locked[key]);
    if (extraneous.length > 0) {
        const detail = `${extraneous.length} installed package(s) absent from package-lock.json, e.g. ${extraneous.slice(0, 3).join(', ')}; run npm prune`;
        strict ? fail(label, detail) : warn(label, detail);
    }

    pass(label, `${lockedEntries.length} locked, ${verified} verified, ${skipped.length} optional skipped`);
};

const targets = [
    { label: 'dependencies (root)', dir: repoRoot },
    { label: 'dependencies (app)', dir: path.join(repoRoot, 'app') },
    { label: 'dependencies (server)', dir: path.join(repoRoot, 'server') },
];

for (const target of targets) {
    if (!fs.existsSync(target.dir)) {
        fail(target.label, `${target.dir} does not exist`);
        continue;
    }
    checkDependencies(target);
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

console.log('');
if (failures.length > 0) {
    console.error(`folder:check FAILED (${failures.length} problem${failures.length === 1 ? '' : 's'})`);
    failures.forEach((failure, index) => console.error(`  ${index + 1}. ${failure}`));
    if (warnings.length > 0) {
        console.error(`${warnings.length} warning(s) also reported above.`);
    }
    process.exitCode = 1;
} else {
    console.log(`folder:check PASSED${warnings.length > 0 ? ` with ${warnings.length} warning(s)` : ''}`);
}
