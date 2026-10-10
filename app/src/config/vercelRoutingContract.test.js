import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    buildCloudflarePagesHeaders,
    buildFrontendSecurityHeaders,
    buildHostedBackendRewrites,
    buildNetlifyHostedBackendRedirects,
    DEFAULT_HOSTED_BACKEND_ORIGIN,
    FRONTEND_ASSET_CACHE_CONTROL,
    FRONTEND_DOCUMENT_CACHE_CONTROL,
    FRONTEND_SERVICE_WORKER_CACHE_CONTROL,
    resolveHostedBackendOrigin,
} from '../../config/vercelRoutingContract.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDirectory, '..', '..');
const repoRoot = path.resolve(appRoot, '..');
const deployWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'deploy-backend-aws.yml');
const netlifyConfigPath = path.join(repoRoot, 'netlify.toml');

const parseCloudflareHeaderBlocks = (contents) => contents
    .split('\n')
    .reduce((blocks, line) => {
        if (/^\S/.test(line)) {
            blocks.push({ path: line.trim(), headers: [] });
        } else if (blocks.length > 0) {
            const match = line.match(/^\s+([A-Za-z-]+):\s*(.*)$/);

            if (match) {
                blocks[blocks.length - 1].headers.push({ key: match[1], value: match[2].trim() });
            }
        }

        return blocks;
    }, []);

const readJson = async (targetPath) => JSON.parse(await readFile(targetPath, 'utf8'));

const readNetlifyRedirects = async () => {
    const config = await readFile(netlifyConfigPath, 'utf8');

    return config
        .split('[[redirects]]')
        .slice(1)
        .map((section) => ({
            from: section.match(/^\s*from\s*=\s*"([^"]+)"/m)?.[1],
            to: section.match(/^\s*to\s*=\s*"([^"]+)"/m)?.[1],
            status: Number(section.match(/^\s*status\s*=\s*(\d+)/m)?.[1]),
            force: section.match(/^\s*force\s*=\s*(true|false)/m)?.[1] === 'true',
        }))
        .filter(({ from, to }) => from && to);
};

