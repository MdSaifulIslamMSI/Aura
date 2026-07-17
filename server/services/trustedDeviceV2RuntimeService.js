const crypto = require('crypto');
const TrustedDeviceCredential = require('../models/TrustedDeviceCredential');
const {
    getTrustedDeviceV2RolloutConfig,
    isTrustedDeviceV2SubjectSelected,
} = require('../config/trustedDeviceV2Rollout');
const { recordAuthSecurityEvent } = require('./authSecurityTelemetryService');
const logger = require('../utils/logger');

const DEVICE_ID_PATTERN = /^[A-Za-z0-9:_-]{12,128}$/;
const ALLOWED_TRANSPORTS = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);
const ALLOWED_USER_VERIFICATION = new Set(['required', 'preferred', 'discouraged', '']);
const ALLOWED_ATTACHMENTS = new Set(['platform', 'cross-platform', '']);
const ALLOWED_SCOPES = new Set(['recognition', 'mfa', 'admin']);
const ALLOWED_ENROLLMENT_CONTEXTS = new Set([
    'device_recognition',
    'mfa_registration',
    'legacy_admin_snapshot',
    'admin_step_up',
    'operator_bootstrap',
]);

const normalizeText = (value) => String(value === undefined || value === null ? '' : value).trim();
const normalizeLower = (value) => normalizeText(value).toLowerCase();
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const normalizeDate = (value) => {
    if (!value) return null;
    const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
};
const toIdString = (value) => normalizeText(value?._id || value);

const createRuntimeError = (code, message) => {
    const error = new Error(message);
    error.code = code;
    return error;
};

const getCredentialKind = (device = {}) => (
    normalizeLower(device?.method) === 'webauthn'
    || normalizeText(device?.webauthnCredentialIdBase64Url)
        ? 'webauthn'
        : 'browser_key'
);

const resolveAudience = (user = {}) => (
    user?.isAdmin || (Array.isArray(user?.adminRoles) && user.adminRoles.length > 0)
        ? 'admin'
        : 'public'
);

const resolveRolloutContext = ({ user, env = process.env } = {}) => {
    const config = getTrustedDeviceV2RolloutConfig(env);
    const subjectId = toIdString(user);
    const audience = resolveAudience(user);
    const selected = Boolean(
        subjectId
        && isTrustedDeviceV2SubjectSelected({ subjectId, audience, config })
    );

    return { audience, config, selected, subjectId };
};

const recordRuntimeEvent = ({
    event,
    outcome,
    reason,
    audience,
    method,
    req = null,
    meta = {},
    recordEvent = recordAuthSecurityEvent,
}) => {
    try {
        recordEvent({
            event,
            outcome,
            reason,
            surface: 'trusted_device',
            req,
            meta: {
                audience,
                method: method === 'webauthn' ? 'passkey' : (method || 'unknown'),
                ...meta,
            },
        });
    } catch {
        // V2 observability must not alter the legacy-authoritative auth path.
    }
};

