#!/usr/bin/env node
/**
 * Fails when a CodeQL SARIF report contains a security finding that the
 * repository has not explicitly accepted.
 *
 * WHY THIS EXISTS: GitHub's code-scanning alerts do not fail a pull request.
 * The `javascript-typescript` CodeQL check is a required status check, but it
 * succeeds as long as the analysis completes - the findings only appear in the
 * Security tab, days later, if anyone looks. That is how 36 alerts
 * accumulated here: nothing in the pipeline ever went red.
 *
 * This gate closes that gap. The CodeQL action writes the SARIF it uploads to
 * GitHub to a local directory (the `output` input of
 * `github/codeql-action/analyze`), so the same report the Security tab shows
 * is available to the workflow, and the workflow can fail on it.
 *
 * POLICY:
 *   - `warning` and `error` results must be covered by
 *     config/security/codeql-accepted-findings.json. An uncovered result
 *     fails the build.
 *   - The number of results for a listed (rule, path) must not exceed the
 *     accepted count. A covered result that is no longer reported is only
 *     reported, not failed: the CodeQL version in CI can legitimately
 *     report a different number of results, and a stale entry must not turn
 *     the whole pipeline red.
 *   - `note` results are ignored. They are quality queries, and the largest
 *     such class - unused local variables - is gated by the `no-unused-vars`
 *     ESLint rule, which is cheaper and gives a better error message than a
 *     SARIF post-processor.
 *   - An accepted entry that is missing a reason, or whose `expires` date has
 *     passed, fails the build (fail-closed, the same contract as
 *     config/security/pqc-allowlist.json and
 *     config/security/lockfile-freshness-allowlist.json).
 *
 * CodeQL for JavaScript does NOT honour inline `// codeql[...]` suppression
 * comments - verified against CodeQL 2.27.3 - so the acceptance list is the
 * only operative mechanism for an accepted finding.
 *
 * Usage:
 *   node scripts/security/check-codeql-sarif.mjs --sarif <file-or-directory> [...]
 *   node scripts/security/check-codeql-sarif.mjs --sarif <dir> --baseline <file>
 *
 * Exit code 0 = pass, 1 = fail.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ACCEPTANCE_PATH = path.join(repoRoot, 'config', 'security', 'codeql-accepted-findings.json');

const GATED_LEVELS = new Set(['warning', 'error']);

const parseArgs = (argv) => {
    const sarifPaths = [];
    let baselinePath = ACCEPTANCE_PATH;
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--sarif') {
            const value = argv[index + 1];
            if (!value) throw new Error('--sarif needs a path');
            sarifPaths.push(value);
            index += 1;
            continue;
        }
        if (argv[index] === '--baseline') {
            const value = argv[index + 1];
            if (!value) throw new Error('--baseline needs a path');
            baselinePath = path.resolve(value);
            index += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${argv[index]}`);
    }
    return { sarifPaths, baselinePath };
};

const listSarifFiles = (target) => {
    if (!fs.existsSync(target)) return [];
    const stats = fs.statSync(target);
    if (stats.isFile()) return [target];
    return fs.readdirSync(target)
        .filter((name) => name.toLowerCase().endsWith('.sarif'))
        .map((name) => path.join(target, name));
};

const readSarifResults = (file) => {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        throw new Error(`${file}: not valid JSON: ${error.message}`);
    }
    const results = [];
    for (const run of parsed.runs || []) {
        for (const result of run.results || []) {
            const location = result.locations?.[0]?.physicalLocation;
            if (!location) continue;
            const uri = location.artifactLocation?.uri || '';
            if (!uri) continue;
            results.push({
                ruleId: result.ruleId,
                level: result.level || 'warning',
                path: uri.replace(/\\/g, '/').replace(/^\.\//, ''),
                line: location.region?.startLine || 0,
                message: (result.message?.text || '').split('\n')[0],
            });
        }
    }
    return results;
};

const loadAcceptance = (baselinePath) => {
    if (!fs.existsSync(baselinePath)) {
        throw new Error(`Acceptance list not found: ${baselinePath}`);
    }
    const document = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const entries = document.acceptedFindings;
    if (!Array.isArray(entries)) {
        throw new Error(`${baselinePath}: "acceptedFindings" must be an array`);
    }
    const now = Date.now();
    const problems = [];
    const byKey = new Map();

    for (const entry of entries) {
        if (!entry.rule || !entry.path) {
            problems.push(`${baselinePath}: entry is missing "rule" or "path": ${JSON.stringify(entry)}`);
            continue;
        }
        const key = `${entry.rule}|${entry.path}`;
        const count = Number.isInteger(entry.count) && entry.count > 0 ? entry.count : 1;
        // The entry is registered even when it is invalid, so the coverage
        // check below does not ALSO report the finding as unaccepted. The
        // specific problem with the entry is the failure to act on.
        byKey.set(key, { ...entry, count });

        if (!entry.reason || String(entry.reason).trim().length === 0) {
            problems.push(`${baselinePath}: ${entry.rule} ${entry.path} has no reason - an accepted finding must say why it is accepted`);
            continue;
        }
        if (!entry.expires) {
            problems.push(`${baselinePath}: ${entry.rule} ${entry.path} has no "expires" date - an acceptance without an expiry is a permanent waiver`);
            continue;
        }
        if (new Date(entry.expires).getTime() <= now) {
            problems.push(`${baselinePath}: ${entry.rule} ${entry.path} expired on ${entry.expires} - re-review it or fix the finding`);
        }
    }

    return { byKey, problems };
};

export const auditSarif = ({ sarifPaths, baselinePath = ACCEPTANCE_PATH }) => {
    const failures = [];
    const { byKey, problems } = loadAcceptance(baselinePath);
    failures.push(...problems);

    const files = sarifPaths.flatMap(listSarifFiles);
    if (files.length === 0) {
        failures.push(
            'No SARIF report was found. The gate must read the report the CodeQL action '
            + 'produced, so an empty or missing path is a failure rather than a pass.'
        );
        return { failures, files, observed: new Map() };
    }

    const observed = new Map();
    for (const file of files) {
        let results;
        try {
            results = readSarifResults(file);
        } catch (error) {
            failures.push(error.message);
            continue;
        }
        for (const result of results) {
            if (!GATED_LEVELS.has(result.level)) continue;
            const key = `${result.ruleId}|${result.path}`;
            if (!observed.has(key)) observed.set(key, { rule: result.ruleId, path: result.path, count: 0, lines: [] });
            const entry = observed.get(key);
            entry.count += 1;
            entry.lines.push(result.line);
        }
    }

    for (const [key, entry] of observed) {
        const accepted = byKey.get(key);
        if (!accepted) {
            failures.push(
                `Unaccepted CodeQL finding: ${entry.rule} in ${entry.path} `
                + `(lines ${entry.lines.join(', ')}). Fix the root cause, or record an accepted `
                + 'disposition in config/security/codeql-accepted-findings.json.'
            );
            continue;
        }
        if (entry.count > accepted.count) {
            failures.push(
                `${entry.rule} in ${entry.path} now reports ${entry.count} result(s) but only `
                + `${accepted.count} are accepted. Re-review the extra finding(s) before they land.`
            );
        }
    }

    const stale = [];
    for (const [key, accepted] of byKey) {
        const entry = observed.get(key);
        if (!entry) {
            // Not a failure: the CodeQL version in CI can legitimately stop
            // reporting a result. It is reported so the entry can be pruned.
            stale.push(`${accepted.rule} in ${accepted.path} is accepted but was not reported`);
        } else if (entry.count < accepted.count) {
            stale.push(
                `${accepted.rule} in ${accepted.path} reported ${entry.count} of the accepted `
                + `${accepted.count} result(s); the entry can be reduced`
            );
        }
    }

    return { failures, stale, files, observed };
};

const invokedDirectly = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(`[security:codeql-sarif] ${error.message}`);
        process.exit(1);
    }

    if (options.sarifPaths.length === 0) {
        console.error('[security:codeql-sarif] FAILED - no --sarif path was given.');
        process.exit(1);
    }

    const { failures, stale, files, observed } = auditSarif(options);

    for (const note of stale) {
        console.log(`[security:codeql-sarif] NOTE - ${note}`);
    }

    if (failures.length > 0) {
        console.error('[security:codeql-sarif] FAILED - the CodeQL report contains findings that are not accepted:');
        for (const failure of failures) console.error(`- ${failure}`);
        console.error(
            'Fix the root cause, or record an accepted disposition with a reason and an expiry '
            + 'in config/security/codeql-accepted-findings.json.'
        );
        process.exit(1);
    }

    const gated = [...observed.values()].reduce((sum, entry) => sum + entry.count, 0);
    console.log(
        `[security:codeql-sarif] PASS - ${files.length} SARIF report(s) read, ${gated} gated `
        + 'finding(s) all covered by config/security/codeql-accepted-findings.json.'
    );
}
