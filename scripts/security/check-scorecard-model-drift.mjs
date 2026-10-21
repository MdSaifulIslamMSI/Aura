#!/usr/bin/env node
/**
 * Fails when the OpenSSF Scorecard `Token-Permissions` model ported into
 * scripts/security/check-workflow-token-permissions.mjs no longer matches the
 * upstream source it was derived from.
 *
 * WHY THIS EXISTS: the token-permissions gate reproduces Scorecard's scoring
 * by hand. A hand-port is only as trustworthy as its last sync: if upstream
 * changes the tracked scopes, the penalty table or the probe order, the port
 * keeps reporting 10/10 while the real Scorecard score drops - and the
 * `TokenPermissionsID` code-scanning alerts come back with nothing in the
 * repository to explain why.
 *
 * This check fetches the exact upstream files the port was derived from (at
 * the pinned commit) and compares the parts the model depends on:
 *
 *   - the scopes Scorecard tracks as "of interest"   (checks/raw/permissions.go)
 *   - the penalty each top-level write costs        (checks/evaluation/permissions.go)
 *   - the order the probes are evaluated in          (probes/entries.go)
 *
 * It runs on the weekly Scorecard workflow, which is the schedule that
 * already runs the real Scorecard, so a drift is caught on the same cadence.
 *
 * Usage:
 *   node scripts/security/check-scorecard-model-drift.mjs
 *   node scripts/security/check-scorecard-model-drift.mjs --offline-dir <dir>
 *
 * `--offline-dir` reads the upstream sources from a directory instead of the
 * network. It never WRITES the fetched sources anywhere: a cache under the
 * shared temporary directory would be a predictable path that another local
 * process could pre-create as a symlink, and the content would come from the
 * network. The directory must contain the three upstream files, flattened:
 * `checks_raw_permissions.go`, `checks_evaluation_permissions.go` and
 * `probes_entries.go`.
 *
 * Exit code 0 = the port matches upstream, 1 = it has drifted.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    MODEL_PROVENANCE,
    PERMISSIONS_OF_INTEREST,
    PROBE_ORDER,
    TOP_LEVEL_WRITE_PENALTY,
} from './scorecard-token-permissions-model.mjs';

const FLATTENED_NAMES = {
    'checks/raw/permissions.go': 'checks_raw_permissions.go',
    'checks/evaluation/permissions.go': 'checks_evaluation_permissions.go',
    'probes/entries.go': 'probes_entries.go',
};

const fetchText = async (url) => {
    // An explicit controller (rather than AbortSignal.timeout) so the timer
    // can be cleared: a pending timeout keeps the event loop alive and Node
    // aborts on exit with a libuv assertion.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
        const response = await fetch(url, {
            headers: { accept: 'text/plain' },
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
        return await response.text();
    } finally {
        clearTimeout(timer);
    }
};

const readUpstream = async (relativePath, { offlineDir }) => {
    if (offlineDir) {
        const file = path.join(offlineDir, FLATTENED_NAMES[relativePath]);
        if (!fs.existsSync(file)) {
            throw new Error(`offline mode: ${file} is missing`);
        }
        return fs.readFileSync(file, 'utf8');
    }
    const url = `https://raw.githubusercontent.com/ossf/scorecard/${MODEL_PROVENANCE.commit}/${relativePath}`;
    return fetchText(url);
};

/** The `permissionStatuses = permission("statuses")` style constant block. */
const parseScopeConstants = (source) => {
    const constants = new Map();
    const pattern = /permission([A-Za-z]+)\s*=\s*permission\("([^"]+)"\)/g;
    for (const match of source.matchAll(pattern)) {
        constants.set(match[1], match[2]);
    }
    return constants;
};

/** The `var permissionsOfInterest = []permission{...}` list. */
const parseScopesOfInterest = (source, constants) => {
    const block = /permissionsOfInterest\s*=\s*\[\]permission\{([^}]*)\}/.exec(source);
    if (!block) throw new Error('could not find permissionsOfInterest in the upstream source');
    const scopes = [];
    for (const match of block[1].matchAll(/permission([A-Za-z]+)/g)) {
        const scope = constants.get(match[1]);
        if (!scope) throw new Error(`unknown scope constant permission${match[1]}`);
        scopes.push(scope);
    }
    return scopes.sort();
};

