const { analyzeCatalogRecord } = require('../services/catalogSourceIntegrityService');

describe('catalogSourceIntegrityService', () => {
    test('flags placeholder image hosts without rejecting lookalike URL paths', () => {
        expect(analyzeCatalogRecord({
            image: 'https://picsum.photos/300',
        }).flags.syntheticImage).toBe(true);

        expect(analyzeCatalogRecord({
            image: 'https://images.example.test/path/picsum.photos/300',
        }).flags.syntheticImage).toBe(false);
    });
});
