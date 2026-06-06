const {
    buildRouteExposureInventory,
} = require('../security/invisibleFabric/routeDiscovery');

describe('route exposure registry', () => {
    test('classifies every discovered backend route', () => {
        const inventory = buildRouteExposureInventory();
        const missing = inventory.filter((route) => !route.exposure);

        expect(inventory.length).toBeGreaterThan(50);
        expect(missing).toEqual([]);
    });

    test('admin and internal routes are not publicly discoverable', () => {
        const inventory = buildRouteExposureInventory();
        const exposed = inventory.filter((route) => (
            ['admin', 'internal'].includes(route.exposure?.classification)
            && route.exposure?.publiclyDiscoverable
        ));

        expect(exposed).toEqual([]);
    });

    test('provider webhook routes require signature verification markers', () => {
        const inventory = buildRouteExposureInventory();
        const webhooks = inventory.filter((route) => route.exposure?.classification === 'webhook');

        expect(webhooks.length).toBeGreaterThanOrEqual(3);
        expect(webhooks.every((route) => route.exposure.signatureVerificationRequired)).toBe(true);
    });
});
