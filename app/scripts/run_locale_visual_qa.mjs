import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const appDir = path.resolve(scriptDir, '..');
const args = [
    'playwright',
    'test',
    'e2e/locale.visual.spec.js',
    '--config',
    'playwright.locale-qa.config.js',
];
const command = process.platform === 'win32'
    ? `npx ${args.join(' ')}`
    : 'npx';

const child = spawn(command, process.platform === 'win32' ? [] : args, {
    cwd: appDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
        ...process.env,
        LOCALE_VISUAL_QA: '1',
    },
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }

    process.exit(code ?? 0);
});
