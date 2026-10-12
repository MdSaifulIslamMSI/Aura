#!/usr/bin/env node
// Remove .map files from the build output.
//
// Sourcemaps are always emitted by the Vite build (see vite.config.js): the
// sourceMappingURL comment must stay in the JS/CSS so every build of a commit
// is byte-identical — Render, Railway and Vercel build from source and the
// cross-lane coherence gate compares content-hashed asset filenames.
//
// The .map FILES are the leak: unminified source (route names, API paths,
// business logic) is publicly downloadable otherwise, and no host config
// blocks /assets/*.map. This script runs as `postbuild` for every build
// EXCEPT the Sentry release pipeline (AURA_KEEP_SOURCEMAPS=true), which keeps
// the maps for the upload — the CI deploy strip step removes them from that
// build's payload before publish.
//
// The flag is deliberately NOT VITE_-prefixed: Vite inlines every VITE_* var
// into import.meta.env (referenced or not), so a CI-only VITE_BUILD_SOURCEMAP
// would change the bundle bytes themselves and the shared artifact could
// never byte-match the render/railway/vercel source builds.
//
// Deletion happens here, after the build, and never inside the Vite build:
// chunk filenames are content hashes that include the map, so removing maps
// before the hashes finalize renames the JS/CSS and breaks the byte-parity
// this exists to protect.
//
// To keep maps in a local build for debugging, run:
//   AURA_KEEP_SOURCEMAPS=true npm run build
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const distDir = process.argv[2] || join(process.cwd(), 'dist');

if (String(process.env.AURA_KEEP_SOURCEMAPS || '').trim().toLowerCase() === 'true') {
    console.log('[strip-deploy-sourcemaps] AURA_KEEP_SOURCEMAPS=true: keeping .map files for the Sentry upload.');
    process.exit(0);
}

let removed = 0;

async function walk(dir) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return; // no dist yet — nothing to strip
    }
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            await walk(full);
        } else if (entry.name.endsWith('.map')) {
            await rm(full, { force: true });
            removed += 1;
        }
    }
}

await walk(distDir);

if (removed > 0) {
    console.log(`[strip-deploy-sourcemaps] removed ${removed} .map file(s) from ${distDir}.`);
} else {
    console.log(`[strip-deploy-sourcemaps] no .map files found in ${distDir}.`);
}
