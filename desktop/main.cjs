const path = require('path');
const { app, BrowserWindow, dialog, shell } = require('electron');
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

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

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

const createMainWindow = async () => {
    if (!runtime) {
        runtime = await startRuntimeServer({
            distDir: resolveDistDir(),
            port: Number(process.env.AURA_DESKTOP_PORT || 0),
        });
    }

    const iconPath = resolveIconPath();
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 1080,
        minHeight: 720,
        show: false,
        backgroundColor: '#f3f4f6',
        autoHideMenuBar: true,
        icon: iconPath,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    mainWindow.once('ready-to-show', () => {
        if (mainWindow) {
            mainWindow.show();
        }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (!isInternalUrl(url, runtime.url)) {
            void shell.openExternal(url);
            return { action: 'deny' };
        }

        return { action: 'allow' };
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
        console.info(`[desktop:update] checking for updates (${reason})`);
        autoUpdater.checkForUpdatesAndNotify().catch((error) => {
            console.warn('[desktop:update] update check failed:', error?.message || error);
        });
    };

    autoUpdater.on('checking-for-update', () => {
        console.info('[desktop:update] checking for updates');
    });

    autoUpdater.on('update-available', (info) => {
        console.info('[desktop:update] update available:', info?.version || 'unknown');
    });

    autoUpdater.on('update-not-available', (info) => {
        console.info('[desktop:update] already current:', info?.version || app.getVersion());
    });

    autoUpdater.on('update-downloaded', (info) => {
        console.info('[desktop:update] update downloaded:', info?.version || 'unknown');

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
    });

    setTimeout(() => checkForUpdates('startup'), UPDATE_CHECK_DELAY_MS);
    updateCheckTimer = setInterval(() => checkForUpdates('scheduled'), UPDATE_CHECK_INTERVAL_MS);
    updateCheckTimer.unref?.();
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
