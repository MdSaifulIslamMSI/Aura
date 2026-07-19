const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, powerMonitor, screen, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const {
    DEFAULT_RUNTIME_PORT,
    MAX_STABLE_RUNTIME_PORT,
    startRuntimeServer,
    validateDesktopAuthFrontend,
} = require('./runtimeServer.cjs');
const { isDesktopOwnerAccessSignInAvailable } = require('./ownerAccessAuth.cjs');
const { formatDesktopAuthResultForRenderer } = require('./browserAuthResult.cjs');
const { buildLaunchShellDataUrl } = require('./launchShell.cjs');
const {
    canGrantDesktopRuntimePermission,
    isAuthWindowUrl,
    isInternalUrl,
    isSafeExternalUrl,
    isTrustedDesktopIpcSender,
} = require('./securityPolicy.cjs');
const {
    buildDesktopStartupUrl,
    loadWindowUrlSafely,
    revealWindow,
    runWithTimeout,
} = require('./startupReliability.cjs');

let mainWindow = null;
let mainWindowCreationPromise = null;
let runtime = null;
let isQuitting = false;
let updateChecksStarted = false;
let updateCheckTimer = null;
let updateReadyPromptShown = false;

const isMac = process.platform === 'darwin';
const APP_ID = 'com.aura.marketplace.desktop';
const UPDATE_CHECK_DELAY_MS = 8000;
const STARTUP_CACHE_CLEAR_TIMEOUT_MS = 5000;
const STARTUP_WINDOW_REVEAL_TIMEOUT_MS = 8000;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const UPDATE_FOCUS_THROTTLE_MS = 30 * 60 * 1000;
const UPDATE_FEED = Object.freeze({
    provider: 'github',
    owner: 'MdSaifulIslamMSI',
    repo: 'Aura',
    releaseType: 'release',
});

