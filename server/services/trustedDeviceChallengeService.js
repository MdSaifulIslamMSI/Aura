const crypto = require('crypto');
const User = require('../models/User');

const TRUSTED_DEVICE_ID_HEADER = 'x-aura-device-id';
const TRUSTED_DEVICE_LABEL_HEADER = 'x-aura-device-label';
const TRUSTED_DEVICE_SESSION_HEADER = 'x-aura-device-session';
const DEVICE_CHALLENGE_TTL_MS = Math.max(Number(process.env.AUTH_DEVICE_CHALLENGE_TTL_MS || 90_000), 30_000);
const MAX_TRUSTED_DEVICES = Math.max(Number(process.env.AUTH_TRUSTED_DEVICE_LIMIT || 5), 1);
const DEVICE_SESSION_TTL_MS = Math.max(Number(process.env.AUTH_DEVICE_SESSION_TTL_MS || (12 * 60 * 60 * 1000)), 5 * 60 * 1000);

const SERVER_KEY = (() => {
    const source = String(
        process.env.AUTH_DEVICE_CHALLENGE_SECRET
        || process.env.AUTH_VAULT_SECRET
        || ''
    ).trim();

    return source
        ? crypto.createHash('sha256').update(source).digest()
        : crypto.randomBytes(32);
})();

const normalizeDeviceId = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    if (!/^[A-Za-z0-9:_-]{12,128}$/.test(normalized)) return '';
    return normalized;
};

const normalizeDeviceLabel = (value) => {
    const normalized = String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized.slice(0, 120);
};

const extractTrustedDeviceContext = (req = {}) => ({
    deviceId: normalizeDeviceId(
        req.get?.(TRUSTED_DEVICE_ID_HEADER)
        || req.headers?.[TRUSTED_DEVICE_ID_HEADER]
        || req.body?.deviceId
        || ''
    ),
    deviceLabel: normalizeDeviceLabel(
        req.get?.(TRUSTED_DEVICE_LABEL_HEADER)
        || req.headers?.[TRUSTED_DEVICE_LABEL_HEADER]
        || req.body?.deviceLabel
        || ''
    ),
});

const buildSessionBinding = ({ authUid = '', authToken = null } = {}) => {
    const issuedAt = Number(authToken?.iat || 0);
    return `${String(authUid || '').trim()}:${Number.isFinite(issuedAt) ? issuedAt : 0}`;
};

