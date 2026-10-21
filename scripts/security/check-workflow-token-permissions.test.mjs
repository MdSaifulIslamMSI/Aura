import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { auditWorkflowTokenPermissions } from './check-workflow-token-permissions.mjs';

const writeWorkflow = (root, name, body) => {
    const dir = path.join(root, '.github', 'workflows');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, name), body);
};

const scoreOf = (root) => auditWorkflowTokenPermissions(root).score;

test('a read-only top-level block scores 10', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'aura-token-perms-'));
    try {
        writeWorkflow(root, 'ok.yml', [
            'name: ok',
            'on:',
            '  push:',
            '    branches: [main]',
            'permissions:',
            '  contents: read',
            'jobs:',
            '  build:',
            '    runs-on: ubuntu-latest',
            '    steps:',
            '      - run: echo hi',
            '',
        ].join('\n'));

        assert.equal(scoreOf(root), 10);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a top-level write scope drops the score to 0', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'aura-token-perms-'));
    try {
        writeWorkflow(root, 'bad.yml', [
            'name: bad',
            'on:',
            '  push:',
            '    branches: [main]',
            'permissions:',
            '  contents: read',
            '  actions: write',
            'jobs:',
            '  build:',
            '    runs-on: ubuntu-latest',
            '    steps:',
            '      - run: echo hi',
            '',
        ].join('\n'));

        assert.equal(scoreOf(root), 0);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a job-level write scope is allowed when the top level is read-only', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'aura-token-perms-'));
    try {
        writeWorkflow(root, 'job.yml', [
            'name: job',
            'on:',
            '  push:',
            '    branches: [main]',
            'permissions:',
            '  contents: read',
            'jobs:',
            '  deploy:',
            '    runs-on: ubuntu-latest',
            '    permissions:',
            '      actions: write',
            '      contents: read',
            '    steps:',
            '      - run: echo hi',
            '',
        ].join('\n'));

        assert.equal(scoreOf(root), 10);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('an undeclared top-level block combined with a job-level write scores 0', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'aura-token-perms-'));
    try {
        writeWorkflow(root, 'undeclared.yml', [
            'name: undeclared',
            'on:',
            '  push:',
            '    branches: [main]',
            'jobs:',
            '  deploy:',
            '    runs-on: ubuntu-latest',
            '    permissions:',
            '      actions: write',
            '    steps:',
            '      - run: echo hi',
            '',
        ].join('\n'));

        assert.equal(scoreOf(root), 0);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a write to a scope Scorecard does not track does not affect the score', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'aura-token-perms-'));
    try {
        writeWorkflow(root, 'oidc.yml', [
            'name: oidc',
            'on:',
            '  push:',
            '    branches: [main]',
            'permissions:',
            '  contents: read',
            '  id-token: write',
            'jobs:',
            '  build:',
            '    runs-on: ubuntu-latest',
            '    steps:',
            '      - run: echo hi',
            '',
        ].join('\n'));

        assert.equal(scoreOf(root), 10);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('every workflow in this repository scores 10', () => {
    const result = auditWorkflowTokenPermissions();
    assert.deepEqual(result.parseErrors, []);
    assert.equal(
        result.score,
        10,
        `Token-Permissions scored ${result.score}/10; every violation below becomes a `
        + '`TokenPermissionsID` code-scanning alert: '
        + result.warnings.map((warning) => `${warning.path}: ${warning.text}`).join(', ')
    );
});
