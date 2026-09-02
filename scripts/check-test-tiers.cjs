#!/usr/bin/env node
'use strict';

/**
 * Test tier manifest guard — fails when:
 *   1. Any tier entry in config/test-tiers.json is stale (file no longer exists)
 *      or malformed (outside the surface's tests/ directory).
 *   2. Any noDbFiles basename no longer matches a real test file.
 *   3. A test-like file under <surface>/tests is invisible to jest's
 *      '**\/*.test.js' testMatch (dead suite that can never run).
 *   4. A GitHub workflow reintroduces a hardcoded --runTestsByPath list
 *      (test file lists must live only in config/test-tiers.json).
 *   5. A test suite is listed in no tier and not in the surface's
 *      "$untriaged" allowlist (new suites must be triaged explicitly —
 *      tiered for CI, or consciously allowlisted as untriaged).
 *
 * Usage: node scripts/check-test-tiers.cjs
 * Exit 0 = manifest healthy; exit 1 = problems listed.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'config', 'test-tiers.json');
const WORKFLOWS_DIR = path.join(ROOT, '.github', 'workflows');
const TIER_SURFACES = ['server'];
const noDbTierNames = new Set(['noDbFiles']);

const fail = (message) => {
    console.error(`[check-test-tiers] ${message}`);
    process.exit(1);
};

const walk = (dir, filter, out = []) => {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, filter, out);
        else if (filter(entry.name, full)) out.push(full);
    }
    return out;
};

if (!fs.existsSync(MANIFEST_PATH)) {
    fail(`Manifest not found: ${MANIFEST_PATH}`);
}

let manifest;
try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
} catch (error) {
    fail(`Manifest is not valid JSON: ${error.message}`);
}

const problems = [];
let tierCount = 0;
let suiteCount = 0;
let untriagedCount = 0;

for (const surface of TIER_SURFACES) {
    const surfaceConfig = manifest[surface];
    if (!surfaceConfig) fail(`Manifest has no "${surface}" surface.`);
    const serverDir = path.join(ROOT, surface);

    // 1 + 2: tier entries exist, well-formed; noDbFiles basenames resolve
    const testFiles = walk(path.join(serverDir, 'tests'), (name) => name.endsWith('.test.js'));
    suiteCount = testFiles.length;
    const basenames = new Set(testFiles.map((f) => path.basename(f)));

    // 5: coverage — every suite must be in a tier or the $untriaged allowlist
    const coveredSuites = new Set();

    for (const [tier, files] of Object.entries(surfaceConfig)) {
        if (tier.startsWith('$')) {
            if (tier === '$untriaged') {
                if (!Array.isArray(files)) {
                    problems.push(`${surface}/$untriaged: must be an array of tests/ paths`);
                } else {
                    untriagedCount = files.length;
                    for (const f of files) {
                        if (!f.startsWith('tests/')) {
                            problems.push(`${surface}/$untriaged: entry outside tests/: ${f}`);
                        } else if (!fs.existsSync(path.join(serverDir, f))) {
                            problems.push(`${surface}/$untriaged: stale entry (file missing): ${f}`);
                        } else {
                            coveredSuites.add(f);
                        }
                    }
                }
            }
            continue;
        }
        if (noDbTierNames.has(tier)) {
            for (const base of files) {
                if (!basenames.has(base)) {
                    problems.push(`${surface}/noDbFiles: no test file named "${base}"`);
                }
            }
            continue;
        }
        tierCount += 1;
        if (!Array.isArray(files) || files.length === 0) {
            problems.push(`${surface}/${tier}: tier is empty`);
            continue;
        }
        for (const f of files) {
            if (!f.startsWith('tests/')) {
                problems.push(`${surface}/${tier}: entry outside tests/: ${f}`);
            } else if (!fs.existsSync(path.join(serverDir, f))) {
                problems.push(`${surface}/${tier}: stale entry (file missing): ${f}`);
            } else {
                coveredSuites.add(f);
            }
        }
    }

    // noDbFiles holds basenames, not paths — resolve them to paths for
    // coverage so a noDbFiles listing alone still counts as a triage.
    for (const base of surfaceConfig.noDbFiles || []) {
        for (const file of testFiles) {
            if (path.basename(file) === base) {
                coveredSuites.add(`tests/${path.relative(path.join(serverDir, 'tests'), file).split(path.sep).join('/')}`);
            }
        }
    }

    for (const file of testFiles) {
        const relative = `tests/${path.relative(path.join(serverDir, 'tests'), file).split(path.sep).join('/')}`;
        if (!coveredSuites.has(relative)) {
            problems.push(`${relative}: suite is in no tier and not in ${surface}/$untriaged (triage it: add to a CI tier or the allowlist)`);
        }
    }

    // 3: dead suites — test-like files jest's testMatch will never pick up
    const testMatchPattern = /\.test\.js$/;
    for (const file of walk(path.join(serverDir, 'tests'), (name) => name.endsWith('.js'))) {
        if (testMatchPattern.test(file)) continue;
        const content = fs.readFileSync(file, 'utf8');
        // Excludes `.test(` regex-method calls via the negative lookbehind.
        if (/(?<![\w.])(describe|test|it)\s*\(/.test(content)) {
            problems.push(`${path.relative(ROOT, file)}: contains tests but does not match jest testMatch '**/*.test.js'`);
        }
    }
}

// 4: workflow drift — hardcoded runTestsByPath lists must not return
const workflowFiles = walk(WORKFLOWS_DIR, (name) => name.endsWith('.yml') || name.endsWith('.yaml'));
for (const file of workflowFiles) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
        if (line.includes('runTestsByPath')) {
            problems.push(`${path.relative(ROOT, file)}:${idx + 1}: hardcoded --runTestsByPath list (use scripts/run-test-tier.cjs with config/test-tiers.json)`);
        }
    });
}

if (problems.length > 0) {
    console.error(`[check-test-tiers] ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
}

console.log(`[check-test-tiers] OK — ${tierCount} tiers validated, ${suiteCount} server suites reachable (${suiteCount - untriagedCount} tiered, ${untriagedCount} allowlisted untriaged), ${workflowFiles.length} workflows drift-free.`);
