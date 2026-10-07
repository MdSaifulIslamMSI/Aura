import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This file lives at app/src/config, so the repo root is three levels up.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const readRepoFile = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');

const prunesVercelDeployments = async (workflowPath) => {
    const source = await readRepoFile(workflowPath);
    return /api\.vercel\.com\/v13\/deployments\/\$\{DEPLOYMENT_ID\}/.test(source)
        && /DELETE/.test(source);
};

describe('Vercel Deployment Storage', () => {
    it('prunes the storefront preview only after its last consumer', async () => {
        const source = await readRepoFile('.github/workflows/deploy-netlify.yml');

        // verify-preview-coherence is the final job that reads the preview, so
        // cleanup must wait for it or the release evidence loses its subject.
        const cleanup = source.slice(source.indexOf('  cleanup-vercel-preview:'));
        expect(cleanup).toBeTruthy();
        expect(cleanup).toContain('verify-preview-coherence');
        expect(cleanup).toContain('always()');

        // Deleting before the coherence check would break release evidence.
        expect(cleanup.indexOf('verify-preview-coherence'))
            .toBeLessThan(cleanup.indexOf('Delete the ephemeral Vercel preview deployment'));
    });

    it('never deletes a deployment that holds a production alias', async () => {
        for (const workflowPath of [
            '.github/workflows/deploy-netlify.yml',
            '.github/workflows/deploy-gateway-vercel.yml',
        ]) {
            const source = await readRepoFile(workflowPath);
            expect(source, workflowPath).toContain('/v4/aliases/');
            expect(source, workflowPath).toContain('refusing to delete');
            // Fail closed on anything that is not a plain deployment id.
            expect(source, workflowPath).toContain('dpl_*)');
        }
    });

    it('deletes previews through the API in both deploy workflows', async () => {
        expect(await prunesVercelDeployments('.github/workflows/deploy-netlify.yml')).toBe(true);
        expect(await prunesVercelDeployments('.github/workflows/deploy-gateway-vercel.yml')).toBe(true);
    });

    it('keeps gateway production deploys out of the cleanup path', async () => {
        const source = await readRepoFile('.github/workflows/deploy-gateway-vercel.yml');
        const productionJob = source.slice(source.indexOf('  deploy-production:'));
        // The cleanup step belongs to deploy-preview only.
        expect(productionJob).not.toContain('Delete the ephemeral gateway preview deployment');
    });

    it('requires an explicit confirmation before the prune script deletes', async () => {
        const source = await readRepoFile('scripts/vercel/prune-deployments.mjs');

        // Dry run is the default; deletion needs both flags.
        expect(source).toContain('const dryRun = !flag(\'apply\')');
        expect(source).toContain('confirm !== \'prune\'');
        // Production and alias-holding deployments are excluded from candidates.
        expect(source).toContain("deployment.target === 'production'");
        expect(source).toContain('!protectedIds.has(deployment.uid)');
    });

    it('reports rather than deletes on the scheduled run', async () => {
        const source = await readRepoFile('.github/workflows/vercel-storage-prune.yml');

        expect(source).toContain('schedule:');
        expect(source).toContain('cron:');
        // Deletion is gated behind the explicit dispatch input.
        expect(source).toContain('if [ "${APPLY}" = "true" ]');
    });

    it('excludes sourcemaps from the deploy payload but keeps them for Sentry', async () => {
        const packaging = await readRepoFile('app/scripts/create_vercel_static_output.mjs');
        const vite = await readRepoFile('app/vite.config.js');

        // Vite still emits maps so the Sentry release step can upload them.
        expect(vite).toContain('sourcemap: true');
        // ...but they never enter the Vercel payload.
        expect(packaging).toContain('pruneSourceMaps(outputDirectory)');
        expect(packaging).toContain('Vercel output still contains');
    });

    it('mirror-checks the Vercel payload against dist while excluding sourcemaps', async () => {
        const source = await readRepoFile('.github/workflows/deploy-netlify.yml');
        const step = source.slice(source.indexOf('Verify Vercel output mirrors shared artifact'));

        // A plain `diff -qr app/dist .vercel/output/static` fails the moment the
        // deploy copy is pruned, so the gate must exclude maps...
        expect(step).toContain("diff -qr -x '*.map' app/dist .vercel/output/static");
        // ...and still fail if any map reaches the payload.
        expect(step).toContain("find .vercel/output -name '*.map'");
    });
});