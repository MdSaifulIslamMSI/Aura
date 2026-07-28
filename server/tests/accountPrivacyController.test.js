jest.mock('../services/accountPrivacyService', () => ({
    cancelPrivacyJob: jest.fn(),
    createPrivacyJob: jest.fn(),
    getPrivacyJob: jest.fn(),
    getPublicPrivacyCapabilities: jest.fn(),
}));

jest.mock('../services/authSecurityTelemetryService', () => ({
    recordAuthSecurityEvent: jest.fn(),
}));

const {
    cancelPrivacyJob,
    createPrivacyJob,
    getPublicPrivacyCapabilities,
} = require('../services/accountPrivacyService');
const {
    cancelDeletionRequest,
    getPrivacyCapabilities,
    requestAccountDeletion,
} = require('../controllers/accountPrivacyController');

const flushController = async (controller, req, res, next) => {
    controller(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));
};

const buildResponse = () => ({
    set: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
});

describe('account privacy controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('publishes a safe disabled capability contract', async () => {
        getPublicPrivacyCapabilities.mockReturnValue({
            contractVersion: 1,
            enabled: false,
            blockedReason: 'authoritative_policy_or_runtime_contract_incomplete',
        });
        const res = buildResponse();

        await flushController(getPrivacyCapabilities, {}, res, jest.fn());

        expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    });

    test('binds a deletion job to the authenticated owner and idempotency header', async () => {
        createPrivacyJob.mockResolvedValue({
            replayed: false,
            job: {
                id: '507f1f77bcf86cd799439299',
                type: 'deletion',
                status: 'awaiting_grace',
            },
        });
        const req = {
            user: { _id: '507f1f77bcf86cd799439211' },
            get: jest.fn((name) => name === 'Idempotency-Key' ? 'delete-request-0001' : ''),
        };
        const res = buildResponse();

        await flushController(requestAccountDeletion, req, res, jest.fn());

        expect(createPrivacyJob).toHaveBeenCalledWith({
            userId: '507f1f77bcf86cd799439211',
            type: 'deletion',
            idempotencyKey: 'delete-request-0001',
        });
        expect(res.status).toHaveBeenCalledWith(202);
    });

    test('cancels only an owner deletion request through the service boundary', async () => {
        cancelPrivacyJob.mockResolvedValue({
            id: '507f1f77bcf86cd799439299',
            type: 'deletion',
            status: 'cancelled',
        });
        const req = {
            user: { _id: '507f1f77bcf86cd799439211' },
            params: { requestId: '507f1f77bcf86cd799439299' },
        };
        const res = buildResponse();

        await flushController(cancelDeletionRequest, req, res, jest.fn());

        expect(cancelPrivacyJob).toHaveBeenCalledWith({
            userId: '507f1f77bcf86cd799439211',
            requestId: '507f1f77bcf86cd799439299',
            type: 'deletion',
        });
        expect(res.status).toHaveBeenCalledWith(200);
    });
});
