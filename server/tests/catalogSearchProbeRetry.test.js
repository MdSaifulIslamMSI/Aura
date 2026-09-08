jest.mock('../models/Product', () => ({
    aggregate: jest.fn(),
}));

const loadService = () => {
    jest.resetModules();
    // eslint-disable-next-line global-require
    return require('../services/catalogService');
};

describe('catalog Atlas search probe recovery', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env.CATALOG_SEARCH_PROBE_RETRY_MS = '10';
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    test('failed probe is cached briefly, then retried and can recover', async () => {
        const service = loadService();
        const { aggregate } = require('../models/Product');
        aggregate.mockRejectedValueOnce(new Error('index not found'));
        aggregate.mockResolvedValueOnce([]);

        await expect(service.assertSearchAvailable()).resolves.toBe(false);
        await expect(service.assertSearchAvailable()).resolves.toBe(false);
        expect(aggregate).toHaveBeenCalledTimes(1);

        await new Promise((resolve) => setTimeout(resolve, 25));

        await expect(service.assertSearchAvailable()).resolves.toBe(true);
        expect(aggregate).toHaveBeenCalledTimes(2);
    });

    test('successful probe stays latched for the process lifetime', async () => {
        const service = loadService();
        const { aggregate } = require('../models/Product');
        aggregate.mockResolvedValue([]);

        await expect(service.assertSearchAvailable()).resolves.toBe(true);
        await expect(service.assertSearchAvailable()).resolves.toBe(true);
        expect(aggregate).toHaveBeenCalledTimes(1);
    });
});
