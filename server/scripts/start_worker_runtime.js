#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const { loadLocalEnvFiles, primeAwsParameterStoreEnv, getRuntimeSecretBootstrapState } = require('../config/runtimeConfig');

const targetScript = path.resolve(__dirname, '..', 'workerProcess.js');

const forwardSignal = (child, signal) => {
    if (child && !child.killed) {
        child.kill(signal);
    }
};

const bootstrap = async () => {
    loadLocalEnvFiles();
    await primeAwsParameterStoreEnv({ logger: console });
    const bootstrapState = getRuntimeSecretBootstrapState();
    process.env.RUNTIME_SECRET_SOURCE = bootstrapState.source;
    process.env.RUNTIME_SECRET_LOADED_KEY_COUNT = String(Array.isArray(bootstrapState.loadedKeys) ? bootstrapState.loadedKeys.length : 0);

    const child = spawn(process.execPath, [targetScript], {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env },
        stdio: 'inherit',
    });

    process.on('SIGINT', () => forwardSignal(child, 'SIGINT'));
    process.on('SIGTERM', () => forwardSignal(child, 'SIGTERM'));

    child.on('exit', (code, signal) => {
        if (signal) {
            console.warn(`[runtime] worker child exited via ${signal} after ${bootstrapState.source}`);
            process.kill(process.pid, signal);
            return;
        }
        process.exit(code === null ? 1 : code);
    });
};

bootstrap().catch((error) => {
    console.error('[runtime] worker bootstrap failed:', error?.stack || error?.message || error);
    process.exit(1);
});
