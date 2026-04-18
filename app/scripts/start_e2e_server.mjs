import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverDir = path.resolve(__dirname, '../../server');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const requireFromServer = createRequire(path.join(serverDir, 'package.json'));

const run = (command, args) => new Promise((resolve, reject) => {
    const child = spawn(command, args, {
        cwd: serverDir,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
        if (signal) {
            reject(new Error(`Command "${command} ${args.join(' ')}" exited from signal ${signal}`));
            return;
        }

        if (code !== 0) {
            reject(new Error(`Command "${command} ${args.join(' ')}" exited with code ${code}`));
            return;
        }

        resolve();
    });
});

const hasServerDependencies = () => {
    try {
        requireFromServer.resolve('compression');
        requireFromServer.resolve('express');
        return true;
    } catch {
        return false;
    }
};

if (!hasServerDependencies()) {
    if (process.env.CI === 'true') {
        throw new Error('Server dependencies are missing for E2E. Install them in ./server before starting the app test server.');
    }
    await run(npmCommand, ['ci']);
}

await run(npmCommand, ['start']);
