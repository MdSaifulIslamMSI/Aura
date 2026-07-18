import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    buildFrontendSecurityHeaders,
    buildFrontendSecurityHeaderValues,
    buildHostedBackendRewrites,
    buildNetlifyHostedBackendRedirects,
    assertDeployableHostedBackendOrigin,
    DEFAULT_HOSTED_BACKEND_ORIGIN,
    FRONTEND_META_CONTENT_SECURITY_POLICY,
    resolveHostedBackendOrigin,
} from '../config/vercelRoutingContract.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDirectory, '..', '..');
const hostedBackendOrigin = resolveHostedBackendOrigin(process.env, { allowCommittedFallback: true });
if (hostedBackendOrigin !== DEFAULT_HOSTED_BACKEND_ORIGIN) {
    assertDeployableHostedBackendOrigin(hostedBackendOrigin);
}
const sharedRewrites = buildHostedBackendRewrites(hostedBackendOrigin);
const sharedHeaders = buildFrontendSecurityHeaders(hostedBackendOrigin);
const sharedNetlifyHeaders = buildFrontendSecurityHeaderValues(hostedBackendOrigin);
const netlifyRedirects = buildNetlifyHostedBackendRedirects(hostedBackendOrigin);

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

const appIndexTarget = path.join(repoRoot, 'app', 'index.html');
const appIndexHtml = await readFile(appIndexTarget, 'utf8');
const nextAppIndexHtml = appIndexHtml.replace(
    /(<meta\s+http-equiv="Content-Security-Policy"\s*\r?\n\s*content=")[^"]*("\s*\/>)/,
    `$1${FRONTEND_META_CONTENT_SECURITY_POLICY}$2`
);

if (nextAppIndexHtml === appIndexHtml && !appIndexHtml.includes(FRONTEND_META_CONTENT_SECURITY_POLICY)) {
    throw new Error('Could not synchronize the app index Content-Security-Policy meta tag.');
}

await writeFile(appIndexTarget, nextAppIndexHtml);

const renderNetlifyRedirects = (redirects) => redirects
    .map(({ from, to, status, force }) => [
        '[[redirects]]',
        `  from = "${from}"`,
        `  to = "${to}"`,
        `  status = ${status}`,
        `  force = ${force ? 'true' : 'false'}`,
    ].join('\n'))
    .join('\n\n');

const escapeTomlString = (value = '') => String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const renderNetlifyHeaders = (headers) => [
    '[[headers]]',
    '  for = "/*"',
    '  [headers.values]',
    ...headers.map(({ key, value }) => `    ${key} = "${escapeTomlString(value)}"`),
].join('\n');

const getNetlifyRedirectFrom = (section) => section.match(/^\s*from\s*=\s*"([^"]+)"/m)?.[1] || '';
const netlifyProxyPaths = new Set(netlifyRedirects.map(({ from }) => from));
const netlifyTarget = path.join(repoRoot, 'netlify.toml');
const netlifyConfig = await readFile(netlifyTarget, 'utf8');
const netlifyConfigWithHeaders = netlifyConfig.replace(
    /\[\[headers\]\][\s\S]*?(?=\r?\n\[\[redirects\]\]|\s*$)/,
    renderNetlifyHeaders(sharedNetlifyHeaders)
);
const netlifySections = netlifyConfigWithHeaders.split(/\r?\n(?=\[\[redirects\]\])/);
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
