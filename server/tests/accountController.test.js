jest.mock('../services/accountOverviewService', () => ({
    buildAccountOverview: jest.fn(),
}));

const { buildAccountOverview } = require('../services/accountOverviewService');
const { getAccountOverview } = require('../controllers/accountController');

const flushController = async (controller, req, res, next) => {
    controller(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));
};

const buildResponse = () => ({
    set: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
});

describe('account controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns a private no-store overview for the authenticated principal', async () => {
        const overview = {
            contractVersion: 1,
            identity: { name: 'Account owner' },
            meta: { partial: false, unavailable: [] },
        };
        buildAccountOverview.mockResolvedValue(overview);
        const req = { user: { _id: '507f1f77bcf86cd799439211' } };
        const res = buildResponse();
        const next = jest.fn();

        await flushController(getAccountOverview, req, res, next);

        expect(buildAccountOverview).toHaveBeenCalledWith('507f1f77bcf86cd799439211');
        expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
        expect(res.set).toHaveBeenCalledWith('Vary', 'Authorization, Cookie');
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(overview);
        expect(next).not.toHaveBeenCalled();
    });

    test('does not attempt an overview without an authenticated principal', async () => {
        const res = buildResponse();
        const next = jest.fn();

        await flushController(getAccountOverview, { user: null }, res, next);

        expect(buildAccountOverview).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 401,
        }));
    });
});
