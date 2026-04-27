import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    buildFrontendSecurityHeaders,
    buildHostedBackendRewrites,
    buildNetlifyHostedBackendRedirects,
    HOSTED_BACKEND_ORIGIN,
} from '../config/vercelRoutingContract.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDirectory, '..', '..');
const sharedRewrites = buildHostedBackendRewrites(HOSTED_BACKEND_ORIGIN);
const sharedHeaders = buildFrontendSecurityHeaders();
const netlifyRedirects = buildNetlifyHostedBackendRedirects(HOSTED_BACKEND_ORIGIN);

const targets = [
    path.join(repoRoot, 'vercel.json'),
    path.join(repoRoot, 'app', 'vercel.json'),
];

for (const target of targets) {
    const currentConfig = JSON.parse(await readFile(target, 'utf8'));
    const nextConfig = {
        ...currentConfig,
        headers: sharedHeaders,
        rewrites: sharedRewrites,
    };

    await writeFile(target, `${JSON.stringify(nextConfig, null, 4)}\n`);
}

const renderNetlifyRedirects = (redirects) => redirects
    .map(({ from, to, status, force }) => [
        '[[redirects]]',
        `  from = "${from}"`,
        `  to = "${to}"`,
        `  status = ${status}`,
        `  force = ${force ? 'true' : 'false'}`,
    ].join('\n'))
    .join('\n\n');

const getNetlifyRedirectFrom = (section) => section.match(/^\s*from\s*=\s*"([^"]+)"/m)?.[1] || '';
const netlifyProxyPaths = new Set(netlifyRedirects.map(({ from }) => from));
const netlifyTarget = path.join(repoRoot, 'netlify.toml');
const netlifyConfig = await readFile(netlifyTarget, 'utf8');
const netlifySections = netlifyConfig.split(/\r?\n(?=\[\[redirects\]\])/);
const nextNetlifySections = [];
let insertedNetlifyProxyRedirects = false;

for (const section of netlifySections) {
    if (section.startsWith('[[redirects]]')) {
        const from = getNetlifyRedirectFrom(section);

        if (netlifyProxyPaths.has(from)) {
            if (!insertedNetlifyProxyRedirects) {
                nextNetlifySections.push(renderNetlifyRedirects(netlifyRedirects));
                insertedNetlifyProxyRedirects = true;
            }

            continue;
        }
    }

    nextNetlifySections.push(section.trimEnd());
}

await writeFile(netlifyTarget, `${nextNetlifySections.join('\n\n')}\n`);
