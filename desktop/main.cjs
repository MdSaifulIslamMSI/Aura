const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, powerMonitor, safeStorage, screen, session, shell } = require('electron');

// Guarded main-process error reporting (the renderer is covered by the web
// SDK baked into app/dist). No-op without SENTRY_DSN; never blocks boot.
try {
    if (process.env.SENTRY_DSN) {
        const desktopRelease = String(
            process.env.SENTRY_RELEASE
            || (typeof app?.getVersion === 'function' ? `aura-desktop@${app.getVersion()}` : '')
            || 'aura-desktop-unknown'
        );
        require('@sentry/electron/main').init({
            dsn: process.env.SENTRY_DSN,
            release: desktopRelease,
            environment: String(process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production'),
            tracesSampleRate: Math.min(1, Math.max(0, Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1) || 0)),
            sendDefaultPii: false,
        });
    }
} catch {
    // Sentry must never prevent the desktop shell from booting.
}
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
const { createDesktopSecureStorage } = require('./secureStorage.cjs');
const {
    canGrantDesktopRuntimePermission,
    isAllowedAuthWindowNavigation,
    isAuthWindowUrl,
    isInternalUrl,
    isSafeExternalUrl,
    isTrustedDesktopIpcSender,
} = require('./securityPolicy.cjs');
const {
    DEFAULT_DESKTOP_INTERACTIVE_BACKSTOP_MS,
    buildDesktopStartupUrl,
    evaluateDesktopStartup,
    loadWindowUrlSafely,
    revealWindow,
} = require('./startupReliability.cjs');
const {
    UPDATE_CHECK_DELAY_MS,
    UPDATE_CHECK_INTERVAL_MS,
    buildUpdateErrorMessage,
    buildUpdateRestartPrompt,
    buildUpdateStatusPayload,
    shouldCheckForUpdatesOnFocus,
    shouldInstallUpdateNow,
    shouldPromptForRestart,
    shouldStartAutoUpdateChecks,
} = require('./autoUpdatePolicy.cjs');
const {
    MAIN_WINDOW_ZOOM,
    MIN_WINDOW_HEIGHT,
    MIN_WINDOW_WIDTH,
    buildAuthWindowOptions,
    buildMainWindowWebPreferences,
    getInitialWindowBounds,
} = require('./windowChrome.cjs');

let mainWindow = null;
let mainWindowCreationPromise = null;
let runtime = null;
let isQuitting = false;
let updateChecksStarted = false;
let updateCheckTimer = null;
let updateReadyPromptShown = false;

const isMac = process.platform === 'darwin';
const APP_ID = 'com.aura.marketplace.desktop';
const STARTUP_WINDOW_REVEAL_TIMEOUT_MS = 8000;
const UPDATE_FEED = Object.freeze({
    provider: 'github',
    owner: 'MdSaifulIslamMSI',
    repo: 'Aura',
    releaseType: 'release',
});

// Boot smoke hook. scripts/desktop/boot-smoke.mjs sets AURA_DESKTOP_BOOT_SMOKE=1
// to make the shell report what the window actually loaded, so CI can assert a
// real BrowserWindow reached the runtime origin instead of inferring success from
// the absence of a crash. Never reachable in a shipped build.
const DESKTOP_BOOT_SMOKE_ENV = 'AURA_DESKTOP_BOOT_SMOKE';
const DESKTOP_BOOT_SMOKE_MARKER = '[desktop:boot-smoke]';

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

const isOwnerAccessSignInAvailable = () => isDesktopOwnerAccessSignInAvailable({
    backendOrigin: runtime?.backendOrigin || '',
    isPackaged: app.isPackaged,
});

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

const openSafeExternalUrlInBackground = (candidate) => {
    void openSafeExternalUrl(candidate).catch((error) => {
        console.warn('[desktop] unable to open external URL:', error?.message || error);
    });
};

app.userAgentFallback = DESKTOP_AUTH_USER_AGENT;
app.commandLine.appendSwitch('user-agent', DESKTOP_AUTH_USER_AGENT);

// OS-keychain-backed storage for renderer secrets (trusted-device session).
// Plaintext never touches disk; unavailable OS providers keep values memory-only.
const secureStorage = createDesktopSecureStorage({
    resolveStorageDir: () => app.getPath('userData'),
    safeStorage,
});

ipcMain.handle('desktop:secure-storage:get', (event, key = '') => {
    assertTrustedDesktopIpcSender(event);
    return secureStorage.read(String(key || ''));
});

ipcMain.handle('desktop:secure-storage:set', (event, key = '', value = '') => {
    assertTrustedDesktopIpcSender(event);
    return secureStorage.write(String(key || ''), String(value ?? ''));
});

