const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');

const DESKTOP_OWNER_ACCESS_AUDIENCE = 'aura.desktop.owner.access.v1';
const DESKTOP_OWNER_ACCESS_ENDPOINT = '/api/auth/desktop-handoff/owner-access-token';
const MIN_OWNER_ACCESS_KEY_BYTES = 32;
const MAX_OWNER_ACCESS_KEY_FILE_BYTES = 4096;
const DEFAULT_OWNER_ACCESS_TIMEOUT_MS = 8000;

const parseBooleanEnv = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const trimTrailingSlash = (value = '') => String(value || '').replace(/\/+$/, '');

const decodeBase64Url = (value = '') => {
    const normalized = String(value || '').trim().replace(/-/g, '+').replace(/_/g, '/');
    if (!normalized) return Buffer.alloc(0);
    return Buffer.from(`${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`, 'base64');
};

const resolveOwnerAccessKeyFile = (env = process.env) => {
    const configured = String(env?.AURA_DESKTOP_OWNER_ACCESS_KEY_FILE || '').trim();
    if (!configured) return '';
    return path.isAbsolute(configured)
        ? configured
        : path.resolve(process.cwd(), configured);
};

const readOwnerAccessKeyMaterial = (env = process.env) => {
    const direct = String(env?.AURA_DESKTOP_OWNER_ACCESS_KEY || '').trim();
    if (direct) return Buffer.from(direct, 'utf8');

    const base64 = String(env?.AURA_DESKTOP_OWNER_ACCESS_KEY_BASE64 || '').trim();
    if (base64) return decodeBase64Url(base64);

    const keyFile = resolveOwnerAccessKeyFile(env);
    if (keyFile) {
        let fileDescriptor = null;
        try {
            fileDescriptor = fs.openSync(keyFile, 'r');
            const stats = fs.fstatSync(fileDescriptor);
            if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_OWNER_ACCESS_KEY_FILE_BYTES) {
                return Buffer.alloc(0);
            }
            const boundedBuffer = Buffer.alloc(MAX_OWNER_ACCESS_KEY_FILE_BYTES + 1);
            const bytesRead = fs.readSync(
                fileDescriptor,
                boundedBuffer,
                0,
                boundedBuffer.length,
                0
            );
            if (bytesRead <= 0 || bytesRead > MAX_OWNER_ACCESS_KEY_FILE_BYTES) {
                return Buffer.alloc(0);
            }
            return Buffer.from(boundedBuffer.subarray(0, bytesRead).toString('utf8').trim(), 'utf8');
        } catch {
            return Buffer.alloc(0);
        } finally {
            if (fileDescriptor !== null) {
                try {
                    fs.closeSync(fileDescriptor);
                } catch {
                    // The key remains unavailable if the descriptor cannot be closed cleanly.
                }
            }
        }
    }

    return Buffer.alloc(0);
};

const isDesktopOwnerAccessSignInConfigured = (env = process.env) => (
    parseBooleanEnv(env?.AURA_DESKTOP_OWNER_ACCESS_ENABLED, false)
    && Boolean(String(env?.AURA_DESKTOP_OWNER_FIREBASE_UID || '').trim())
    && readOwnerAccessKeyMaterial(env).length >= MIN_OWNER_ACCESS_KEY_BYTES
);

const isLoopbackBackendOrigin = (backendOrigin = '') => {
    try {
        const url = new URL(backendOrigin);
        if (!['http:', 'https:'].includes(url.protocol)) return false;

        const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
        if (hostname === 'localhost' || hostname === '::1') return true;
        return net.isIP(hostname) === 4 && hostname.split('.')[0] === '127';
    } catch {
        return false;
    }
};

const isDesktopOwnerAccessSignInAvailable = ({
    backendOrigin = '',
    env = process.env,
    isPackaged = false,
} = {}) => (
    !isPackaged
    && isLoopbackBackendOrigin(backendOrigin)
    && isDesktopOwnerAccessSignInConfigured(env)
);

const buildDesktopOwnerAccessPayload = ({
    requestId = '',
    issuedAt = '',
    nonce = '',
} = {}) => [
    DESKTOP_OWNER_ACCESS_AUDIENCE,
    String(requestId || '').trim(),
    String(issuedAt || '').trim(),
    String(nonce || '').trim(),
].join('\n');

const createDesktopOwnerAccessSignature = (payload, key) => crypto
    .createHmac('sha256', key)
    .update(payload)
    .digest('base64url');

const createDesktopOwnerAccessSignIn = async ({
    backendOrigin = '',
    env = process.env,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    timeoutMs = DEFAULT_OWNER_ACCESS_TIMEOUT_MS,
} = {}) => {
    const key = readOwnerAccessKeyMaterial(env);
    if (!isDesktopOwnerAccessSignInConfigured(env)) {
        throw new Error('Desktop owner access is not configured for this app.');
    }
    if (!isLoopbackBackendOrigin(backendOrigin)) {
        throw new Error('Desktop owner access requires a loopback backend. Continue in your browser instead.');
    }
    if (typeof fetchImpl !== 'function') {
        throw new Error('Desktop owner access requires fetch support.');
    }

    const requestId = crypto.randomUUID();
    const issuedAt = new Date(Number(now())).toISOString();
    const nonce = crypto.randomBytes(24).toString('base64url');
    const payload = buildDesktopOwnerAccessPayload({
        requestId,
        issuedAt,
        nonce,
    });
    const signature = createDesktopOwnerAccessSignature(payload, key);

    const controller = new AbortController();
    const resolvedTimeoutMs = Math.max(Number(timeoutMs) || DEFAULT_OWNER_ACCESS_TIMEOUT_MS, 1);
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error('Desktop owner access timed out. Continue in your browser instead.'));
        }, resolvedTimeoutMs);
    });
    let response;
    let result;
    try {
        ({ response, result } = await Promise.race([
            (async () => {
                const nextResponse = await fetchImpl(`${trimTrailingSlash(backendOrigin)}${DESKTOP_OWNER_ACCESS_ENDPOINT}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        requestId,
                        issuedAt,
                        nonce,
                        signature,
                    }),
                    signal: controller.signal,
                });
                const nextResult = await nextResponse.json().catch(() => ({}));
                return { response: nextResponse, result: nextResult };
            })(),
            timeout,
        ]));
    } finally {
        clearTimeout(timeoutId);
    }

    if (!response.ok || !result?.success || !result?.customToken) {
        throw new Error(result?.message || 'Desktop owner access failed.');
    }

    return {
        success: true,
        customToken: result.customToken,
        expiresInSeconds: result.expiresInSeconds || 0,
    };
};

module.exports = {
    DEFAULT_OWNER_ACCESS_TIMEOUT_MS,
    DESKTOP_OWNER_ACCESS_AUDIENCE,
    DESKTOP_OWNER_ACCESS_ENDPOINT,
    MAX_OWNER_ACCESS_KEY_FILE_BYTES,
    buildDesktopOwnerAccessPayload,
    createDesktopOwnerAccessSignIn,
    createDesktopOwnerAccessSignature,
    isDesktopOwnerAccessSignInAvailable,
    isDesktopOwnerAccessSignInConfigured,
    isLoopbackBackendOrigin,
};
