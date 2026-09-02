#!/usr/bin/env node
'use strict';

/**
 * Test gap analysis — lists source modules with no test references.
 *
 * Server: every file under controllers/, services/, middleware/, utils/,
 * config/ is checked for a require/import reference inside server/tests/.
 * App: every .jsx/.js source file under src/ is checked for a co-located
 * or same-basename test file.
 *
 * Usage: node scripts/test-gaps.cjs [limit]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const limit = Number(process.argv[2]) || 25;

const walk = (dir, exts, out = []) => {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, exts, out);
        else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
    }
    return out;
};

// ---------- Server ----------
const serverDir = path.join(ROOT, 'server');
const testsDir = path.join(serverDir, 'tests');
const serverTests = walk(testsDir, ['.test.js']);
const serverTestsBlob = serverTests.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

const serverSurfaces = ['controllers', 'services', 'middleware', 'utils', 'config'];
const serverGaps = [];
for (const surface of serverSurfaces) {
    const files = walk(path.join(serverDir, surface), ['.js']).filter((f) => !f.endsWith('.test.js'));
    for (const file of files) {
        const base = path.basename(file, '.js');
        if (serverTestsBlob.includes(base)) continue;
        serverGaps.push({ surface, rel: path.relative(serverDir, file).replace(/\\/g, '/') });
    }
}

// ---------- App ----------
const appSrc = path.join(ROOT, 'app', 'src');
const appFiles = walk(appSrc, ['.jsx', '.js']).filter((f) => !/\.test\.|\.config\.|src\/(setupTests|main)\./.test(f) && !f.includes('i18n/messages'));
const appGaps = [];
for (const file of appFiles) {
    const dir = path.dirname(file);
    const base = path.basename(file, path.extname(file));
    const hasCoLocated = fs.existsSync(path.join(dir, `${base}.test.js`))
        || fs.existsSync(path.join(dir, `${base}.test.jsx`));
    if (!hasCoLocated) appGaps.push({ rel: path.relative(appSrc, file).replace(/\\/g, '/') });
}

const groupBy = (arr, key) => {
    const m = {};
    for (const item of arr) {
        const k = typeof key === 'function' ? key(item) : item[key];
        (m[k] = m[k] || []).push(item);
    }
    return m;
};

console.log(`=== SERVER: ${serverGaps.length} modules with zero test references ===`);
const bySurface = groupBy(serverGaps, 'surface');
for (const [surface, items] of Object.entries(bySurface)) {
    console.log(`\n[${surface}] ${items.length}`);
    items.slice(0, limit).forEach((i) => console.log(`  ${i.rel}`));
}

console.log(`\n=== APP: ${appGaps.length} source files without a co-located test ===`);
const byTop = groupBy(appGaps, (i) => i.rel.split('/')[0] + '/' + (i.rel.split('/')[1] || ''));
for (const [group, items] of Object.entries(byTop).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`[${group}] ${items.length}`);
    items.slice(0, Math.min(limit, 8)).forEach((i) => console.log(`  ${i.rel}`));
}
