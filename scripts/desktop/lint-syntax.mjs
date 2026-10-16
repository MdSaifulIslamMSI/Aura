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
 * Why it also *rejects* files it cannot parse: this gate used to collect
 * `**\/*.cjs` and ignore everything else, so adding a `.ts` or `.mjs` desktop
 * module silently removed it from the syntax floor AND from knip's project glob
 * (`desktop/**\/*.{js,cjs}`). The shell would then lose coverage with every gate
 * still reporting green. A gate that cannot check a file must say so, so an
 * unhandled JS extension fails here by name until someone decides how to check
 * it.
 *
 * Usage: npm run lint:desktop
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// AURA_DESKTOP_LINT_ROOT exists so scripts/desktop/lint-syntax.test.mjs can run
// this gate against a synthetic fixture tree and assert that it FAILS on inputs
// it is supposed to reject. Without it this gate had no test proving it could
// fail at all — it only ever demonstrated that it passed, which is how three
// sibling gates ended up silently skipping whole file extensions.
const desktopDir = process.env.AURA_DESKTOP_LINT_ROOT
    ? path.resolve(process.env.AURA_DESKTOP_LINT_ROOT)
    : path.join(repoRoot, 'desktop');

// Extensions `node --check` can parse as CommonJS script grammar. Note this is
// why the gate cannot just widen: `--check` rejects a `.mjs` that uses ESM
// syntax, and a `.ts` outright, so "parse everything" is not available.
const PARSED_EXTENSIONS = new Set(['.cjs']);

// The JS family this gate does NOT cover. Derived from the full set so adding a
// language here is one edit, and filtering keeps `.cjs` out so a parsed file is
// never also reported as unhandled.
const JS_FAMILY_EXTENSIONS = [
    '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
];
const UNHANDLED_SOURCE_EXTENSIONS = new Set(
    JS_FAMILY_EXTENSIONS.filter((extension) => !PARSED_EXTENSIONS.has(extension))
);

// Non-source files (images, fixtures) are irrelevant to a syntax floor and are
// skipped by extension rather than by directory, so a stray .ts inside assets/
// is still caught.
const collectModules = (dir) => {
    const parsed = [];
    const unhandled = [];
    if (!fs.existsSync(dir)) return { parsed, unhandled };

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const nested = collectModules(full);
            parsed.push(...nested.parsed);
            unhandled.push(...nested.unhandled);
            continue;
        }

        const extension = path.extname(entry.name).toLowerCase();
        if (PARSED_EXTENSIONS.has(extension)) {
            parsed.push(full);
        } else if (UNHANDLED_SOURCE_EXTENSIONS.has(extension)) {
            unhandled.push(full);
        }
    }

    return { parsed: parsed.sort(), unhandled: unhandled.sort() };
};

const { parsed: modules, unhandled: unhandledModules } = collectModules(desktopDir);

if (unhandledModules.length > 0) {
    // Reported before the parse loop and independently of it: an unhandled file
    // is a coverage hole even when every parseable module is fine, so folding
    // this into `failures` would let it hide behind a parse count.
    console.error(
        `[desktop-lint] ${unhandledModules.length} desktop file(s) use an extension this gate cannot parse.`
        + ' They are excluded from the syntax floor and from knip, so nothing is checking them:\n'
    );
    for (const file of unhandledModules) {
        console.error(`  ${path.relative(repoRoot, file)}\n`);
    }
    console.error(
        'Either convert them to .cjs, or extend this gate with a real check for that'
        + ' extension before committing. Do not delete this file to make the gate green.'
    );
    process.exit(1);
}

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