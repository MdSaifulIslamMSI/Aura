const crypto = require('crypto');
const mongoose = require('mongoose');
const TrustedDeviceCredential = require('../models/TrustedDeviceCredential');
const {
    buildVerifiedV2Credential,
    compareLegacyAndV2Credential,
    mirrorTrustedDeviceMetadata,
    mirrorVerifiedTrustedDevice,
    revokeTrustedDeviceV2ForUser,
    shadowCompareTrustedDeviceRequest,
} = require('../services/trustedDeviceV2RuntimeService');

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const baseUser = (overrides = {}) => ({
    _id: new mongoose.Types.ObjectId(),
    isAdmin: false,
    adminRoles: [],
    ...overrides,
});

const basePasskey = (overrides = {}) => ({
    deviceId: 'device_runtime_123456',
    label: 'Primary passkey',
    method: 'webauthn',
    algorithm: 'ES256',
    publicKeySpkiBase64: Buffer.from('runtime-public-key').toString('base64'),
    webauthnCredentialIdBase64Url: 'runtime-credential-id',
    webauthnTransports: ['internal'],
    webauthnCounter: 4,
    webauthnUserVerification: 'required',
    webauthnUserVerified: true,
    webauthnUserVerifiedAt: new Date('2026-07-17T10:00:00.000Z'),
    webauthnBackupEligible: true,
    webauthnBackedUp: true,
    webauthnBackupStateObservedAt: new Date('2026-07-17T10:00:00.000Z'),
    authenticatorAttachment: 'platform',
    credentialScope: 'mfa',
    enrollmentContext: 'mfa_registration',
    adminEligibility: 'none',
    createdAt: new Date('2026-07-17T09:00:00.000Z'),
    lastSeenAt: new Date('2026-07-17T10:00:00.000Z'),
    lastVerifiedAt: new Date('2026-07-17T10:00:00.000Z'),
    sessionVersion: 'runtime-session-version',
    ...overrides,
});

const dualWriteEnv = (overrides = {}) => ({
    AUTH_TRUSTED_DEVICE_V2_WRITE_MODE: 'dual_write',
    AUTH_TRUSTED_DEVICE_V2_READ_MODE: 'legacy',
    AUTH_TRUSTED_DEVICE_V2_PUBLIC_COHORT_PERCENT: '100',
    AUTH_TRUSTED_DEVICE_V2_ADMIN_COHORT_PERCENT: '100',
    ...overrides,
});

