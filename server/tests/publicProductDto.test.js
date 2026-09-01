'use strict';

const {
    INTERNAL_FIELD_NAMES,
    PUBLIC_PRODUCT_SCALAR_FIELDS,
    hasInternalProductFields,
    pickPublicProductFields,
} = require('../serializers/publicProductSerializer');
const fs = require('fs');
const path = require('path');

// Fixture mirrors the real Product document shape, including the fields the
// Aug 3 external audit caught leaking through the public API.
const buildFixture = () => ({
    _id: '64f0a1b2c3d4e5f6a7b8c9d0',
    id: 41007,
    title: 'Wireless Noise-Cancelling Headphones',
    displayTitle: 'Wireless Noise-Cancelling Headphones (2026)',
    subtitle: 'Studio-grade ANC',
    brand: 'AuraAudio',
    category: 'electronics',
    categoryPaths: ['electronics/audio/headphones'],
    subCategory: 'headphones',
    tags: ['audio', 'wireless'],
    price: 8999,
    originalPrice: 12999,
    discountPercentage: 30,
    rating: 4.4,
    ratingCount: 1284,
    image: 'https://dbtrhsolhec1s.cloudfront.net/catalog/hp-1.jpg',
    images: ['https://dbtrhsolhec1s.cloudfront.net/catalog/hp-1.jpg'],
    description: 'Over-ear ANC headphones.',
    highlights: ['40h battery', 'Hybrid ANC'],
    specifications: [{ key: 'Driver', value: '40mm' }],
    stock: 42,
    deliveryTime: '2-4 days',
    warranty: '1 year manufacturer warranty',
    createdAt: new Date('2026-01-15T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    // ---- internal fields that must never reach a client ----
    source: 'batch',
    externalId: 'ext-kaggle-99131',
    catalogVersion: 'catalog-2026.08.1',
    isPublished: true,
    searchText: 'wireless noise cancelling headphones auraaudio',
    ingestHash: '9f8e7d6c5b4a',
    titleKey: 'wireless-noise-cancelling-headphones',
    imageKey: 'hp-1-hash',
    updatedFromSyncAt: new Date('2026-08-20T00:00:00Z'),
    provenance: {
        sourceName: 'kaggle-electronics-2026',
        sourceType: 'first_party',
        sourceRef: 'C:\\Users\\operator\\Documents\\catalog\\snapshots\\electronics.jsonl',
        manifestHash: 'sha256:aaaabbbbccccdddd',
        ingestedAt: new Date('2026-08-20T00:00:00Z'),
        trustTier: 'verified',
    },
    contentQuality: {
        completenessScore: 88,
        syntheticScore: 12,
        syntheticRejected: false,
    },
    publishGate: {
        status: 'approved',
        reason: 'quality gate passed',
        checkedAt: new Date('2026-08-21T00:00:00Z'),
    },
    adCampaign: {
        isSponsored: true,
        status: 'active',
        priority: 70,
        cpcBid: 12,
        budgetTotal: 50000,
        creativeTagline: 'Sponsored by AuraAudio',
    },
});

// Mongoose-document shim: the serializer must call toObject().
const asMongooseDoc = (plain) => ({
    ...plain,
    toObject() {
        const { toObject, ...rest } = this;
        return rest;
    },
});

describe('publicProductSerializer', () => {
    it('exposes every public scalar field the storefront renders', () => {
        const dto = pickPublicProductFields(buildFixture());
        for (const field of PUBLIC_PRODUCT_SCALAR_FIELDS) {
            expect(dto[field]).toBeDefined();
        }
    });

    it('never emits internal fields (provenance internals, ad economics, ingestion metadata)', () => {
        const dto = pickPublicProductFields(asMongooseDoc(buildFixture()));
        const serialized = JSON.stringify(dto);
        for (const field of INTERNAL_FIELD_NAMES) {
            if (field === 'provenance' || field === 'publishGate' || field === 'adCampaign') continue;
            expect(dto[field]).toBeUndefined();
        }
        expect(serialized).not.toContain('sourceRef');
        expect(serialized).not.toContain('manifestHash');
        expect(serialized).not.toContain('ingestHash');
        expect(serialized).not.toContain('catalogVersion');
        expect(serialized).not.toContain('cpcBid');
        expect(serialized).not.toContain('budgetTotal');
        expect(serialized).not.toContain('syntheticScore');
        expect(serialized).not.toContain('searchText');
        expect(hasInternalProductFields(dto)).toBe(false);
    });

    it('keeps only the minimal public projections of internal subdocuments', () => {
        const dto = pickPublicProductFields(buildFixture());
        expect(dto.provenance).toEqual({ sourceType: 'first_party' });
        expect(dto.publishGate).toEqual({ status: 'approved' });
        expect(dto.adCampaign).toEqual({
            isSponsored: true,
            creativeTagline: 'Sponsored by AuraAudio',
        });
        expect(dto.adCampaign.cpcBid).toBeUndefined();
    });

    it('works on lean objects without toObject', () => {
        const dto = pickPublicProductFields(buildFixture());
        expect(dto.id).toBe(41007);
        expect(dto.brand).toBe('AuraAudio');
    });

    it('returns null for empty input', () => {
        expect(pickPublicProductFields(null)).toBeNull();
        expect(pickPublicProductFields(undefined)).toBeNull();
    });

    it('preserves demo-detection inputs the frontend consumes', () => {
        const fixture = buildFixture();
        fixture.publishGate.status = 'dev_only';
        fixture.provenance.sourceType = 'dev_seed';
        const dto = pickPublicProductFields(fixture);
        expect(dto.publishGate.status).toBe('dev_only');
        expect(dto.provenance.sourceType).toBe('dev_seed');
    });
});

describe('phase 6 wiring contracts', () => {
    const serverRoot = path.join(__dirname, '..');

    it('routes the public product controller through the strict serializer', () => {
        const source = fs.readFileSync(path.join(serverRoot, 'controllers', 'productController.js'), 'utf8');
        expect(source).toContain('pickPublicProductFields(plain)');
        expect(source).not.toMatch(/\.\.\.plain,/);
    });

    it('applies the strict DTO to recommendation products', () => {
        const source = fs.readFileSync(path.join(serverRoot, 'services', 'productRecommendationService.js'), 'utf8');
        expect(source).toContain('pickPublicProductFields');
    });

    it('excludes internal indexing fields from detail reads', () => {
        const source = fs.readFileSync(path.join(serverRoot, 'services', 'catalogService.js'), 'utf8');
        expect(source).toContain('PRODUCT_DETAIL_INTERNAL_EXCLUSION');
        expect(source).toMatch(/includeDetails \? PRODUCT_DETAIL_INTERNAL_EXCLUSION : PRODUCT_LIST_PROJECTION/);
    });
});