const buildVerifiedV2Credential = ({ user, device, provenance = 'v2_reverification' } = {}) => {
    const userId = user?._id;
    const deviceId = normalizeText(device?.deviceId);
    const publicKeySpkiBase64 = normalizeText(device?.publicKeySpkiBase64);
    if (!userId) {
        throw createRuntimeError('TRUSTED_DEVICE_V2_USER_REQUIRED', 'Trusted-device V2 writes require a user');
    }
    if (!DEVICE_ID_PATTERN.test(deviceId)) {
        throw createRuntimeError('TRUSTED_DEVICE_V2_DEVICE_INVALID', 'Trusted-device V2 writes require a valid device ID');
    }
    if (!publicKeySpkiBase64) {
        throw createRuntimeError('TRUSTED_DEVICE_V2_KEY_REQUIRED', 'Trusted-device V2 writes require a public key');
    }

    const credentialKind = getCredentialKind(device);
    const credentialId = credentialKind === 'webauthn'
        ? normalizeText(device?.webauthnCredentialIdBase64Url)
        : '';
    if (credentialKind === 'webauthn' && !credentialId) {
        throw createRuntimeError(
            'TRUSTED_DEVICE_V2_CREDENTIAL_ID_REQUIRED',
            'WebAuthn V2 writes require a credential ID'
        );
    }

    const observedUserVerification = credentialKind === 'webauthn'
        && device?.webauthnUserVerified === true;
    const requestedScope = ALLOWED_SCOPES.has(normalizeLower(device?.credentialScope))
        ? normalizeLower(device.credentialScope)
        : 'recognition';
    const credentialScope = credentialKind === 'webauthn' ? requestedScope : 'recognition';
    const requestedAdminEligibility = normalizeLower(device?.adminEligibility);
    const adminEligibility = requestedAdminEligibility === 'verified' ? 'verified' : 'none';
    const userVerification = ALLOWED_USER_VERIFICATION.has(normalizeLower(device?.webauthnUserVerification))
        ? normalizeLower(device.webauthnUserVerification)
        : '';
    const userVerifiedAt = observedUserVerification
        ? (normalizeDate(device?.webauthnUserVerifiedAt) || normalizeDate(device?.lastVerifiedAt) || new Date())
        : null;

    if (!observedUserVerification && (credentialScope !== 'recognition' || adminEligibility !== 'none')) {
        throw createRuntimeError(
            'TRUSTED_DEVICE_V2_UV_REQUIRED',
            'A passkey without observed user verification cannot satisfy MFA or admin policy'
        );
    }
    if (
        adminEligibility === 'verified'
        && (
            credentialKind !== 'webauthn'
            || credentialScope !== 'admin'
            || !observedUserVerification
            || userVerification !== 'required'
        )
    ) {
        throw createRuntimeError(
            'TRUSTED_DEVICE_V2_ADMIN_ASSURANCE_INVALID',
            'Admin passkeys require an observed user-verified WebAuthn ceremony'
        );
    }

    const observedAt = credentialKind === 'webauthn'
        ? normalizeDate(device?.webauthnBackupStateObservedAt)
        : null;
    const backupStateKnown = Boolean(observedAt);
    const backupEligible = backupStateKnown && Boolean(device?.webauthnBackupEligible);
    const backedUp = backupEligible && Boolean(device?.webauthnBackedUp);
    const attachment = ALLOWED_ATTACHMENTS.has(normalizeLower(device?.authenticatorAttachment))
        ? normalizeLower(device.authenticatorAttachment)
        : '';
    const enrollmentContext = credentialKind === 'webauthn'
        && ALLOWED_ENROLLMENT_CONTEXTS.has(normalizeLower(device?.enrollmentContext))
        ? normalizeLower(device.enrollmentContext)
        : 'device_recognition';
    const revokedAt = normalizeDate(device?.revokedAt);
    const lastVerifiedAt = normalizeDate(device?.lastVerifiedAt) || new Date();

    return {
        schemaVersion: 2,
        user: userId,
        credentialKind,
        deviceIdHash: sha256(deviceId),
        browserKeyHash: credentialKind === 'browser_key' ? sha256(publicKeySpkiBase64) : null,
        webauthnCredentialIdHash: credentialKind === 'webauthn' ? sha256(credentialId) : null,
        webauthnCredentialIdBase64Url: credentialKind === 'webauthn' ? credentialId : null,
        label: normalizeText(device?.label).slice(0, 120),
        algorithm: (normalizeText(device?.algorithm) || 'RSA-PSS-SHA256').slice(0, 64),
        publicKeySpkiBase64,
        webauthnTransports: credentialKind === 'webauthn'
            ? [...new Set((Array.isArray(device?.webauthnTransports) ? device.webauthnTransports : [])
                .map(normalizeLower)
                .filter((entry) => ALLOWED_TRANSPORTS.has(entry)))]
            : [],
        webauthnCounter: credentialKind === 'webauthn'
            ? Math.max(Math.trunc(Number(device?.webauthnCounter || 0)), 0)
            : 0,
        webauthnUserVerification: credentialKind === 'webauthn' ? userVerification : '',
        webauthnUserVerified: observedUserVerification,
        webauthnUserVerifiedAt: userVerifiedAt,
        webauthnAaguid: credentialKind === 'webauthn'
            ? normalizeText(device?.webauthnAaguid).slice(0, 64)
            : '',
        authenticatorAttachment: credentialKind === 'webauthn' ? attachment : '',
        backupEligible,
        backedUp,
        backupStateKnown,
        backupStateObservedAt: observedAt,
        provenance: provenance === 'v2_enrollment' ? 'v2_enrollment' : 'v2_reverification',
        migrationRun: null,
        legacyRecordHash: null,
        credentialScope,
        enrollmentContext,
        adminEligibility,
        adminEligibleAt: adminEligibility === 'verified'
            ? (normalizeDate(device?.adminEligibleAt) || userVerifiedAt)
            : null,
        legacyAdminCandidateAt: null,
        assurance: credentialKind === 'browser_key'
            ? 'browser_bound'
            : (observedUserVerification ? 'passkey_user_verified' : 'passkey_user_present'),
        status: revokedAt ? 'revoked' : 'active',
        sessionVersion: normalizeText(device?.sessionVersion).slice(0, 128),
        createdAt: normalizeDate(device?.createdAt) || lastVerifiedAt,
        lastSeenAt: normalizeDate(device?.lastSeenAt),
        lastVerifiedAt,
        expiresAt: normalizeDate(device?.expiresAt),
        revokedAt,
        revocationReasonCode: revokedAt ? 'legacy_source_revoked' : '',
        revokedByHash: null,
    };
};

