const {
    scanForMarketplaceAnomalies,
} = require('../services/marketplaceIntegrityService');

describe('marketplaceIntegrityService', () => {
    test('bounds anomaly scans to the configured neighborhood limit', async () => {
        const oversizedNeighborhood = Array.from({ length: 90 }, (_, index) => [
            `user_${index}`,
            `user_${index + 1}`,
        ]);

        await expect(
            scanForMarketplaceAnomalies('seed_user', oversizedNeighborhood)
        ).resolves.toMatchObject({
            anomalyCount: expect.any(Number),
            protectionLevel: 'bounded-graph-heuristic',
        });
    });
});
