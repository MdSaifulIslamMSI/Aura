// Regression proof for scripts/security/check-artifact-security-posture.mjs.
//
// A build gate that only ever passes is worse than no gate, because it buys
// false confidence. These cases each mutate the PACKAGED artifact and assert
// the guard rejects it, so the Electron hardening cannot silently regress.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_DIR = path.resolve(__dirname, '..', '..');
const GUARD = path.join(REPO_DIR, 'scripts', 'security', 'check-artifact-security-posture.mjs');
// @electron/asar is ESM-only, so the fixture archive is packed by running its
// bin entry through node directly. The .cmd shim is avoided because the
// repository path can contain spaces, which break shell-based invocation.
const ASAR_BIN = path.join(REPO_DIR, 'node_modules', '@electron', 'asar', 'bin', 'asar.mjs');

const MAIN_BASE = `
const { app, BrowserWindow, ipcMain } = require('electron');

const assertTrustedDesktopIpcSender = (event) => {
  if (!event) throw new Error('Desktop IPC request rejected.');
};

ipcMain.handle('desktop:alpha', (event) => {
  assertTrustedDesktopIpcSender(event);
  return { ok: true };
});

ipcMain.handle('desktop:beta', (event) => {
  assertTrustedDesktopIpcSender(event);
  return { ok: true };
});

const resolvePreloadPath = () => '/tmp/preload.cjs';

const mainWindow = new BrowserWindow({
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload: resolvePreloadPath(),
  },
});
`;

const PRELOAD_BASE = `
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('auraDesktop', {
    isDesktop: true,
    getAppInfo: () => ipcRenderer.invoke('desktop:app-info'),
    readSecureStorage: () => ipcRenderer.invoke('desktop:secure-storage:get'),
});
`;

const buildFixture = ({ mainSource = MAIN_BASE, preloadSource = PRELOAD_BASE, sourceMaps = 0 } = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-posture-'));
    const stage = path.join(root, 'stage');
    const desktopDir = path.join(stage, 'desktop');
    const distDir = path.join(root, 'dist');
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'main.cjs'), mainSource);
    fs.writeFileSync(path.join(desktopDir, 'preload.cjs'), preloadSource);
    for (let i = 0; i < sourceMaps; i += 1) {
        fs.writeFileSync(path.join(distDir, `chunk-${i}.js.map`), '{}');
    }

    const archive = path.join(root, 'app.asar');
    execFileSync(process.execPath, [ASAR_BIN, 'pack', stage, archive], { stdio: 'ignore' });
    return { root, archive, distDir };
};

const runGuard = (archive, distDir, extraArgs = []) => {
    try {
        const stdout = execFileSync(process.execPath, [GUARD, ...extraArgs], {
            env: { ...process.env, ARTIFACT_POSTURE_ASAR: archive, ARTIFACT_POSTURE_DIST: distDir },
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { code: 0, stdout, stderr: '' };
    } catch (error) {
        return { code: error.status, stdout: error.stdout || '', stderr: error.stderr || '' };
    }
};

// Points the guard at a desktop artifact that does not exist, so the strict
// and lenient paths can both be exercised without touching real build output.
const missingArtifact = () => path.join(os.tmpdir(), 'artifact-posture-absent', 'app.asar');

describe('artifact security posture guard', () => {
    const fixtures = [];

    afterAll(() => {
        for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
    });

    const track = (root) => {
        fixtures.push(root);
        return root;
    };

    test('passes a correctly hardened packaged artifact', () => {
        const { root, archive, distDir } = buildFixture();
        track(root);
        const result = runGuard(archive, distDir);
        expect(`${result.stderr}${result.stdout}`).toContain('2/2 packaged IPC channels validate their sender');
        expect(result.code).toBe(0);
    });

    test('fails when nodeIntegration is enabled in the packaged main process', () => {
        const { root, archive, distDir } = buildFixture({
            mainSource: MAIN_BASE.replace('nodeIntegration: false', 'nodeIntegration: true'),
        });
        track(root);
        const result = runGuard(archive, distDir);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('webPreferences.nodeIntegration is true');
    });

    test('fails when contextIsolation is disabled in the packaged main process', () => {
        const { root, archive, distDir } = buildFixture({
            mainSource: MAIN_BASE.replace('contextIsolation: true', 'contextIsolation: false'),
        });
        track(root);
        const result = runGuard(archive, distDir);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('webPreferences.contextIsolation is false');
    });

    test('fails when the renderer sandbox is disabled in the packaged main process', () => {
        const { root, archive, distDir } = buildFixture({
            mainSource: MAIN_BASE.replace('sandbox: true', 'sandbox: false'),
        });
        track(root);
        const result = runGuard(archive, distDir);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('webPreferences.sandbox is false');
    });

    test('fails when an IPC channel drops its sender validation', () => {
        const { root, archive, distDir } = buildFixture({
            mainSource: MAIN_BASE.replace("ipcMain.handle('desktop:beta', (event) => {\n  assertTrustedDesktopIpcSender(event);", "ipcMain.handle('desktop:beta', (event) => {"),
        });
        track(root);
        const result = runGuard(archive, distDir);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('do not validate their sender');
        expect(result.stderr).toContain('desktop:beta');
    });

    test('fails when the preload contextBridge surface grows unreviewed', () => {
        const { root, archive, distDir } = buildFixture({
            preloadSource: PRELOAD_BASE.replace('    isDesktop: true,', '    isDesktop: true,\n    readLocalFiles: () => 1,'),
        });
        track(root);
        const result = runGuard(archive, distDir);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('unapproved members');
        expect(result.stderr).toContain('readLocalFiles');
    });

    test('fails when the frontend build ships source maps', () => {
        const { root, archive, distDir } = buildFixture({ sourceMaps: 2 });
        track(root);
        const result = runGuard(archive, distDir);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('source map');
    });

    test('defaults to a notice when the desktop artifact is absent', () => {
        const distDir = path.join(os.tmpdir(), 'artifact-posture-absent-dist');
        const result = runGuard(missingArtifact(), distDir);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('no packaged desktop app.asar found');
    });

    test('fails when the desktop artifact is absent under --require-desktop', () => {
        const distDir = path.join(os.tmpdir(), 'artifact-posture-absent-dist');
        const result = runGuard(missingArtifact(), distDir, ['--require-desktop']);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('--require-desktop is set');
    });

    test('still enforces artifact posture under --require-desktop', () => {
        const { root, archive, distDir } = buildFixture({
            mainSource: MAIN_BASE.replace('nodeIntegration: false', 'nodeIntegration: true'),
        });
        track(root);
        const result = runGuard(archive, distDir, ['--require-desktop']);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('webPreferences.nodeIntegration is true');
    });
});