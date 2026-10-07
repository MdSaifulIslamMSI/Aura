import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectSourceMaps, pruneSourceMaps } from '../../scripts/lib/prune-sourcemaps.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = path.resolve(appRoot, '..');

const buildFixtureTree = async (root) => {
    await mkdir(path.join(root, 'assets'), { recursive: true });
    await mkdir(path.join(root, 'nested', 'deep'), { recursive: true });
    await writeFile(path.join(root, 'index.html'), '<!doctype html><title>aura</title>');
    await writeFile(path.join(root, 'index.js'), 'console.log(1);');
    await writeFile(path.join(root, 'index.js.map'), '{"version":3,"x":"aaaaaaaaaaaaaaaaaaaa"}');
    await writeFile(path.join(root, 'assets', 'app.js'), 'export default 1;');
    await writeFile(path.join(root, 'assets', 'app.js.map'), '{"version":3,"y":"bbbbbbbbbbbbbbbbbbbbbb"}');
    await writeFile(path.join(root, 'nested', 'deep', 'chunk.js.map'), '{"version":3,"z":"cccccccccccccccccccc"}');
    // Not a sourcemap; must survive.
    await writeFile(path.join(root, 'nested', 'map-notes.txt'), 'keep me');
};

describe('pruneSourceMaps', () => {
    it('removes every sourcemap and reports reclaimed bytes', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'aura-sourcemaps-'));

        try {
            await buildFixtureTree(root);
            const before = await collectSourceMaps(root);
            expect(before).toHaveLength(3);

            const result = await pruneSourceMaps(root);

            expect(result.count).toBe(3);
            expect(result.bytes).toBeGreaterThan(0);
            expect(await collectSourceMaps(root)).toEqual([]);
            // Real assets and lookalike filenames are untouched.
            expect(await readFile(path.join(root, 'index.html'), 'utf8')).toContain('aura');
            expect(await readFile(path.join(root, 'assets', 'app.js'), 'utf8')).toBe('export default 1;');
            expect(await readFile(path.join(root, 'nested', 'map-notes.txt'), 'utf8')).toBe('keep me');
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('is a no-op on a tree without sourcemaps', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'aura-sourcemaps-clean-'));

        try {
            await mkdir(path.join(root, 'assets'), { recursive: true });
            await writeFile(path.join(root, 'index.html'), '<!doctype html>');
            await writeFile(path.join(root, 'assets', 'app.js'), 'export default 1;');

            expect(await pruneSourceMaps(root)).toEqual({ bytes: 0, count: 0 });
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });
});

describe('Vercel static output packaging', () => {
    it('keeps app/dist sourcemaps out of the deploy payload', async () => {
        const script = await readFile(
            path.join(appRoot, 'scripts', 'create_vercel_static_output.mjs'),
            'utf8'
        );

        // The packaging script must prune after copying, and must assert the
        // result so a regression fails the deploy rather than silently
        // re-inflating every retained deployment.
        expect(script).toContain('pruneSourceMaps(outputDirectory)');
        expect(script).toContain('await collectSourceMaps(outputDirectory)');
        expect(script.indexOf('await cp(distDirectory, staticDirectory'))
            .toBeLessThan(script.indexOf('pruneSourceMaps(outputDirectory)'));
    });
});