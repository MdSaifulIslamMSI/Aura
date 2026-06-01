import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '../..');
const reviewedDir = path.join(appDir, 'src/i18n/messages/reviewed');
const compiledDir = path.join(appDir, 'src/i18n/messages/compiled');
const formatJsBin = path.join(appDir, 'node_modules/@formatjs/cli/bin/formatjs');

fs.mkdirSync(compiledDir, { recursive: true });

for (const fileName of fs.readdirSync(reviewedDir).filter((entry) => entry.endsWith('.json')).sort()) {
    const inputPath = path.join(reviewedDir, fileName);
    const outputPath = path.join(compiledDir, fileName);
    const result = spawnSync(process.execPath, [
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
        stdio: 'inherit',
    });

    if (result.error) {
        console.error(result.error.message);
        process.exit(1);
    }

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

console.log(`Compiled reviewed locale catalogs into ${path.relative(appDir, compiledDir).replace(/\\/g, '/')}`);
