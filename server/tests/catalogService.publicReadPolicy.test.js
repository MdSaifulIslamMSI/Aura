const buildFindOneQuery = (value) => {
    const query = {
        sort: jest.fn(() => query),
        select: jest.fn(() => query),
        lean: jest.fn().mockResolvedValue(value),
    };
    return query;
};

const buildLeanOnlyQuery = (value) => ({
    lean: jest.fn().mockResolvedValue(value),
});

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

describe('catalogService public read policy', () => {
    test('queryProducts stays on published active inventory by default even when demo fallback is configured', async () => {
        const { catalogService, Product, SystemState } = loadCatalogService();
        let capturedFilter = null;

        SystemState.findOne.mockResolvedValue({ activeCatalogVersion: 'live-v2' });
        Product.findOne.mockImplementationOnce(() => buildFindOneQuery(null));
        Product.find.mockImplementation((filter) => {
            capturedFilter = filter;
            return buildFindQuery([]);
        });
        Product.countDocuments.mockReturnValue(buildCountQuery(0));

        const result = await catalogService.queryProducts({ includeSponsored: 'false' });

        expect(Product.findOne).toHaveBeenCalledTimes(1);
        expect(capturedFilter).toMatchObject({
            catalogVersion: 'live-v2',
            isPublished: true,
        });
        expect(result.catalogReadMode).toBe('published_only');
    });

    test('queryProducts only enters demo preview mode when explicitly opted in', async () => {
        const { catalogService, Product, SystemState } = loadCatalogService();
        let capturedFilter = null;

        SystemState.findOne.mockResolvedValue({ activeCatalogVersion: 'live-v2' });
        Product.findOne
            .mockImplementationOnce(() => buildFindOneQuery(null))
            .mockImplementationOnce(() => buildFindOneQuery({ catalogVersion: 'demo-v1' }));
        Product.find.mockImplementation((filter) => {
            capturedFilter = filter;
            return buildFindQuery([]);
        });
        Product.countDocuments.mockReturnValue(buildCountQuery(0));

        const result = await catalogService.queryProducts(
            { includeSponsored: 'false' },
            { allowDemoFallback: true }
        );

        expect(capturedFilter).toMatchObject({
            catalogVersion: 'demo-v1',
            'publishGate.status': 'dev_only',
        });
        expect(result.catalogReadMode).toBe('demo_preview');
    });

    test('getProductByIdentifier does not leak products outside the active public catalog unless explicitly allowed', async () => {
        const { catalogService, Product, SystemState } = loadCatalogService();

        SystemState.findOne.mockResolvedValue({ activeCatalogVersion: 'live-v2' });
        Product.findOne
            .mockImplementationOnce(() => buildFindOneQuery({ _id: 'published-anchor' }))
            .mockImplementationOnce(() => buildLeanOnlyQuery(null))
            .mockImplementationOnce(() => buildLeanOnlyQuery(null))
            .mockImplementationOnce(() => buildLeanOnlyQuery({
                _id: 'dev-product',
                id: 123,
                title: 'Hidden Demo Product',
            }));

        const strictResult = await catalogService.getProductByIdentifier('123');
        const privilegedResult = await catalogService.getProductByIdentifier('123', {
            allowOutsideActiveCatalog: true,
        });

        expect(strictResult).toBeNull();
        expect(privilegedResult).toMatchObject({
            _id: 'dev-product',
            id: 123,
        });
        expect(Product.findOne).toHaveBeenCalledTimes(4);
    });
});
