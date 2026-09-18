const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

// Load-smoke guard for the Electron entry file: main.cjs must evaluate cleanly
// at module scope. A missing Electron import (e.g. an identifier passed to a
// dependency but never destructured from require('electron')) used to ship as a
// startup crash that mocked unit tests could not see, because they never load
// the entry file. This test loads main.cjs under a strict Electron namespace
// that throws on any unmocked member, so entry-file scope errors fail here.

const recordedIpcHandles = [];

const makeFakeApp = () => ({
    userAgentFallback: '',
    commandLine: { appendSwitch: () => {} },
    on: () => {},
    once: () => {},
    quit: () => {},
    exit: () => {},
    // Returning false keeps the top-level bootstrap branch dormant: this test
    // covers module-scope evaluation only, not the full boot sequence.
    requestSingleInstanceLock: () => false,
    getPath: () => '/tmp/aura-desktop-user-data',
    whenReady: () => new Promise(() => {}),
});

const electronSurface = {
    app: makeFakeApp(),
    BrowserWindow: class FakeBrowserWindow {
        static getAllWindows() { return []; }
    },
    contextBridge: { exposeInMainWorld: () => {} },
    dialog: { showErrorBox: () => {} },
    ipcMain: {
        handle: (channel) => { recordedIpcHandles.push(channel); },
    },
    ipcRenderer: { on: () => {} },
    powerMonitor: { on: () => {} },
    safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(String(value), 'utf8'),
        decryptString: (buffer) => Buffer.from(buffer),
    },
    screen: { on: () => {} },
    session: { defaultSession: {} },
    shell: { openExternal: async () => {} },
};

const strictElectronModule = new Proxy(electronSurface, {
    get(target, prop) {
        if (prop in target) {
            return target[prop];
        }
        throw new Error(`main.cjs used an Electron member that is not mocked: ${String(prop)}`);
    },
});

test('main.cjs evaluates at module scope and registers its IPC surface', () => {
    delete process.env.SENTRY_DSN;

    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, ...rest) {
        if (request === 'electron') {
            return strictElectronModule;
        }
        if (request === 'electron-updater') {
            return { autoUpdater: { on: () => {} } };
        }
        return originalLoad.call(this, request, ...rest);
    };

    try {
        require('./main.cjs');
    } finally {
        Module._load = originalLoad;
    }

    assert.ok(
        recordedIpcHandles.includes('desktop:secure-storage:get'),
        'secure-storage IPC surface must be registered at load'
    );
    assert.ok(
        recordedIpcHandles.includes('desktop:secure-storage:set'),
        'secure-storage IPC surface must be registered at load'
    );
});
