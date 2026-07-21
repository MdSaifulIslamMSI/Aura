const User = require('../models/User');
const {
    assertAdminPasskeyEnrollmentAssurance,
    buildMfaState,
    hasFreshIndependentAdminEnrollmentFactor,
    syncPasskeyMfaState,
} = require('../controllers/mfaController');

describe('admin passkey enrollment assurance', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    const buildAdminRequest = (overrides = {}) => ({
        user: { isAdmin: true },
        authToken: {},
        authSession: null,
        ...overrides,
    });

    test('does not require admin bootstrap assurance for public users', () => {
        expect(hasFreshIndependentAdminEnrollmentFactor({
            user: { isAdmin: false },
        })).toBe(true);
    });

    test('enforces admin bootstrap assurance for role-only admin subjects', () => {
        expect(hasFreshIndependentAdminEnrollmentFactor({
            user: { isAdmin: false, adminRoles: ['SECURITY_ADMIN'] },
            authToken: { auth_time: Math.floor(Date.now() / 1000) },
        })).toBe(false);
    });

    test('rejects an admin primary session with no independent factor', () => {
        const req = buildAdminRequest({
            authToken: {
                auth_time: Math.floor(Date.now() / 1000),
            },
        });

        expect(hasFreshIndependentAdminEnrollmentFactor(req)).toBe(false);
        expect(() => assertAdminPasskeyEnrollmentAssurance(req)).toThrow(expect.objectContaining({
            code: 'ADMIN_PASSKEY_ENROLLMENT_ASSURANCE_REQUIRED',
            statusCode: 403,
            requiresMfa: true,
        }));
    });

    test('accepts a fresh server-verified token second factor', () => {
        const req = buildAdminRequest({
            authToken: {
                auth_time: Math.floor(Date.now() / 1000),
                firebase: {
                    sign_in_second_factor: 'totp',
                },
            },
        });

        expect(hasFreshIndependentAdminEnrollmentFactor(req)).toBe(true);
        expect(() => assertAdminPasskeyEnrollmentAssurance(req)).not.toThrow();
    });

    test('rejects stale token MFA and expired browser-session step-up', () => {
        const req = buildAdminRequest({
            authToken: {
                auth_time: Math.floor((Date.now() - (20 * 60 * 1000)) / 1000),
                firebase: {
                    sign_in_second_factor: 'totp',
                },
            },
            authSession: {
                amr: ['duo'],
                stepUpUntil: new Date(Date.now() - 1000).toISOString(),
            },
        });

        expect(hasFreshIndependentAdminEnrollmentFactor(req)).toBe(false);
    });

    test('accepts a currently active Duo or TOTP session step-up', () => {
        const req = buildAdminRequest({
            authSession: {
                amr: ['duo_oidc'],
                stepUpUntil: new Date(Date.now() + 60_000).toISOString(),
            },
        });

        expect(hasFreshIndependentAdminEnrollmentFactor(req)).toBe(true);
    });

    test('does not present a recognition-only passkey as enrolled MFA', () => {
        const state = buildMfaState({
            isAdmin: false,
            trustedDevices: [{
                deviceId: 'device-public-recognition',
                label: 'Remembered passkey browser',
                method: 'webauthn',
                webauthnCredentialIdBase64Url: 'recognition-credential',
                credentialScope: 'recognition',
                webauthnUserVerification: 'required',
                revokedAt: null,
            }],
            mfa: { enabled: false, passkeys: [] },
        }, { currentDeviceId: 'device-public-recognition' });

        expect(state.methods.passkey).toMatchObject({ enabled: false, count: 0 });
        expect(state.devicePolicy).toMatchObject({
            audience: 'public',
            currentDeviceBound: true,
            activeCount: 1,
        });
        expect(state.trustedDevices[0]).toMatchObject({
            isCurrent: true,
            isMfaFactor: false,
            credentialScope: 'recognition',
        });
    });

    test('keeps a legacy admin candidate disabled until a dedicated verified assertion promotes it', () => {
        const legacyCredentialId = 'legacy-admin-credential';
        const state = buildMfaState({
            isAdmin: true,
            trustedDevices: [{
                deviceId: 'device-legacy-admin-passkey',
                label: 'Legacy admin passkey',
                method: 'webauthn',
                webauthnCredentialIdBase64Url: legacyCredentialId,
                credentialScope: 'recognition',
                adminEligibility: 'legacy_candidate',
                enrollmentContext: 'legacy_admin_snapshot',
                webauthnUserVerification: 'required',
                webauthnUserVerified: true,
                revokedAt: null,
            }],
            mfa: {
                enabled: true,
                passkeys: [{ credentialId: legacyCredentialId, revokedAt: null }],
            },
        }, { currentDeviceId: 'device-legacy-admin-passkey' });

        expect(state.methods.passkey).toMatchObject({ enabled: false, count: 0 });
        expect(state.trustedDevices[0]).toMatchObject({
            isCurrent: true,
            isMfaFactor: false,
            credentialScope: 'recognition',
            adminEligibility: 'legacy_candidate',
            adminEligible: false,
        });
    });

    test('marks only a verified UV admin passkey as admin eligible and reports sync state', () => {
        const state = buildMfaState({
            isAdmin: true,
            trustedDevices: [{
                deviceId: 'device-admin-passkey',
                label: 'Admin security key',
                method: 'webauthn',
                webauthnCredentialIdBase64Url: 'admin-credential',
                credentialScope: 'admin',
                adminEligibility: 'verified',
                webauthnUserVerification: 'required',
                webauthnBackupEligible: true,
                webauthnBackedUp: true,
                revokedAt: null,
            }],
            mfa: {
                enabled: true,
                passkeys: [{ credentialId: 'admin-credential', revokedAt: null }],
            },
        });

        expect(state.methods.passkey).toMatchObject({ enabled: true, count: 1 });
        expect(state.devicePolicy.audience).toBe('admin');
        expect(state.trustedDevices[0]).toMatchObject({
            adminEligible: true,
            isMfaFactor: true,
            backupEligible: true,
            backedUp: true,
            syncState: 'synced',
        });
    });

    test('does not count an explicitly non-UV passkey as MFA even when stale scope data says mfa', () => {
        const state = buildMfaState({
            isAdmin: false,
            trustedDevices: [{
                deviceId: 'device-public-no-uv',
                label: 'User-present passkey',
                method: 'webauthn',
                webauthnCredentialIdBase64Url: 'no-uv-credential',
                credentialScope: 'mfa',
                webauthnUserVerification: 'preferred',
                webauthnUserVerified: false,
                revokedAt: null,
            }],
            mfa: {
                enabled: true,
                passkeys: [{ credentialId: 'no-uv-credential', revokedAt: null }],
            },
        });

        expect(state.methods.passkey).toMatchObject({ enabled: false, count: 0 });
        expect(state.trustedDevices[0]).toMatchObject({
            isMfaFactor: false,
            userVerified: false,
        });
    });

    test('rejects non-UV passkeys before enabling MFA state', async () => {
        await expect(syncPasskeyMfaState({
            userId: '507f1f77bcf86cd799439011',
            trustedDevice: {
                webauthnCredentialIdBase64Url: 'credential-no-uv',
                webauthnUserVerified: false,
                webauthnUserVerification: 'preferred',
            },
        })).rejects.toMatchObject({
            statusCode: 403,
            code: 'PASSKEY_USER_VERIFICATION_REQUIRED',
        });
    });

    test('uses optimistic versioning when synchronizing passkey MFA state', async () => {
        const query = {
            select: jest.fn(() => query),
            lean: jest.fn().mockResolvedValue({
                _id: '507f1f77bcf86cd799439011',
                __v: 7,
                mfa: { passkeys: [] },
            }),
        };
        jest.spyOn(User, 'findById').mockReturnValue(query);
        jest.spyOn(User, 'findOneAndUpdate').mockResolvedValue(null);

        await expect(syncPasskeyMfaState({
            userId: '507f1f77bcf86cd799439011',
            trustedDevice: {
                label: 'Security key',
                webauthnCredentialIdBase64Url: 'credential-uv',
                webauthnUserVerified: true,
                credentialScope: 'mfa',
            },
        })).rejects.toMatchObject({
            statusCode: 409,
            code: 'TRUSTED_DEVICE_STATE_CHANGED',
        });
        expect(User.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: '507f1f77bcf86cd799439011', __v: 7 },
            expect.objectContaining({ $inc: { __v: 1 } }),
            expect.any(Object)
        );
    });
});
