import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const appDir = path.resolve(scriptDir, '..');
const playwrightCli = path.join(appDir, 'node_modules', '@playwright', 'test', 'cli.js');
const args = [
    'test',
    'e2e/locale.accessibility.spec.js',
    '--config',
    'playwright.locale-qa.config.js',
];

const child = spawn(process.execPath, [playwrightCli, ...args], {
    cwd: appDir,
    stdio: 'inherit',
    env: {
        ...process.env,
        LOCALE_ACCESSIBILITY_QA: '1',
    },
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }

    process.exit(code ?? 0);
});
