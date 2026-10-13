// Window geometry and Chrome settings for the desktop shell, with no Electron
// imports so it can be unit tested. main.cjs resolves these against the live
// screen and BrowserWindow.

const MIN_WINDOW_WIDTH = 1080;
const MIN_WINDOW_HEIGHT = 720;
const AUTH_WINDOW_OPTIONS = Object.freeze({
    width: 640,
    height: 780,
    minWidth: 520,
    minHeight: 560,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    modal: false,
});

// Clamps the initial window into a usable range on every display size. A 4K
// screen should not open a 4K-wide window, and a small netbook screen must
// still get something above the minimum.
const getInitialWindowBounds = ({
    width,
    height,
    minWidth = 1180,
    maxWidth = 1680,
    minHeight = 760,
    maxHeight = 1040,
} = {}) => ({
    width: Math.max(minWidth, Math.min(Number(width) || 0, maxWidth)),
    height: Math.max(minHeight, Math.min(Number(height) || 0, maxHeight)),
});

// Auth popups run sandboxed with no Node access and share the parent's session,
// so an OAuth flow cannot reach the main window's storage or the preload bridge.
const buildAuthWindowWebPreferences = (parentWindow) => ({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    session: parentWindow?.webContents?.session,
});

const buildAuthWindowOptions = (parentWindow) => ({
    ...AUTH_WINDOW_OPTIONS,
    parent: parentWindow,
    webPreferences: buildAuthWindowWebPreferences(parentWindow),
});

// The main renderer is hardened the same way. contextIsolation + sandbox with a
// narrow contextBridge surface is what makes the preload contract meaningful.
const buildMainWindowWebPreferences = ({ preloadPath } = {}) => ({
    backgroundThrottling: false,
    contextIsolation: true,
    nodeIntegration: false,
    preload: preloadPath,
    sandbox: true,
});

// Remote content is never allowed to drive the zoom level; the app's own
// layout is sized for 1.0 and user zoom would break it.
const MAIN_WINDOW_ZOOM = 1;

module.exports = {
    AUTH_WINDOW_OPTIONS,
    MAIN_WINDOW_ZOOM,
    MIN_WINDOW_HEIGHT,
    MIN_WINDOW_WIDTH,
    buildAuthWindowOptions,
    buildAuthWindowWebPreferences,
    buildMainWindowWebPreferences,
    getInitialWindowBounds,
};