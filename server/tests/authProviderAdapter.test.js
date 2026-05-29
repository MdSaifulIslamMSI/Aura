jest.mock('../config/firebase', () => ({
    auth: () => ({
        verifyIdToken: jest.fn(async () => ({
            uid: 'firebase-user-1',
            email: 'legacy@example.test',
            exp: 1_700_000_600,
        })),
    }),
}));

const {
    createAuthAdapter,
    createLegacyAuthContext,
    mapExternalIdentityToInternalUser,
} = require('../services/auth/authProviderAdapter');

describe('authProviderAdapter', () => {
    test('keeps legacy Firebase as the rollback-safe default', async () => {
        const adapter = createAuthAdapter({ env: {} });
        const context = await adapter.verifyAccessToken('legacy-token');

        expect(adapter.provider).toBe('legacy');
        expect(context).toMatchObject({
            provider: 'legacy',
            authUid: 'firebase-user-1',
        });
    });

    test('uses the configured OIDC verifier for keycloak without leaking provider details', async () => {
        const oidcVerifier = jest.fn(async () => ({
            provider: 'keycloak',
            subject: 'external-subject',
            authUid: 'keycloak:external-subject',
            identity: {
                email: 'oidc@example.test',
                name: 'OIDC User',
                emailVerified: true,
            },
            authToken: {
                uid: 'keycloak:external-subject',
                email: 'oidc@example.test',
            },
        }));

        const adapter = createAuthAdapter({
            env: {
                AUTH_PROVIDER: 'keycloak',
                AUTH_ISSUER_URL: 'https://idp.company.test/realms/aura',
                AUTH_CLIENT_ID: 'aura-web',
                AUTH_CLIENT_TYPE: 'public',
                AUTH_AUDIENCE: 'aura-web',
                AUTH_REDIRECT_URI: 'https://app.company.test/auth/callback',
                AUTH_POST_LOGOUT_REDIRECT_URI: 'https://app.company.test/login',
            },
            oidcVerifier,
        });

        const context = await adapter.verifyAccessToken('oidc-token');

        expect(adapter.provider).toBe('keycloak');
        expect(oidcVerifier).toHaveBeenCalledWith(expect.objectContaining({ token: 'oidc-token' }));
        expect(context.authUid).toBe('keycloak:external-subject');
    });

    test('exposes the required internal adapter methods', () => {
        const adapter = createAuthAdapter({ env: {} });

        expect(adapter).toEqual(expect.objectContaining({
            getCurrentUser: expect.any(Function),
            requireUser: expect.any(Function),
            requireRole: expect.any(Function),
            requirePermission: expect.any(Function),
            verifyAccessToken: expect.any(Function),
            refreshSession: expect.any(Function),
            logout: expect.any(Function),
            getUserClaims: expect.any(Function),
            mapExternalIdentityToInternalUser: expect.any(Function),
        }));
    });

    test('maps external subject to authUid instead of linking by email only', () => {
        const context = createLegacyAuthContext({
            uid: 'firebase-user-1',
            email: 'legacy@example.test',
            email_verified: true,
        });

        expect(mapExternalIdentityToInternalUser(context)).toEqual(expect.objectContaining({
            authUid: 'firebase-user-1',
            email: 'legacy@example.test',
            provider: 'legacy',
        }));
    });
});
