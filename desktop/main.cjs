const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, powerMonitor, screen, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { startRuntimeServer } = require('./runtimeServer.cjs');

let mainWindow = null;
let runtime = null;
let isQuitting = false;
let updateChecksStarted = false;
let updateCheckTimer = null;
let updateReadyPromptShown = false;

const isMac = process.platform === 'darwin';
const APP_ID = 'com.aura.marketplace.desktop';
const UPDATE_CHECK_DELAY_MS = 8000;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const UPDATE_FOCUS_THROTTLE_MS = 30 * 60 * 1000;
const DESKTOP_AUTH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let lastUpdateCheckAt = 0;

ipcMain.handle('desktop:app-info', () => ({
    platform: process.platform,
    runtimeUrl: runtime?.url || '',
    version: app.getVersion(),
}));

const resolveAssetPath = (...segments) => {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, ...segments);
    }
    return path.join(app.getAppPath(), ...segments);
};

const resolveDistDir = () => (
    app.isPackaged
        ? resolveAssetPath('app-dist')
        : resolveAssetPath('app', 'dist')
);
const resolveIconPath = () => (
    app.isPackaged
        ? resolveAssetPath('app-icon.png')
        : resolveAssetPath('app', 'public', 'assets', 'icon-512.png')
);
const resolvePreloadPath = () => path.join(app.getAppPath(), 'desktop', 'preload.cjs');

const resolveRequestedRuntimePort = () => {
    const rawValue = String(process.env.AURA_DESKTOP_PORT || '').trim();
    if (!rawValue) return undefined;

    const parsed = Number(rawValue);
    return Number.isInteger(parsed) && parsed > 0 && parsed < 65536
        ? parsed
        : undefined;
};

const getInitialWindowBounds = () => {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    return {
        width: Math.max(1180, Math.min(width, 1680)),
        height: Math.max(760, Math.min(height, 1040)),
    };
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const AUTH_WINDOW_HOSTS = new Set([
    'accounts.google.com',
    'apis.google.com',
    'facebook.com',
    'google.com',
    'm.facebook.com',
    'mobile.facebook.com',
    'oauth.twitter.com',
    'twitter.com',
    'www.facebook.com',
    'www.google.com',
    'x.com',
]);
const AUTH_WINDOW_HOST_SUFFIXES = [
    '.facebook.com',
    '.firebaseapp.com',
    '.google.com',
    '.twitter.com',
    '.web.app',
    '.x.com',
];

const isInternalUrl = (candidate, runtimeUrl) => {
    try {
        const target = new URL(candidate);
        const runtimeTarget = new URL(runtimeUrl);

        if (target.origin === runtimeTarget.origin) {
            return true;
        }

        const sameLoopbackOrigin = target.protocol === runtimeTarget.protocol
            && target.port === runtimeTarget.port
            && LOOPBACK_HOSTS.has(target.hostname)
            && LOOPBACK_HOSTS.has(runtimeTarget.hostname);

        return sameLoopbackOrigin;
    } catch {
        return false;
    }
};

const isAuthWindowUrl = (candidate) => {
    try {
        const target = new URL(candidate);
        if (target.protocol !== 'https:') {
            return false;
        }

        const hostname = target.hostname.toLowerCase();
        return AUTH_WINDOW_HOSTS.has(hostname)
            || AUTH_WINDOW_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
    } catch {
        return false;
    }
};

const buildAuthWindowOptions = (parentWindow) => ({
    width: 640,
    height: 780,
    minWidth: 520,
    minHeight: 560,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    parent: parentWindow,
    modal: false,
    webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
    },
});

const sendDesktopUpdateStatus = (type, payload = {}) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    mainWindow.webContents.send('desktop:update:status', {
        type,
        ...payload,
    });
};