const mirrorVerifiedTrustedDevice = async ({
    user,
    device,
    provenance = 'v2_reverification',
    env = process.env,
    model = TrustedDeviceCredential,
    recordEvent = recordAuthSecurityEvent,
} = {}) => {
    const context = resolveRolloutContext({ user, env });
    if (context.config.writeMode !== 'dual_write') return { status: 'disabled' };
    if (!context.selected) return { status: 'not_selected' };

    let record;
    try {
        record = buildVerifiedV2Credential({ user, device, provenance });
        const filter = {
            user: record.user,
            deviceIdHash: record.deviceIdHash,
        };
        if (record.credentialKind === 'webauthn' && record.backupStateKnown) {
            filter.$or = [
                { backupStateKnown: { $ne: true } },
                { backupEligible: record.backupEligible },
            ];
        }

        const { createdAt, ...mutableRecord } = record;
        const result = await model.updateOne(
            filter,
            {
                $set: mutableRecord,
                $setOnInsert: { createdAt },
            },
            {
                upsert: true,
                runValidators: true,
                setDefaultsOnInsert: true,
            }
        );
        const wrote = Number(result?.matchedCount || 0) > 0
            || Number(result?.modifiedCount || 0) > 0
            || Number(result?.upsertedCount || 0) > 0
            || Boolean(result?.upsertedId);
        if (!wrote) {
            throw createRuntimeError(
                'TRUSTED_DEVICE_V2_WRITE_UNCONFIRMED',
                'Trusted-device V2 dual write was not acknowledged'
            );
        }

        recordRuntimeEvent({
            event: 'trusted_device_v2_dual_write',
            outcome: 'success',
            reason: 'none',
            audience: context.audience,
            method: record.credentialKind,
            meta: { operation: provenance },
            recordEvent,
        });
        return { status: 'written' };
    } catch (error) {
        logger.warn('trusted_device_v2.dual_write_failed', {
            code: normalizeText(error?.code) || 'TRUSTED_DEVICE_V2_WRITE_FAILED',
            audience: context.audience,
        });
        recordRuntimeEvent({
            event: 'trusted_device_v2_dual_write',
            outcome: 'failure',
            reason: error?.code === 11000 ? 'integrity_mismatch' : 'write_failed',
            audience: context.audience,
            method: getCredentialKind(device),
            meta: { operation: provenance },
            recordEvent,
        });
        return {
            status: 'failed',
            code: normalizeText(error?.code) || 'TRUSTED_DEVICE_V2_WRITE_FAILED',
        };
    }
};

