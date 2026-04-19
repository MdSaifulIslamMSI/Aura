import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildHostedBackendRewrites, HOSTED_BACKEND_ORIGIN } from '../config/vercelRoutingContract.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDirectory, '..', '..');
const sharedRewrites = buildHostedBackendRewrites(HOSTED_BACKEND_ORIGIN);

const targets = [
    path.join(repoRoot, 'vercel.json'),
    path.join(repoRoot, 'app', 'vercel.json'),
];

for (const target of targets) {
    const currentConfig = JSON.parse(await readFile(target, 'utf8'));
    const nextConfig = {
        ...currentConfig,
        rewrites: sharedRewrites,
    };

    await writeFile(target, `${JSON.stringify(nextConfig, null, 4)}\n`);
}