const buildDesktopAuthUserAgent = () => {
    const chromeVersion = process.versions.chrome || '124.0.0.0';
    const platformToken = process.platform === 'darwin'
        ? 'Macintosh; Intel Mac OS X 10_15_7'
        : process.platform === 'linux'
            ? 'X11; Linux x86_64'
            : 'Windows NT 10.0; Win64; x64';

    return `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
};

const DESKTOP_AUTH_USER_AGENT = buildDesktopAuthUserAgent();

let lastUpdateCheckAt = 0;

const assertTrustedDesktopIpcSender = (event) => {
    if (!isTrustedDesktopIpcSender({
        event,
        mainWindow,
        runtimeUrl: runtime?.url || '',
    })) {
        throw new Error('Desktop IPC request rejected because its origin is not trusted.');
    }
};

const openSafeExternalUrl = async (candidate) => {
    if (!isSafeExternalUrl(candidate)) {
        throw new Error('Desktop refused to open an unsafe external URL.');
    }
    await shell.openExternal(candidate);
};

app.userAgentFallback = DESKTOP_AUTH_USER_AGENT;
app.commandLine.appendSwitch('user-agent', DESKTOP_AUTH_USER_AGENT);

ipcMain.handle('desktop:app-info', (event) => {
    assertTrustedDesktopIpcSender(event);
    return ({
        ownerAccessSignInAvailable: isDesktopOwnerAccessSignInAvailable({ isPackaged: app.isPackaged }),
        platform: process.platform,
        runtimeUrl: runtime?.url || '',
        version: app.getVersion(),
    });
});

ipcMain.handle('desktop:auth:start-browser-sign-in', async (event, options = {}) => {
    assertTrustedDesktopIpcSender(event);
    if (!runtime?.createDesktopAuthRequest) {
        throw new Error('Desktop auth runtime is not ready yet.');
    }

    await validateDesktopAuthFrontend({
        authFrontendOrigin: runtime.desktopAuthFrontendOrigin,
    });

    const request = runtime.createDesktopAuthRequest({
        path: options?.path || '/login',
        returnTo: options?.returnTo || '/',
    });
    await openSafeExternalUrl(request.url);
    return {
        requestId: request.requestId,
        expiresAt: request.expiresAt,
    };
});

ipcMain.handle('desktop:auth:consume-browser-sign-in', (event, requestId = '') => {
    assertTrustedDesktopIpcSender(event);
    if (!runtime?.consumeDesktopAuthResult) {
        throw new Error('Desktop auth runtime is not ready yet.');
    }

    return formatDesktopAuthResultForRenderer(runtime.consumeDesktopAuthResult(requestId));
});

ipcMain.handle('desktop:auth:reopen-browser-sign-in', async (event, requestId = '') => {
    assertTrustedDesktopIpcSender(event);
    if (!runtime?.getDesktopAuthRequest) {
        throw new Error('Desktop auth runtime is not ready yet.');
    }

    const request = runtime.getDesktopAuthRequest(requestId);
    if (!request?.url) {
        throw new Error('Desktop browser sign-in is expired or no longer pending.');
    }

    await openSafeExternalUrl(request.url);
    return {
        success: true,
        requestId: request.requestId,
        expiresAt: request.expiresAt,
    };
});

ipcMain.handle('desktop:auth:cancel-browser-sign-in', (event, requestId = '') => {
    assertTrustedDesktopIpcSender(event);
    if (!runtime?.cancelDesktopAuthRequest) {
        return { success: false };
    }

    return {
        success: runtime.cancelDesktopAuthRequest(requestId),
    };
});

ipcMain.handle('desktop:auth:owner-access-sign-in', async (event) => {
    assertTrustedDesktopIpcSender(event);
    if (!isDesktopOwnerAccessSignInAvailable({ isPackaged: app.isPackaged })) {
        throw new Error('Desktop owner access is unavailable in packaged builds. Continue in your browser instead.');
    }
    if (!runtime?.createDesktopOwnerAccessSignIn) {
        throw new Error('Desktop owner access runtime is not ready yet.');
    }

    return runtime.createDesktopOwnerAccessSignIn();
});

ipcMain.handle('desktop:api:public-catalog-get', async (event, request = {}) => {
    assertTrustedDesktopIpcSender(event);
    if (!runtime?.fetchPublicCatalog) {
        throw new Error('Desktop catalog runtime is not ready yet.');
    }

    return runtime.fetchPublicCatalog(request);
});

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

const resolveLaunchIconDataUrl = () => {
    const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'app-icon.png')
        : path.join(app.getAppPath(), 'app', 'public', 'assets', 'icon-512.png');

    try {
        return `data:image/png;base64,${fs.readFileSync(iconPath).toString('base64')}`;
    } catch (error) {
        console.warn('[desktop] launch icon could not be loaded:', error?.message || error);
        return '';
    }
};

const resolveRequestedRuntimePort = () => {
    if (app.isPackaged) return DEFAULT_RUNTIME_PORT;

    const rawValue = String(process.env.AURA_DESKTOP_PORT || '').trim();
    if (!rawValue) return undefined;

    const parsed = Number(rawValue);
    return Number.isInteger(parsed)
        && parsed >= DEFAULT_RUNTIME_PORT
        && parsed <= MAX_STABLE_RUNTIME_PORT
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

const clearDesktopRuntimeWebCaches = async (runtimeUrl = '') => {
    try {
        const origin = new URL(runtimeUrl).origin;
        await session.defaultSession.clearStorageData({
            origin,
            storages: ['serviceworkers', 'cachestorage'],
        });
        await session.defaultSession.clearCache();
    } catch (error) {
        console.warn('[desktop] unable to clear local runtime web caches:', error?.message || error);
    }
};

const installDesktopPermissionPolicy = () => {
    const defaultSession = session.defaultSession;

    defaultSession.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
        const requestUrl = details.requestingUrl
            || details.securityOrigin
            || webContents?.getURL?.()
            || runtime?.url
            || '';
        callback(canGrantDesktopRuntimePermission(permission, requestUrl, runtime?.url || ''));
    });

    defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details = {}) => {
        const requestUrl = requestingOrigin
            || details.requestingUrl
            || details.securityOrigin
            || webContents?.getURL?.()
            || runtime?.url
            || '';
        return canGrantDesktopRuntimePermission(permission, requestUrl, runtime?.url || '');
    });
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
        session: parentWindow?.webContents?.session,
    },
});

const sendDesktopUpdateStatus = (type, payload = {}) => {
    if (
        !mainWindow
        || mainWindow.isDestroyed()
        || !isInternalUrl(mainWindow.webContents.getURL(), runtime?.url || '')
    ) {
        return;
    }

    mainWindow.webContents.send('desktop:update:status', {
        type,
        ...payload,
    });
};

const sendDesktopAuthStatus = (type, payload = {}) => {
    if (
        !mainWindow
        || mainWindow.isDestroyed()
        || !isInternalUrl(mainWindow.webContents.getURL(), runtime?.url || '')
    ) {
        return;
    }

    mainWindow.webContents.send('desktop:auth:status', {
        type,
        ...payload,
    });
};

const buildUpdateErrorMessage = (error) => {
    const rawMessage = String(error?.message || error || 'Update check failed.').trim();

    if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo/i.test(rawMessage)) {
        return 'Aura could not resolve the GitHub update channel. Check your internet or DNS, then try again.';
    }

    return rawMessage || 'Update check failed.';
};

const createMainWindow = async () => {
    const iconPath = resolveIconPath();
    const initialBounds = getInitialWindowBounds();
    mainWindow = new BrowserWindow({
        ...initialBounds,
        minWidth: 1080,
        minHeight: 720,
        show: false,
        backgroundColor: '#202020',
        autoHideMenuBar: true,
        icon: iconPath,
        title: 'Aura Desktop',
        webPreferences: {
            backgroundThrottling: false,
            contextIsolation: true,
            nodeIntegration: false,
            preload: resolvePreloadPath(),
            sandbox: true,
        },
    });
    mainWindow.webContents.setUserAgent(DESKTOP_AUTH_USER_AGENT);

    const activeWindow = mainWindow;
    const revealActiveWindow = () => revealWindow(activeWindow, {
        maximize: process.env.AURA_DESKTOP_START_MAXIMIZED !== 'false',
    });
    const revealTimer = setTimeout(() => {
        console.warn('[desktop] ready-to-show was delayed; revealing the startup window.');
        revealActiveWindow();
    }, STARTUP_WINDOW_REVEAL_TIMEOUT_MS);

    mainWindow.once('ready-to-show', () => {
        clearTimeout(revealTimer);
        revealActiveWindow();
    });

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (isMainFrame === false) return;
        clearTimeout(revealTimer);
        console.error('[desktop] main window failed to load:', errorCode, errorDescription, validatedUrl);
        revealActiveWindow();
    });

    mainWindow.webContents.on('did-finish-load', () => {
        if (activeWindow.isDestroyed()) return;
        activeWindow.webContents.setZoomFactor(1);
        Promise.resolve(activeWindow.webContents.setVisualZoomLevelLimits(1, 1)).catch(() => {});
    });

    mainWindow.on('closed', () => {
        clearTimeout(revealTimer);
        if (mainWindow === activeWindow) {
            mainWindow = null;
        }
    });

    const launchShellLoaded = await loadWindowUrlSafely(
        activeWindow,
        buildLaunchShellDataUrl({
            iconDataUrl: resolveLaunchIconDataUrl(),
        })
    );
    if (!launchShellLoaded) return null;

    if (!runtime) {
        const runtimeOptions = {
            distDir: resolveDistDir(),
            onDesktopAuthComplete: (payload) => {
                sendDesktopAuthStatus('completed', payload);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    revealWindow(mainWindow);
                }
            },
            onDesktopAuthCancel: (payload) => {
                sendDesktopAuthStatus('cancelled', payload);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    revealWindow(mainWindow);
                }
            },
        };
        const requestedPort = resolveRequestedRuntimePort();
        if (requestedPort) {
            runtimeOptions.port = requestedPort;
        }
        runtime = await startRuntimeServer(runtimeOptions);
    }
    if (activeWindow.isDestroyed()) return null;
    try {
        await runWithTimeout(
            () => clearDesktopRuntimeWebCaches(runtime.url),
            STARTUP_CACHE_CLEAR_TIMEOUT_MS,
            'Desktop cache cleanup timed out.'
        );
    } catch (error) {
        console.warn('[desktop] continuing after cache cleanup timeout:', error?.message || error);
    }

    if (activeWindow.isDestroyed()) {
        return null;
    }

    const guardMainFrameNavigation = (event, url) => {
        if (isInternalUrl(url, runtime.url)) {
            return;
        }

        event.preventDefault();
        if (isSafeExternalUrl(url)) {
            void shell.openExternal(url);
        }
    };
    activeWindow.webContents.on('will-navigate', guardMainFrameNavigation);
    activeWindow.webContents.on('will-redirect', guardMainFrameNavigation);

    activeWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isInternalUrl(url, runtime.url)) {
            return { action: 'allow' };
        }

        if (isAuthWindowUrl(url)) {
            return {
                action: 'allow',
                overrideBrowserWindowOptions: buildAuthWindowOptions(activeWindow),
            };
        }

        if (isSafeExternalUrl(url)) {
            void shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    activeWindow.webContents.on('did-create-window', (childWindow, details = {}) => {
        childWindow.setMenuBarVisibility(false);
        if (isAuthWindowUrl(details.url || '')) {
            childWindow.webContents.setUserAgent(DESKTOP_AUTH_USER_AGENT);
            childWindow.center();
        }
        childWindow.webContents.setWindowOpenHandler(({ url }) => {
            if (isAuthWindowUrl(url) || isInternalUrl(url, runtime.url)) {
                return {
                    action: 'allow',
                    overrideBrowserWindowOptions: buildAuthWindowOptions(activeWindow),
                };
            }

            if (isSafeExternalUrl(url)) {
                void shell.openExternal(url);
            }
            return { action: 'deny' };
        });
    });

    const appLoaded = await loadWindowUrlSafely(
        activeWindow,
        buildDesktopStartupUrl(runtime.url, app.getVersion())
    );
    return appLoaded ? activeWindow : null;
};

const ensureMainWindow = async () => {
    await app.whenReady();
    if (mainWindow && !mainWindow.isDestroyed()) {
        return mainWindow;
    }

    if (!mainWindowCreationPromise) {
        mainWindowCreationPromise = createMainWindow()
            .finally(() => {
                mainWindowCreationPromise = null;
            });
    }

    return mainWindowCreationPromise;
};

const startAutoUpdateChecks = () => {
    if (updateChecksStarted || !app.isPackaged || process.env.AURA_DESKTOP_AUTO_UPDATE === 'false') {
        return;
    }

    updateChecksStarted = true;
    autoUpdater.setFeedURL(UPDATE_FEED);
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;

    const checkForUpdates = (reason) => {
        lastUpdateCheckAt = Date.now();
        console.info(`[desktop:update] checking for updates (${reason})`);
        sendDesktopUpdateStatus('checking', { reason });
        autoUpdater.checkForUpdatesAndNotify().catch((error) => {
            const message = buildUpdateErrorMessage(error);
            console.warn('[desktop:update] update check failed:', message);
            sendDesktopUpdateStatus('error', {
                message,
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
        const message = buildUpdateErrorMessage(error);
        console.warn('[desktop:update] update check failed:', message);
        sendDesktopUpdateStatus('error', {
            message,
        });
    });

    setTimeout(() => checkForUpdates('startup'), UPDATE_CHECK_DELAY_MS);
    updateCheckTimer = setInterval(() => checkForUpdates('scheduled'), UPDATE_CHECK_INTERVAL_MS);
    updateCheckTimer.unref?.();

    ipcMain.handle('desktop:update:check', (event) => {
        assertTrustedDesktopIpcSender(event);
        checkForUpdates('manual');
        return { ok: true };
    });

    ipcMain.handle('desktop:update:install-now', (event) => {
        assertTrustedDesktopIpcSender(event);
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
    installDesktopPermissionPolicy();
    await ensureMainWindow();
    startAutoUpdateChecks();

    app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0 && !mainWindow) {
            await ensureMainWindow();
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
        void ensureMainWindow()
            .then((window) => revealWindow(window, { focus: true }))
            .catch((error) => {
                console.error('[desktop] failed to recover the main window:', error);
            });
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