ipcMain.handle('desktop:app-info', (event) => {
    assertTrustedDesktopIpcSender(event);
    return ({
        ownerAccessSignInAvailable: isOwnerAccessSignInAvailable(),
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
    try {
        await openSafeExternalUrl(request.url);
    } catch (error) {
        runtime.cancelDesktopAuthRequest?.(request.requestId);
        throw error;
    }
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
    if (!isOwnerAccessSignInAvailable()) {
        throw new Error('Desktop owner access is unavailable for this desktop configuration. Continue in your browser instead.');
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

// The launch shell renders the mark at 58x58 CSS px (launchShell.cjs), so a
// 512px source is ~8x oversized: it base64-encodes into a ~676 KB data URL that
// Chromium must decode and paint before the real app load starts. 192px covers
// 2x DPI with headroom at a sixth of the bytes, and measured materially faster
// to navigate. Do not "improve" this back to the 512 icon.
//
// This is deliberately a DIFFERENT resource from resolveIconPath() above, which
// feeds BrowserWindow's `icon:` and should stay 512px because the OS scales that
// one across taskbar densities. Shipping only one file would have silently
// capped the window icon to 192px, so build.extraResources carries both.
const resolveLaunchIconDataUrl = () => {
    const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'app-launch-icon.png')
        : path.join(app.getAppPath(), 'app', 'public', 'assets', 'icon-192.png');

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

const sendDesktopUpdateStatus = (type, payload = {}) => {
    if (
        !mainWindow
        || mainWindow.isDestroyed()
        || !isInternalUrl(mainWindow.webContents.getURL(), runtime?.url || '')
    ) {
        return;
    }

    mainWindow.webContents.send(
        'desktop:update:status',
        buildUpdateStatusPayload(type, payload)
    );
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

// Reports what the shell actually loaded, then lets the caller skip the rest of
// the boot sequence. Returns true only when it ran, so normal boots are
// unaffected. See DESKTOP_BOOT_SMOKE_ENV above.
const reportDesktopBootSmoke = (window) => {
    if (app.isPackaged || process.env[DESKTOP_BOOT_SMOKE_ENV] !== '1') {
        return false;
    }

    let windowUrl = '';
    try {
        windowUrl = window && !window.isDestroyed() ? window.webContents.getURL() : '';
    } catch {
        // The window can close while we report. An empty URL then fails the
        // smoke assertion, which is the correct outcome.
    }

    // fs.writeSync rather than console.log: stdout is asynchronous when piped,
    // and the harness may kill this process as soon as it reads the line.
    fs.writeSync(1, `${DESKTOP_BOOT_SMOKE_MARKER} ${JSON.stringify({
        ok: Boolean(window) && Boolean(windowUrl),
        runtimeUrl: runtime?.url || '',
        windowUrl,
        version: app.getVersion(),
        platform: process.platform,
    })}\n`);

    return true;
};

const createMainWindow = async () => {
    const startupStartedAt = Date.now();
    const mark = (label) => {
        if (process.env.AURA_DESKTOP_TRACE_BOOT !== '1') return;
        console.error(`[desktop:trace] ${label} @${Date.now() - startupStartedAt}ms`);
    };
    mark('enter');
    const iconPath = resolveIconPath();
    const initialBounds = getInitialWindowBounds(
        screen.getPrimaryDisplay().workAreaSize
    );
    mark('bounds');
    mainWindow = new BrowserWindow({
        ...initialBounds,
        minWidth: MIN_WINDOW_WIDTH,
        minHeight: MIN_WINDOW_HEIGHT,
        show: false,
        backgroundColor: '#202020',
        autoHideMenuBar: true,
        icon: iconPath,
        title: 'Aura Desktop',
        webPreferences: buildMainWindowWebPreferences({
            preloadPath: resolvePreloadPath(),
        }),
    });
    mark('browserwindow-created');
    mainWindow.webContents.setUserAgent(DESKTOP_AUTH_USER_AGENT);

    const activeWindow = mainWindow;
    // When the window first became visible. This — not the /login navigation
    // resolving — is what the startup budget measures, so it must be captured on
    // every path that can reveal the window, including the failure and timeout
    // fallbacks. Falls back to "now" if none fired.
    let revealedAt = 0;
    const recordReveal = () => {
        if (!revealedAt) revealedAt = Date.now();
    };
    const revealActiveWindow = () => {
        recordReveal();
        return revealWindow(activeWindow, {
            maximize: process.env.AURA_DESKTOP_START_MAXIMIZED !== 'false',
        });
    };
    const revealTimer = setTimeout(() => {
        console.warn('[desktop] ready-to-show was delayed; revealing the startup window.');
        revealActiveWindow();
    }, STARTUP_WINDOW_REVEAL_TIMEOUT_MS);

    mainWindow.once('ready-to-show', () => {
        clearTimeout(revealTimer);
        mark('ready-to-show');
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
        mark('did-finish-load');
        activeWindow.webContents.setZoomFactor(MAIN_WINDOW_ZOOM);
        Promise.resolve(
            activeWindow.webContents.setVisualZoomLevelLimits(MAIN_WINDOW_ZOOM, MAIN_WINDOW_ZOOM)
        ).catch(() => {});
    });

    mainWindow.on('closed', () => {
        clearTimeout(revealTimer);
        if (mainWindow === activeWindow) {
            mainWindow = null;
        }
    });

    mark('before-launch-shell');
    // Start the runtime concurrently with the launch-shell load instead of after
    // it. The two are independent — the launch shell is a data: URL that never
    // touches the runtime — so running them in series added the server's cold
    // start plus its first-request warmup (~90-215ms measured) directly onto the
    // startup critical path. The eager .catch keeps a server failure (EADDRINUSE)
    // from surfacing as an unhandled rejection while the shell is still loading;
    // it is re-thrown at the await below, where the caller already handles it.
    let pendingRuntime = null;
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
        mark('runtime-kickoff');
        pendingRuntime = startRuntimeServer(runtimeOptions);
        pendingRuntime.catch(() => {});
    }

    const launchShellLoaded = await loadWindowUrlSafely(
        activeWindow,
        buildLaunchShellDataUrl({
            iconDataUrl: resolveLaunchIconDataUrl(),
        })
    );
    mark('after-launch-shell');
    if (!launchShellLoaded) return null;

    if (pendingRuntime) {
        runtime = await pendingRuntime;
        mark('after-runtime');
    }
    if (activeWindow.isDestroyed()) return null;

    const guardMainFrameNavigation = (event, url) => {
        if (isInternalUrl(url, runtime.url)) {
            return;
        }

        event.preventDefault();
        if (isSafeExternalUrl(url)) {
            openSafeExternalUrlInBackground(url);
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
            openSafeExternalUrlInBackground(url);
        }
        return { action: 'deny' };
    });

    activeWindow.webContents.on('did-create-window', (childWindow, details = {}) => {
        childWindow.setMenuBarVisibility(false);
        if (isAuthWindowUrl(details.url || '')) {
            childWindow.webContents.setUserAgent(DESKTOP_AUTH_USER_AGENT);
            childWindow.center();
        }
        const guardAuthWindowNavigation = (event, url) => {
            if (isAllowedAuthWindowNavigation(url, runtime.url)) {
                return;
            }

            event.preventDefault();
            if (isSafeExternalUrl(url)) {
                openSafeExternalUrlInBackground(url);
            }
        };
        childWindow.webContents.on('will-navigate', guardAuthWindowNavigation);
        childWindow.webContents.on('will-redirect', guardAuthWindowNavigation);
        childWindow.webContents.setWindowOpenHandler(({ url }) => {
            if (isAllowedAuthWindowNavigation(url, runtime.url)) {
                return {
                    action: 'allow',
                    overrideBrowserWindowOptions: buildAuthWindowOptions(activeWindow),
                };
            }

            if (isSafeExternalUrl(url)) {
                openSafeExternalUrlInBackground(url);
            }
            return { action: 'deny' };
        });
    });

    mark('before-app-load');
    const appLoaded = await loadWindowUrlSafely(
        activeWindow,
        buildDesktopStartupUrl(runtime.url, app.getVersion())
    );
    mark('after-app-load');
    if (appLoaded) {
        const interactiveMs = Date.now() - startupStartedAt;
        // Budget the reveal the user actually perceives, and hold the full
        // interactive cost to a separate loose backstop. Reporting only one of
        // the two would hide a regression in the other: budget the navigation
        // and a fast splash looks slow, budget the reveal and a hung SPA looks
        // fine.
        const startup = evaluateDesktopStartup({
            startedAt: startupStartedAt,
            finishedAt: revealedAt || Date.now(),
        });
        const interactiveWithinBackstop = interactiveMs <= DEFAULT_DESKTOP_INTERACTIVE_BACKSTOP_MS;
        const message = `[desktop:sre] startup ready in ${startup.durationMs}ms `
            + `(budget ${startup.budgetMs}ms), interactive in ${interactiveMs}ms `
            + `(backstop ${DEFAULT_DESKTOP_INTERACTIVE_BACKSTOP_MS}ms).`;
        if (startup.withinBudget && interactiveWithinBackstop) {
            console.info(message);
        } else {
            console.warn(message);
        }
    }
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
    const shouldStart = shouldStartAutoUpdateChecks({
        isPackaged: app.isPackaged,
        autoUpdateDisabled: process.env.AURA_DESKTOP_AUTO_UPDATE === 'false',
        alreadyStarted: updateChecksStarted,
    });
    if (!shouldStart) {
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

        if (!shouldPromptForRestart({ promptAlreadyShown: updateReadyPromptShown })) {
            return;
        }

        updateReadyPromptShown = true;
        const targetWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        const updatePrompt = buildUpdateRestartPrompt();
        const promptPromise = targetWindow
            ? dialog.showMessageBox(targetWindow, updatePrompt)
            : dialog.showMessageBox(updatePrompt);

        promptPromise.then(({ response }) => {
            if (!shouldInstallUpdateNow({ response })) {
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
        if (shouldCheckForUpdatesOnFocus({ lastCheckAt: lastUpdateCheckAt })) {
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
    const window = await ensureMainWindow();
    if (reportDesktopBootSmoke(window)) {
        return;
    }
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
        // The smoke harness reads the marker line, not the error box, which
        // would block forever on a headless runner.
        if (!reportDesktopBootSmoke(null)) {
            dialog.showErrorBox(
                'Aura Marketplace Desktop',
                error?.message || 'The desktop app failed to start.'
            );
        }
        app.exit(1);
    });
}
