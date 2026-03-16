#!/usr/bin/env node
/* eslint-disable no-console */
const { execSync } = require('child_process');

const MAX_FILE_BYTES = 1024 * 1024; // 1MB
const BLOCKED_PATH_PATTERNS = [
    /^server\/test_output\.txt$/i,
    /(^|\/)test[_-]?output.*\.(txt|log)$/i,
    /(^|\/)runtime[_-]?.*\.log$/i,
    /(^|\/)playwright-report\//i,
    /(^|\/)coverage\//i,
];

const listTrackedFiles = () => execSync('git ls-files', { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const fileSize = (filePath) => {
    try {
        return Number(execSync(`git cat-file -s HEAD:${filePath}`, { encoding: 'utf8' }).trim());
    } catch {
        return 0;
    }
};

const violations = [];

for (const filePath of listTrackedFiles()) {
    if (BLOCKED_PATH_PATTERNS.some((pattern) => pattern.test(filePath))) {
        violations.push(`Blocked artifact path committed: ${filePath}`);
    }

    const size = fileSize(filePath);
    if (size > MAX_FILE_BYTES && /(log|txt|out|report|coverage)/i.test(filePath)) {
        violations.push(`Oversized log/report artifact committed (${Math.round(size / 1024)} KiB): ${filePath}`);
    }
}

if (violations.length > 0) {
    console.error('Artifact guard failed. Remove generated runtime/test artifacts from version control:');
    for (const violation of violations) {
        console.error(` - ${violation}`);
    }
    process.exit(1);
}

console.log('Artifact guard passed.');
