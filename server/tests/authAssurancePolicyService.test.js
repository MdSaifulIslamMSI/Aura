const {
    AUTH_ASSURANCE_ACTIONS,
    AUTH_ASSURANCE_LEVELS,
    evaluateAuthAssurance,
    requireAuthAssurance,
} = require('../services/authAssurancePolicyService');

const buildFlow = (overrides = {}) => ({
    sub: 'user-123',
    purpose: 'forgot-password',
    factor: 'otp',
    nextStep: 'reset-password',
    signalBond: {},
    ...overrides,
});

describe('authAssurancePolicyService', () => {
    test('allows password reset finalization with OTP fallback when the flow is not passkey-bound', () => {
        const decision = evaluateAuthAssurance({
            action: AUTH_ASSURANCE_ACTIONS.PASSWORD_RESET_FINALIZE,
            user: { _id: 'user-123' },
            flow: buildFlow(),
            resetSessionFresh: true,
        });

        expect(decision.allowed).toBe(true);
        expect(decision.requiredLevel).toBe(AUTH_ASSURANCE_LEVELS.OTP);
        expect(decision.grantedLevel).toBe(AUTH_ASSURANCE_LEVELS.OTP);
    });

    test('rejects password reset finalization when the recovery OTP window is not fresh', () => {
        const decision = evaluateAuthAssurance({
            action: AUTH_ASSURANCE_ACTIONS.PASSWORD_RESET_FINALIZE,
            user: { _id: 'user-123' },
            flow: buildFlow(),
            resetSessionFresh: false,
        });

        expect(decision.allowed).toBe(false);
        expect(decision.grantedLevel).toBe(AUTH_ASSURANCE_LEVELS.NONE);
        expect(decision.reasons[0]).toContain('Fresh recovery OTP verification');
    });

    test('requires fresh WebAuthn proof at final password reset for passkey-bound flows', () => {
        const flow = buildFlow({
            signalBond: {
                deviceId: 'device-passkey-123',
                deviceSessionHash: 'session-hash-123',
                deviceMethod: 'webauthn',
            },
        });

        const decision = evaluateAuthAssurance({
            action: AUTH_ASSURANCE_ACTIONS.PASSWORD_RESET_FINALIZE,
            user: { _id: 'user-123' },
            flow,
            deviceSessionHash: 'session-hash-123',
            resetSessionFresh: true,
        });

        expect(decision.allowed).toBe(false);
        expect(decision.requiredLevel).toBe(AUTH_ASSURANCE_LEVELS.PASSKEY_STEP_UP);
        expect(decision.grantedLevel).toBe(AUTH_ASSURANCE_LEVELS.TRUSTED_DEVICE);
        expect(decision.reasons[0]).toContain('Fresh passkey verification');
    });

    test('allows final password reset when fresh WebAuthn proof matches the bound trusted-device session', () => {
        const flow = buildFlow({
            signalBond: {
                deviceId: 'device-passkey-123',
                deviceSessionHash: 'session-hash-123',
                deviceMethod: 'webauthn',
            },
        });

        const decision = evaluateAuthAssurance({
            action: AUTH_ASSURANCE_ACTIONS.PASSWORD_RESET_FINALIZE,
            user: { _id: 'user-123' },
            flow,
            trustedDeviceSignal: {
                verified: true,
                method: 'webauthn',
                deviceId: 'device-passkey-123',
                deviceSessionHash: 'session-hash-123',
            },
            resetSessionFresh: true,
        });

        expect(decision.allowed).toBe(true);
        expect(decision.grantedLevel).toBe(AUTH_ASSURANCE_LEVELS.PASSKEY_STEP_UP);
        expect(decision.evidence.passkeyStepUp).toBe(true);
    });

    test('allows auth sync to consume a passkey-bound OTP flow when the device session hash matches', () => {
        const decision = evaluateAuthAssurance({
            action: AUTH_ASSURANCE_ACTIONS.AUTH_SYNC_ELEVATED_LOGIN,
            user: { _id: 'user-123' },
            flow: buildFlow({
                purpose: 'login',
                nextStep: 'auth-sync',
                signalBond: {
                    deviceId: 'device-passkey-123',
                    deviceSessionHash: 'session-hash-123',
                    deviceMethod: 'webauthn',
                    authUid: 'firebase-user-123',
                },
            }),
            deviceSessionHash: 'session-hash-123',
            firebaseAuthFresh: true,
        });

        expect(decision.allowed).toBe(true);
        expect(decision.requiredLevel).toBe(AUTH_ASSURANCE_LEVELS.PASSKEY_STEP_UP);
        expect(decision.grantedLevel).toBe(AUTH_ASSURANCE_LEVELS.PASSKEY_STEP_UP);
    });

    test('rejects auth sync when Firebase auth time is not fresh inside the policy decision', () => {
        const decision = evaluateAuthAssurance({
            action: AUTH_ASSURANCE_ACTIONS.AUTH_SYNC_ELEVATED_LOGIN,
            user: { _id: 'user-123' },
            flow: buildFlow({
                purpose: 'login',
                nextStep: 'auth-sync',
            }),
            firebaseAuthFresh: false,
        });

        expect(decision.allowed).toBe(false);
        expect(decision.grantedLevel).toBe(AUTH_ASSURANCE_LEVELS.NONE);
        expect(decision.reasons[0]).toContain('Fresh login');
    });

    test('throws when auth sync lacks the trusted-device session required by a passkey-bound flow', () => {
        expect(() => requireAuthAssurance({
            action: AUTH_ASSURANCE_ACTIONS.AUTH_SYNC_ELEVATED_LOGIN,
            user: { _id: 'user-123' },
            flow: buildFlow({
                purpose: 'login',
                nextStep: 'auth-sync',
                signalBond: {
                    deviceId: 'device-passkey-123',
                    deviceSessionHash: 'session-hash-123',
                    deviceMethod: 'webauthn',
                },
            }),
            deviceSessionHash: 'session-hash-other',
            firebaseAuthFresh: true,
        })).toThrow('Fresh passkey verification is required for this auth step.');
    });
});
