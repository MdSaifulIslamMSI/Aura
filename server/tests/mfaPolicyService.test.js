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
                trustedDevices: [{
                    method: 'webauthn',
                    webauthnCredentialIdBase64Url: 'credential-1',
                    webauthnUserVerified: true,
                    credentialScope: 'admin',
                    adminEligibility: 'verified',
                }],
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

    test('does not promote a public passkey into an admin MFA credential after a role change', () => {
        const decision = evaluateLogin({
            env: {
                MFA_ENABLED: 'true',
                MFA_PASSKEY_ENABLED: 'true',
                MFA_REQUIRED_FOR_ADMINS: 'true',
            },
            user: {
                isAdmin: true,
                trustedDevices: [{
                    method: 'webauthn',
                    webauthnCredentialIdBase64Url: 'public-credential',
                    credentialScope: 'mfa',
                    adminEligibility: 'none',
                }],
                mfa: {
                    enabled: true,
                    defaultMethod: 'passkey',
                    passkeys: [{ credentialId: 'public-credential' }],
                },
            },
        });

        expect(decision).toMatchObject({
            mfaRequired: true,
            allowedMethods: [],
            preferredMethod: null,
            reason: 'admin_policy',
            block: true,
        });
    });

    test('does not offer a recognition-only or non-UV WebAuthn credential as public MFA', () => {
        const baseUser = {
            mfa: {
                enabled: true,
                defaultMethod: 'passkey',
                passkeys: [{ credentialId: 'credential-1' }],
            },
            recoveryCodeState: { activeCount: 0 },
        };
        const env = {
            MFA_ENABLED: 'true',
            MFA_PASSKEY_ENABLED: 'true',
        };

        const recognitionOnly = evaluateLogin({
            env,
            user: {
                ...baseUser,
                mfa: { ...baseUser.mfa, passkeys: [] },
                trustedDevices: [{
                    method: 'webauthn',
                    webauthnCredentialIdBase64Url: 'credential-1',
                    webauthnUserVerified: true,
                    credentialScope: 'recognition',
                }],
            },
        });
        const explicitNonUv = evaluateLogin({
            env,
            user: {
                ...baseUser,
                trustedDevices: [{
                    method: 'webauthn',
                    webauthnCredentialIdBase64Url: 'credential-1',
                    webauthnUserVerified: false,
                    webauthnUserVerification: 'required',
                    credentialScope: 'mfa',
                }],
            },
        });

        expect(recognitionOnly).toMatchObject({ mfaRequired: true, allowedMethods: [], block: true });
        expect(explicitNonUv).toMatchObject({ mfaRequired: true, allowedMethods: [], block: true });
    });

    test('treats role-only admin subjects as admin policy subjects', () => {
        const decision = evaluateLogin({
            env: {
                MFA_ENABLED: 'true',
                MFA_TOTP_ENABLED: 'true',
                MFA_REQUIRED_FOR_ADMINS: 'true',
            },
            user: {
                isAdmin: false,
                adminRoles: ['SECURITY_ADMIN'],
                mfa: { totp: { enabled: true, confirmedAt: new Date() } },
            },
        });

        expect(decision).toMatchObject({
            mfaRequired: true,
            reason: 'admin_policy',
            role: 'admin',
            allowedMethods: [MFA_METHODS.TOTP],
        });
    });

    test('accepts only session-bound completed MFA when evaluating a resumed login', () => {
        const user = {
            mfa: {
                enabled: true,
                totp: { enabled: true, confirmedAt: new Date() },
            },
        };
        const env = { MFA_ENABLED: 'true', MFA_TOTP_ENABLED: 'true' };

        expect(evaluateLogin({
            env,
            user,
            context: { session: { amr: ['totp', 'mfa'] } },
        })).toMatchObject({ mfaRequired: false, policyRequired: true, satisfied: true, reason: 'satisfied' });
        expect(evaluateLogin({
            env,
            user,
            context: { session: { amr: ['webauthn'] } },
        })).toMatchObject({ mfaRequired: true, satisfied: false, reason: 'user_enabled' });
    });

    test('does not let recognition-only WebAuthn step-up satisfy a TOTP action policy', () => {
        const user = {
            mfa: {
                enabled: true,
                totp: { enabled: true, confirmedAt: new Date() },
                lastMfaAt: new Date(),
                lastMfaMethod: 'totp',
            },
        };
        const env = { MFA_ENABLED: 'true', MFA_TOTP_ENABLED: 'true' };
        const stepUpUntil = new Date(Date.now() + 60_000).toISOString();

        expect(evaluateAction({
            env,
            user,
            action: 'account.delete',
            session: { amr: ['webauthn'], stepUpUntil },
        }).satisfied).toBe(false);
        expect(evaluateAction({
            env,
            user,
            action: 'account.delete',
            session: { amr: ['totp', 'mfa'], stepUpUntil },
        }).satisfied).toBe(true);
    });

    test('does not let an unspecified Firebase second factor satisfy a passkey-only action', () => {
        const decision = evaluateAction({
            env: { MFA_ENABLED: 'true', MFA_PASSKEY_ENABLED: 'true' },
            action: 'admin.security_config.change',
            user: {
                isAdmin: true,
                trustedDevices: [{
                    method: 'webauthn',
                    webauthnCredentialIdBase64Url: 'admin-credential',
                    webauthnUserVerified: true,
                    credentialScope: 'admin',
                    adminEligibility: 'verified',
                }],
                mfa: { enabled: true },
            },
            session: {
                amr: ['firebase_mfa'],
                stepUpUntil: new Date(Date.now() + 60_000).toISOString(),
            },
        });

        expect(decision).toMatchObject({
            allowedMethods: [MFA_METHODS.PASSKEY],
            satisfied: false,
        });
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
