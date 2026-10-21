import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { auditSarif } from './check-codeql-sarif.mjs';

const makeSarif = (results) => JSON.stringify({
    version: '2.1.0',
    runs: [{ tool: { driver: { name: 'CodeQL' } }, results }],
});

const result = (ruleId, level, uri, startLine = 1, text = 'message') => ({
    ruleId,
    level,
    message: { text },
    locations: [{
        physicalLocation: {
            artifactLocation: { uri },
            region: { startLine },
        },
    }],
});

/** Creates the files, runs the audit while they exist, then cleans up. */
const withFiles = (files, fn) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'aura-codeql-sarif-'));
    try {
        for (const [name, content] of Object.entries(files)) {
            const target = path.join(dir, name);
            mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, content);
        }
        return fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
};

const withBaseline = (entries, fn) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'aura-codeql-baseline-'));
    const file = path.join(dir, 'baseline.json');
    writeFileSync(file, JSON.stringify({ acceptedFindings: entries }));
    try {
        return fn(file);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
};

const accepted = (rule, file, count = 1, expires = '2999-12-31') => ({
    rule,
    path: file,
    count,
    reason: 'test disposition',
    expires,
});

const audit = (results, entries, { file = 'r.sarif' } = {}) => withBaseline(entries, (baselinePath) => (
    withFiles({ [file]: makeSarif(results) }, (dir) => auditSarif({
        sarifPaths: [path.join(dir, file)],
        baselinePath,
    }))
));

test('an empty report passes', () => {
    const { failures } = audit([], []);
    assert.deepEqual(failures, []);
});

test('a finding with no acceptance fails', () => {
    const { failures } = audit([result('js/polynomial-redos', 'warning', 'server/x.js')], []);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /Unaccepted CodeQL finding: js\/polynomial-redos in server\/x\.js/);
});

test('a finding covered by the acceptance list passes', () => {
    const { failures } = audit(
        [result('js/polynomial-redos', 'warning', 'server/x.js')],
        [accepted('js/polynomial-redos', 'server/x.js')],
    );
    assert.deepEqual(failures, []);
});

test('more findings than accepted for the same rule and path fails', () => {
    const { failures } = audit(
        [
            result('js/polynomial-redos', 'warning', 'server/x.js', 10),
            result('js/polynomial-redos', 'warning', 'server/x.js', 20),
        ],
        [accepted('js/polynomial-redos', 'server/x.js', 1)],
    );
    assert.equal(failures.length, 1);
    assert.match(failures[0], /now reports 2 result\(s\) but only 1 are accepted/);
});

test('fewer findings than accepted is reported but does not fail', () => {
    const { failures, stale } = audit(
        [result('js/polynomial-redos', 'warning', 'server/x.js')],
        [accepted('js/polynomial-redos', 'server/x.js', 3)],
    );
    assert.deepEqual(failures, []);
    assert.equal(stale.length, 1);
});

test('note-level results are ignored', () => {
    const { failures } = audit([result('js/unused-local-variable', 'note', 'server/x.js')], []);
    assert.deepEqual(failures, []);
});

test('an expired acceptance fails the gate', () => {
    const { failures } = audit(
        [result('js/polynomial-redos', 'warning', 'server/x.js')],
        [accepted('js/polynomial-redos', 'server/x.js', 1, '2020-01-01')],
    );
    assert.equal(failures.length, 1);
    assert.match(failures[0], /expired on 2020-01-01/);
});

test('an acceptance without a reason fails the gate', () => {
    const { failures } = audit(
        [result('js/polynomial-redos', 'warning', 'server/x.js')],
        [{ rule: 'js/polynomial-redos', path: 'server/x.js', count: 1, expires: '2999-12-31' }],
    );
    assert.equal(failures.length, 1);
    assert.match(failures[0], /has no reason/);
});

test('an acceptance without an expiry fails the gate', () => {
    const { failures } = audit(
        [result('js/polynomial-redos', 'warning', 'server/x.js')],
        [{ rule: 'js/polynomial-redos', path: 'server/x.js', count: 1, reason: 'because' }],
    );
    assert.equal(failures.length, 1);
    assert.match(failures[0], /has no "expires" date/);
});

test('a missing SARIF report fails rather than passing silently', () => {
    const { failures } = withBaseline([], (baselinePath) => auditSarif({
        sarifPaths: [path.join(os.tmpdir(), 'aura-does-not-exist-12345', 'r.sarif')],
        baselinePath,
    }));
    assert.equal(failures.length, 1);
    assert.match(failures[0], /No SARIF report was found/);
});

test('a directory of reports is read', () => {
    const { failures } = withBaseline([accepted('js/polynomial-redos', 'server/x.js')], (baselinePath) => (
        withFiles({
            'a.sarif': makeSarif([result('js/polynomial-redos', 'warning', 'server/x.js')]),
            'b.sarif': makeSarif([]),
        }, (dir) => auditSarif({ sarifPaths: [dir], baselinePath }))
    ));
    assert.deepEqual(failures, []);
});
