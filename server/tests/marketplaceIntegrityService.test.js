const {
    getIntegrityIssue,
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

    test('blocks placeholder hosts without rejecting lookalike URL paths', () => {
        expect(getIntegrityIssue({
            title: 'Handmade desk lamp',
            description: 'A real seller listing.',
            images: ['https://picsum.photos/300'],
        })).toMatch(/placeholder image sources/i);

        expect(getIntegrityIssue({
            title: 'Handmade desk lamp',
            description: 'A real seller listing.',
            images: ['https://images.example.test/path/picsum.photos/300'],
        })).toBeNull();
    });
});
