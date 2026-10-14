#!/usr/bin/env node
// Phase 6 (P0/P1): built-artifact security posture guard. Runs after the
// frontend and desktop builds and asserts that the SHIPPED artifacts keep the
// Electron hardening that source review cannot guarantee once code is packaged.
//
// Source-level scanners prove what the repository contains. They say nothing
// about what was actually packed into app.asar, so a desktop build produced
// from a different branch, a stale cache, or a bad merge can ship a weaker
// BrowserWindow than the source implies. This check reads desktop/main.cjs and
// desktop/preload.cjs back out of the built .asar and fails the build on:
//
//   1. webPreferences that disable the renderer sandbox (contextIsolation
//      disabled, nodeIntegration enabled, or sandbox disabled).
//   2. Any ipcMain.handle() channel that does not validate its sender before
//      doing work, which is the control that blocks a hostile or navigated-away
//      renderer from driving privileged main-process handlers.
//   3. A contextBridge surface that grows beyond the members this guard
//      approves, since every addition widens what any renderer XSS can reach.
//   4. Source maps shipped in the frontend build.
//
// Fails the build otherwise. Skips with a notice when the desktop bundle has
// not been built, so it is safe to run in a web-only pipeline. Pass
// --require-desktop in a full pipeline so a skipped desktop build fails the
// gate instead of quietly skipping every Electron assertion.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '..', '..');

const ASAR_CANDIDATES = [
    path.join(repoDir, 'desktop-release', 'linux-unpacked', 'resources', 'app.asar'),
    path.join(repoDir, 'desktop-release', 'mac', 'Aura.app', 'Contents', 'Resources', 'app.asar'),
    path.join(repoDir, 'desktop-release', 'win-unpacked', 'resources', 'app.asar'),
];

// Approved contextBridge members for window.auraDesktop. Extend this list
// deliberately in review; anything new is a renderer-reachable capability.
const APPROVED_BRIDGE_MEMBERS = [
    'cancelBrowserSignIn',
    'checkForUpdates',
    'consumeBrowserSignIn',
    'fetchPublicCatalog',
    'getAppInfo',
    'installUpdateNow',
    'isDesktop',
    'onBrowserSignInStatus',
    'onUpdateStatus',
    'readSecureStorage',
    'reopenBrowserSignIn',
    'signInWithOwnerAccess',
    'startBrowserSignIn',
    'writeSecureStorage',
];

// A handler that calls any of these is treated as sender-validated. Matching
// is intentionally fuzzy so renaming the helper does not silently drop the
// guard to zero.
const SENDER_VALIDATION_MARKERS = [
    'TrustedDesktopIpcSender',
    'validateSender',
    'assertTrusted',
    'isTrusted',
];

const REQUIRED_WEB_PREFERENCES = [
    { name: 'contextIsolation', expected: true },
    { name: 'nodeIntegration', expected: false },
    { name: 'sandbox', expected: true },
];

const problems = [];
const notices = [];

const fail = (message) => problems.push(message);

// @electron/asar throws when the logical path is absent rather than returning
// null, so every caller below relies on this wrapper to turn a missing file into
// a clean "not present" result. Without the catch a missing module crashes the
// guard with an unhandled exception instead of reporting a problem.
const readFromAsar = (asar, logicalPath) => {
    try {
        const buffer = require('@electron/asar').extractFile(asar, logicalPath);
        return buffer ? buffer.toString('utf8') : null;
    } catch {
        return null;
    }
};

// Overrides exist so the regression tests can point this guard at a mutated
// fixture archive, and so a platform-specific bundle layout can be gated
// without editing this file.
const resolveAsar = () => {
    const override = process.env.ARTIFACT_POSTURE_ASAR;
    if (override) return fs.existsSync(override) ? override : null;
    return ASAR_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || null;
};

const resolveDistDir = () => process.env.ARTIFACT_POSTURE_DIST
    || path.join(repoDir, 'app', 'dist');

// --require-desktop turns a missing desktop artifact into a failure instead of
// a notice. Without it a pipeline that silently skips the desktop build would
// also silently skip every Electron assertion in this guard.
const requireDesktop = process.argv.includes('--require-desktop');

