#!/usr/bin/env node
'use strict';

const {
    assertAuthCase,
    formatGeneratedFailure,
    formatNumber,
    generateAuthCases,
} = require('../tests/auth/helpers/matrix-engine');

function getArgValue(name, fallback = null) {
    const prefix = `${name}=`;
    const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
    return process.argv.includes(name);
}

function run() {
    const mode = getArgValue('--mode', 'generated');
    const expansionLevel = getArgValue('--expand', null);
    const seed = getArgValue('--seed', null);
    const limit = Number(getArgValue('--limit', process.env.AUTH_TEST_TARGET || '0')) || undefined;
    const json = hasFlag('--json');
    const assert = hasFlag('--assert');

    const batch = generateAuthCases({ mode, expansionLevel, seed, limit });
    let rejected = 0;
    let allowed = 0;

    if (assert) {
        for (const authCase of batch.cases) {
            try {
                const evaluation = assertAuthCase(authCase);
                if (evaluation.allowed) allowed += 1;
                else rejected += 1;
            } catch (error) {
                console.error(formatGeneratedFailure(error, batch));
                process.exitCode = 1;
                return;
            }
        }
    }

    const summary = {
        mode: batch.mode,
        expansionLevel: batch.expansionLevel,
        seed: batch.seed,
        generatedCases: batch.cases.length,
        logicalCeiling: Number(batch.logicalCeiling),
        recommendedExecutedTests: batch.recommendedExecutedTests,
        allowed,
        rejected,
    };

    if (json) {
        console.log(JSON.stringify({ summary, cases: batch.cases }, null, 2));
        return;
    }

    console.log('GENERATED AUTH MATRIX');
    console.log(`Mode: ${summary.mode}`);
    console.log(`Expansion Level: ${summary.expansionLevel}`);
    console.log(`Seed: ${summary.seed}`);
    console.log(`Generated cases: ${formatNumber(summary.generatedCases)}`);
    console.log(`Logical ceiling: ${formatNumber(summary.logicalCeiling)}`);
    console.log(`Recommended executed tests: ${summary.recommendedExecutedTests}`);
    if (assert) {
        console.log(`Allowed safe cases: ${formatNumber(summary.allowed)}`);
        console.log(`Rejected / reauth / forbidden cases: ${formatNumber(summary.rejected)}`);
    }
    console.log('');
    console.log('Replay command:');
    console.log(`npm run test:auth:generated -- --seed=${summary.seed} --expand=${summary.expansionLevel}`);
}

run();
