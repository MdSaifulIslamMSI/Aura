const {
    MFA_METHODS,
    evaluateAction,
    evaluateLogin,
} = require('../services/mfaPolicyService');

describe('mfaPolicyService', () => {
    test('keeps MFA disabled by default for rollback safety', () => {
        const decision = evaluateLogin({
            env: {},
            user: {
                mfa: {
                    enabled: true,
                    totp: {
                        enabled: true,
                        confirmedAt: new Date(),
                    },
                },
            },
        });

        expect(decision).toMatchObject({
            mfaRequired: false,
            reason: 'not_required',
        });
    });

    test('requires enabled buyer MFA at login with TOTP allowed', () => {
        const decision = evaluateLogin({
            env: {
                MFA_ENABLED: 'true',
                MFA_TOTP_ENABLED: 'true',
            },
            user: {
                mfa: {
                    enabled: true,
                    defaultMethod: 'totp',
                    totp: {
                        enabled: true,
                        confirmedAt: new Date(),
                    },
                },
                recoveryCodeState: { activeCount: 0 },
            },
        });

        expect(decision).toMatchObject({
            mfaRequired: true,
            allowedMethods: [MFA_METHODS.TOTP],
            preferredMethod: MFA_METHODS.TOTP,
            reason: 'user_enabled',
            block: false,
        });
    });

    test('prefers passkey for super-admin dangerous actions when available', () => {
        const decision = evaluateAction({
            env: {
                MFA_ENABLED: 'true',
                MFA_PASSKEY_ENABLED: 'true',
                MFA_TOTP_ENABLED: 'true',
            },
            action: 'admin.security_config.change',
            user: {
                isAdmin: true,
                adminRoles: ['SUPER_ADMIN'],
                trustedDevices: [{ method: 'webauthn', webauthnCredentialIdBase64Url: 'credential-1' }],
                mfa: {
                    enabled: true,
                    totp: { enabled: true, confirmedAt: new Date() },
                },
            },
            session: {},
        });

        expect(decision).toMatchObject({
            freshMfaRequired: true,
            preferredMethod: MFA_METHODS.PASSKEY,
            satisfied: false,
        });
        expect(decision.allowedMethods).toEqual(expect.arrayContaining([MFA_METHODS.PASSKEY, MFA_METHODS.TOTP]));
    });

    test('does not create an empty step-up challenge for optional unenrolled buyers', () => {
        const decision = evaluateAction({
            env: {
                MFA_ENABLED: 'true',
                MFA_TOTP_ENABLED: 'true',
            },
            action: 'account.delete',
            user: {
                isAdmin: false,
                isSeller: false,
                mfa: { enabled: false },
                recoveryCodeState: { activeCount: 0 },
            },
            session: {},
        });

        expect(decision).toMatchObject({
            freshMfaRequired: false,
            allowedMethods: [],
            reason: 'not_required',
            block: false,
            satisfied: true,
        });
    });

    test('blocks enrolled users when fresh MFA is required but no method is available', () => {
        const decision = evaluateAction({
            env: {
                MFA_ENABLED: 'true',
                MFA_TOTP_ENABLED: 'true',
            },
            action: 'account.delete',
            user: {
                mfa: { enabled: true },
                recoveryCodeState: { activeCount: 0 },
            },
            session: {},
        });

        expect(decision).toMatchObject({
            freshMfaRequired: true,
            allowedMethods: [],
            reason: 'dangerous_action',
            block: true,
            satisfied: false,
        });
    });
});
