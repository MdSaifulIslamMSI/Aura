#!/usr/bin/env node
'use strict';

const { classifyFiles, getChangedFilesFromGit } = require('../tests/auth/helpers/risk-classifier');
const {
    buildCountReport,
    formatNumber,
    loadAutoExpandPolicy,
    loadMatrix,
    writeGeneratedCount,
} = require('../tests/auth/helpers/matrix-engine');

function getArgValue(name, fallback = null) {
    const prefix = `${name}=`;
    const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : fallback;
}

function selectedExpansionLevel() {
    if (process.argv.includes('--auto')) {
        const files = getChangedFilesFromGit(process.argv.slice(2));
        return classifyFiles(files).autoExpandLevel;
    }
    return getArgValue('--expand', 'level_0_base');
}

function printReport(report) {
    const matrix = loadMatrix();
    const policy = loadAutoExpandPolicy();
    console.log('AUTH TEST MATRIX COUNT');
    console.log('');
    for (const [dimensionName, count] of Object.entries(report.baseMatrix.dimensionCounts)) {
        console.log(`${dimensionName}: ${count}`);
    }
    console.log('');
    console.log(`Base matrix ceiling: ${formatNumber(report.baseMatrix.logicalCeiling)} combinations`);
    console.log('');
    console.log(`Selected expansion: ${report.selectedExpansionLevel}`);
    console.log('Added dimensions:');
    if (report.selectedExpansion.enabledDimensions.length === 0) {
        console.log('- none');
    } else {
        for (const dimension of report.selectedExpansion.enabledDimensions) {
            const values = matrix.futureDimensions[dimension] || [];
            console.log(`${dimension}: ${values.length}`);
        }
    }
    console.log('');
    console.log(`Expanded logical ceiling: ${formatNumber(report.selectedExpansion.logicalCeiling)}`);
    console.log(`Recommended executed generated tests: ${policy.levels[report.selectedExpansionLevel].recommendedExecutedTests}`);
    console.log('');
    console.log('Execution policy:');
    for (const [tier, range] of Object.entries(report.executionPolicy)) {
        console.log(`${tier}: ${range}`);
    }
    console.log('');
    console.log('Professional claim:');
    console.log('"The architecture auto-expands its logical test ceiling based on authentication/security risk while executing practical sampled subsets."');
    console.log(report.professionalClaim);
}

try {
    const expansionLevel = selectedExpansionLevel();
    const report = buildCountReport(expansionLevel);
    writeGeneratedCount(report);
    printReport(report);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
