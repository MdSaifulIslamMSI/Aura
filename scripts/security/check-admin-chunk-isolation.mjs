#!/usr/bin/env node
// Phase 6 (P0/P1): admin chunk isolation guard. Runs against app/dist after a
// frontend build and asserts that no admin-* chunk is transitively reachable
// from the public entry (index.html), so unauthenticated visitors never
// download admin application code. Fails the build otherwise.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '..', '..');
const distDir = path.join(repoDir, 'app', 'dist');

const fail = (message) => {
    console.error(`[admin-chunk-isolation] ${message}`);
    process.exit(1);
};

const indexPath = path.join(distDir, 'index.html');
const manifestPath = path.join(distDir, 'manifest.json');

if (!fs.existsSync(indexPath)) {
    fail(`app/dist/index.html not found — run "npm --prefix app run build" before this check.`);
}

const html = fs.readFileSync(indexPath, 'utf8');

// 1. The public shell must not reference admin chunks directly.
const htmlAssetRefs = [...html.matchAll(/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g)].map((m) => m[0]);
const htmlAdminRefs = htmlAssetRefs.filter((ref) => /(^|\/)admin-/.test(ref));
if (htmlAdminRefs.length > 0) {
    fail(`public index.html references admin chunks: ${htmlAdminRefs.join(', ')}`);
}

// 2. When a Vite/Rolldown manifest is emitted, walk the import graph from the
// entry chunks and assert no admin chunk is transitively reachable.
let adminReachable = [];
if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const keyByFile = {};
    const adminKeys = [];
    for (const [key, value] of Object.entries(manifest)) {
        if (value.file) keyByFile[value.file] = key;
        if (/\/pages\/Admin\//.test(key) || String(value.name || '').startsWith('admin-')) {
            adminKeys.push(key);
        }
    }

    const reachable = new Set();
    const queue = entryFiles(html)
        .map((file) => keyByFile[file])
        .filter(Boolean);
    while (queue.length) {
        const key = queue.shift();
        if (!key || reachable.has(key)) continue;
        reachable.add(key);
        for (const dep of manifest[key].imports || []) queue.push(dep);
        for (const dep of manifest[key].dynamicImports || []) queue.push(dep);
    }

    adminReachable = adminKeys.filter((key) => reachable.has(key));
    if (adminReachable.length > 0) {
        for (const key of adminReachable) {
            const importers = Object.entries(manifest)
                .filter(([, value]) => (value.imports || []).includes(key) || (value.dynamicImports || []).includes(key))
                .map(([k]) => k)
                .filter((k) => !k.includes('/pages/Admin/'));
            console.error(`  reachable admin chunk: ${manifest[key].name || key} via ${importers.join(', ') || 'entry'}`);
        }
        fail(`admin chunks are transitively reachable from the public shell (${adminReachable.length}).`);
    }
}

console.log('[admin-chunk-isolation] OK — public shell references no admin chunks.');
if (htmlAdminRefs.length === 0 && adminReachable.length === 0) {
    process.exit(0);
}

function entryFiles(htmlSource) {
    return [...htmlSource.matchAll(/assets\/[A-Za-z0-9._-]+\.js/g)]
        .map((match) => match[0]);
}
