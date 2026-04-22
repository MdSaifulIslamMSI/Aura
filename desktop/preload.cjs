const { contextBridge, ipcRenderer } = require('electron');

const UPDATE_EVENT_NAME = 'aura-desktop-update';

const emitUpdateEvent = (detail = {}) => {
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT_NAME, { detail }));
};

ipcRenderer.on('desktop:update:status', (_event, payload = {}) => {
    emitUpdateEvent(payload);
});

contextBridge.exposeInMainWorld('auraDesktop', {
    isDesktop: true,
    checkForUpdates: () => ipcRenderer.invoke('desktop:update:check'),
    getAppInfo: () => ipcRenderer.invoke('desktop:app-info'),
    installUpdateNow: () => ipcRenderer.invoke('desktop:update:install-now'),
    onUpdateStatus: (listener) => {
        if (typeof listener !== 'function') {
            return () => {};
        }

        const handler = (event) => listener(event.detail || {});
        window.addEventListener(UPDATE_EVENT_NAME, handler);
        return () => window.removeEventListener(UPDATE_EVENT_NAME, handler);
    },
});
