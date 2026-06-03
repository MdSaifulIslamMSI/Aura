const { spawnSync } = require('child_process');
const { mkdtempSync, rmSync } = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

const createReportDir = (label = 'security-script') => mkdtempSync(path.join(os.tmpdir(), `${label}-`));

const cleanupReportDir = (dir) => {
    if (dir) {
        rmSync(dir, { recursive: true, force: true });
    }
};

const runSecurityScript = (relativeScript, args = [], options = {}) => spawnSync(
    process.execPath,
    [path.join(repoRoot, relativeScript), ...args],
    {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
            ...process.env,
            ...options.env,
        },
        timeout: options.timeout || 30000,
    }
);

module.exports = {
    cleanupReportDir,
    createReportDir,
    repoRoot,
    runSecurityScript,
};
