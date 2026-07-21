const {
    MFA_METHODS,
    buildDesktopHandoffMfaMarker,
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

    test('requires an exact verified admin device before accepting passkey MFA session claims', () => {
        const env = {
            MFA_ENABLED: 'true',
            MFA_PASSKEY_ENABLED: 'true',
            MFA_REQUIRED_FOR_ADMINS: 'true',
        };
        const session = {
            deviceId: 'admin-device-1',
            amr: ['webauthn', 'passkey', 'mfa'],
        };
        const baseDevice = {
            deviceId: 'admin-device-1',
            method: 'webauthn',
            webauthnCredentialIdBase64Url: 'admin-credential-1',
            webauthnUserVerified: true,
        };

        expect(evaluateLogin({
            env,
            user: {
                isAdmin: true,
                trustedDevices: [{
                    ...baseDevice,
                    credentialScope: 'recognition',
                    adminEligibility: 'none',
                }],
            },
            context: { session },
        })).toMatchObject({ mfaRequired: true, satisfied: false, block: true });

        expect(evaluateLogin({
            env,
            user: {
                isAdmin: true,
                trustedDevices: [{
                    ...baseDevice,
                    credentialScope: 'admin',
                    adminEligibility: 'verified',
                }],
            },
            context: { session },
        })).toMatchObject({ mfaRequired: false, satisfied: true, reason: 'satisfied' });
    });

    test('offers legacy admin passkey restoration only on the exact current device', () => {
        const env = {
            MFA_ENABLED: 'true',
            MFA_PASSKEY_ENABLED: 'true',
            MFA_REQUIRED_FOR_ADMINS: 'true',
        };
        const user = {
            isAdmin: true,
            trustedDevices: [{
                deviceId: 'legacy-admin-device-1',
                method: 'webauthn',
                webauthnCredentialIdBase64Url: 'legacy-admin-credential-1',
                credentialScope: 'recognition',
                enrollmentContext: 'legacy_admin_snapshot',
                adminEligibility: 'legacy_candidate',
            }],
        };

        expect(evaluateLogin({
            env,
            user,
            context: { session: { deviceId: 'legacy-admin-device-1', amr: [] } },
        })).toMatchObject({
            mfaRequired: true,
            allowedMethods: [MFA_METHODS.PASSKEY],
            preferredMethod: MFA_METHODS.PASSKEY,
            block: false,
        });

        expect(evaluateLogin({
            env,
            user,
            context: { session: { deviceId: 'different-device-2', amr: [] } },
        })).toMatchObject({
            mfaRequired: true,
            allowedMethods: [],
            preferredMethod: null,
            block: true,
        });
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

    test('accepts only an exact target-bound admin handoff marker for login, never fresh action step-up', () => {
        const targetDeviceId = 'aura_desktop_target_marker_123';
        const sourcePasskey = {
            deviceId: 'hosted-admin-passkey-123',
            method: 'webauthn',
            webauthnCredentialIdBase64Url: 'admin-marker-credential',
            webauthnUserVerified: true,
            credentialScope: 'admin',
            adminEligibility: 'verified',
        };
        const user = {
            isAdmin: true,
            trustedDevices: [sourcePasskey, {
                deviceId: targetDeviceId,
                method: 'browser_key',
            }],
            mfa: { enabled: true },
        };
        const env = {
            MFA_ENABLED: 'true',
            MFA_REQUIRED_FOR_ADMINS: 'true',
            MFA_PASSKEY_ENABLED: 'true',
        };
        const adminMarker = buildDesktopHandoffMfaMarker(targetDeviceId, { admin: true });
        const targetSession = {
            deviceId: targetDeviceId,
            deviceMethod: 'browser_key',
            aal: 'aal2',
            amr: ['device_binding', 'desktop_handoff', 'mfa', adminMarker],
            stepUpUntil: null,
            webAuthnStepUpUntil: null,
        };

        expect(evaluateLogin({ user, env, context: { session: targetSession } })).toMatchObject({
            mfaRequired: false,
            satisfied: true,
        });
        expect(evaluateLogin({
            user,
            env,
            context: {
                session: {
                    ...targetSession,
                    amr: ['mfa', adminMarker],
                },
            },
        })).toMatchObject({
            mfaRequired: true,
            satisfied: false,
        });
        expect(evaluateLogin({
            user,
            env,
            context: {
                session: {
                    ...targetSession,
                    deviceMethod: 'webauthn',
                },
            },
        })).toMatchObject({
            mfaRequired: true,
            satisfied: false,
        });
        expect(evaluateLogin({
            user,
            env,
            context: { session: { ...targetSession, deviceId: 'aura_desktop_other_marker_456' } },
        })).toMatchObject({
            mfaRequired: true,
            satisfied: false,
        });
        expect(evaluateLogin({
            user,
            env,
            context: {
                session: {
                    ...targetSession,
                    amr: [
                        'device_binding',
                        'desktop_handoff',
                        'mfa',
                        buildDesktopHandoffMfaMarker(targetDeviceId),
                    ],
                },
            },
        })).toMatchObject({
            mfaRequired: true,
            satisfied: false,
        });
        expect(evaluateAction({
            user,
            env,
            action: 'admin.security_config.change',
            session: targetSession,
        })).toMatchObject({
            freshMfaRequired: true,
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
