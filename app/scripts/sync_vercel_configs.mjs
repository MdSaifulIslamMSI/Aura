import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    buildCloudflarePagesHeaders,
    buildCloudflarePagesRedirects,
    buildFrontendSecurityHeaders,
    buildFrontendSecurityHeaderValues,
    buildHostedBackendRewrites,
    buildNetlifyHostedBackendRedirects,
    buildRailwayCaddyfile,
    buildRailwayToml,
    buildRenderBlueprint,
    assertDeployableHostedBackendOrigin,
    DEFAULT_HOSTED_BACKEND_ORIGIN,
    FRONTEND_META_CONTENT_SECURITY_POLICY,
    resolveHostedBackendOrigin,
} from '../config/vercelRoutingContract.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDirectory, '..', '..');
const checkMode = process.argv.includes('--check');

// The committed contract default is the single source of truth for generated
// files. `--check` is intentionally environment-independent: it verifies that
// the committed outputs match what the committed contract generates, so CI
// results never depend on runner-side AURA_BACKEND_ORIGIN values. A real
// origin swap sets the repo variable and re-runs this script WITHOUT --check
// (the regenerated files are then committed for the check to validate).
const committedOrigin = resolveHostedBackendOrigin({}, { allowCommittedFallback: true });
if (committedOrigin !== DEFAULT_HOSTED_BACKEND_ORIGIN) {
    assertDeployableHostedBackendOrigin(committedOrigin);
}
const committedOriginHost = new URL(committedOrigin).hostname;

const sharedRewrites = buildHostedBackendRewrites(committedOrigin);
const sharedHeaders = buildFrontendSecurityHeaders(committedOrigin);
const sharedNetlifyHeaders = buildFrontendSecurityHeaderValues(committedOrigin);
const netlifyRedirects = buildNetlifyHostedBackendRedirects(committedOrigin);

