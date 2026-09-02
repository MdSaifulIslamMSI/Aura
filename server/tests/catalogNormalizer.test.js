const {
    buildSearchText,
    normalizeAdCampaign,
    normalizeSpecifications,
    detectCatalogSourceType,
    normalizeCategory,
    PLACEHOLDER_IMAGE_PATTERNS,
} = require('../services/catalog/normalizer');

describe('catalog normalizer: buildSearchText', () => {
    test('joins the searchable fields and skips empty ones', () => {
        const text = buildSearchText({
            title: 'Aura Phone',
            brand: 'Aura',
            category: 'Mobiles',
            description: '',
            highlights: ['5G', 'AMOLED'],
            specifications: [{ key: 'RAM', value: '8GB' }],
        });
        expect(text).toBe('Aura Phone | Aura | Mobiles | 5G AMOLED | RAM 8GB');
    });

    test('tolerates missing collections', () => {
        expect(buildSearchText({ title: 'X' })).toBe('X');
        expect(buildSearchText({})).toBe('');
    });
});

describe('catalog normalizer: normalizeSpecifications', () => {
    test('accepts object maps and converts them to key/value pairs', () => {
        expect(normalizeSpecifications({ RAM: '8GB', Color: 'Black' })).toEqual([
            { key: 'RAM', value: '8GB' },
            { key: 'Color', value: 'Black' },
        ]);
    });

    test('drops empty entries and deduplicates case-insensitively', () => {
        const specs = normalizeSpecifications([
            { key: 'RAM', value: '8GB' },
            { name: 'ram', value: '8GB' },
            { key: '', value: 'orphan' },
            { key: 'Color', value: '' },
            { key: 'RAM', value: '12GB' },
        ]);
        expect(specs).toEqual([
            { key: 'RAM', value: '8GB' },
            { key: 'RAM', value: '12GB' },
        ]);
    });

    test('caps the output at 30 specs', () => {
        const specs = normalizeSpecifications(
            Array.from({ length: 40 }, (_, i) => ({ key: 'k' + i, value: 'v' + i }))
        );
        expect(specs).toHaveLength(30);
    });

    test('returns an empty list for non-array non-object input', () => {
        expect(normalizeSpecifications('junk')).toEqual([]);
        expect(normalizeSpecifications()).toEqual([]);
    });
});

describe('catalog normalizer: detectCatalogSourceType', () => {
    test('maps manual to first_party and provider to provider', () => {
        expect(detectCatalogSourceType({ source: 'manual' })).toBe('first_party');
        expect(detectCatalogSourceType({ source: 'provider', sourceRef: 'https://vendor/api' })).toBe('provider');
    });

    test('flags dev-seed references regardless of declared source', () => {
        expect(detectCatalogSourceType({ source: 'batch', sourceRef: 's3://data/catalog_1m.jsonl' })).toBe('dev_seed');
        expect(detectCatalogSourceType({ source: 'batch', sourceRef: 'demo_catalog_2026.json' })).toBe('dev_seed');
        expect(detectCatalogSourceType({ source: 'batch', sourceRef: 'synthetic_catalog.tar' })).toBe('dev_seed');
    });

    test('defaults to batch and reports unknown for unrecognized sources', () => {
        expect(detectCatalogSourceType({})).toBe('batch');
        expect(detectCatalogSourceType({ source: 'partner_feed', sourceRef: 'x.csv' })).toBe('unknown');
    });
});

describe('catalog normalizer: normalizeAdCampaign', () => {
    test('returns a safe inactive default for non-object input', () => {
        const campaign = normalizeAdCampaign('nope');
        expect(campaign).toMatchObject({ isSponsored: false, status: 'inactive', placement: 'all' });
    });

    test('clamps priority, cpc bid, and budgets into valid ranges', () => {
        const campaign = normalizeAdCampaign({
            isSponsored: true,
            priority: 500,
            cpcBid: -5,
            budgetTotal: 999999999,
            budgetSpent: -10,
        });
        expect(campaign.priority).toBe(100);
        expect(campaign.cpcBid).toBe(0);
        expect(campaign.budgetTotal).toBe(100000000);
        expect(campaign.budgetSpent).toBe(0);
    });

    test('rejects invalid or inverted date windows', () => {
        const invalid = normalizeAdCampaign({ startsAt: 'not-a-date', endsAt: '2026-01-01' });
        expect(invalid.isSponsored).toBe(false);

        const inverted = normalizeAdCampaign({ startsAt: '2026-02-01', endsAt: '2026-01-01' });
        expect(inverted.isSponsored).toBe(false);
    });

    test(' whitelists the campaign status', () => {
        expect(normalizeAdCampaign({ status: 'active' }).status).toBe('active');
        expect(normalizeAdCampaign({ status: 'bogus' }).status).toBe('inactive');
    });
});

describe('catalog normalizer: normalizeCategory and placeholders', () => {
    test('passes through unknown categories and normalizes empty to empty', () => {
        expect(normalizeCategory('')).toBe('');
        expect(typeof normalizeCategory('Misc')).toBe('string');
        expect(normalizeCategory('Misc').length).toBeGreaterThan(0);
    });

    test('classifies known placeholder image hosts', () => {
        expect(PLACEHOLDER_IMAGE_PATTERNS.some((p) => p.test('https://via.placeholder.com/600x600'))).toBe(true);
        expect(PLACEHOLDER_IMAGE_PATTERNS.some((p) => p.test('https://picsum.photos/200'))).toBe(true);
        expect(PLACEHOLDER_IMAGE_PATTERNS.some((p) => p.test('https://placehold.co/600x600'))).toBe(true);
        expect(PLACEHOLDER_IMAGE_PATTERNS.some((p) => p.test('https://dummyimage.com/600x400'))).toBe(true);
        expect(PLACEHOLDER_IMAGE_PATTERNS.some((p) => p.test('https://cdn.aura.dev/img/phone.jpg'))).toBe(false);
    });
});