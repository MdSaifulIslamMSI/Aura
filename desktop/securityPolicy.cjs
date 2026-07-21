const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

const AUTH_WINDOW_HOSTS = new Set([
    'accounts.google.com',
    'billy-b674c.firebaseapp.com',
    'billy-b674c.web.app',
    'facebook.com',
    'github.com',
    'm.facebook.com',
    'mobile.facebook.com',
    'oauth.twitter.com',
    'twitter.com',
    'www.facebook.com',
    'www.github.com',
    'x.com',
]);

const DESKTOP_RUNTIME_PERMISSIONS = new Set([
    'display-capture',
    'fullscreen',
    'media',
    'notifications',
]);

const isInternalUrl = (candidate, runtimeUrl) => {
    try {
        const target = new URL(candidate);
        const runtimeTarget = new URL(runtimeUrl);

        if (target.origin === runtimeTarget.origin) {
            return true;
        }

        return target.protocol === runtimeTarget.protocol
            && target.port === runtimeTarget.port
            && LOOPBACK_HOSTS.has(target.hostname)
            && LOOPBACK_HOSTS.has(runtimeTarget.hostname);
    } catch {
        return false;
    }
};

const isAuthWindowUrl = (candidate) => {
    try {
        const target = new URL(candidate);
        return target.protocol === 'https:'
            && AUTH_WINDOW_HOSTS.has(target.hostname.toLowerCase());
    } catch {
        return false;
    }
};

const isAllowedAuthWindowNavigation = (candidate, runtimeUrl) => (
    isAuthWindowUrl(candidate) || isInternalUrl(candidate, runtimeUrl)
);

const isSafeExternalUrl = (candidate) => {
    try {
        return new Set(['https:', 'mailto:', 'tel:']).has(new URL(candidate).protocol);
    } catch {
        return false;
    }
};

const normalizeRuntimePermission = (permission) => {
    const nextPermission = String(permission || '').trim();
    if (nextPermission === 'audioCapture' || nextPermission === 'videoCapture') {
        return 'media';
    }
    return nextPermission;
};

const canGrantDesktopRuntimePermission = (permission, requestUrl, runtimeUrl) => (
    DESKTOP_RUNTIME_PERMISSIONS.has(normalizeRuntimePermission(permission))
    && isInternalUrl(requestUrl, runtimeUrl)
);

const isTrustedDesktopIpcSender = ({ event, mainWindow, runtimeUrl }) => {
    const webContents = mainWindow?.webContents;
    const senderFrame = event?.senderFrame;
    if (
        !webContents
        || event?.sender !== webContents
        || !senderFrame
        || senderFrame !== webContents.mainFrame
    ) {
        return false;
    }

    return isInternalUrl(
        senderFrame.url || event.sender?.getURL?.() || '',
        runtimeUrl
    );
};

module.exports = {
    canGrantDesktopRuntimePermission,
    isAllowedAuthWindowNavigation,
    isAuthWindowUrl,
    isInternalUrl,
    isSafeExternalUrl,
    isTrustedDesktopIpcSender,
};
