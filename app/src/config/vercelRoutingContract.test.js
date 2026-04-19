import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildHostedBackendRewrites, HOSTED_BACKEND_ORIGIN } from '../../config/vercelRoutingContract.mjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDirectory, '..', '..');
const repoRoot = path.resolve(appRoot, '..');
const deployWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'deploy-backend-aws.yml');

const readJson = async (targetPath) => JSON.parse(await readFile(targetPath, 'utf8'));

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

    it('does not allow the legacy EC2 socket or API origin back into committed rewrites', async () => {
        const [rootConfig, appConfig] = await Promise.all([
            readJson(path.join(repoRoot, 'vercel.json')),
            readJson(path.join(appRoot, 'vercel.json')),
        ]);
        const legacyOriginPattern = /3\.109\.181\.238:5000/;
        const configs = [rootConfig, appConfig];

        for (const config of configs) {
            const proxyDestinations = (config.rewrites || [])
                .map((entry) => entry.destination)
                .filter((destination) => destination !== '/index.html');

            expect(proxyDestinations.length).toBeGreaterThan(0);

            for (const destination of proxyDestinations) {
                expect(destination.startsWith(HOSTED_BACKEND_ORIGIN)).toBe(true);
                expect(destination).not.toMatch(legacyOriginPattern);
            }
        }
    });

    it('keeps the deploy workflow aligned to the shared hosted backend origin contract', async () => {
        const workflow = await readFile(deployWorkflowPath, 'utf8');

        expect(workflow).toContain('node ./app/scripts/print_hosted_backend_origin.mjs');
        expect(workflow).not.toMatch(/3\.109\.181\.238:5000/);
        expect(workflow).not.toContain('AWS_BACKEND_BASE_URL: http');
    });
});