const mirrorTrustedDeviceMetadata = async ({
    user,
    devices = [],
    revocationReasonCode = 'user_revoked',
    env = process.env,
    model = TrustedDeviceCredential,
    recordEvent = recordAuthSecurityEvent,
} = {}) => {
    const context = resolveRolloutContext({ user, env });
    if (context.config.writeMode !== 'dual_write') return { status: 'disabled', matched: 0 };
    if (!context.selected) return { status: 'not_selected', matched: 0 };

    const candidates = (Array.isArray(devices) ? devices : [])
        .filter((device) => DEVICE_ID_PATTERN.test(normalizeText(device?.deviceId)));
    if (candidates.length === 0) return { status: 'empty', matched: 0 };

    const operations = candidates.map((device) => {
        const revokedAt = normalizeDate(device?.revokedAt);
        return {
            updateOne: {
                filter: {
                    user: user._id,
                    deviceIdHash: sha256(normalizeText(device.deviceId)),
                },
                update: {
                    $set: {
                        label: normalizeText(device?.label).slice(0, 120),
                        sessionVersion: normalizeText(device?.sessionVersion).slice(0, 128),
                        lastSeenAt: normalizeDate(device?.lastSeenAt),
                        lastVerifiedAt: normalizeDate(device?.lastVerifiedAt) || new Date(0),
                        expiresAt: normalizeDate(device?.expiresAt),
                        status: revokedAt ? 'revoked' : 'active',
                        revokedAt,
                        revocationReasonCode: revokedAt
                            ? normalizeText(revocationReasonCode).slice(0, 80)
                            : '',
                    },
                },
                upsert: false,
            },
        };
    });

    try {
        const result = await model.bulkWrite(operations, { ordered: false });
        const matched = Number(result?.matchedCount || result?.nMatched || 0);
        const complete = matched === operations.length;
        recordRuntimeEvent({
            event: 'trusted_device_v2_metadata_write',
            outcome: complete ? 'success' : 'failure',
            reason: complete ? 'none' : 'v2_record_missing',
            audience: context.audience,
            method: 'unknown',
            meta: { requested: operations.length, matched },
            recordEvent,
        });
        return { status: complete ? 'written' : 'partial', matched };
    } catch (error) {
        logger.warn('trusted_device_v2.metadata_write_failed', {
            code: normalizeText(error?.code) || 'TRUSTED_DEVICE_V2_METADATA_WRITE_FAILED',
            audience: context.audience,
        });
        recordRuntimeEvent({
            event: 'trusted_device_v2_metadata_write',
            outcome: 'failure',
            reason: 'write_failed',
            audience: context.audience,
            method: 'unknown',
            recordEvent,
        });
        return { status: 'failed', matched: 0 };
    }
};

const revokeTrustedDeviceV2ForUser = async ({
    user,
    revokedAt = new Date(),
    reasonCode = 'account_recovery',
    env = process.env,
    model = TrustedDeviceCredential,
    recordEvent = recordAuthSecurityEvent,
} = {}) => {
    const context = resolveRolloutContext({ user, env });
    if (context.config.writeMode !== 'dual_write') return { status: 'disabled', modified: 0 };
    if (!context.selected) return { status: 'not_selected', modified: 0 };

    try {
        const result = await model.updateMany(
            { user: user._id, status: 'active' },
            {
                $set: {
                    status: 'revoked',
                    revokedAt: normalizeDate(revokedAt) || new Date(),
                    revocationReasonCode: normalizeText(reasonCode).slice(0, 80),
                },
            },
            { runValidators: true }
        );
        const modified = Number(result?.modifiedCount || result?.nModified || 0);
        recordRuntimeEvent({
            event: 'trusted_device_v2_bulk_revoke',
            outcome: 'success',
            reason: reasonCode,
            audience: context.audience,
            method: 'unknown',
            meta: { modified },
            recordEvent,
        });
        return { status: 'written', modified };
    } catch (error) {
        logger.warn('trusted_device_v2.bulk_revoke_failed', {
            code: normalizeText(error?.code) || 'TRUSTED_DEVICE_V2_BULK_REVOKE_FAILED',
            audience: context.audience,
        });
        recordRuntimeEvent({
            event: 'trusted_device_v2_bulk_revoke',
            outcome: 'failure',
            reason: 'write_failed',
            audience: context.audience,
            method: 'unknown',
            recordEvent,
        });
        return { status: 'failed', modified: 0 };
    }
};

