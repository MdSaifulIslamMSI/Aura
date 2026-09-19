/**
 * Cutover probe for the Firebase Admin SDK service-account credentials.
 *
 * Resolves the SAME credential sources the runtime uses (server/config/firebase.js): *   1. FIREBASE_SERVICE_ACCOUNT        — full service-account JSON blob
 *   2. FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY — discrete scalars
 *      (embedded \n escapes handled like the runtime)
 * and proves the credentials are live by signing a JWT and exchanging it at
 * Google's OAuth2 token endpoint. This is read-only against Google: a token
 * mint grants nothing until used, and no Firebase data is touched.
 *
 * Use it twice during the key rotation runbook (docs/runbook-firebase-key-rotation.md):
 * after importing the NEW key into SSM, and again after the old key is
 * deleted — the second run must still pass, proving cutover completed.
 *
 * Exit 0 = credentials valid; exit 1 = invalid/unresolvable.
 * Never prints the key material — only the service-account email and expiry.
 *
 * Usage: node scripts/verify_firebase_admin_credentials.js
 */
const crypto = require('crypto');
const {
    loadLocalEnvFiles,
    primeAwsParameterStoreEnv,
} = require('../config/runtimeConfig');

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_TIMEOUT_MS = 15000;

// Mirrors the readEnv semantics of server/config/firebase.js without
// importing it — that module initializes the Firebase admin app on load,
// which a credential probe must not do.
const readEnv = (name) => {
    const value = String(process.env[name] ?? '').trim();
    return value || '';
};

const resolveServiceAccount = () => {
    const blob = readEnv('FIREBASE_SERVICE_ACCOUNT');
    if (blob) {
        try {
            return { account: JSON.parse(blob), source: 'FIREBASE_SERVICE_ACCOUNT' };
        } catch (error) {
            throw new Error(`FIREBASE_SERVICE_ACCOUNT is not valid JSON: ${error.message}`);
        }
    }

    const clientEmail = readEnv('FIREBASE_CLIENT_EMAIL');
    const privateKey = readEnv('FIREBASE_PRIVATE_KEY');
    if (clientEmail && privateKey) {
        return {
            account: {
                client_email: clientEmail,
                private_key: privateKey.replace(/\\n/g, '\n'),
                project_id: readEnv('FIREBASE_PROJECT_ID'),
            },
            source: 'FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY',
        };
    }

    return null;
};

const base64url = (buffer) => Buffer.from(buffer).toString('base64url');

const mintAccessToken = async (account) => {
    const issuedAt = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({
        iss: account.client_email,
        sub: account.client_email,
        scope: SCOPE,
        aud: TOKEN_ENDPOINT,
        iat: issuedAt,
        exp: issuedAt + 3600,
    }));
    const signature = crypto
        .createSign('RSA-SHA256')
        .update(`${header}.${payload}`)
        .sign(account.private_key)
        .toString('base64url');

    const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: `${header}.${payload}.${signature}`,
        }),
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
};

const run = async () => {
    loadLocalEnvFiles();
    // Match the runtime: when Parameter Store priming is enabled, secrets
    // come from SSM (this is where FIREBASE_* live in production). Best
    // effort — with priming unavailable, fall back to the local env.
    try {
        await primeAwsParameterStoreEnv({ logger: console });
    } catch (error) {
        console.error(`Parameter Store priming skipped: ${error.message}`);
    }

    const resolved = resolveServiceAccount();
    if (!resolved) {
        console.error('No Firebase admin credentials in environment.');
        console.error('Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.');
        process.exit(1);
    }

    const { account, source } = resolved;
    const email = String(account.client_email || '');
    if (!email || !account.private_key) {
        console.error(`Credential source "${source}" is missing client_email or private_key.`);
        process.exit(1);
    }

    console.log(`credential source : ${source}`);
    console.log(`service account   : ${email}`);
    console.log(`project           : ${account.project_id || '(not set)'}`);

    let result;
    try {
        result = await mintAccessToken(account);
    } catch (error) {
        console.error(`Token exchange failed (network): ${error.message}`);
        process.exit(1);
    }

    if (result.status !== 200 || !result.body.access_token) {
        const detail = result.body.error_description || result.body.error || `HTTP ${result.status}`;
        console.error(`KEY INVALID: Google rejected the assertion — ${detail}`);
        console.error('If this follows an old-key deletion, the SSM values are stale; re-check the runbook step that updates them.');
        process.exit(1);
    }

    console.log(`KEY VALID: access token minted, expires_in=${result.body.expires_in}s`);
    console.log('This proves the private key is active and matches the service-account email.');
};

run().catch((error) => {
    console.error(`probe failed: ${error.message}`);
    process.exit(1);
});
