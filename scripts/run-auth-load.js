#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const target = (process.env.AUTH_LOAD_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
const allowProduction = process.env.AUTH_LOAD_ALLOW_PROD === 'true';
const localTargets = new Set(['http://localhost:5000', 'http://127.0.0.1:5000']);

if (!localTargets.has(target) && !allowProduction) {
    console.error(`Refusing to run load tests against ${target}. Use staging/local, or set AUTH_LOAD_ALLOW_PROD=true only for approved non-destructive validation.`);
    process.exit(1);
}

const k6Command = process.platform === 'win32' ? 'k6.exe' : 'k6';
const script = process.argv[2] || 'tests/auth/load/login-load.k6.js';
const result = spawnSync(k6Command, ['run', path.resolve(script)], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    env: {
        ...process.env,
        AUTH_LOAD_BASE_URL: target,
    },
});

if (result.error && result.error.code === 'ENOENT') {
    console.error('k6 is not installed or not on PATH. Install k6 to run auth load tests.');
    process.exit(1);
}
process.exit(result.status || 0);
