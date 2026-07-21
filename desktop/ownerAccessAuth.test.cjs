const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    MAX_OWNER_ACCESS_KEY_FILE_BYTES,
    buildDesktopOwnerAccessPayload,
    createDesktopOwnerAccessSignIn,
    createDesktopOwnerAccessSignature,
    isDesktopOwnerAccessSignInAvailable,
    isDesktopOwnerAccessSignInConfigured,
    isLoopbackBackendOrigin,
} = require('./ownerAccessAuth.cjs');

test('desktop owner access signs a fresh handoff assertion without certificates', async () => {
    const accessKey = crypto.randomBytes(48).toString('base64url');
    const env = {
        AURA_DESKTOP_OWNER_ACCESS_ENABLED: 'true',
        AURA_DESKTOP_OWNER_ACCESS_KEY: accessKey,
        AURA_DESKTOP_OWNER_FIREBASE_UID: 'owner-firebase-uid',
    };
    let capturedUrl = '';
    let capturedBody = null;

    const result = await createDesktopOwnerAccessSignIn({
        backendOrigin: 'http://127.0.0.1:5000/',
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
    assert.equal(capturedUrl, 'http://127.0.0.1:5000/api/auth/desktop-handoff/owner-access-token');
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
        backendOrigin: 'http://localhost:5000',
        env: { AURA_DESKTOP_OWNER_ACCESS_ENABLED: 'true' },
        fetchImpl: async () => {
            throw new Error('fetch should not run');
        },
    }), /not configured/);

    await assert.rejects(() => createDesktopOwnerAccessSignIn({
        backendOrigin: 'http://localhost:5000',
        env: {
            AURA_DESKTOP_OWNER_ACCESS_ENABLED: 'true',
            AURA_DESKTOP_OWNER_ACCESS_KEY: crypto.randomBytes(48).toString('base64url'),
        },
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
            AURA_DESKTOP_OWNER_FIREBASE_UID: 'owner-firebase-uid',
        }), true);
    } finally {
        fs.rmSync(tmpDir, { force: true, recursive: true });
    }
});

test('desktop owner access fails closed for directories and oversized key files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-owner-access-invalid-file-'));
    const oversizedKeyFile = path.join(tmpDir, 'oversized-owner-access.key');
    fs.writeFileSync(oversizedKeyFile, 'a'.repeat(MAX_OWNER_ACCESS_KEY_FILE_BYTES + 1));

    try {
        for (const keyFile of [tmpDir, oversizedKeyFile]) {
            const env = {
                AURA_DESKTOP_OWNER_ACCESS_ENABLED: 'true',
                AURA_DESKTOP_OWNER_ACCESS_KEY_FILE: keyFile,
                AURA_DESKTOP_OWNER_FIREBASE_UID: 'owner-firebase-uid',
            };
            assert.doesNotThrow(() => isDesktopOwnerAccessSignInConfigured(env));
            assert.equal(isDesktopOwnerAccessSignInConfigured(env), false);
            assert.equal(isDesktopOwnerAccessSignInAvailable({
                backendOrigin: 'http://localhost:5000',
                env,
                isPackaged: false,
            }), false);
        }
    } finally {
        fs.rmSync(tmpDir, { force: true, recursive: true });
    }
});

test('desktop owner access is exposed only for unpackaged apps using a loopback backend', () => {
    const env = {
        AURA_DESKTOP_OWNER_ACCESS_ENABLED: 'true',
        AURA_DESKTOP_OWNER_ACCESS_KEY: crypto.randomBytes(48).toString('base64url'),
        AURA_DESKTOP_OWNER_FIREBASE_UID: 'owner-firebase-uid',
    };

    assert.equal(isDesktopOwnerAccessSignInAvailable({
        backendOrigin: 'http://localhost:5000',
        env,
        isPackaged: false,
    }), true);
    assert.equal(isDesktopOwnerAccessSignInAvailable({
        backendOrigin: 'https://127.0.0.12:5000',
        env,
        isPackaged: false,
    }), true);
    assert.equal(isDesktopOwnerAccessSignInAvailable({
        backendOrigin: 'http://[::1]:5000',
        env,
        isPackaged: false,
    }), true);
    assert.equal(isDesktopOwnerAccessSignInAvailable({
        backendOrigin: 'https://api.example.test',
        env,
        isPackaged: false,
    }), false);
    assert.equal(isDesktopOwnerAccessSignInAvailable({
        backendOrigin: 'http://127.attacker.example:5000',
        env,
        isPackaged: false,
    }), false);
    assert.equal(isDesktopOwnerAccessSignInAvailable({
        backendOrigin: 'http://localhost:5000',
        env,
        isPackaged: true,
    }), false);
    assert.equal(isDesktopOwnerAccessSignInAvailable({
        backendOrigin: 'http://localhost:5000',
        env: { AURA_DESKTOP_OWNER_ACCESS_ENABLED: 'true' },
        isPackaged: false,
    }), false);
    assert.equal(isDesktopOwnerAccessSignInAvailable({
        backendOrigin: 'http://localhost:5000',
        env: {
            AURA_DESKTOP_OWNER_ACCESS_ENABLED: 'true',
            AURA_DESKTOP_OWNER_ACCESS_KEY: crypto.randomBytes(48).toString('base64url'),
        },
        isPackaged: false,
    }), false);
});

test('desktop owner access rejects remote backends before making a request', async () => {
    const env = {
        AURA_DESKTOP_OWNER_ACCESS_ENABLED: 'true',
        AURA_DESKTOP_OWNER_ACCESS_KEY: crypto.randomBytes(48).toString('base64url'),
        AURA_DESKTOP_OWNER_FIREBASE_UID: 'owner-firebase-uid',
    };
    let requestAttempted = false;

    await assert.rejects(() => createDesktopOwnerAccessSignIn({
        backendOrigin: 'https://dbtrhsolhec1s.cloudfront.net',
        env,
        fetchImpl: async () => {
            requestAttempted = true;
            throw new Error('remote request must not run');
        },
    }), /requires a loopback backend/);

    assert.equal(requestAttempted, false);
});

test('loopback backend detection rejects wildcard, remote, and lookalike hosts', () => {
    assert.equal(isLoopbackBackendOrigin('http://localhost:5000'), true);
    assert.equal(isLoopbackBackendOrigin('https://127.0.0.1:5000'), true);
    assert.equal(isLoopbackBackendOrigin('http://[::1]:5000'), true);
    assert.equal(isLoopbackBackendOrigin('http://0.0.0.0:5000'), false);
    assert.equal(isLoopbackBackendOrigin('https://api.example.test'), false);
    assert.equal(isLoopbackBackendOrigin('http://127.attacker.example:5000'), false);
    assert.equal(isLoopbackBackendOrigin('ftp://127.0.0.1/resource'), false);
    assert.equal(isLoopbackBackendOrigin('not-a-url'), false);
});

test('development owner access times out instead of blocking browser sign-in indefinitely', async () => {
    const env = {
        AURA_DESKTOP_OWNER_ACCESS_ENABLED: 'true',
        AURA_DESKTOP_OWNER_ACCESS_KEY: crypto.randomBytes(48).toString('base64url'),
        AURA_DESKTOP_OWNER_FIREBASE_UID: 'owner-firebase-uid',
    };

    await assert.rejects(() => createDesktopOwnerAccessSignIn({
        backendOrigin: 'http://localhost:5000',
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
        AURA_DESKTOP_OWNER_FIREBASE_UID: 'owner-firebase-uid',
    };

    await assert.rejects(() => createDesktopOwnerAccessSignIn({
        backendOrigin: 'http://localhost:5000',
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
