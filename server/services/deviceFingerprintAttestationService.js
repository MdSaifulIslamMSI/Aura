const crypto = require('crypto');

// Phase 5B: server-issued device fingerprint attestation. The raw
// x-device-fingerprint header is client-asserted and trivially rotated, which
// fragments limiter keys and poisons device-trust decisions. At session
// establishment the server signs the observed fingerprint together with the
// session id into an httpOnly cookie; consumers prefer the attested value and
// only fall back to the raw header when no valid attestation exists.
//
// Flag: SIGNED_DEVICE_FINGERPRINT_ENABLED=true with
// DEVICE_FP_ATTEST_SECRET (falls back to AUTH_RISK_SIGNAL_SECRET).

const ATTESTATION_COOKIE_NAME = 'aura_dfa';
const ATTESTATION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const trim = (value = '') => String(value || '').trim();

const isSignedDeviceFingerprintEnabled = () => (
    String(process.env.SIGNED_DEVICE_FINGERPRINT_ENABLED || '').trim().toLowerCase() === 'true'
);

const getAttestationSecret = () => (
    trim(process.env.DEVICE_FP_ATTEST_SECRET) || trim(process.env.AUTH_RISK_SIGNAL_SECRET)
);

const base64Url = (value) => Buffer.from(value).toString('base64url');
const fromBase64Url = (value) => Buffer.from(String(value || ''), 'base64url').toString('utf8');

const signPayload = (canonical, secret) => crypto
    .createHmac('sha256', secret)
    .update(canonical)
    .digest('base64url');

// Builds the attestation cookie value: base64url(fp|sessionId|exp).sig
const buildDeviceFingerprintAttestation = ({ fingerprint = '', sessionId = '', now = Date.now() } = {}) => {
    const fp = trim(fingerprint);
    const secret = getAttestationSecret();
    if (!isSignedDeviceFingerprintEnabled() || !secret || !fp) {
        return { enabled: false, attestation: '' };
    }
    const exp = now + ATTESTATION_TTL_MS;
    const canonical = `${fp}|${trim(sessionId)}|${exp}`;
    const payload = base64Url(canonical);
    const signature = signPayload(canonical, secret);
    return { enabled: true, attestation: `${payload}.${signature}` };
};

// Verifies an attestation against the presented fingerprint. Returns the
// attested fingerprint only when the signature, session binding, expiry, and
// presented fingerprint all match.
const verifyDeviceFingerprintAttestation = ({
    attestation = '',
    fingerprint = '',
    sessionId = '',
    now = Date.now(),
} = {}) => {
    const secret = getAttestationSecret();
    const presented = trim(fingerprint);
    const raw = trim(attestation);
    if (!secret || !raw || !raw.includes('.')) {
        return { trusted: false, fingerprint: '' };
    }
    const [payload, signature] = raw.split('.');
    if (!payload || !signature) {
        return { trusted: false, fingerprint: '' };
    }
    let canonical;
    try {
        canonical = fromBase64Url(payload);
    } catch {
        return { trusted: false, fingerprint: '' };
    }
    const expected = signPayload(canonical, secret);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return { trusted: false, fingerprint: '' };
    }
    const [attestedFp, attestedSession, expRaw] = canonical.split('|');
    const exp = Number(expRaw) || 0;
    if (!attestedFp || exp <= now) {
        return { trusted: false, fingerprint: '' };
    }
    if (trim(sessionId) && attestedSession && attestedSession !== trim(sessionId)) {
        return { trusted: false, fingerprint: '' };
    }
    if (presented && attestedFp !== presented) {
        return { trusted: false, fingerprint: '' };
    }
    return { trusted: true, fingerprint: attestedFp };
};

// Cookie options mirror the browser session cookie posture.
const attestationCookieOptions = ({ isProduction = false } = {}) => ({
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: ATTESTATION_TTL_MS,
    path: '/',
});

const resolveTrustedDeviceFingerprint = (req = {}) => {
    const cookieHeader = trim(req.headers?.cookie);
    if (!cookieHeader) return { trusted: false, fingerprint: '' };
    const cookies = Object.fromEntries(
        cookieHeader.split(';')
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => {
                const eq = part.indexOf('=');
                return eq === -1 ? [part, ''] : [part.slice(0, eq), part.slice(eq + 1)];
            })
    );
    return verifyDeviceFingerprintAttestation({
        attestation: cookies[ATTESTATION_COOKIE_NAME] || '',
        fingerprint: trim(req.headers?.['x-device-fingerprint']),
        sessionId: trim(req.authSession?.sessionId),
    });
};

module.exports = {
    ATTESTATION_COOKIE_NAME,
    ATTESTATION_TTL_MS,
    attestationCookieOptions,
    buildDeviceFingerprintAttestation,
    getAttestationSecret,
    isSignedDeviceFingerprintEnabled,
    resolveTrustedDeviceFingerprint,
    verifyDeviceFingerprintAttestation,
};
