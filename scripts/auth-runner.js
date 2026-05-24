'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { classifyFiles, getChangedFilesFromGit } = require('../tests/auth/helpers/risk-classifier');
const { DEFAULT_LIMITS, MODE_EXPANSION_DEFAULTS } = require('../tests/auth/helpers/matrix-engine');

const ROOT_DIR = path.resolve(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeCommand = process.execPath;

const TIER_CONFIG = {
    smoke: {
        mode: 'smoke',
        limit: 500,
        expand: 'level_0_base',
        checks: [
            { cmd: npmCommand, args: ['--prefix', 'server', 'test', '--', '--runTestsByPath', 'tests/authRoutes.integration.test.js', 'tests/authMiddleware.test.js', 'tests/elasticAuthMatrixArchitecture.test.js'] },
        ],
        nodeTestDirs: ['tests/auth/unit', 'tests/auth/integration'],
    },
    core: {
        mode: 'core',
        limit: 1500,
        expand: 'level_0_base',
        checks: [
            { cmd: npmCommand, args: ['run', 'security:auth-tests'] },
            { cmd: npmCommand, args: ['--prefix', 'server', 'test', '--', '--runTestsByPath', 'tests/elasticAuthMatrixArchitecture.test.js', 'tests/elasticAuthSecurityProperties.test.js'] },
        ],
        nodeTestDirs: ['tests/auth/unit', 'tests/auth/integration', 'tests/auth/rbac', 'tests/auth/property'],
    },
    security: {
        mode: 'security',
        limit: 3000,
        expand: 'level_1_device',
        checks: [
            { cmd: npmCommand, args: ['run', 'security:login-next10'] },
            { cmd: npmCommand, args: ['run', 'security:attack-smoke'] },
            { cmd: npmCommand, args: ['--prefix', 'server', 'test', '--', '--runTestsByPath', 'tests/elasticAuthSecurityProperties.test.js'] },
        ],
        nodeTestDirs: ['tests/auth/security', 'tests/auth/property'],
    },
    generated: {
        mode: 'generated',
        limit: DEFAULT_LIMITS.generated,
        expand: MODE_EXPANSION_DEFAULTS.generated,
        checks: [
            { cmd: npmCommand, args: ['--prefix', 'server', 'test', '--', '--runTestsByPath', 'tests/elasticAuthMatrixArchitecture.test.js'] },
        ],
        nodeTestDirs: ['tests/auth/generated'],
    },
    nightly: {
        mode: 'nightly',
        limit: DEFAULT_LIMITS.nightly,
        expand: MODE_EXPANSION_DEFAULTS.nightly,
        checks: [
            { cmd: npmCommand, args: ['run', 'security:auth-tests'] },
        ],
        nodeTestDirs: ['tests/auth/unit', 'tests/auth/security', 'tests/auth/rbac', 'tests/auth/generated', 'tests/auth/property'],
    },
    critical: {
        mode: 'critical',
        limit: DEFAULT_LIMITS.critical,
        expand: MODE_EXPANSION_DEFAULTS.critical,
        checks: [
            { cmd: npmCommand, args: ['run', 'security:login-gates'] },
        ],
        nodeTestDirs: ['tests/auth/unit', 'tests/auth/security', 'tests/auth/rbac', 'tests/auth/generated', 'tests/auth/property'],
    },
};

function runStep(step, env = {}) {
    console.log(`\n> ${step.cmd} ${step.args.join(' ')}`);
    if (![npmCommand, nodeCommand].includes(step.cmd)) {
        throw new Error(`Unsupported auth runner command: ${step.cmd}`);
    }

    const result = spawnSync(step.cmd, step.args, { // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
        cwd: ROOT_DIR,
        stdio: 'inherit',
        env: { ...process.env, ...env },
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        const detail = result.signal ? `signal ${result.signal}` : `exit code ${result.status}`;
        throw new Error(`Command failed with ${detail}: ${step.cmd} ${step.args.join(' ')}`);
    }
}

function runGenerated({ mode, limit, expand, seed }) {
    const args = [
        path.join(ROOT_DIR, 'scripts/generate-auth-matrix.js'),
        `--mode=${mode}`,
        `--limit=${limit}`,
        `--expand=${expand}`,
        '--assert',
    ];
    if (seed) args.push(`--seed=${seed}`);
    runStep({ cmd: nodeCommand, args });
}

function listNodeTestFiles(relativeDirs) {
    const files = [];
    function walk(dir) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(fullPath);
            else if (entry.isFile() && entry.name.endsWith('.test.js')) files.push(fullPath);
        }
    }
    for (const relativeDir of relativeDirs || []) {
        walk(path.join(ROOT_DIR, relativeDir));
    }
    return files;
}

function runNodeAuthTests(relativeDirs) {
    const files = listNodeTestFiles(relativeDirs);
    if (files.length === 0) return;
    runStep({ cmd: nodeCommand, args: ['--test', ...files] });
}

function runTier(tier, overrides = {}) {
    const config = TIER_CONFIG[tier];
    if (!config) throw new Error(`Unknown auth test tier: ${tier}`);
    const limit = Number(overrides.limit || process.env.AUTH_TEST_TARGET || config.limit);
    const expand = overrides.expand || process.env.AUTH_TEST_EXPAND || config.expand;
    const seed = overrides.seed || process.env.AUTH_TEST_SEED || null;

    console.log(`AUTH TEST TIER: ${tier.toUpperCase()}`);
    console.log(`Generated target: ${limit}`);
    console.log(`Expansion level: ${expand}`);

    for (const check of config.checks) {
        runStep(check, { NODE_ENV: 'test' });
    }
    runNodeAuthTests(config.nodeTestDirs);
    runGenerated({ mode: config.mode, limit, expand, seed });
}

function runAuto() {
    const classification = classifyFiles(getChangedFilesFromGit(process.argv.slice(2)));
    console.log(`AUTH AUTO RISK: ${classification.riskLevel}`);
    console.log(`AUTO EXPAND: ${classification.autoExpandLevel}`);
    console.log(`COMMAND: ${classification.recommendedCommand}`);

    if (classification.recommendedCommand.includes('critical')) return runTier('critical', { expand: classification.autoExpandLevel });
    if (classification.recommendedCommand.includes('security')) return runTier('security', { expand: classification.autoExpandLevel });
    if (classification.recommendedCommand.includes('generated')) return runTier('generated', { expand: classification.autoExpandLevel });
    if (classification.recommendedCommand.endsWith('test:auth')) return runTier('core', { expand: classification.autoExpandLevel });
    return runTier('smoke', { expand: classification.autoExpandLevel });
}

module.exports = {
    runAuto,
    runTier,
};
