const {
    assertInvisibleFabricConfig,
    getInvisibleFabricConfig,
} = require('../security/invisibleFabric/config');

describe('Invisible Fabric config', () => {
    test('keeps local development safe and low-friction by default', () => {
        const config = getInvisibleFabricConfig({
            NODE_ENV: 'development',
        });

        expect(config).toMatchObject({
            enabled: false,
            production: false,
            requireTrustedEdge: false,
            cloakAdmin: false,
            honeypotsEnabled: false,
            responseMinimization: false,
        });
    });

    test('defaults production to enabled defensive controls without blindly requiring edge headers', () => {
        const config = getInvisibleFabricConfig({
            NODE_ENV: 'production',
        });

        expect(config).toMatchObject({
            enabled: true,
            production: true,
            requireTrustedEdge: false,
            cloakAdmin: true,
            cloakInternalRoutes: true,
            honeypotsEnabled: true,
            responseMinimization: true,
            publicRouteManifestRequired: true,
        });
    });

    test('fails closed when strict trusted edge mode is enabled without a secret', () => {
        expect(() => assertInvisibleFabricConfig({
            NODE_ENV: 'production',
            INVISIBLE_FABRIC_ENABLED: 'true',
            INVISIBLE_REQUIRE_TRUSTED_EDGE: 'true',
        })).toThrow('INVISIBLE_TRUSTED_EDGE_SECRET is required');
    });

    test('accepts production strict trusted edge mode with a configured secret', () => {
        expect(() => assertInvisibleFabricConfig({
            NODE_ENV: 'production',
            INVISIBLE_FABRIC_ENABLED: 'true',
            INVISIBLE_REQUIRE_TRUSTED_EDGE: 'true',
            INVISIBLE_TRUSTED_EDGE_HEADER: 'x-aura-edge-secret',
            INVISIBLE_TRUSTED_EDGE_SECRET: 'test-edge-secret-32-characters',
        })).not.toThrow();
    });
});
