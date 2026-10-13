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

// Survives the Module._load patch being torn down, so a later require() still
// hits the cache and does not re-run main.cjs's module scope.
const recordedIpcHandlers = new Map();

// Minimal BrowserWindow stand-in for the lifecycle listeners main.cjs attaches
// during window creation. Only the members those listeners touch are needed.
class FakeBrowserWindow {
    static getAllWindows() { return []; }

    constructor() {
        this.destroyed = false;
        this.shown = false;
        this.webContents = {
            url: '',
            session: { id: 'shared-session' },
            events: new Map(),
            sent: [],
            on(event, handler) { this.events.set(event, handler); },
            once() {},
            send(channel, payload) { this.sent.push({ channel, payload }); },
            getURL() { return this.url; },
            setUserAgent() {},
            setZoomFactor() {},
            setVisualZoomLevelLimits: async () => {},
        };
        this.listeners = new Map();
    }

    on(event, handler) { this.listeners.set(event, handler); }
    once() {}
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    isVisible() { return this.shown; }
    show() { this.shown = true; }
    focus() {}
    restore() {}
    maximize() {}
    center() {}
    setMenuBarVisibility() {}
}

const electronSurface = {
    app: Object.assign(makeFakeApp(), { getVersion: () => '1.0.0', isPackaged: false }),
    BrowserWindow: FakeBrowserWindow,
    contextBridge: { exposeInMainWorld: () => {} },
    dialog: { showErrorBox: () => {} },
    ipcMain: {
        handle: (channel, handler) => {
            recordedIpcHandles.push(channel);
            recordedIpcHandlers.set(channel, handler);
        },
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

// Every IPC channel the renderer can reach. A channel missing from this list is
// a gap in the assertions below, not evidence that it is unreachable.
const EXPECTED_IPC_CHANNELS = [
    'desktop:secure-storage:get',
    'desktop:secure-storage:set',
    'desktop:app-info',
    'desktop:auth:start-browser-sign-in',
    'desktop:auth:consume-browser-sign-in',
    'desktop:auth:reopen-browser-sign-in',
    'desktop:auth:cancel-browser-sign-in',
    'desktop:auth:owner-access-sign-in',
    'desktop:api:public-catalog-get',
];

const loadMainWithMockedElectron = () => {
    delete process.env.SENTRY_DSN;

    // main.cjs registers its IPC handlers at module scope, so it only runs once
    // per process. Evicting it from the cache is what lets each test observe a
    // fresh registration; recordedIpcHandlers is deliberately not cleared, so
    // the handlers stay reachable after the _load patch is torn down.
    delete require.cache[require.resolve('./main.cjs')];

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
        // requestSingleInstanceLock returns false in the fake, so bootstrap stays
        // dormant and main.cjs can be re-required per case.
        return require('./main.cjs');
    } finally {
        Module._load = originalLoad;
    }
};

// A trusted event is the main window's own frame on the runtime origin.
const trustedIpcEvent = (url) => {
    const mainFrame = { url };
    return {
        sender: { webContents: { mainFrame, getURL: () => url } },
        senderFrame: mainFrame,
    };
};

test('main.cjs evaluates at module scope and registers its IPC surface', () => {
    loadMainWithMockedElectron();

    for (const channel of EXPECTED_IPC_CHANNELS) {
        assert.ok(
            recordedIpcHandles.includes(channel),
            `${channel} must be registered at load`
        );
    }
});

test('every renderer-reachable IPC handler rejects an untrusted sender', async () => {
    loadMainWithMockedElectron();

    const foreignSender = {
        sender: {},
        senderFrame: { url: 'https://evil.example/attack.html' },
    };

    for (const channel of EXPECTED_IPC_CHANNELS) {
        const handler = recordedIpcHandlers.get(channel);
        assert.ok(handler, `${channel} must expose a handler`);

        // The trust gate must reject before the handler reaches its own logic,
        // so an untrusted frame can never observe runtime or storage behaviour.
        // Handlers are async, so the rejection surfaces as a rejected promise
        // rather than a synchronous throw.
        await assert.rejects(
            async () => handler(foreignSender),
            /origin is not trusted/,
            `${channel} must reject a sender outside the runtime origin`
        );
    }
});

test('IPC handlers stay closed while no main window exists', async () => {
    loadMainWithMockedElectron();

    // The trusted-sender check requires event.sender to be the main window's own
    // webContents. Before bootstrap creates that window there is nothing to
    // trust, so a renderer that somehow reached IPC must be refused rather than
    // served. This is the same gate assertTrustedDesktopIpcSender applies in
    // production, exercised without a live BrowserWindow.
    const runtimeUrl = 'http://127.0.0.1:47831';
    const forgedSender = trustedIpcEvent(runtimeUrl);

    await assert.rejects(
        async () => recordedIpcHandlers.get('desktop:secure-storage:set')(
            forgedSender,
            'trusted-device',
            'super-secret-value'
        ),
        /origin is not trusted/
    );
    await assert.rejects(
        async () => recordedIpcHandlers.get('desktop:secure-storage:get')(
            forgedSender,
            'trusted-device'
        ),
        /origin is not trusted/
    );
    await assert.rejects(
        async () => recordedIpcHandlers.get('desktop:app-info')(forgedSender),
        /origin is not trusted/
    );
});
