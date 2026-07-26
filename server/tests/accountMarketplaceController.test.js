jest.mock('../services/accountMarketplaceService', () => ({
    buildAccountMarketplaceHub: jest.fn(),
}));

const { buildAccountMarketplaceHub } = require('../services/accountMarketplaceService');
const { getAccountMarketplace } = require('../controllers/accountMarketplaceController');

const flushController = async (controller, req, res, next) => {
    controller(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));
};

const buildResponse = () => ({
    set: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
});

describe('account marketplace controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns only the authenticated owner marketplace hub with private caching', async () => {
        const hub = {
            contractVersion: 1,
            savedItems: { count: 1, items: [{ productId: 42 }] },
            reviews: { count: 0, items: [] },
        };
        buildAccountMarketplaceHub.mockResolvedValue(hub);
        const req = { user: { _id: '507f1f77bcf86cd799439211' } };
        const res = buildResponse();
        const next = jest.fn();

        await flushController(getAccountMarketplace, req, res, next);

        expect(buildAccountMarketplaceHub).toHaveBeenCalledWith('507f1f77bcf86cd799439211');
        expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
        expect(res.set).toHaveBeenCalledWith('Vary', 'Authorization, Cookie');
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(hub);
        expect(next).not.toHaveBeenCalled();
    });

    test('fails closed without an authenticated owner', async () => {
        const res = buildResponse();
        const next = jest.fn();

        await flushController(getAccountMarketplace, { user: null }, res, next);

        expect(buildAccountMarketplaceHub).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });
});
