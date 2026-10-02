#!/usr/bin/env node
// Prune build artifacts that must never ride inside a mobile shell.
//
// `cap sync` copies app/dist wholesale into the native assets directories.
// The web build keeps sourcemaps in dist on purpose — Sentry symbolication
// uploads them from there (student-pack-sentry-release.mjs) — but shipping
// them inside the APK/IPA is pure weight: 35MB across 122 maps on the
// 2026-10-02 shell, which alone pushed the Android release past its size
// budget. Native bundles never fetch .map files; devtools on a release
// build is the only consumer, and it is not one.
//
// Run after `cap sync` in the mobile:sync:* scripts. Idempotent.

import { readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const SHELL_ASSETS_DIRS = [
    join(appRoot, 'android', 'app', 'src', 'main', 'assets', 'public'),
    join(appRoot, 'ios', 'App', 'App', 'public'),
];

const PRUNED_EXTENSIONS = new Set(['.map']);

function prune(dir) {
    let files = 0;
    let bytes = 0;
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        // Sync target not generated (e.g. iOS shell absent) — nothing to prune.
        return { files, bytes };
    }
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            const nested = prune(full);
            files += nested.files;
            bytes += nested.bytes;
            continue;
        }
        const ext = entry.name.slice(entry.name.lastIndexOf('.'));
        if (PRUNED_EXTENSIONS.has(ext)) {
            bytes += statSync(full).size;
            files += 1;
            rmSync(full);
        }
    }
    return { files, bytes };
}

let totalFiles = 0;
let totalBytes = 0;
for (const dir of SHELL_ASSETS_DIRS) {
    const { files, bytes } = prune(dir);
    totalFiles += files;
    totalBytes += bytes;
}

const mb = (totalBytes / (1024 * 1024)).toFixed(1);
console.log(`[prune-mobile-shell] removed ${totalFiles} map file(s), ${mb} MB freed from native shell assets.`);
if (totalFiles === 0) {
    console.log('[prune-mobile-shell] nothing to prune (already clean).');
}
