const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    buildDesktopOwnerAccessPayload,
    createDesktopOwnerAccessSignIn,
    createDesktopOwnerAccessSignature,
    isDesktopOwnerAccessSignInAvailable,
    isDesktopOwnerAccessSignInConfigured,
} = require('./ownerAccessAuth.cjs');

test('desktop owner access signs a fresh handoff assertion without certificates', async () => {
    const accessKey = crypto.randomBytes(48).toString('base64url');
    const env = {
        AURA_DESKTOP_OWNER_ACCESS_ENABLED: 'true',
        AURA_DESKTOP_OWNER_ACCESS_KEY: accessKey,
    };
    let capturedUrl = '';
    let capturedBody = null;

    const result = await createDesktopOwnerAccessSignIn({
        backendOrigin: 'https://api.example.test/',
        env,
        now: () => Date.parse('2026-07-09T09:00:00.000Z'),
        fetchImpl: async (url, options = {}) => {
            capturedUrl = url;
            capturedBody = JSON.parse(options.body);
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    customToken: 'owner-custom-token',
                    expiresInSeconds: 3600,
                }),
            };
        },
    });

    assert.equal(result.customToken, 'owner-custom-token');
    assert.equal(capturedUrl, 'https://api.example.test/api/auth/desktop-handoff/owner-access-token');
    assert.match(capturedBody.requestId, /^[0-9a-f-]{36}$/);
    assert.equal(capturedBody.issuedAt, '2026-07-09T09:00:00.000Z');
    assert.match(capturedBody.nonce, /^[A-Za-z0-9_-]{16,128}$/);
    assert.equal(
        capturedBody.signature,
        createDesktopOwnerAccessSignature(
            buildDesktopOwnerAccessPayload(capturedBody),
            accessKey
        )
    );
});

test('desktop owner access stays unavailable without local owner key material', async () => {
    assert.equal(isDesktopOwnerAccessSignInConfigured({}), false);

    await assert.rejects(() => createDesktopOwnerAccessSignIn({
        backendOrigin: 'https://api.example.test',
        env: { AURA_DESKTOP_OWNER_ACCESS_ENABLED: 'true' },
        fetchImpl: async () => {
            throw new Error('fetch should not run');
        },
    }), /not configured/);
});

test('desktop owner access can read a local key file outside the bundle', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-owner-access-'));
    const keyFile = path.join(tmpDir, 'owner-access.key');
    fs.writeFileSync(keyFile, crypto.randomBytes(48).toString('base64url'));

    try {
        assert.equal(isDesktopOwnerAccessSignInConfigured({
            AURA_DESKTOP_OWNER_ACCESS_ENABLED: 'true',
            AURA_DESKTOP_OWNER_ACCESS_KEY_FILE: keyFile,
        }), true);
    } finally {
        fs.rmSync(tmpDir, { force: true, recursive: true });
    }
});

test('desktop owner access is never exposed by a packaged public build', () => {
    const env = {
        AURA_DESKTOP_OWNER_ACCESS_ENABLED: 'true',
        AURA_DESKTOP_OWNER_ACCESS_KEY: crypto.randomBytes(48).toString('base64url'),
    };

    assert.equal(isDesktopOwnerAccessSignInAvailable({ env, isPackaged: false }), true);
    assert.equal(isDesktopOwnerAccessSignInAvailable({ env, isPackaged: true }), false);
});

test('development owner access times out instead of blocking browser sign-in indefinitely', async () => {
    const env = {
        AURA_DESKTOP_OWNER_ACCESS_ENABLED: 'true',
        AURA_DESKTOP_OWNER_ACCESS_KEY: crypto.randomBytes(48).toString('base64url'),
    };

    await assert.rejects(() => createDesktopOwnerAccessSignIn({
        backendOrigin: 'https://api.example.test',
        env,
        timeoutMs: 5,
        fetchImpl: async (_url, options = {}) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    }), /timed out/);
});

test('development owner access timeout also covers a stalled response body', async () => {
    const env = {
        AURA_DESKTOP_OWNER_ACCESS_ENABLED: 'true',
        AURA_DESKTOP_OWNER_ACCESS_KEY: crypto.randomBytes(48).toString('base64url'),
    };

    await assert.rejects(() => createDesktopOwnerAccessSignIn({
        backendOrigin: 'https://api.example.test',
        env,
        timeoutMs: 5,
        fetchImpl: async (_url, options = {}) => ({
            ok: true,
            json: async () => new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            }),
        }),
    }), /timed out/);
});
