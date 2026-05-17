const { contextBridge, ipcRenderer } = require('electron');

const UPDATE_EVENT_NAME = 'aura-desktop-update';
const AUTH_EVENT_NAME = 'aura-desktop-auth';

const emitUpdateEvent = (detail = {}) => {
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT_NAME, { detail }));
};

ipcRenderer.on('desktop:update:status', (_event, payload = {}) => {
    emitUpdateEvent(payload);
});

ipcRenderer.on('desktop:auth:status', (_event, payload = {}) => {
    window.dispatchEvent(new CustomEvent(AUTH_EVENT_NAME, { detail: payload }));
});

contextBridge.exposeInMainWorld('auraDesktop', {
    isDesktop: true,
    cancelBrowserSignIn: (requestId) => ipcRenderer.invoke('desktop:auth:cancel-browser-sign-in', requestId),
    consumeBrowserSignIn: (requestId) => ipcRenderer.invoke('desktop:auth:consume-browser-sign-in', requestId),
    checkForUpdates: () => ipcRenderer.invoke('desktop:update:check'),
    getAppInfo: () => ipcRenderer.invoke('desktop:app-info'),
    installUpdateNow: () => ipcRenderer.invoke('desktop:update:install-now'),
    startBrowserSignIn: (options = {}) => ipcRenderer.invoke('desktop:auth:start-browser-sign-in', options),
    onBrowserSignInStatus: (listener) => {
        if (typeof listener !== 'function') {
            return () => {};
        }

        const handler = (event) => listener(event.detail || {});
        window.addEventListener(AUTH_EVENT_NAME, handler);
        return () => window.removeEventListener(AUTH_EVENT_NAME, handler);
    },
    onUpdateStatus: (listener) => {
        if (typeof listener !== 'function') {
            return () => {};
        }

        const handler = (event) => listener(event.detail || {});
        window.addEventListener(UPDATE_EVENT_NAME, handler);
        return () => window.removeEventListener(UPDATE_EVENT_NAME, handler);
    },
});
