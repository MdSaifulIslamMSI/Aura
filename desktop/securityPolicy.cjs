const fs = require('fs');
const path = require('path');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

// Committed allowlist of HTTPS hosts permitted to open an Electron auth window.
// Single-sourced into config/desktop-auth-window-hosts.json.
//
// This is a trust boundary, so it is a committed artifact rather than an env
// override: an env var would make the OAuth popup allowlist runtime-mutable, and
// a compromised or misconfigured environment could widen it to an attacker host.
//
// Loading must never throw. The fallback below is a committed copy of the
// artifact, and securityPolicy.test.cjs asserts the two cannot silently diverge,
// so a packaging regression degrades to the known-good list instead of bricking
// the app at require time.
const AUTH_WINDOW_HOSTS_FALLBACK = Object.freeze([
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

const readGeneratedAuthWindowHosts = () => {
    const candidates = [
        path.join(__dirname, '..', 'config', 'desktop-auth-window-hosts.json'),
        path.join(process.resourcesPath || '', 'config', 'desktop-auth-window-hosts.json'),
    ];

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
            const hosts = Array.isArray(parsed?.hosts) ? parsed.hosts : [];
            const normalized = [...new Set(
                hosts
                    .filter((host) => typeof host === 'string')
                    .map((host) => host.trim().toLowerCase())
                    .filter(Boolean)
            )];

            // An empty or malformed artifact must not silently disable every
            // auth popup; that would break sign-in rather than fail loudly.
            if (normalized.length > 0) {
                return normalized;
            }
        } catch {
            // Try the next candidate.
        }
    }

    return null;
};

const AUTH_WINDOW_HOSTS = new Set(readGeneratedAuthWindowHosts() || AUTH_WINDOW_HOSTS_FALLBACK);

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
    AUTH_WINDOW_HOSTS,
    AUTH_WINDOW_HOSTS_FALLBACK,
    canGrantDesktopRuntimePermission,
    isAllowedAuthWindowNavigation,
    isAuthWindowUrl,
    isInternalUrl,
    isSafeExternalUrl,
    isTrustedDesktopIpcSender,
};
