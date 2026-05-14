#!/usr/bin/env node
'use strict';

const {
    classifyFiles,
    formatClassification,
    getChangedFilesFromGit,
} = require('../tests/auth/helpers/risk-classifier');

try {
    const files = getChangedFilesFromGit(process.argv.slice(2));
    const classification = classifyFiles(files);
    console.log(formatClassification(classification));
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