describe('trustedDeviceV2RuntimeService', () => {
    test('builds a validated fresh admin passkey record from observed UV', async () => {
        const user = baseUser({ isAdmin: true, adminRoles: ['super_admin'] });
        const record = buildVerifiedV2Credential({
            user,
            device: basePasskey({
                credentialScope: 'admin',
                enrollmentContext: 'admin_step_up',
                adminEligibility: 'verified',
                adminEligibleAt: new Date('2026-07-17T10:00:00.000Z'),
            }),
            provenance: 'v2_reverification',
        });

        expect(record).toMatchObject({
            credentialKind: 'webauthn',
            credentialScope: 'admin',
            adminEligibility: 'verified',
            assurance: 'passkey_user_verified',
            webauthnUserVerified: true,
            backupStateKnown: true,
        });
        expect(record.deviceIdHash).toBe(sha256('device_runtime_123456'));
        await expect(new TrustedDeviceCredential(record).validate()).resolves.toBeUndefined();
    });

    test('refuses to promote a user-present passkey into MFA or admin assurance', () => {
        const user = baseUser();

        expect(() => buildVerifiedV2Credential({
            user,
            device: basePasskey({
                webauthnUserVerification: 'preferred',
                webauthnUserVerified: false,
                webauthnUserVerifiedAt: null,
                credentialScope: 'mfa',
            }),
        })).toThrow('cannot satisfy MFA or admin policy');
    });

    test('keeps dual writes cohort-scoped and preserves backup-eligibility immutability', async () => {
        const user = baseUser();
        const model = {
            updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
        };
        const recordEvent = jest.fn();

        const result = await mirrorVerifiedTrustedDevice({
            user,
            device: basePasskey(),
            env: dualWriteEnv(),
            model,
            recordEvent,
        });

        expect(result).toEqual({ status: 'written' });
        expect(model.updateOne).toHaveBeenCalledWith(
            expect.objectContaining({
                user: user._id,
                deviceIdHash: sha256('device_runtime_123456'),
                $or: [
                    { backupStateKnown: { $ne: true } },
                    { backupEligible: true },
                ],
            }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    assurance: 'passkey_user_verified',
                    migrationRun: null,
                }),
            }),
            expect.objectContaining({ upsert: true, runValidators: true })
        );
        expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({
            event: 'trusted_device_v2_dual_write',
            outcome: 'success',
        }));
    });

    test('does not touch V2 when writes are disabled or the subject is outside the cohort', async () => {
        const user = baseUser();
        const model = { updateOne: jest.fn() };

        await expect(mirrorVerifiedTrustedDevice({
            user,
            device: basePasskey(),
            env: {},
            model,
            recordEvent: jest.fn(),
        })).resolves.toEqual({ status: 'disabled' });
        await expect(mirrorVerifiedTrustedDevice({
            user,
            device: basePasskey(),
            env: dualWriteEnv({
                AUTH_TRUSTED_DEVICE_V2_PUBLIC_COHORT_PERCENT: '0',
            }),
            model,
            recordEvent: jest.fn(),
        })).resolves.toEqual({ status: 'not_selected' });
        expect(model.updateOne).not.toHaveBeenCalled();
    });

    test('updates only existing V2 metadata records and reports migration gaps', async () => {
        const user = baseUser();
        const model = {
            bulkWrite: jest.fn().mockResolvedValue({ matchedCount: 1 }),
        };
        const recordEvent = jest.fn();

        const result = await mirrorTrustedDeviceMetadata({
            user,
            devices: [
                basePasskey({ label: 'Renamed' }),
                basePasskey({ deviceId: 'device_runtime_654321', revokedAt: new Date() }),
            ],
            env: dualWriteEnv(),
            model,
            recordEvent,
        });

        expect(result).toEqual({ status: 'partial', matched: 1 });
        const [operations] = model.bulkWrite.mock.calls[0];
        expect(operations).toHaveLength(2);
        expect(operations.every((operation) => operation.updateOne.upsert === false)).toBe(true);
        expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({
            event: 'trusted_device_v2_metadata_write',
            outcome: 'failure',
        }));
    });

    test('mirrors password-reset revocation to every active V2 credential in the selected cohort', async () => {
        const user = baseUser();
        const revokedAt = new Date('2026-07-17T11:00:00.000Z');
        const model = {
            updateMany: jest.fn().mockResolvedValue({ modifiedCount: 3 }),
        };

        await expect(revokeTrustedDeviceV2ForUser({
            user,
            revokedAt,
            reasonCode: 'password_reset',
            env: dualWriteEnv(),
            model,
            recordEvent: jest.fn(),
        })).resolves.toEqual({ status: 'written', modified: 3 });
        expect(model.updateMany).toHaveBeenCalledWith(
            { user: user._id, status: 'active' },
            { $set: expect.objectContaining({ status: 'revoked', revokedAt, revocationReasonCode: 'password_reset' }) },
            { runValidators: true }
        );
    });

    test('classifies matches, stricter migrations, and security regressions', () => {
        const legacy = basePasskey();
        const v2 = {
            ...buildVerifiedV2Credential({ user: baseUser(), device: legacy }),
        };

        expect(compareLegacyAndV2Credential({
            legacyDevice: legacy,
            v2Credential: v2,
            deviceId: legacy.deviceId,
        })).toEqual({ status: 'match' });

        expect(compareLegacyAndV2Credential({
            legacyDevice: basePasskey({ credentialScope: 'admin', adminEligibility: 'verified' }),
            v2Credential: { ...v2, credentialScope: 'recognition', adminEligibility: 'legacy_candidate' },
            deviceId: legacy.deviceId,
        })).toEqual({ status: 'v2_stricter' });

        expect(compareLegacyAndV2Credential({
            legacyDevice: basePasskey({ revokedAt: new Date() }),
            v2Credential: { ...v2, status: 'active', revokedAt: null },
            deviceId: legacy.deviceId,
        })).toEqual({ status: 'v2_weaker' });

        expect(compareLegacyAndV2Credential({
            legacyDevice: legacy,
            v2Credential: { ...v2, publicKeySpkiBase64: 'different-key' },
            deviceId: legacy.deviceId,
        })).toEqual({ status: 'public_key_mismatch' });
    });

    test('shadow comparison observes V2 without changing the legacy user object', async () => {
        const device = basePasskey();
        const user = baseUser({ trustedDevices: [device] });
        const v2 = buildVerifiedV2Credential({ user, device });
        const query = {
            select: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue(v2),
        };
        const model = { findOne: jest.fn().mockReturnValue(query) };
        const recordEvent = jest.fn();

        await expect(shadowCompareTrustedDeviceRequest({
            user,
            deviceId: device.deviceId,
            env: dualWriteEnv({ AUTH_TRUSTED_DEVICE_V2_READ_MODE: 'shadow_compare' }),
            model,
            recordEvent,
        })).resolves.toEqual({ status: 'match' });
        expect(user.trustedDevices).toEqual([device]);
        expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({
            event: 'trusted_device_v2_shadow_compare',
            outcome: 'success',
        }));
    });

    test('shadow read failures are observable but fail open to the legacy authority', async () => {
        const device = basePasskey();
        const user = baseUser({ trustedDevices: [device] });
        const query = {
            select: jest.fn().mockReturnThis(),
            lean: jest.fn().mockRejectedValue(new Error('database unavailable')),
        };
        const recordEvent = jest.fn();

        await expect(shadowCompareTrustedDeviceRequest({
            user,
            deviceId: device.deviceId,
            env: dualWriteEnv({ AUTH_TRUSTED_DEVICE_V2_READ_MODE: 'shadow_compare' }),
            model: { findOne: jest.fn().mockReturnValue(query) },
            recordEvent,
        })).resolves.toEqual({ status: 'read_failed' });
        expect(recordEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure' }));
    });
});
