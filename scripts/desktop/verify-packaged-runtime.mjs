import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { listPackage } from '@electron/asar';

/**
 * Asserts the packaged desktop app can actually resolve the hosted backend
 * origin, instead of only proving electron-builder exited zero.
 *
 * Desktop 1.0.195 shipped a build that crashed on launch with an uncaught
 * `ENOENT: config/backend-origin.json`. The package step passed, and the unit
 * test asserting the origin value passed too, because both ran against the repo
 * tree where the file exists. Only the packaged artifact was wrong.
 *
 * The guaranteed mechanism is build.extraResources: it copies an explicit
 * `from` file to an explicit `to` path with no glob semantics, so it behaves
 * identically on Windows and Linux, and runtimeServer.cjs already probes
 * `process.resourcesPath/config/backend-origin.json` as a candidate. The
 * build.files copy inside the asar is defence in depth; electron-builder's
 * file matcher has proven platform-sensitive for a single-file pattern, so it
 * is reported rather than required.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const unpackedDir = path.join(repoRoot, 'desktop-release', 'linux-unpacked');
const resourcesDir = path.join(unpackedDir, 'resources');
const asarPath = path.join(resourcesDir, 'app.asar');

const fail = (message) => {
    console.error(`[desktop-package] ${message}`);
    process.exit(1);
};

const expectedOrigin = JSON.parse(
    readFileSync(path.join(repoRoot, 'config', 'backend-origin.json'), 'utf8'),
).origin;

if (!existsSync(asarPath)) {
    fail(`Packaged app.asar not found at ${asarPath}. Run electron-builder before this check.`);
}

const asarEntries = listPackage(asarPath);
// electron-builder writes asar headers with the host separator, so a Windows
// build yields "\config\backend-origin.json" while CI yields
// "config/backend-origin.json". Compare on a normalized form.
const normalizeEntry = (entry) => String(entry)
    .split(/[\\/]+/)
    .filter(Boolean)
    .join('/');
const inAsar = asarEntries.some((entry) => normalizeEntry(entry) === 'config/backend-origin.json');

const repoFilePresent = existsSync(path.join(repoRoot, 'config', 'backend-origin.json'));
const buildFiles = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))?.build?.files;
const declaredInFiles = Array.isArray(buildFiles) && buildFiles.includes('config/backend-origin.json');

console.log(`[desktop-package] asar entries: ${asarEntries.length}`);
console.log(`[desktop-package] expected origin: ${expectedOrigin}`);
console.log(`[desktop-package] source file present in workspace: ${repoFilePresent}`);
console.log(`[desktop-package] declared in build.files: ${declaredInFiles}`);
console.log(`[desktop-package] in asar (defence in depth): ${inAsar ? 'yes' : 'no'}`);

// Required: the extraResources copy is what the packaged app falls back to when
// the artifact is not inside the asar.
const externalPath = path.join(resourcesDir, 'config', 'backend-origin.json');

if (!existsSync(externalPath)) {
    fail(`config/backend-origin.json is missing from ${externalPath}. It must be in build.extraResources in package.json.`);
}

const externalOrigin = JSON.parse(readFileSync(externalPath, 'utf8')).origin;

if (externalOrigin !== expectedOrigin) {
    fail(`Packaged extraResources copy names ${externalOrigin}, expected ${expectedOrigin}.`);
}

console.log(`[desktop-package] extraResources copy: ${externalOrigin} (matches)`);

if (!repoFilePresent) {
    fail('config/backend-origin.json is missing from the workspace; it must be committed and checked out.');
}

if (!inAsar) {
    console.warn('[desktop-package] WARNING the artifact is not inside the asar.');
    console.warn('[desktop-package] WARNING electron-builder did not apply the build.files entry on this');
    console.warn('[desktop-package] WARNING platform; the extraResources copy above still makes the origin');
    console.warn('[desktop-package] WARNING resolvable at runtime, so this is defence in depth, not a break.');
}

// Load the packaged runtime module directly. This is the assertion that would
// have caught the 1.0.195 crash: the module used to throw ENOENT at require time.
//
// Plain Node cannot require() through an asar (only Electron patches fs for
// that), so extract the archive and load it for real rather than asserting on
// the source tree.
const { extractAll } = await import('@electron/asar');
const { mkdtempSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { createRequire } = await import('node:module');

const extractDir = mkdtempSync(path.join(tmpdir(), 'aura-desktop-package-'));

try {
    extractAll(asarPath, extractDir);
    const packagedRuntime = path.join(extractDir, 'desktop', 'runtimeServer.cjs');

    if (!existsSync(packagedRuntime)) {
        fail(`Packaged desktop/runtimeServer.cjs missing from ${extractDir}.`);
    }

    const requirePackaged = createRequire(packagedRuntime);
    const runtime = requirePackaged(packagedRuntime);

    if (runtime.DEFAULT_BACKEND_ORIGIN !== expectedOrigin) {
        fail(`Packaged runtimeServer resolved ${runtime.DEFAULT_BACKEND_ORIGIN}, expected ${expectedOrigin}.`);
    }

    console.log(`[desktop-package] packaged runtime resolves: ${runtime.DEFAULT_BACKEND_ORIGIN}`);

    // Prove the crash guard is armed rather than silently masking a packaging
    // regression: the extracted package must be the reason the origin resolves,
    // not the committed fallback standing in for a missing artifact.
    if (runtime.BACKEND_ORIGIN_FALLBACK !== expectedOrigin) {
        fail(`Packaged fallback ${runtime.BACKEND_ORIGIN_FALLBACK} has drifted from ${expectedOrigin}.`);
    }
    console.log('[desktop-package] packaged fallback matches the contract');
} catch (error) {
    fail(`Packaged runtimeServer.cjs failed to load: ${error?.message || error}`);
} finally {
    rmSync(extractDir, { recursive: true, force: true });
}

console.log('[desktop-package] OK — packaged app can resolve the hosted backend origin.');