// d888af79 extracted the BrowserWindow hardening out of main.cjs into a
// factory in windowChrome.cjs, so the literal keys stopped appearing in the
// packaged main process. Reading main.cjs alone made a correctly hardened
// artifact look unhardened. Resolve the factory the main process actually
// delegates to, and read the hardening from there. An unresolvable delegation
// still fails: the guard must never pass because it could not check.
const resolveWebPreferencesSource = (asar, mainSource) => {
    const declaresInline = REQUIRED_WEB_PREFERENCES.every(
        ({ name }) => new RegExp(`${name}\\s*:\\s*(true|false)`).test(mainSource),
    );
    if (declaresInline) return { source: mainSource, origin: 'desktop/main.cjs' };

    // webPreferences: someFactory({ ... })
    const factoryMatch = mainSource.match(/webPreferences\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
    if (!factoryMatch) return null;
    const factory = factoryMatch[1];

    // Find the require() that binds that factory, so the helper is located by
    // what main.cjs imports rather than by a hardcoded filename.
    for (const [, names, modulePath] of mainSource.matchAll(
        /const\s*\{([^}]*)\}\s*=\s*require\(\s*['"`](\.[^'"`]+)['"`]\s*\)/g,
    )) {
        if (!names.split(',').some((entry) => entry.trim() === factory)) continue;
        const logicalPath = path.posix.join('desktop', modulePath.replace(/^\.\//, ''));
        const helperSource = readFromAsar(asar, logicalPath);
        if (!helperSource) return null;
        return { source: helperSource, origin: logicalPath, factory };
    }

    return null;
};

// 1. BrowserWindow hardening, read from the packaged main process.
const checkWebPreferences = (asar, mainSource) => {
    const resolved = resolveWebPreferencesSource(asar, mainSource);
    if (!resolved) {
        fail('packaged desktop/main.cjs declares no inline webPreferences and the BrowserWindow factory it delegates to could not be resolved from the artifact; renderer hardening cannot be verified.');
        return;
    }

    for (const { name, expected } of REQUIRED_WEB_PREFERENCES) {
        const pattern = new RegExp(`${name}\\s*:\\s*(true|false)`);
        const match = resolved.source.match(pattern);
        if (!match) {
            fail(`${resolved.origin} declares no explicit webPreferences.${name}; the packaged renderer hardening cannot be verified.`);
            continue;
        }
        const actual = match[1] === 'true';
        if (actual !== expected) {
            fail(`webPreferences.${name} is ${actual} in ${resolved.origin}; expected ${expected}.`);
        }
    }

    if (resolved.origin !== 'desktop/main.cjs') {
        notices.push(`webPreferences resolved through ${resolved.factory}() in ${resolved.origin}.`);
    }
};

// 2. Every ipcMain.handle() channel must validate its sender.
const checkSenderValidation = (source) => {
    const segments = source.split('ipcMain.handle(').slice(1);
    if (segments.length === 0) {
        notices.push('no ipcMain.handle() channels found in the packaged main process.');
        return;
    }
    const unvalidated = [];
    segments.forEach((segment, index) => {
        const channel = (segment.match(/^\s*['"`]([^'"`]+)['"`]/) || [])[1] || `#${index + 1}`;
        if (!SENDER_VALIDATION_MARKERS.some((marker) => segment.includes(marker))) {
            unvalidated.push(channel);
        }
    });
    if (unvalidated.length > 0) {
        fail(`${unvalidated.length} of ${segments.length} ipcMain.handle() channels do not validate their sender: ${unvalidated.join(', ')}`);
    } else {
        notices.push(`${segments.length}/${segments.length} packaged IPC channels validate their sender.`);
    }
};

// 3. The preload contextBridge surface must not grow unreviewed.
const checkBridgeSurface = (source) => {
    const match = source.match(/exposeInMainWorld\(\s*['"`]([^'"`]+)['"`]\s*,\s*\{/);
    if (!match) {
        fail('desktop/preload.cjs exposes no contextBridge API; the packaged renderer surface could not be verified.');
        return;
    }
    const apiName = match[1];
    const body = source.slice(match.index);
    const members = new Set([...body.matchAll(/^\s{4}([A-Za-z_$][A-Za-z0-9_$]*)\s*:/gm)].map((m) => m[1]));
    if (members.size === 0) {
        fail(`contextBridge API "${apiName}" exposes no identifiable members; the packaged renderer surface could not be verified.`);
        return;
    }
    const unapproved = [...members].filter((name) => !APPROVED_BRIDGE_MEMBERS.includes(name)).sort();
    if (unapproved.length > 0) {
        fail(`contextBridge API "${apiName}" exposes unapproved members: ${unapproved.join(', ')}. Add them to APPROVED_BRIDGE_MEMBERS only after review.`);
    } else {
        notices.push(`contextBridge API "${apiName}" exposes ${members.size} approved members.`);
    }
};

// 4. Frontend build must not ship source maps.
const checkSourceMaps = () => {
    const distDir = resolveDistDir();
    if (!fs.existsSync(distDir)) {
        notices.push('app/dist not present; skipping source map check.');
        return;
    }
    const maps = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.map')) maps.push(path.relative(repoDir, full));
        }
    };
    walk(distDir);
    if (maps.length > 0) {
        fail(`frontend build ships ${maps.length} source map(s): ${maps.slice(0, 10).join(', ')}`);
    } else {
        notices.push('frontend build ships no source maps.');
    }
};

const asar = resolveAsar();
if (!asar) {
    const message = 'no packaged desktop app.asar found — run the desktop build to gate the Electron artifact.';
    if (requireDesktop) {
        fail(`${message} --require-desktop is set, so a missing desktop artifact fails this check.`);
    } else {
        notices.push(message);
    }
} else {
    const mainSource = readFromAsar(asar, 'desktop/main.cjs');
    const preloadSource = readFromAsar(asar, 'desktop/preload.cjs');
    if (!mainSource) {
        fail(`packaged ${path.relative(repoDir, asar)} does not contain desktop/main.cjs.`);
    } else {
        checkWebPreferences(asar, mainSource);
        checkSenderValidation(mainSource);
    }
    if (!preloadSource) {
        fail(`packaged ${path.relative(repoDir, asar)} does not contain desktop/preload.cjs.`);
    } else {
        checkBridgeSurface(preloadSource);
    }
    notices.push(`inspected ${path.relative(repoDir, asar)}`);
}

checkSourceMaps();

for (const notice of notices) {
    console.log(`[artifact-posture] ${notice}`);
}

if (problems.length > 0) {
    console.error(`[artifact-posture] FAILED with ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
}

console.log('[artifact-posture] OK — packaged artifacts keep the approved Electron hardening.');
process.exit(0);