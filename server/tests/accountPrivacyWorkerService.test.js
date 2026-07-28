const ORIGINAL_ENV = { ...process.env };

jest.mock('../models/AccountPrivacyJob', () => ({
    findOneAndUpdate: jest.fn(),
}));

jest.mock('../services/accountPrivacyService', () => ({
    requireEnabledPolicy: jest.fn(),
    serializePrivacyJob: jest.fn((job) => ({
        id: String(job._id),
        type: job.type,
        status: job.status,
        failureCode: job.failureCode || '',
    })),
}));

const AccountPrivacyJob = require('../models/AccountPrivacyJob');
const {
    claimNextPrivacyJob,
    processNextPrivacyJob,
} = require('../services/accountPrivacyWorkerService');

describe('account privacy worker service', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.clearAllMocks();
    });

    test('claims queued, elapsed-grace, or stale processing work with a lease', async () => {
        const now = new Date('2026-07-26T10:00:00Z');
        AccountPrivacyJob.findOneAndUpdate.mockResolvedValue(null);

        await claimNextPrivacyJob({ workerId: 'privacy-worker-1', now });

        expect(AccountPrivacyJob.findOneAndUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                type: { $in: ['export', 'deactivation', 'deletion'] },
                $or: expect.arrayContaining([
                    { status: 'queued' },
                    { status: 'awaiting_grace', graceEndsAt: { $lte: now } },
                ]),
            }),
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'processing',
                    workerId: 'privacy-worker-1',
                    lockedAt: now,
                }),
                $inc: { attempts: 1 },
            }),
            expect.any(Object)
        );
    });

    test('fails safely when no type handler is installed', async () => {
        AccountPrivacyJob.findOneAndUpdate
            .mockResolvedValueOnce({
                _id: '507f1f77bcf86cd799439299',
                type: 'export',
                status: 'processing',
                workerId: 'privacy-worker-1',
            })
            .mockResolvedValueOnce({
                _id: '507f1f77bcf86cd799439299',
                type: 'export',
                status: 'failed',
                failureCode: 'handler_unavailable',
            });

        const result = await processNextPrivacyJob({
            workerId: 'privacy-worker-1',
            handlers: {},
        });

        expect(result).toMatchObject({
            type: 'export',
            status: 'failed',
            failureCode: 'handler_unavailable',
        });
        expect(AccountPrivacyJob.findOneAndUpdate.mock.calls[1][0]).toMatchObject({
            _id: '507f1f77bcf86cd799439299',
            status: 'processing',
            workerId: 'privacy-worker-1',
        });
    });
});
