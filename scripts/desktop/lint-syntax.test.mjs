#!/usr/bin/env node

/**
 * Meta-test for the desktop syntax gate.
 *
 * Why this file exists: `lint-syntax.mjs` had accumulated three silent-skip
 * holes over its life, and nothing caught them because the gate was only ever
 * exercised on a tree where it passed. A gate that has never been observed
 * failing is not a gate — it is a script that prints OK.
 *
 * So every case here asserts the OPPOSITE of what the gate does in CI: given an
 * input it is supposed to reject, it must exit non-zero AND name the offending
 * file. The one positive case exists to prove the harness itself is wired up,
 * so a gate that failed for the wrong reason (bad spawn, wrong cwd) cannot
 * masquerade as a working rejection.
 *
 * Run: npm run test:gate-contract
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const gatePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'lint-syntax.mjs');
const realDesktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'desktop');

// Spawns the gate rather than importing it: the gate calls process.exit, so an
// in-process import would take the test runner down with it.
const runGate = (desktopDir) => {
    try {
        const stdout = execFileSync(process.execPath, [gatePath], {
            env: { ...process.env, AURA_DESKTOP_LINT_ROOT: desktopDir },
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { code: 0, stdout, stderr: '' };
    } catch (error) {
        return {
            code: typeof error.status === 'number' ? error.status : 1,
            stdout: String(error.stdout || ''),
            stderr: String(error.stderr || ''),
        };
    }
};

const withFixture = (files, fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-desktop-lint-'));
    try {
        for (const [relativePath, content] of Object.entries(files)) {
            const target = path.join(dir, relativePath);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, content, 'utf8');
        }
        return fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
};

const VALID_MODULE = "const fs = require('fs');\nmodule.exports = { fs };\n";

test('positive control: the real desktop/ tree passes', () => {
    const result = runGate(realDesktopDir);
    assert.equal(result.code, 0, `expected the real tree to pass, got:\n${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /desktop modules parse cleanly/);
});

test('rejects a .cjs module that does not parse', () => {
    withFixture({ 'broken.cjs': 'const = ;\n' }, (dir) => {
        const result = runGate(dir);
        assert.equal(result.code, 1, 'a syntax error must fail the gate');
        assert.match(result.stderr, /broken\.cjs/, 'the failing module must be named');
    });
});

test('rejects a .mjs module instead of silently skipping it', () => {
    withFixture({ 'ok.cjs': VALID_MODULE, 'probe.mjs': 'export const x = 1;\n' }, (dir) => {
        const result = runGate(dir);
        assert.equal(result.code, 1, 'an unhandled extension must fail the gate');
        assert.match(result.stderr, /probe\.mjs/, 'the skipped file must be named');
    });
});

test('rejects a .ts module', () => {
    withFixture({ 'ok.cjs': VALID_MODULE, 'probe.ts': 'export const x: number = 1;\n' }, (dir) => {
        const result = runGate(dir);
        assert.equal(result.code, 1);
        assert.match(result.stderr, /probe\.ts/);
    });
});

test('rejects an unhandled extension nested below the tree root', () => {
    // Extension-based classification, not directory-based: a stray .ts inside a
    // nested assets folder is the exact shape that used to slip through.
    withFixture({
        'ok.cjs': VALID_MODULE,
        'nested/deeper/probe.ts': 'export const x = 1;\n',
    }, (dir) => {
        const result = runGate(dir);
        assert.equal(result.code, 1);
        assert.match(result.stderr, /probe\.ts/);
    });
});

test('rejects an empty tree rather than reporting success on nothing', () => {
    withFixture({ 'notes.md': 'not a module\n' }, (dir) => {
        const result = runGate(dir);
        assert.equal(result.code, 1, 'zero parseable modules must fail, not pass vacuously');
        assert.match(result.stderr, /No desktop modules found/);
    });
});

test('ignores non-source files that are not JavaScript', () => {
    withFixture({
        'ok.cjs': VALID_MODULE,
        'assets/icon.png': 'not really a png',
        'assets/readme.md': '# notes',
        'config.json': '{}',
    }, (dir) => {
        const result = runGate(dir);
        assert.equal(result.code, 0, `non-source files must not fail the gate:\n${result.stderr}`);
    });
});