/** The `case "checks", "statuses": ... return 0.5` table inside `reduceBy`. */
const parsePenaltyTable = (source) => {
    const fn = /func reduceBy\(f \*finding\.Finding, dl checker\.DetailLogger\) float32 \{([\s\S]*?)\n\}/.exec(source);
    if (!fn) throw new Error('could not find reduceBy in the upstream source');
    const penalties = new Map();
    // Each case logs a warning and then returns the penalty, so the return
    // expression is not on the line after the `case`. Go has no semicolons.
    const pattern = /case\s+((?:"[^"]+"(?:,\s*)?)+):([\s\S]*?)return\s+([^\n]+)/g;
    for (const match of fn[1].matchAll(pattern)) {
        const scopes = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
        const raw = match[3].trim();
        const value = raw.includes('MaxResultScore') ? 10 : Number(raw);
        if (!Number.isFinite(value)) throw new Error(`unrecognised penalty expression: ${raw}`);
        for (const scope of scopes) penalties.set(scope, value);
    }
    return penalties;
};

/** The `TokenPermissions = []ProbeImpl{...}` list. */
const parseProbeOrder = (source) => {
    const block = /TokenPermissions\s*=\s*\[\]ProbeImpl\{([^}]*)\}/.exec(source);
    if (!block) throw new Error('could not find the TokenPermissions probe list in the upstream source');
    return [...block[1].matchAll(/([a-zA-Z]+)\.Run/g)].map((match) => match[1]);
};

const compareSets = (label, upstream, port) => {
    const upstreamSorted = [...upstream].sort();
    const portSorted = [...port].sort();
    if (JSON.stringify(upstreamSorted) === JSON.stringify(portSorted)) return null;
    return `${label} differs\n    upstream: ${upstreamSorted.join(', ')}\n    port:     ${portSorted.join(', ')}`;
};

export const checkModelDrift = async ({ offlineDir = null } = {}) => {
    const [rawSource, evaluationSource, entriesSource] = await Promise.all([
        readUpstream('checks/raw/permissions.go', { offlineDir }),
        readUpstream('checks/evaluation/permissions.go', { offlineDir }),
        readUpstream('probes/entries.go', { offlineDir }),
    ]);

    const constants = parseScopeConstants(rawSource);
    const upstreamScopes = parseScopesOfInterest(rawSource, constants);
    const upstreamPenalties = parsePenaltyTable(evaluationSource);
    const upstreamProbeOrder = parseProbeOrder(entriesSource);

    const problems = [];

    const scopeDiff = compareSets('The scopes Scorecard tracks as "of interest"', upstreamScopes, PERMISSIONS_OF_INTEREST);
    if (scopeDiff) problems.push(scopeDiff);

    for (const [scope, value] of upstreamPenalties) {
        const ported = TOP_LEVEL_WRITE_PENALTY[scope];
        if (ported !== value) {
            problems.push(`The top-level write penalty for "${scope}" differs\n    upstream: ${value}\n    port:     ${ported}`);
        }
    }
    for (const scope of Object.keys(TOP_LEVEL_WRITE_PENALTY)) {
        if (!upstreamPenalties.has(scope)) {
            problems.push(`The port penalises "${scope}", which upstream does not`);
        }
    }

    const probeDiff = compareSets('The order the probes are evaluated in', upstreamProbeOrder, PROBE_ORDER);
    if (probeDiff) problems.push(probeDiff);

    return { problems, upstreamScopes, upstreamPenalties, upstreamProbeOrder };
};

const invokedDirectly = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
    const offlineIndex = process.argv.indexOf('--offline-dir');
    const offlineDir = offlineIndex >= 0 ? process.argv[offlineIndex + 1] : null;
    if (offlineIndex >= 0 && !offlineDir) {
        console.error('[security:scorecard-model-drift] --offline-dir needs a directory path.');
        process.exit(1);
    }

    let result;
    try {
        result = await checkModelDrift({ offlineDir });
    } catch (error) {
        console.error(`[security:scorecard-model-drift] Could not compare against upstream: ${error.message}`);
        process.exit(1);
    }

    if (result.problems.length > 0) {
        console.error(
            `[security:scorecard-model-drift] FAILED - the ported Token-Permissions model no longer `
            + `matches ${MODEL_PROVENANCE.upstream} ${MODEL_PROVENANCE.release} `
            + `(${MODEL_PROVENANCE.commit}):`
        );
        for (const problem of result.problems) console.error(`- ${problem}`);
        console.error(
            'Re-derive scripts/security/check-workflow-token-permissions.mjs from the upstream sources '
            + 'listed in MODEL_PROVENANCE, then update the pinned commit.'
        );
        process.exit(1);
    }

    console.log(
        `[security:scorecard-model-drift] PASS - the ported model matches ${MODEL_PROVENANCE.upstream} `
        + `${MODEL_PROVENANCE.release} (${MODEL_PROVENANCE.commit.slice(0, 12)}): `
        + `${result.upstreamScopes.length} tracked scopes, `
        + `${result.upstreamPenalties.size} penalty entries, `
        + `${result.upstreamProbeOrder.length} probes.`
    );
}