const createMainWindow = async () => {
    if (!runtime) {
        const runtimeOptions = { distDir: resolveDistDir() };
        const requestedPort = resolveRequestedRuntimePort();
        if (requestedPort) {
            runtimeOptions.port = requestedPort;
        }
        runtime = await startRuntimeServer(runtimeOptions);
    }

    const iconPath = resolveIconPath();
    const initialBounds = getInitialWindowBounds();
    mainWindow = new BrowserWindow({
        ...initialBounds,
        minWidth: 1080,
        minHeight: 720,
        show: false,
        backgroundColor: '#020617',
        autoHideMenuBar: true,
        icon: iconPath,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: resolvePreloadPath(),
            sandbox: true,
        },
    });

    mainWindow.once('ready-to-show', () => {
        if (mainWindow) {
            if (process.env.AURA_DESKTOP_START_MAXIMIZED !== 'false') {
                mainWindow.maximize();
            }
            mainWindow.show();
        }
    });

    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow?.webContents.setZoomFactor(1);
        Promise.resolve(mainWindow?.webContents.setVisualZoomLevelLimits(1, 1)).catch(() => {});
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isInternalUrl(url, runtime.url)) {
            return { action: 'allow' };
        }

        if (isAuthWindowUrl(url)) {
            return {
                action: 'allow',
                overrideBrowserWindowOptions: buildAuthWindowOptions(mainWindow),
            };
        }

        void shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.webContents.on('did-create-window', (childWindow, details = {}) => {
        childWindow.setMenuBarVisibility(false);
        if (isAuthWindowUrl(details.url || '')) {
            childWindow.webContents.setUserAgent(DESKTOP_AUTH_USER_AGENT);
            childWindow.center();
        }
        childWindow.webContents.setWindowOpenHandler(({ url }) => {
            if (isAuthWindowUrl(url) || isInternalUrl(url, runtime.url)) {
                return {
                    action: 'allow',
                    overrideBrowserWindowOptions: buildAuthWindowOptions(mainWindow),
                };
            }

            void shell.openExternal(url);
            return { action: 'deny' };
        });
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    await mainWindow.loadURL(runtime.url);
};

const startAutoUpdateChecks = () => {
    if (updateChecksStarted || !app.isPackaged || process.env.AURA_DESKTOP_AUTO_UPDATE === 'false') {
        return;
    }

    updateChecksStarted = true;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;

    const checkForUpdates = (reason) => {
        lastUpdateCheckAt = Date.now();
        console.info(`[desktop:update] checking for updates (${reason})`);
        sendDesktopUpdateStatus('checking', { reason });
        autoUpdater.checkForUpdatesAndNotify().catch((error) => {
            console.warn('[desktop:update] update check failed:', error?.message || error);
            sendDesktopUpdateStatus('error', {
                message: error?.message || 'Update check failed.',
            });
        });
    };

    autoUpdater.on('checking-for-update', () => {
        console.info('[desktop:update] checking for updates');
        sendDesktopUpdateStatus('checking');
    });

    autoUpdater.on('update-available', (info) => {
        console.info('[desktop:update] update available:', info?.version || 'unknown');
        sendDesktopUpdateStatus('available', {
            version: info?.version || '',
        });
    });

    autoUpdater.on('update-not-available', (info) => {
        console.info('[desktop:update] already current:', info?.version || app.getVersion());
        sendDesktopUpdateStatus('not-available', {
            version: info?.version || app.getVersion(),
        });
    });

    autoUpdater.on('download-progress', (progress = {}) => {
        sendDesktopUpdateStatus('downloading', {
            percent: Number(progress.percent || 0),
        });
    });

    autoUpdater.on('update-downloaded', (info) => {
        console.info('[desktop:update] update downloaded:', info?.version || 'unknown');
        sendDesktopUpdateStatus('downloaded', {
            version: info?.version || '',
        });

        if (updateReadyPromptShown) {
            return;
        }

        updateReadyPromptShown = true;
        const targetWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        const updatePrompt = {
            type: 'info',
            buttons: ['Restart and update', 'Later'],
            defaultId: 0,
            cancelId: 1,
            title: 'Aura Marketplace update ready',
            message: 'A new Aura Marketplace version has been downloaded.',
            detail: 'Restart the desktop app now to install the update, or choose Later to install it when you quit.',
        };
        const promptPromise = targetWindow
            ? dialog.showMessageBox(targetWindow, updatePrompt)
            : dialog.showMessageBox(updatePrompt);

        promptPromise.then(({ response }) => {
            if (response !== 0) {
                return;
            }

            isQuitting = true;
            autoUpdater.quitAndInstall(false, true);
        }).catch((error) => {
            console.warn('[desktop:update] update prompt failed:', error?.message || error);
        });
    });

    autoUpdater.on('error', (error) => {
        console.warn('[desktop:update] update check failed:', error?.message || error);
        sendDesktopUpdateStatus('error', {
            message: error?.message || 'Update check failed.',
        });
    });

    setTimeout(() => checkForUpdates('startup'), UPDATE_CHECK_DELAY_MS);
    updateCheckTimer = setInterval(() => checkForUpdates('scheduled'), UPDATE_CHECK_INTERVAL_MS);
    updateCheckTimer.unref?.();

    ipcMain.handle('desktop:update:check', () => {
        checkForUpdates('manual');
        return { ok: true };
    });

    ipcMain.handle('desktop:update:install-now', () => {
        isQuitting = true;
        autoUpdater.quitAndInstall(false, true);
        return { ok: true };
    });

    powerMonitor.on('resume', () => {
        checkForUpdates('resume');
    });

    app.on('browser-window-focus', () => {
        if ((Date.now() - lastUpdateCheckAt) > UPDATE_FOCUS_THROTTLE_MS) {
            checkForUpdates('focus');
        }
    });
};

const stopRuntime = async () => {
    if (updateCheckTimer) {
        clearInterval(updateCheckTimer);
        updateCheckTimer = null;
    }

    if (!runtime) return;

    const activeRuntime = runtime;
    runtime = null;

    try {
        await activeRuntime.close();
    } catch (error) {
        console.error('[desktop] failed to stop runtime server:', error);
    }
};

const bootstrap = async () => {
    app.setAppUserModelId(APP_ID);
    await app.whenReady();
    await createMainWindow();
    startAutoUpdateChecks();

    app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0 && !mainWindow) {
            await createMainWindow();
        }
    });
};

app.on('window-all-closed', () => {
    if (!isMac) {
        app.quit();
    }
});

app.on('before-quit', async (event) => {
    if (isQuitting) {
        return;
    }

    isQuitting = true;
    event.preventDefault();
    await stopRuntime();
    app.quit();
});

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.focus();
    });

    bootstrap().catch(async (error) => {
        console.error('[desktop] bootstrap failed:', error);
        await stopRuntime();
        dialog.showErrorBox(
            'Aura Marketplace Desktop',
            error?.message || 'The desktop app failed to start.'
        );
        app.exit(1);
    });
}