// Replaces every stale reference to the contract-default origin with the
// resolved one. With the committed default resolved this is the identity
// transform (so --check passes for committed files); on swap day it rewrites
// hand-maintained files (gateway portal, capacitor allowNavigation) in place.
const replaceDefaultOrigin = (content) => content
    .split(DEFAULT_HOSTED_BACKEND_ORIGIN)
    .join(committedOrigin)
    .split(DEFAULT_HOSTED_BACKEND_ORIGIN.replace(/^https?:\/\//, ''))
    .join(committedOriginHost);

const generatedFiles = new Map();

// --- Vercel lane configs (merge into existing JSON) ---
const vercelTargets = [
    path.join(repoRoot, 'vercel.json'),
    path.join(repoRoot, 'app', 'vercel.json'),
];

for (const target of vercelTargets) {
    const currentConfig = JSON.parse(await readFile(target, 'utf8'));
    const nextConfig = {
        ...currentConfig,
        headers: sharedHeaders,
        rewrites: sharedRewrites,
    };

    generatedFiles.set(target, `${JSON.stringify(nextConfig, null, 4)}\n`);
}

// --- Render / Railway / Cloudflare Pages (pure builder outputs) ---
generatedFiles.set(path.join(repoRoot, 'render.yaml'), buildRenderBlueprint(committedOrigin));
generatedFiles.set(path.join(repoRoot, 'app', 'Caddyfile'), buildRailwayCaddyfile(committedOrigin));
generatedFiles.set(path.join(repoRoot, 'app', 'railway.toml'), buildRailwayToml(committedOrigin));
generatedFiles.set(
    path.join(repoRoot, 'cloudflare', '_headers'),
    `${buildCloudflarePagesHeaders(committedOrigin)}\n`,
);
generatedFiles.set(
    path.join(repoRoot, 'cloudflare', '_redirects'),
    buildCloudflarePagesRedirects(),
);

// --- SPA meta CSP: app/index.html plus the committed mobile copies ---
const indexMetaTargets = [
    path.join(repoRoot, 'app', 'index.html'),
    path.join(repoRoot, 'app', 'android', 'app', 'src', 'main', 'assets', 'public', 'index.html'),
    path.join(repoRoot, 'app', 'ios', 'App', 'App', 'public', 'index.html'),
];

for (const indexTarget of indexMetaTargets) {
    const indexHtml = await readFile(indexTarget, 'utf8');
    const nextIndexHtml = indexHtml.replace(
        /(<meta\s+http-equiv="Content-Security-Policy"\s*\r?\n\s*content=")[^"]*("\s*\/>)/,
        `$1${FRONTEND_META_CONTENT_SECURITY_POLICY}$2`
    );

    if (nextIndexHtml === indexHtml && !indexHtml.includes(FRONTEND_META_CONTENT_SECURITY_POLICY)) {
        throw new Error(`Could not synchronize the Content-Security-Policy meta tag in ${indexTarget}.`);
    }

    generatedFiles.set(indexTarget, nextIndexHtml);
}

// --- Netlify lane configs (section surgery on existing TOML) ---
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
// Both Netlify configs stay in sync: the repo-root file (used with the repo
// root as base directory) and app/netlify.toml (used with app/ as base
// directory). A base-directory choice must never silently change the
// security-header posture, so the [[headers]] block is inserted when missing.
const netlifyTargets = [
    path.join(repoRoot, 'netlify.toml'),
    path.join(repoRoot, 'app', 'netlify.toml'),
];

for (const netlifyTarget of netlifyTargets) {
    const netlifyConfig = await readFile(netlifyTarget, 'utf8');
    let withHeaders = netlifyConfig;
    if (!/^\[\[headers\]\]/m.test(withHeaders)) {
        withHeaders = withHeaders.replace(
            /(\[build\][^\[]*?)(?=\r?\n\[\[redirects\]\])/,
            (_, build) => `${build.trimEnd()}\n\n${renderNetlifyHeaders(sharedNetlifyHeaders)}`
        );
    }
    withHeaders = withHeaders.replace(
        /\[\[headers\]\][\s\S]*?(?=\r?\n\[\[redirects\]\]|\s*$)/,
        renderNetlifyHeaders(sharedNetlifyHeaders)
    );
    const netlifySections = withHeaders.split(/\r?\n(?=\[\[redirects\]\])/);
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

    generatedFiles.set(netlifyTarget, `${nextNetlifySections.join('\n\n')}\n`);
}

// --- Gateway portal (static hand-maintained links to the storefront/backend) ---
const gatewayTarget = path.join(repoRoot, 'gateway', 'index.html');
generatedFiles.set(gatewayTarget, replaceDefaultOrigin(await readFile(gatewayTarget, 'utf8')));

// --- Capacitor native config (hand-maintained allowNavigation) ---
const capacitorTarget = path.join(repoRoot, 'app', 'capacitor.config.ts');
generatedFiles.set(capacitorTarget, replaceDefaultOrigin(await readFile(capacitorTarget, 'utf8')));

// --- Generated backend-origin artifact (consumed by server + desktop at runtime) ---
generatedFiles.set(
    path.join(repoRoot, 'config', 'backend-origin.json'),
    `${JSON.stringify({
        origin: committedOrigin,
        source: 'app/config/vercelRoutingContract.mjs DEFAULT_HOSTED_BACKEND_ORIGIN',
        generator: 'app/scripts/sync_vercel_configs.mjs',
    }, null, 4)}\n`,
);

// --- Write or verify ---
const drifted = [];
for (const [target, nextContent] of generatedFiles) {
    const currentContent = await readFile(target, 'utf8').catch(() => null);
    if (currentContent !== nextContent) {
        drifted.push(path.relative(repoRoot, target));
    }
    if (!checkMode) {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, nextContent);
    }
}

if (checkMode) {
    if (drifted.length) {
        console.error(`Generated config drift detected (${drifted.length} file(s)):`);
        for (const file of drifted) {
            console.error(`  - ${file}`);
        }
        console.error('Run `node app/scripts/sync_vercel_configs.mjs` and commit the result.');
        process.exit(1);
    }
    console.log('Generated configs are in sync with the routing contract.');
} else {
    console.log(`Synchronized ${generatedFiles.size} generated config files (backend origin: ${committedOrigin}).`);
}
