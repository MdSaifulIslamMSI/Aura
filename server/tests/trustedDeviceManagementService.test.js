const User = require('../models/User');
const {
    revokeBrowserSessionsForDevices,
} = require('../services/browserSessionService');
const {
    issueTrustedDeviceSession,
    verifyTrustedDeviceSession,
} = require('../services/trustedDeviceChallengeService');
const {
    renameTrustedDevice,
    revokeTrustedDevices,
} = require('../services/trustedDeviceManagementService');

jest.mock('../models/User', () => ({
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
}));

jest.mock('../services/browserSessionService', () => ({
    revokeBrowserSessionsForDevices: jest.fn(),
}));

describe('trustedDeviceManagementService', () => {
    const originalEnv = { ...process.env };
    const userAId = '507f1f77bcf86cd799439011';
    const userBId = '507f1f77bcf86cd799439012';
    const deviceAId = 'device-user-a-0001';
    const deviceBId = 'device-user-b-0001';
    const deviceOtherId = 'device-user-a-0002';
    const credentialA = 'credential-user-a';
    let stateByUser;

    const clone = (value) => structuredClone(value);

    const buildPasskey = ({
        deviceId = deviceAId,
        credentialId = credentialA,
        label = 'Primary passkey',
        adminEligibility = 'none',
        credentialScope = 'mfa',
    } = {}) => ({
        deviceId,
        label,
        method: 'webauthn',
        publicKeySpkiBase64: 'public-key',
        webauthnCredentialIdBase64Url: credentialId,
        webauthnUserVerification: 'required',
        webauthnUserVerified: true,
        webauthnUserVerifiedAt: new Date('2026-07-16T00:00:00.000Z'),
        credentialScope,
        adminEligibility,
        sessionVersion: `session-version-${deviceId}`,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        lastVerifiedAt: new Date('2026-07-16T00:00:00.000Z'),
        revokedAt: null,
        expiresAt: null,
    });

    const buildBrowserDevice = ({ deviceId = deviceOtherId, label = 'Other browser' } = {}) => ({
        deviceId,
        label,
        method: 'browser_key',
        publicKeySpkiBase64: 'browser-public-key',
        credentialScope: 'recognition',
        adminEligibility: 'none',
        sessionVersion: `session-version-${deviceId}`,
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        lastVerifiedAt: new Date('2026-07-15T00:00:00.000Z'),
        revokedAt: null,
        expiresAt: null,
    });

    const buildUser = ({
        _id = userAId,
        isAdmin = false,
        adminRoles = [],
        trustedDevices = [buildPasskey()],
        totpEnabled = false,
        requiredByPolicy = false,
    } = {}) => ({
        _id,
        __v: 0,
        email: `${_id}@example.test`,
        isAdmin,
        adminRoles,
        isSeller: false,
        trustedDevices,
        mfa: {
            enabled: true,
            defaultMethod: 'passkey',
            requiredByPolicy,
            totp: {
                enabled: totpEnabled,
                confirmedAt: totpEnabled ? new Date('2026-07-01T00:00:00.000Z') : null,
            },
            passkeys: trustedDevices
                .filter((device) => device.method === 'webauthn')
                .map((device) => ({
                    credentialId: device.webauthnCredentialIdBase64Url,
                    name: device.label,
                    revokedAt: null,
                })),
        },
    });

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv };
        process.env.NODE_ENV = 'test';
        stateByUser = {
            [userAId]: buildUser(),
            [userBId]: buildUser({
                _id: userBId,
                trustedDevices: [buildPasskey({
                    deviceId: deviceBId,
                    credentialId: 'credential-user-b',
                })],
            }),
        };

        User.findById.mockImplementation((userId) => {
            const query = {
                select: jest.fn(() => query),
                lean: jest.fn(async () => (
                    stateByUser[userId] ? clone(stateByUser[userId]) : null
                )),
            };
            return query;
        });
        User.findOneAndUpdate.mockImplementation(async (filter, update) => {
            const userId = String(filter?._id || '');
            const current = stateByUser[userId];
            if (!current || Number(filter?.__v) !== Number(current.__v || 0)) return null;
            const set = update?.$set || {};
            stateByUser[userId] = {
                ...current,
                __v: Number(current.__v || 0) + Number(update?.$inc?.__v || 0),
                trustedDevices: clone(set.trustedDevices),
                mfa: {
                    ...current.mfa,
                    passkeys: clone(set['mfa.passkeys']),
                    enabled: set['mfa.enabled'],
                    defaultMethod: set['mfa.defaultMethod'],
                },
            };
            return clone(stateByUser[userId]);
        });
        revokeBrowserSessionsForDevices.mockResolvedValue({ revoked: 2 });
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    test('renames only the authenticated user device and keeps the duplicate passkey label aligned', async () => {
        const result = await renameTrustedDevice({
            userId: userAId,
            deviceId: deviceAId,
            label: `  Work ${String.fromCharCode(0x202e)}  laptop  `,
        });

        expect(result).toMatchObject({
            deviceId: deviceAId,
            label: 'Work laptop',
        });
        expect(stateByUser[userAId].trustedDevices[0].label).toBe('Work laptop');
        expect(stateByUser[userAId].mfa.passkeys[0].name).toBe('Work laptop');
        expect(stateByUser[userAId].mfa).toMatchObject({
            enabled: true,
            defaultMethod: 'passkey',
        });
        expect(revokeBrowserSessionsForDevices).not.toHaveBeenCalled();
    });

    test('rejects a stale full-array write instead of losing a concurrent device update', async () => {
        User.findOneAndUpdate.mockResolvedValueOnce(null);

        await expect(renameTrustedDevice({
            userId: userAId,
            deviceId: deviceAId,
            label: 'Concurrent rename',
        })).rejects.toMatchObject({
            statusCode: 409,
            code: 'TRUSTED_DEVICE_STATE_CHANGED',
        });

        expect(stateByUser[userAId].trustedDevices[0].label).toBe('Primary passkey');
    });

    test('soft-revokes a public user last passkey, rotates its session version, and disables MFA cleanly', async () => {
        const before = clone(stateByUser[userAId]);
        const authToken = {
            auth_time: Math.floor(Date.now() / 1000) - 30,
            iat: Math.floor(Date.now() / 1000) - 30,
        };
        const { deviceSessionToken } = issueTrustedDeviceSession({
            user: before,
            authUid: 'firebase-user-a',
            authToken,
            deviceId: deviceAId,
            sessionVersion: before.trustedDevices[0].sessionVersion,
        });

        const result = await revokeTrustedDevices({
            userId: userAId,
            deviceId: deviceAId,
            env: {
                ...process.env,
                MFA_REQUIRED_FOR_ADMINS: 'false',
                ADMIN_REQUIRE_PASSKEY: 'false',
            },
        });

        const revokedDevice = stateByUser[userAId].trustedDevices[0];
        expect(result).toMatchObject({
            revokedDeviceIds: [deviceAId],
            revokedSessions: 2,
        });
        expect(revokedDevice.revokedAt).toBeTruthy();
        expect(revokedDevice.sessionVersion).not.toBe(before.trustedDevices[0].sessionVersion);
        expect(stateByUser[userAId].mfa.passkeys[0].revokedAt).toBeTruthy();
        expect(stateByUser[userAId].mfa).toMatchObject({
            enabled: false,
            defaultMethod: '',
        });
        expect(revokeBrowserSessionsForDevices).toHaveBeenCalledWith(userAId, [deviceAId]);
        expect(verifyTrustedDeviceSession({
            user: stateByUser[userAId],
            authUid: 'firebase-user-a',
            authToken,
            deviceId: deviceAId,
            deviceSessionToken,
        })).toEqual({
            success: false,
            reason: 'Trusted device registration revoked',
        });
    });

    test('does not allow one user to rename or revoke another user device', async () => {
        await expect(renameTrustedDevice({
            userId: userAId,
            deviceId: deviceBId,
            label: 'Stolen label',
        })).rejects.toMatchObject({
            statusCode: 404,
            code: 'TRUSTED_DEVICE_NOT_FOUND',
        });
        await expect(revokeTrustedDevices({
            userId: userAId,
            deviceId: deviceBId,
        })).rejects.toMatchObject({
            statusCode: 404,
            code: 'TRUSTED_DEVICE_NOT_FOUND',
        });

        expect(stateByUser[userBId].trustedDevices[0]).toMatchObject({
            deviceId: deviceBId,
            revokedAt: null,
        });
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
        expect(revokeBrowserSessionsForDevices).not.toHaveBeenCalled();
    });

    test('blocks revocation of the last passkey for a role-only admin subject', async () => {
        stateByUser[userAId] = buildUser({
            isAdmin: false,
            adminRoles: ['SECURITY_ADMIN'],
            trustedDevices: [buildPasskey({
                adminEligibility: 'verified',
                credentialScope: 'admin',
            })],
        });

        await expect(revokeTrustedDevices({
            userId: userAId,
            deviceId: deviceAId,
            env: {
                ...process.env,
                ADMIN_REQUIRE_PASSKEY: 'true',
                MFA_REQUIRED_FOR_ADMINS: 'true',
            },
        })).rejects.toMatchObject({
            statusCode: 409,
            code: 'ADMIN_PASSKEY_REQUIRED',
        });

        expect(stateByUser[userAId].trustedDevices[0].revokedAt).toBeNull();
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
        expect(revokeBrowserSessionsForDevices).not.toHaveBeenCalled();
    });

    test('does not treat a legacy admin candidate as a replacement for the last verified admin passkey', async () => {
        const legacyCandidate = {
            ...buildPasskey({
                deviceId: deviceOtherId,
                credentialId: 'credential-legacy-admin-candidate',
                adminEligibility: 'legacy_candidate',
                credentialScope: 'recognition',
            }),
            webauthnUserVerification: 'required',
            webauthnUserVerified: false,
            webauthnUserVerifiedAt: null,
        };
        stateByUser[userAId] = buildUser({
            isAdmin: true,
            trustedDevices: [
                buildPasskey({
                    adminEligibility: 'verified',
                    credentialScope: 'admin',
                }),
                legacyCandidate,
            ],
        });

        await expect(revokeTrustedDevices({
            userId: userAId,
            deviceId: deviceAId,
            env: {
                ...process.env,
                ADMIN_REQUIRE_PASSKEY: 'true',
                MFA_REQUIRED_FOR_ADMINS: 'true',
            },
        })).rejects.toMatchObject({
            statusCode: 409,
            code: 'ADMIN_PASSKEY_REQUIRED',
        });

        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
        expect(revokeBrowserSessionsForDevices).not.toHaveBeenCalled();
    });

    test('revoke-all-others preserves the server-bound current device and keeps TOTP as the default', async () => {
        const currentDevice = buildBrowserDevice({
            deviceId: deviceAId,
            label: 'Current browser',
        });
        const otherBrowser = buildBrowserDevice({ deviceId: deviceOtherId });
        const otherPasskey = buildPasskey({
            deviceId: 'device-user-a-0003',
            credentialId: 'credential-user-a-other',
        });
        stateByUser[userAId] = buildUser({
            trustedDevices: [currentDevice, otherBrowser, otherPasskey],
            totpEnabled: true,
        });

        const result = await revokeTrustedDevices({
            userId: userAId,
            currentDeviceId: deviceAId,
            revokeAllOthers: true,
            env: {
                ...process.env,
                ADMIN_REQUIRE_PASSKEY: 'false',
            },
        });

        expect(result.revokedDeviceIds).toEqual(expect.arrayContaining([
            deviceOtherId,
            'device-user-a-0003',
        ]));
        expect(stateByUser[userAId].trustedDevices.find((device) => device.deviceId === deviceAId).revokedAt).toBeNull();
        expect(stateByUser[userAId].trustedDevices
            .filter((device) => device.deviceId !== deviceAId)
            .every((device) => Boolean(device.revokedAt))).toBe(true);
        expect(stateByUser[userAId].mfa).toMatchObject({
            enabled: true,
            defaultMethod: 'totp',
        });
        expect(revokeBrowserSessionsForDevices).toHaveBeenCalledWith(
            userAId,
            expect.arrayContaining([deviceOtherId, 'device-user-a-0003'])
        );
    });

    test('rejects revoke-all-others without a server-bound current device', async () => {
        await expect(revokeTrustedDevices({
            userId: userAId,
            currentDeviceId: '',
            revokeAllOthers: true,
        })).rejects.toMatchObject({
            statusCode: 400,
            code: 'CURRENT_TRUSTED_DEVICE_REQUIRED',
        });
        expect(User.findById).not.toHaveBeenCalled();
    });
});
