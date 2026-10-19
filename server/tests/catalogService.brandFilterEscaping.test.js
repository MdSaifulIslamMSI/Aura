const buildFindOneQuery = (value) => {
    const query = {
        sort: jest.fn(() => query),
        select: jest.fn(() => query),
        lean: jest.fn().mockResolvedValue(value),
    };
    return query;
};

const buildFindQuery = (value) => {
    const query = {
        select: jest.fn(() => query),
        sort: jest.fn(() => query),
        skip: jest.fn(() => query),
        limit: jest.fn(() => query),
        lean: jest.fn(() => query),
        maxTimeMS: jest.fn().mockResolvedValue(value),
    };
    return query;
};

const buildCountQuery = (value) => ({
    maxTimeMS: jest.fn().mockResolvedValue(value),
});

const loadCatalogService = () => {
    jest.resetModules();

    jest.doMock('../config/catalogFlags', () => ({
        flags: {
            nodeEnv: 'test',
            isProduction: false,
            isTest: true,
            catalogImportsEnabled: true,
            catalogSyncEnabled: true,
            catalogActiveVersionRequired: true,
            catalogPublicDemoFallback: true,
            catalogSearchIndexName: 'products_search_v1',
            catalogSearchCheckOnBoot: false,
            catalogSyncIntervalMs: 15 * 60 * 1000,
            catalogImportWorkerPollMs: 5000,
            catalogDefaultSyncProvider: 'file',
            catalogProviderSourceRef: '',
        },
        parseBoolean: jest.fn(),
    }));

    jest.doMock('../models/Product', () => ({
        syncProductIndexes: jest.fn().mockResolvedValue(undefined),
        findOne: jest.fn(),
        find: jest.fn(),
        countDocuments: jest.fn(),
        aggregate: jest.fn(),
        deleteOne: jest.fn(),
        normalizeTitleKey: jest.fn((value) => value),
        normalizeImageKey: jest.fn((value) => value),
    }));

    jest.doMock('../models/SystemState', () => ({
        findOne: jest.fn(),
        findOneAndUpdate: jest.fn(),
    }));

    jest.doMock('../models/CatalogImportJob', () => ({ countDocuments: jest.fn() }));
    jest.doMock('../models/CatalogSyncCursor', () => ({ findOne: jest.fn() }));
    jest.doMock('../models/CatalogSyncRun', () => ({ countDocuments: jest.fn() }));
    jest.doMock('../utils/logger', () => ({
        warn: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
    }));
    jest.doMock('../services/catalogSnapshotService', () => ({
        prepareCatalogSnapshotForImport: jest.fn(),
    }));

    const catalogService = require('../services/catalogService');
    const Product = require('../models/Product');
    const SystemState = require('../models/SystemState');

    return {
        catalogService,
        Product,
        SystemState,
    };
};

const captureBrandFilter = async (brand) => {
    const { catalogService, Product, SystemState } = loadCatalogService();
    let capturedFilter = null;

    SystemState.findOne.mockResolvedValue({ activeCatalogVersion: 'live-v2' });
    Product.findOne.mockImplementationOnce(() => buildFindOneQuery(null));
    Product.find.mockImplementation((filter) => {
        capturedFilter = filter;
        return buildFindQuery([]);
    });
    Product.countDocuments.mockReturnValue(buildCountQuery(0));

    await catalogService.queryProducts({ includeSponsored: 'false', brand });

    const patterns = capturedFilter?.brand?.$in;
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns).toHaveLength(1);
    return patterns[0];
};

describe('catalogService brand filter regex escaping', () => {
    test('treats a wildcard brand as a literal brand name instead of matching every product', async () => {
        const pattern = await captureBrandFilter('.*');

        expect(pattern.test('.*')).toBe(true);
        expect(pattern.test('Dell')).toBe(false);
        expect(pattern.test('Apple')).toBe(false);
        expect(pattern.test('')).toBe(false);
    });

    test('treats an alternation brand as a literal brand name', async () => {
        const pattern = await captureBrandFilter('Apple|Samsung');

        expect(pattern.test('Apple|Samsung')).toBe(true);
        expect(pattern.test('Apple')).toBe(false);
        expect(pattern.test('Samsung')).toBe(false);
    });

    test('does not throw on an invalid regular expression fragment supplied as a brand', async () => {
        await expect(captureBrandFilter('(?i)')).resolves.toBeDefined();
    });

    test('matches an invalid regular expression fragment literally', async () => {
        const pattern = await captureBrandFilter('(?i)');

        expect(pattern.test('(?i)')).toBe(true);
        expect(pattern.test('anything')).toBe(false);
    });

    test('keeps escaping regex metacharacters in an otherwise normal brand', async () => {
        const pattern = await captureBrandFilter('A.C');

        expect(pattern.test('A.C')).toBe(true);
        expect(pattern.test('ABC')).toBe(false);
    });

    test('keeps every brand in a comma separated list escaped', async () => {
        const { catalogService, Product, SystemState } = loadCatalogService();
        let capturedFilter = null;

        SystemState.findOne.mockResolvedValue({ activeCatalogVersion: 'live-v2' });
        Product.findOne.mockImplementationOnce(() => buildFindOneQuery(null));
        Product.find.mockImplementation((filter) => {
            capturedFilter = filter;
            return buildFindQuery([]);
        });
        Product.countDocuments.mockReturnValue(buildCountQuery(0));

        await catalogService.queryProducts({ includeSponsored: 'false', brand: '.* , Apple|Samsung' });

        const patterns = capturedFilter.brand.$in;
        expect(patterns).toHaveLength(2);
        expect(patterns[0].test('.*')).toBe(true);
        expect(patterns[0].test('Dell')).toBe(false);
        expect(patterns[1].test('Apple|Samsung')).toBe(true);
        expect(patterns[1].test('Apple')).toBe(false);
    });
});
