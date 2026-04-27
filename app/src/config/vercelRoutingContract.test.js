import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    buildHostedBackendRewrites,
    buildNetlifyHostedBackendRedirects,
    HOSTED_BACKEND_ORIGIN,
} from '../../config/vercelRoutingContract.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDirectory, '..', '..');
const repoRoot = path.resolve(appRoot, '..');
const deployWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'deploy-backend-aws.yml');
const netlifyConfigPath = path.join(repoRoot, 'netlify.toml');

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
        const expectedRewrites = buildHostedBackendRewrites(HOSTED_BACKEND_ORIGIN);
        const [rootConfig, appConfig] = await Promise.all([
            readJson(path.join(repoRoot, 'vercel.json')),
            readJson(path.join(appRoot, 'vercel.json')),
        ]);

        expect(rootConfig.rewrites).toEqual(expectedRewrites);
        expect(appConfig.rewrites).toEqual(expectedRewrites);
    });

    it('keeps Netlify proxy redirects aligned to the hosted backend origin', async () => {
        const redirects = await readNetlifyRedirects();
        const expectedRedirects = buildNetlifyHostedBackendRedirects(HOSTED_BACKEND_ORIGIN);

        for (const expectedRedirect of expectedRedirects) {
            expect(redirects).toContainEqual(expectedRedirect);
        }
    });

    it('does not allow stale backend origins back into committed proxy routes', async () => {
        const [rootConfig, appConfig] = await Promise.all([
            readJson(path.join(repoRoot, 'vercel.json')),
            readJson(path.join(appRoot, 'vercel.json')),
        ]);
        const netlifyRedirects = await readNetlifyRedirects();
        const staleOriginPattern = /(aura-msi-api-ca\.wittycliff-f743de69\.southeastasia\.azurecontainerapps\.io|3\.109\.181\.238)/;
        const configs = [rootConfig, appConfig];

        for (const config of configs) {
            const proxyDestinations = (config.rewrites || [])
                .map((entry) => entry.destination)
                .filter((destination) => destination !== '/index.html');

            expect(proxyDestinations.length).toBeGreaterThan(0);

            for (const destination of proxyDestinations) {
                expect(destination.startsWith(HOSTED_BACKEND_ORIGIN)).toBe(true);
                expect(destination).not.toMatch(staleOriginPattern);
            }
        }

        for (const { to } of netlifyRedirects.filter(({ from }) => from !== '/*')) {
            expect(to.startsWith(HOSTED_BACKEND_ORIGIN)).toBe(true);
            expect(to).not.toMatch(staleOriginPattern);
        }
    });

    it('keeps the deploy workflow aligned to the shared hosted backend origin contract', async () => {
        const workflow = await readFile(deployWorkflowPath, 'utf8');

        expect(workflow).toContain('node ./app/scripts/print_hosted_backend_origin.mjs');
        expect(workflow).not.toContain('AWS_BACKEND_BASE_URL: http');
        expect(workflow).not.toMatch(/aura-msi-api-ca\.wittycliff-f743de69\.southeastasia\.azurecontainerapps\.io/);
    });
});
