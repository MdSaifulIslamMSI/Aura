import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '../..');
const reviewedDir = path.join(appDir, 'src/i18n/messages/reviewed');
const compiledDir = path.join(appDir, 'src/i18n/messages/compiled');
const formatJsBin = path.join(appDir, 'node_modules/@formatjs/cli/bin/formatjs');
const MAX_COMPILE_ATTEMPTS = 3;

const waitForFileRelease = (attempt) => {
    Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        200 * attempt,
    );
};

fs.mkdirSync(compiledDir, { recursive: true });

for (const fileName of fs.readdirSync(reviewedDir).filter((entry) => entry.endsWith('.json')).sort()) {
    const inputPath = path.join(reviewedDir, fileName);
    const outputPath = path.join(compiledDir, fileName);
    let result;

    for (let attempt = 1; attempt <= MAX_COMPILE_ATTEMPTS; attempt += 1) {
        result = spawnSync(process.execPath, [
            formatJsBin,
            'compile',
            inputPath,
            '--format',
            'simple',
            '--out-file',
            outputPath,
        ], {
            cwd: appDir,
            encoding: 'utf8',
        });

        if (!result.error && result.status === 0) {
            break;
        }

        if (attempt < MAX_COMPILE_ATTEMPTS) {
            waitForFileRelease(attempt);
        }
    }

    if (result?.error || result?.status !== 0) {
        const message = result?.error?.message || result?.stderr || `Compilation failed for ${fileName}`;
        console.error(String(message).trim());
        process.exit(result?.status ?? 1);
    }
}

console.log(`Compiled reviewed locale catalogs into ${path.relative(appDir, compiledDir).replace(/\\/g, '/')}`);
