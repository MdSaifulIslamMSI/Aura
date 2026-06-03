const {
    SENSITIVE_ACTION_CATEGORIES,
    resolveSensitiveActionPolicyConfig,
} = require('../config/sensitiveActionPolicy');
const {
    evaluateSensitiveActionPolicy,
} = require('../security/sensitiveActionPolicy');

const adminActor = (overrides = {}) => ({
    _id: 'admin-1',
    isAdmin: true,
    email: 'admin@example.com',
    trustedDevices: [
        { deviceId: 'passkey-1', method: 'webauthn' },
    ],
    ...overrides,
});

const evaluateAdminMutation = (overrides = {}) => evaluateSensitiveActionPolicy({
    action: 'admin.users.mutate',
    category: SENSITIVE_ACTION_CATEGORIES.ADMIN_USER_MANAGEMENT,
    riskLevel: 'critical',
    actor: adminActor(),
    context: {
        recentAuth: true,
        webAuthnStepUpFresh: true,
        amr: ['webauthn'],
        ...overrides.context,
    },
    env: { NODE_ENV: 'production', ...overrides.env },
    ...(overrides.input || {}),
});

describe('sensitive action policy', () => {
    test('production blocks critical admin mutation when no WebAuthn credential is registered', () => {
        const decision = evaluateAdminMutation({
            input: {
                actor: adminActor({ trustedDevices: [] }),
            },
        });

        expect(decision).toMatchObject({
            allowed: false,
            reason: 'webauthn_registration_required',
            action: 'admin.users.mutate',
            riskLevel: 'critical',
        });
        expect(decision.requiredAssurance).toEqual(expect.arrayContaining([
            'authenticated',
            'admin',
            'recent_auth',
            'webauthn_registered',
            'fresh_webauthn_step_up',
        ]));
    });

    test('production blocks critical admin mutation when WebAuthn step-up is stale', () => {
        const decision = evaluateAdminMutation({
            context: {
                webAuthnStepUpFresh: false,
                amr: ['password'],
            },
        });

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toBe('webauthn_step_up_required');
    });

    test('production allows critical admin mutation with fresh WebAuthn evidence', () => {
        const decision = evaluateAdminMutation();

        expect(decision).toMatchObject({
            allowed: true,
            reason: 'allowed',
            telemetryCode: 'security.policy.allowed.allowed',
        });
    });

    test('non-admin cannot bypass critical admin mutation with WebAuthn evidence', () => {
        const decision = evaluateAdminMutation({
            input: {
                actor: {
                    _id: 'user-1',
                    isAdmin: false,
                    trustedDevices: [{ method: 'webauthn' }],
                },
            },
        });

        expect(decision.allowed).toBe(false);
        expect(decision.reason).toBe('admin_assurance_required');
    });

    test('rollback only allows denial when explicitly enabled', () => {
        const denied = evaluateAdminMutation({
            input: {
                actor: adminActor({ trustedDevices: [] }),
            },
            env: {
                AUTH_SENSITIVE_ACTION_POLICY_ROLLBACK: 'false',
            },
        });
        const allowed = evaluateAdminMutation({
            input: {
                actor: adminActor({ trustedDevices: [] }),
            },
            env: {
                AUTH_SENSITIVE_ACTION_POLICY_ROLLBACK: 'true',
            },
        });

        expect(denied.allowed).toBe(false);
        expect(allowed).toMatchObject({
            allowed: true,
            reason: 'rollback_override',
            rollbackAllowed: true,
        });
    });

    test('development defaults stay compatible unless WebAuthn enforcement is enabled', () => {
        const config = resolveSensitiveActionPolicyConfig({ NODE_ENV: 'development' });
        const decision = evaluateSensitiveActionPolicy({
            action: 'admin.users.mutate',
            category: SENSITIVE_ACTION_CATEGORIES.ADMIN_USER_MANAGEMENT,
            riskLevel: 'critical',
            actor: adminActor({ trustedDevices: [] }),
            context: { recentAuth: true },
            config,
        });

        expect(config.requireWebAuthnForAdminStateChanges).toBe(false);
        expect(decision.allowed).toBe(true);
        expect(decision.requiredAssurance).not.toContain('webauthn_registered');
    });
});