const sealToken = (payload) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', SERVER_KEY, iv);
    const encoded = Buffer.from(JSON.stringify(payload));
    const ciphertext = Buffer.concat([cipher.update(encoded), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
};

const openToken = (token) => {
    const buffer = Buffer.from(String(token || ''), 'base64url');
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const ciphertext = buffer.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', SERVER_KEY, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
};

const buildChallengeMessage = ({ challenge = '', mode = '', deviceId = '' } = {}) => (
    Buffer.from(`aura-device-proof|${String(mode)}|${String(deviceId)}|${String(challenge)}`, 'utf8')
);

const issueTrustedDeviceSession = ({
    user,
    authUid = '',
    authToken = null,
    deviceId = '',
} = {}) => {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const expiresAt = Date.now() + DEVICE_SESSION_TTL_MS;

    return {
        deviceSessionToken: sealToken({
            typ: 'trusted_device_session',
            sub: String(user?._id || ''),
            deviceId: normalizedDeviceId,
            sessionBinding: buildSessionBinding({ authUid, authToken }),
            exp: expiresAt,
        }),
        expiresAt: new Date(expiresAt).toISOString(),
    };
};

const verifyTrustedDeviceSession = ({
    user,
    authUid = '',
    authToken = null,
    deviceId = '',
    deviceSessionToken = '',
} = {}) => {
    try {
        const payload = openToken(deviceSessionToken);
        const normalizedDeviceId = normalizeDeviceId(deviceId);

        if (payload?.typ !== 'trusted_device_session') {
            return { success: false, reason: 'Trusted device session type mismatch' };
        }
        if (String(payload?.sub || '') !== String(user?._id || '')) {
            return { success: false, reason: 'Trusted device session subject mismatch' };
        }
        if (payload?.deviceId !== normalizedDeviceId) {
            return { success: false, reason: 'Trusted device session device mismatch' };
        }
        if (Date.now() > Number(payload?.exp || 0)) {
            return { success: false, reason: 'Trusted device session expired' };
        }
        if (payload?.sessionBinding !== buildSessionBinding({ authUid, authToken })) {
            return { success: false, reason: 'Trusted device session binding mismatch' };
        }

        return { success: true };
    } catch {
        return { success: false, reason: 'Trusted device session invalid' };
    }
};

const verifyRsaPssSignature = ({ publicKeySpkiBase64 = '', signatureBase64 = '', message }) => {
    const publicKeyDer = Buffer.from(String(publicKeySpkiBase64 || ''), 'base64');
    const signature = Buffer.from(String(signatureBase64 || ''), 'base64');
    if (!publicKeyDer.length || !signature.length) return false;

    return crypto.verify(
        'sha256',
        message,
        {
            key: publicKeyDer,
            format: 'der',
            type: 'spki',
            padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: 32,
        },
        signature
    );
};

const sanitizeTrustedDevice = (device = {}) => ({
    deviceId: normalizeDeviceId(device.deviceId),
    label: normalizeDeviceLabel(device.label),
    algorithm: String(device.algorithm || 'RSA-PSS-SHA256'),
    createdAt: device.createdAt ? new Date(device.createdAt).toISOString() : null,
    lastSeenAt: device.lastSeenAt ? new Date(device.lastSeenAt).toISOString() : null,
    lastVerifiedAt: device.lastVerifiedAt ? new Date(device.lastVerifiedAt).toISOString() : null,
});

const getTrustedDeviceRegistration = (user = null, deviceId = '') => {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (!user || !normalizedDeviceId || !Array.isArray(user.trustedDevices)) {
        return null;
    }

    return user.trustedDevices.find((entry) => normalizeDeviceId(entry?.deviceId) === normalizedDeviceId) || null;
};

const isTrustedDeviceRegisteredForUser = (user = null, deviceId = '') => Boolean(
    getTrustedDeviceRegistration(user, deviceId)
);

const upsertTrustedDevice = async ({
    userId,
    deviceId,
    deviceLabel = '',
    publicKeySpkiBase64 = '',
    replaceExistingKey = false,
}) => {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const normalizedLabel = normalizeDeviceLabel(deviceLabel) || 'Trusted browser';
    const normalizedPublicKey = String(publicKeySpkiBase64 || '').trim();
    const now = new Date();

    const user = await User.findById(userId, 'trustedDevices').lean();
    const currentDevices = Array.isArray(user?.trustedDevices) ? [...user.trustedDevices] : [];
    const existingIndex = currentDevices.findIndex((entry) => normalizeDeviceId(entry?.deviceId) === normalizedDeviceId);

    const nextRecord = {
        deviceId: normalizedDeviceId,
        label: normalizedLabel,
        algorithm: 'RSA-PSS-SHA256',
        createdAt: existingIndex >= 0 ? currentDevices[existingIndex].createdAt || now : now,
        lastSeenAt: now,
        lastVerifiedAt: now,
        publicKeySpkiBase64: replaceExistingKey || existingIndex < 0
            ? normalizedPublicKey
            : String(currentDevices[existingIndex].publicKeySpkiBase64 || normalizedPublicKey),
    };

    if (existingIndex >= 0) {
        currentDevices.splice(existingIndex, 1, nextRecord);
    } else {
        currentDevices.push(nextRecord);
    }

    currentDevices.sort((left, right) => (
        new Date(right?.lastVerifiedAt || 0).getTime() - new Date(left?.lastVerifiedAt || 0).getTime()
    ));

    const trimmedDevices = currentDevices.slice(0, MAX_TRUSTED_DEVICES);

    await User.updateOne(
        { _id: userId },
        { $set: { trustedDevices: trimmedDevices } }
    );

    return sanitizeTrustedDevice(nextRecord);
};

const issueTrustedDeviceChallenge = async ({
    user,
    authUid = '',
    authToken = null,
    deviceId = '',
    deviceLabel = '',
}) => {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (!user?._id || !normalizedDeviceId) {
        throw new Error('Trusted device challenges require a stable device identifier');
    }

    const existingDevice = getTrustedDeviceRegistration(user, normalizedDeviceId);
    const challenge = crypto.randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + DEVICE_CHALLENGE_TTL_MS;
    const mode = existingDevice ? 'assert' : 'enroll';

    const token = sealToken({
        sub: String(user._id),
        challenge,
        mode,
        deviceId: normalizedDeviceId,
        deviceLabel: normalizeDeviceLabel(deviceLabel),
        sessionBinding: buildSessionBinding({ authUid, authToken }),
        exp: expiresAt,
    });

    return {
        token,
        challenge,
        mode,
        algorithm: 'RSA-PSS-SHA256',
        deviceId: normalizedDeviceId,
        expiresAt: new Date(expiresAt).toISOString(),
        registered: Boolean(existingDevice),
        registeredLabel: existingDevice ? normalizeDeviceLabel(existingDevice.label) : '',
    };
};

const verifyTrustedDeviceChallenge = async ({
    user,
    authUid = '',
    authToken = null,
    token = '',
    proof = '',
    deviceId = '',
    deviceLabel = '',
    publicKeySpkiBase64 = '',
}) => {
    let payload;
    try {
        payload = openToken(token);
    } catch {
        return { success: false, reason: 'Trusted device challenge token invalid' };
    }

    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const expectedSessionBinding = buildSessionBinding({ authUid, authToken });

    if (!payload?.sub || String(payload.sub) !== String(user?._id || '')) {
        return { success: false, reason: 'Device challenge subject mismatch' };
    }
    if (!normalizedDeviceId || payload.deviceId !== normalizedDeviceId) {
        return { success: false, reason: 'Device challenge device mismatch' };
    }
    if (!payload.challenge || Date.now() > Number(payload.exp || 0)) {
        return { success: false, reason: 'Device challenge expired' };
    }
    if (payload.sessionBinding !== expectedSessionBinding) {
        return { success: false, reason: 'Device challenge session binding mismatch' };
    }

    const message = buildChallengeMessage({
        challenge: payload.challenge,
        mode: payload.mode,
        deviceId: normalizedDeviceId,
    });

    if (payload.mode === 'assert') {
        const registeredDevice = getTrustedDeviceRegistration(user, normalizedDeviceId);
        if (!registeredDevice?.publicKeySpkiBase64) {
            return { success: false, reason: 'Trusted device registration missing' };
        }

        const valid = verifyRsaPssSignature({
            publicKeySpkiBase64: registeredDevice.publicKeySpkiBase64,
            signatureBase64: proof,
            message,
        });

        if (!valid) {
            return { success: false, reason: 'Trusted device signature invalid' };
        }

        const trustedDevice = await upsertTrustedDevice({
            userId: user._id,
            deviceId: normalizedDeviceId,
            deviceLabel: deviceLabel || registeredDevice.label || payload.deviceLabel || '',
            publicKeySpkiBase64: registeredDevice.publicKeySpkiBase64,
            replaceExistingKey: false,
        });

        return {
            success: true,
            mode: 'assert',
            trustedDevice,
            ...issueTrustedDeviceSession({
                user,
                authUid,
                authToken,
                deviceId: normalizedDeviceId,
            }),
        };
    }

    const normalizedPublicKey = String(publicKeySpkiBase64 || '').trim();
    if (!normalizedPublicKey) {
        return { success: false, reason: 'Trusted device public key missing for enrollment' };
    }

    const enrollmentValid = verifyRsaPssSignature({
        publicKeySpkiBase64: normalizedPublicKey,
        signatureBase64: proof,
        message,
    });

    if (!enrollmentValid) {
        return { success: false, reason: 'Trusted device enrollment signature invalid' };
    }

    const trustedDevice = await upsertTrustedDevice({
        userId: user._id,
        deviceId: normalizedDeviceId,
        deviceLabel: deviceLabel || payload.deviceLabel || 'Trusted browser',
        publicKeySpkiBase64: normalizedPublicKey,
        replaceExistingKey: true,
    });

    return {
        success: true,
        mode: 'enroll',
        trustedDevice,
        ...issueTrustedDeviceSession({
            user,
            authUid,
            authToken,
            deviceId: normalizedDeviceId,
        }),
    };
};

module.exports = {
    TRUSTED_DEVICE_ID_HEADER,
    TRUSTED_DEVICE_LABEL_HEADER,
    TRUSTED_DEVICE_SESSION_HEADER,
    extractTrustedDeviceContext,
    getTrustedDeviceRegistration,
    isTrustedDeviceRegisteredForUser,
    issueTrustedDeviceChallenge,
    verifyTrustedDeviceSession,
    normalizeDeviceId,
    verifyTrustedDeviceChallenge,
};
