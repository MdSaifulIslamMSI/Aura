#!/usr/bin/env node
'use strict';

/**
 * Test inventory — counts test suites per surface and writes reports/test-inventory.json.
 * Usage: npm run test:inventory
 */
const fs = await import('node:fs');
const path = await import('node:path');
const { fileURLToPath } = await import('node:url');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SURFACES = [
    { name: 'app-unit', dir: path.join(ROOT, 'app', 'src'), match: /\.test\.(js|jsx|ts|tsx)$/ },
    { name: 'app-e2e', dir: path.join(ROOT, 'app', 'e2e'), match: /(\.spec|\.test)\.(js|jsx|ts|tsx)$/ },
    { name: 'server', dir: path.join(ROOT, 'server', 'tests'), match: /\.test\.js$/ },
    { name: 'root-tests', dir: path.join(ROOT, 'tests'), match: /\.test\.js$/ },
];

const walk = (dir, regex) => {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...walk(full, regex));
        } else if (regex.test(entry.name)) {
            out.push(path.relative(ROOT, full).replace(/\\/g, '/'));
        }
    }
    return out;
};

const surfaces = SURFACES.map(({ name, dir, match }) => {
    const files = walk(dir, match).sort();
    return { name, count: files.length, files };
});

const report = {
    generatedAt: new Date().toISOString(),
    total: surfaces.reduce((sum, s) => sum + s.count, 0),
    surfaces: surfaces.map(({ name, count }) => ({ name, count })),
};

const reportsDir = path.join(ROOT, 'reports');
fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(
    path.join(reportsDir, 'test-inventory.json'),
    JSON.stringify({ ...report, surfaces }, null, 2)
);

for (const { name, count } of report.surfaces) {
    console.log(`${name.padEnd(12)} ${count}`);
}
console.log(`${'TOTAL'.padEnd(12)} ${report.total}`);
console.log(`Written: reports/test-inventory.json`);
