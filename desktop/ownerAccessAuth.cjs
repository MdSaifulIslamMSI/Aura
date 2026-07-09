const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DESKTOP_OWNER_ACCESS_AUDIENCE = 'aura.desktop.owner.access.v1';
const DESKTOP_OWNER_ACCESS_ENDPOINT = '/api/auth/desktop-handoff/owner-access-token';
const MIN_OWNER_ACCESS_KEY_BYTES = 32;

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
    if (keyFile && fs.existsSync(keyFile)) {
        return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'utf8');
    }

    return Buffer.alloc(0);
};

const isDesktopOwnerAccessSignInConfigured = (env = process.env) => (
    parseBooleanEnv(env?.AURA_DESKTOP_OWNER_ACCESS_ENABLED, false)
    && readOwnerAccessKeyMaterial(env).length >= MIN_OWNER_ACCESS_KEY_BYTES
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
} = {}) => {
    const key = readOwnerAccessKeyMaterial(env);
    if (!parseBooleanEnv(env?.AURA_DESKTOP_OWNER_ACCESS_ENABLED, false) || key.length < MIN_OWNER_ACCESS_KEY_BYTES) {
        throw new Error('Desktop owner access is not configured for this app.');
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

    const response = await fetchImpl(`${trimTrailingSlash(backendOrigin)}${DESKTOP_OWNER_ACCESS_ENDPOINT}`, {
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
    });
    const result = await response.json().catch(() => ({}));

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
    DESKTOP_OWNER_ACCESS_AUDIENCE,
    DESKTOP_OWNER_ACCESS_ENDPOINT,
    buildDesktopOwnerAccessPayload,
    createDesktopOwnerAccessSignIn,
    createDesktopOwnerAccessSignature,
    isDesktopOwnerAccessSignInConfigured,
};