describe('vercel routing contract', () => {
    it('keeps root and app rewrites aligned to the hosted backend origin', async () => {
        const expectedRewrites = buildHostedBackendRewrites(DEFAULT_HOSTED_BACKEND_ORIGIN);
        const [rootConfig, appConfig] = await Promise.all([
            readJson(path.join(repoRoot, 'vercel.json')),
            readJson(path.join(appRoot, 'vercel.json')),
        ]);

        expect(rootConfig.rewrites).toEqual(expectedRewrites);
        expect(appConfig.rewrites).toEqual(expectedRewrites);
    });

    it('keeps Netlify proxy redirects aligned to the hosted backend origin', async () => {
        const redirects = await readNetlifyRedirects();
        const expectedRedirects = buildNetlifyHostedBackendRedirects(DEFAULT_HOSTED_BACKEND_ORIGIN);

        for (const expectedRedirect of expectedRedirects) {
            expect(redirects).toContainEqual(expectedRedirect);
        }
    });

    it('allows deploy scripts to override the hosted backend origin safely', () => {
        expect(resolveHostedBackendOrigin({
            AURA_BACKEND_ORIGIN: ' https://api.example.com/ ',
            AWS_BACKEND_BASE_URL: 'http://12.34.56.78:5000',
        })).toBe('https://api.example.com');

        expect(resolveHostedBackendOrigin({
            AWS_BACKEND_BASE_URL: 'http://12.34.56.78:5000/',
        })).toBe('http://12.34.56.78:5000');

        expect(() => resolveHostedBackendOrigin({})).toThrow(/AURA_BACKEND_ORIGIN|AWS_BACKEND_BASE_URL/);
        expect(resolveHostedBackendOrigin({}, { allowCommittedFallback: true })).toBe(DEFAULT_HOSTED_BACKEND_ORIGIN);
        expect(() => resolveHostedBackendOrigin({ AURA_BACKEND_ORIGIN: '/' })).toThrow(/absolute http/);
        expect(() => resolveHostedBackendOrigin({ AURA_BACKEND_ORIGIN: '/' }, { allowCommittedFallback: true })).toThrow(/absolute http/);
        expect(resolveHostedBackendOrigin({ AURA_BACKEND_ORIGIN: '/' }, {
            allowCommittedFallback: true,
            allowSameOriginFallback: true,
        })).toBe(DEFAULT_HOSTED_BACKEND_ORIGIN);
    });

    it('can render staging deployment headers for the isolated AWS backend', () => {
        const stagingOrigin = 'http://ec2-13-201-55-118.ap-south-1.compute.amazonaws.com';
        const headers = buildFrontendSecurityHeaders(stagingOrigin);
        const csp = headers[0].headers.find(({ key }) => key === 'Content-Security-Policy')?.value || '';
        const stagingSocketOrigin = stagingOrigin.replace(/^http:/, 'ws:');

        expect(csp).toContain(stagingOrigin);
        expect(csp).toContain(stagingSocketOrigin);
        expect(csp).not.toContain(DEFAULT_HOSTED_BACKEND_ORIGIN);
    });

    it('emits each Cloudflare Pages security header exactly once across matching blocks', async () => {
        // Cloudflare Pages appends values from every matching `_headers` block
        // instead of letting the most specific block win. `/*`, `/`, and
        // `/index.html` all match a document request, so repeating the full
        // security set on each one concatenates the ~3 KB CSP past Cloudflare's
        // header limit and Cloudflare drops Content-Security-Policy entirely.
        // That regression shipped silently: the lane fell back to the weaker
        // meta CSP with no failing check.
        const contents = await readFile(path.join(repoRoot, 'cloudflare', '_headers'), 'utf8');
        const blocks = parseCloudflareHeaderBlocks(contents);
        const occurrences = new Map();

        for (const block of blocks) {
            for (const { key } of block.headers) {
                occurrences.set(key, (occurrences.get(key) || 0) + 1);
            }
        }

        expect(blocks.length).toBeGreaterThan(0);
        expect(blocks.map(({ path }) => path)).toContain('/*');

        for (const [key, count] of occurrences) {
            // Cache-Control is the one header that is intentionally repeated —
            // it carries the per-tier cache policy. Every other (security)
            // header must appear exactly once, on `/*`.
            expect({ key, count }).toEqual({ key, count: key === 'Cache-Control' ? 4 : 1 });
        }

        const rootBlock = blocks.find(({ path }) => path === '/*');

        expect(rootBlock.headers.length).toBeGreaterThan(0);
        expect(rootBlock.headers.map(({ key }) => key)).toContain('Content-Security-Policy');

        for (const block of blocks.filter(({ path }) => path !== '/*')) {
            for (const { key } of block.headers) {
                expect(key).toBe('Cache-Control');
            }
        }
    });

    it('keeps the Cloudflare Pages cache tiers intact after splitting header blocks', () => {
        const blocks = parseCloudflareHeaderBlocks(buildCloudflarePagesHeaders(DEFAULT_HOSTED_BACKEND_ORIGIN));
        const cacheControlFor = (blockPath) => blocks
            .find(({ path }) => path === blockPath)
            ?.headers
            ?.find(({ key }) => key === 'Cache-Control')
            ?.value;

        expect(cacheControlFor('/assets/*')).toBe(FRONTEND_ASSET_CACHE_CONTROL);
        expect(cacheControlFor('/sw.js')).toBe(FRONTEND_SERVICE_WORKER_CACHE_CONTROL);
        expect(cacheControlFor('/')).toBe(FRONTEND_DOCUMENT_CACHE_CONTROL);
        expect(cacheControlFor('/index.html')).toBe(FRONTEND_DOCUMENT_CACHE_CONTROL);
    });

    it('keeps browser cache recovery headers aligned for Vercel deployments', () => {
        const headers = buildFrontendSecurityHeaders(DEFAULT_HOSTED_BACKEND_ORIGIN);
        const cacheControlFor = (source) => headers
            .find((entry) => entry.source === source)
            ?.headers
            ?.find((header) => header.key === 'Cache-Control')
            ?.value;

        expect(cacheControlFor('/assets/:path*')).toBe(FRONTEND_ASSET_CACHE_CONTROL);
        expect(cacheControlFor('/sw.js')).toBe(FRONTEND_SERVICE_WORKER_CACHE_CONTROL);
        expect(cacheControlFor('/')).toBe(FRONTEND_DOCUMENT_CACHE_CONTROL);
        expect(cacheControlFor('/index.html')).toBe(FRONTEND_DOCUMENT_CACHE_CONTROL);
    });

    it('does not allow stale backend origins back into committed proxy routes', async () => {
        const [rootConfig, appConfig] = await Promise.all([
            readJson(path.join(repoRoot, 'vercel.json')),
            readJson(path.join(appRoot, 'vercel.json')),
        ]);
        const netlifyRedirects = await readNetlifyRedirects();
        const staleOriginPattern = /(aura-msi-api-ca\.wittycliff-f743de69\.southeastasia\.azurecontainerapps\.io|3\.109\.181\.238|13\.206\.172\.186|sslip\.io)/;
        const configs = [rootConfig, appConfig];

        for (const config of configs) {
            const proxyDestinations = (config.rewrites || [])
                .map((entry) => entry.destination)
                .filter((destination) => destination !== '/index.html');

            expect(proxyDestinations.length).toBeGreaterThan(0);

            for (const destination of proxyDestinations) {
                expect(destination.startsWith(DEFAULT_HOSTED_BACKEND_ORIGIN)).toBe(true);
                expect(destination).not.toMatch(staleOriginPattern);
            }
        }

        for (const { to } of netlifyRedirects.filter(({ from }) => from !== '/*')) {
            expect(to.startsWith(DEFAULT_HOSTED_BACKEND_ORIGIN)).toBe(true);
            expect(to).not.toMatch(staleOriginPattern);
        }
    });

    it('keeps the deploy workflow aligned to the shared hosted backend origin contract', async () => {
        const workflow = await readFile(deployWorkflowPath, 'utf8');

        expect(workflow).toContain('node ./app/scripts/print_hosted_backend_origin.mjs');
        expect(workflow).not.toContain('AWS_BACKEND_BASE_URL: http');
        expect(workflow).not.toMatch(/^https:\/\/aura-msi-api-ca\.wittycliff-f743de69\.southeastasia\.azurecontainerapps\.io(?:[/?#]|$)/m);
    });
});