const isLegacyDeviceActive = (device = null, now = Date.now()) => {
    if (!device || device.revokedAt) return false;
    const expiresAt = normalizeDate(device.expiresAt)?.getTime() || 0;
    return !expiresAt || expiresAt > now;
};

const isV2CredentialActive = (credential = null, now = Date.now()) => {
    if (!credential || credential.status !== 'active' || credential.revokedAt) return false;
    const expiresAt = normalizeDate(credential.expiresAt)?.getTime() || 0;
    return !expiresAt || expiresAt > now;
};

const compareLegacyAndV2Credential = ({ legacyDevice = null, v2Credential = null, deviceId = '' } = {}) => {
    if (!legacyDevice && !v2Credential) return { status: 'both_missing' };
    if (legacyDevice && !v2Credential) return { status: 'v2_missing' };
    if (!legacyDevice && v2Credential) return { status: 'v2_orphaned' };

    const kind = getCredentialKind(legacyDevice);
    if (v2Credential.credentialKind !== kind) return { status: 'credential_kind_mismatch' };
    if (normalizeLower(v2Credential.deviceIdHash) !== sha256(normalizeText(deviceId))) {
        return { status: 'device_hash_mismatch' };
    }
    if (sha256(normalizeText(legacyDevice.publicKeySpkiBase64)) !== sha256(normalizeText(v2Credential.publicKeySpkiBase64))) {
        return { status: 'public_key_mismatch' };
    }
    if (kind === 'webauthn') {
        const credentialId = normalizeText(legacyDevice.webauthnCredentialIdBase64Url);
        if (sha256(credentialId) !== normalizeLower(v2Credential.webauthnCredentialIdHash)) {
            return { status: 'credential_id_mismatch' };
        }
    }

    const legacyActive = isLegacyDeviceActive(legacyDevice);
    const v2Active = isV2CredentialActive(v2Credential);
    if (legacyActive && !v2Active) return { status: 'v2_stricter' };
    if (!legacyActive && v2Active) return { status: 'v2_weaker' };
    if (normalizeText(legacyDevice.sessionVersion) !== normalizeText(v2Credential.sessionVersion)) {
        return { status: 'session_version_mismatch' };
    }
    if (kind === 'webauthn' && Number(v2Credential.webauthnCounter || 0) < Number(legacyDevice.webauthnCounter || 0)) {
        return { status: 'counter_stale' };
    }

    const legacyScope = ALLOWED_SCOPES.has(normalizeLower(legacyDevice.credentialScope))
        ? normalizeLower(legacyDevice.credentialScope)
        : 'recognition';
    const scopeRank = { recognition: 0, mfa: 1, admin: 2 };
    const v2Scope = ALLOWED_SCOPES.has(normalizeLower(v2Credential.credentialScope))
        ? normalizeLower(v2Credential.credentialScope)
        : 'recognition';
    if (scopeRank[v2Scope] < scopeRank[legacyScope]) return { status: 'v2_stricter' };
    if (scopeRank[v2Scope] > scopeRank[legacyScope]) return { status: 'v2_weaker' };

    const legacyAdmin = normalizeLower(legacyDevice.adminEligibility) || 'none';
    const v2Admin = normalizeLower(v2Credential.adminEligibility) || 'none';
    const adminRank = { none: 0, legacy_candidate: 1, verified: 2 };
    if ((adminRank[v2Admin] || 0) < (adminRank[legacyAdmin] || 0)) return { status: 'v2_stricter' };
    if ((adminRank[v2Admin] || 0) > (adminRank[legacyAdmin] || 0)) return { status: 'v2_weaker' };

    const legacyBackupObserved = Boolean(normalizeDate(legacyDevice.webauthnBackupStateObservedAt));
    if (
        kind === 'webauthn'
        && legacyBackupObserved
        && v2Credential.backupStateKnown
        && Boolean(legacyDevice.webauthnBackupEligible) !== Boolean(v2Credential.backupEligible)
    ) {
        return { status: 'backup_eligibility_mismatch' };
    }

    return { status: 'match' };
};

