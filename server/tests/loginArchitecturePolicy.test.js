const { getAuthProviderPolicy } = require('../config/authProviderPolicy');
const { listAuthorizationPolicy } = require('../config/authorizationPolicy');
const { listPrivacyDataInventory } = require('../config/privacyDataInventory');
const { getPrivilegedAccessPolicy } = require('../config/privilegedAccessPolicy');

describe('login architecture policy manifests', () => {
    test('tracks consumer and enterprise provider breadth', () => {
        const providers = getAuthProviderPolicy();
        const keys = providers.map((provider) => provider.key);

        expect(keys).toEqual(expect.arrayContaining([
            'google',
            'facebook',
            'x',
            'microsoft',
            'apple',
            'enterprise_oidc',
            'enterprise_saml',
        ]));
        expect(providers.find((provider) => provider.key === 'microsoft')).toMatchObject({
            status: 'ready_when_enabled',
            protocol: 'oidc_via_firebase',
        });
        expect(providers.find((provider) => provider.key === 'enterprise_saml')).toMatchObject({
            status: 'design_required',
            enterprise: true,
        });
    });

    test('formalizes admin and sensitive-user authorization surfaces', () => {
        const policy = listAuthorizationPolicy();

        expect(policy).toEqual(expect.arrayContaining([
            expect.objectContaining({
                method: 'POST',
                path: '/api/admin/users/:userId/delete',
                permission: 'admin.users.delete',
                role: 'admin',
                middleware: ['protect', 'admin'],
            }),
            expect.objectContaining({
                method: 'POST',
                path: '/api/auth/recovery-codes',
                permission: 'auth.recovery_codes.issue',
                assurance: 'passkey',
            }),
        ]));
    });

    test('defines privacy export and erasure coverage by data domain', () => {
        const inventory = listPrivacyDataInventory();

        expect(inventory.map((entry) => entry.domain)).toEqual(expect.arrayContaining([
            'identity',
            'commerce',
            'support',
            'observability',
            'ai_assistant',
        ]));
        expect(inventory.filter((entry) => entry.exportable === true).length).toBeGreaterThanOrEqual(3);
        expect(inventory.every((entry) => entry.retention)).toBe(true);
    });

    test('keeps privileged access JIT policy explicit and disabled by default', () => {
        const policy = getPrivilegedAccessPolicy();

        expect(policy.jitAccessEnabled).toBe(false);
        expect(policy.approvalRequiredFor).toEqual(expect.arrayContaining([
            'admin.users.delete',
            'admin.ops.maintenance',
        ]));
        expect(policy.baselineAssurance).toEqual(expect.arrayContaining([
            'fresh_session',
            'second_factor',
        ]));
    });
});
