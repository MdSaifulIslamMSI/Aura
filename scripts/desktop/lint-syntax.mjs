#!/usr/bin/env node

/**
 * Desktop syntax gate — parses every desktop/ CommonJS module with the Node
 * parser and fails on the first one that does not compile.
 *
 * Scope note, stated plainly so nobody mistakes this for ESLint: `npm run lint`
 * is `npm --prefix app run lint`, so nothing linted desktop/ at all. This is a
 * *syntax* floor, not a style linter — it catches parse errors and nothing
 * else. Adding real ESLint at the repo root is a dependency and config decision
 * (`desktop/` is CommonJS and outside app/'s ESLint project), so it was left for
 * a deliberate call rather than smuggled in here.
 *
 * What it does buy: a broken require() in desktop/ now fails a named command
 * instead of surfacing as an opaque boot crash, and the ~1,800 lines of
 * unlinted shell get a gate that costs no install time.
 *
 * Usage: npm run lint:desktop
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const desktopDir = path.join(repoRoot, 'desktop');

const collectModules = (dir) => {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...collectModules(full));
        } else if (entry.name.endsWith('.cjs')) {
            out.push(full);
        }
    }
    return out.sort();
};

const modules = collectModules(desktopDir);
if (modules.length === 0) {
    console.error('[desktop-lint] No desktop modules found — did desktop/ move?');
    process.exit(1);
}

const failures = [];
for (const file of modules) {
    try {
        execFileSync(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
        const detail = String(error?.stderr || error?.message || '').trim();
        failures.push(`${path.relative(repoRoot, file)}\n${detail}`);
    }
}

if (failures.length > 0) {
    console.error(`[desktop-lint] ${failures.length} of ${modules.length} module(s) failed to parse:\n`);
    for (const failure of failures) {
        console.error(`${failure}\n`);
    }
    process.exit(1);
}

console.log(`[desktop-lint] OK — ${modules.length} desktop modules parse cleanly.`);