const resolveLean = async (query) => {
    const selected = typeof query?.select === 'function'
        ? query.select([
            '+deviceIdHash',
            '+publicKeySpkiBase64',
            '+webauthnCredentialIdHash',
            '+webauthnCredentialIdBase64Url',
            '+sessionVersion',
        ].join(' '))
        : query;
    return typeof selected?.lean === 'function' ? selected.lean() : selected;
};

const shadowCompareTrustedDeviceRequest = async ({
    user,
    deviceId,
    req = null,
    env = process.env,
    model = TrustedDeviceCredential,
    recordEvent = recordAuthSecurityEvent,
} = {}) => {
    const context = resolveRolloutContext({ user, env });
    if (context.config.readMode !== 'shadow_compare') return { status: 'disabled' };
    if (!context.selected) return { status: 'not_selected' };

    const normalizedDeviceId = normalizeText(deviceId);
    if (!DEVICE_ID_PATTERN.test(normalizedDeviceId)) return { status: 'no_device' };
    const legacyDevice = Array.isArray(user?.trustedDevices)
        ? user.trustedDevices.find((entry) => normalizeText(entry?.deviceId) === normalizedDeviceId) || null
        : null;

    try {
        const v2Credential = await resolveLean(model.findOne({
            user: user._id,
            deviceIdHash: sha256(normalizedDeviceId),
        }));
        const comparison = compareLegacyAndV2Credential({
            legacyDevice,
            v2Credential,
            deviceId: normalizedDeviceId,
        });
        const success = comparison.status === 'match' || comparison.status === 'both_missing';
        const stricter = comparison.status === 'v2_stricter';
        recordRuntimeEvent({
            event: 'trusted_device_v2_shadow_compare',
            outcome: success ? 'success' : (stricter ? 'blocked' : 'failure'),
            reason: comparison.status,
            audience: context.audience,
            method: legacyDevice ? getCredentialKind(legacyDevice) : 'unknown',
            req,
            meta: { shadowResult: comparison.status },
            recordEvent,
        });
        return comparison;
    } catch (error) {
        logger.warn('trusted_device_v2.shadow_read_failed', {
            code: normalizeText(error?.code) || 'TRUSTED_DEVICE_V2_SHADOW_READ_FAILED',
            audience: context.audience,
        });
        recordRuntimeEvent({
            event: 'trusted_device_v2_shadow_compare',
            outcome: 'failure',
            reason: 'read_failed',
            audience: context.audience,
            method: legacyDevice ? getCredentialKind(legacyDevice) : 'unknown',
            req,
            meta: { shadowResult: 'read_failed' },
            recordEvent,
        });
        return { status: 'read_failed' };
    }
};

module.exports = {
    buildVerifiedV2Credential,
    compareLegacyAndV2Credential,
    mirrorTrustedDeviceMetadata,
    mirrorVerifiedTrustedDevice,
    resolveRolloutContext,
    revokeTrustedDeviceV2ForUser,
    shadowCompareTrustedDeviceRequest,
    __private: {
        getCredentialKind,
        isLegacyDeviceActive,
        isV2CredentialActive,
        sha256,
    },
};
