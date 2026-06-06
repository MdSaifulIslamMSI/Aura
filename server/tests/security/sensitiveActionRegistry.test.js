const {
    canonicalizeAction,
    getSensitiveActionPolicy,
    listSensitiveActions,
} = require('../../security/sensitiveActionRegistry');

describe('sensitiveActionRegistry', () => {
    test('defines the required sensitive action set', () => {
        expect(listSensitiveActions()).toEqual(expect.arrayContaining([
            'admin.role.change',
            'payment.refund',
            'data.export',
            'auth.mfa.disable',
            'status.adminupdate',
        ]));
    });

    test('admin role change is critical and passkey gated', () => {
        const policy = getSensitiveActionPolicy('admin.role.change');

        expect(policy).toMatchObject({
            sensitivity: 'critical',
            requiresFreshAuth: true,
            requiresMfa: true,
            requiresPasskeyForAdmin: true,
            requiresAudit: true,
        });
        expect(policy.allowedRoles).toContain('admin');
        expect(policy.containmentPolicy).toContain('freeze_admin_destructive_actions');
    });

    test('payment refund is critical and support/admin limited', () => {
        const policy = getSensitiveActionPolicy('payment.refund');

        expect(policy.sensitivity).toBe('critical');
        expect(policy.allowedRoles).toEqual(expect.arrayContaining(['admin', 'support']));
        expect(policy.requiresFreshAuth).toBe(true);
        expect(policy.requiresAudit).toBe(true);
    });

    test('aliases map existing route action names to fabric policies', () => {
        expect(canonicalizeAction('payment.refund.create')).toBe('payment.refund');
        expect(canonicalizeAction('admin.user.role.update')).toBe('admin.role.change');
    });
});
