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
    getRegisteredAccountPrivacyJobTypes,
    getUnserviceableAccountPrivacyJobTypes,
    processNextPrivacyJob,
} = require('../services/accountPrivacyWorkerService');
const {
    clearAccountPrivacyHandlers,
    registerAccountPrivacyHandlers,
} = require('../services/accountPrivacyHandlerRegistry');

describe('account privacy worker service', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        clearAccountPrivacyHandlers();
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

    test('never leaves a job pending when its handler is unavailable', async () => {
        AccountPrivacyJob.findOneAndUpdate
            .mockResolvedValueOnce({
                _id: '507f1f77bcf86cd799439299',
                type: 'deletion',
                status: 'processing',
                workerId: 'privacy-worker-1',
            })
            .mockResolvedValueOnce({
                _id: '507f1f77bcf86cd799439299',
                type: 'deletion',
                status: 'failed',
                failureCode: 'handler_unavailable',
            });

        await processNextPrivacyJob({ workerId: 'privacy-worker-1' });

        const update = AccountPrivacyJob.findOneAndUpdate.mock.calls[1][1].$set;
        expect(update).toMatchObject({
            status: 'failed',
            failureCode: 'handler_unavailable',
            lockedAt: null,
            workerId: '',
        });
        expect(update.completedAt).toBeUndefined();
    });

    test('reports every job type as unserviceable until a handler is registered', () => {
        expect(getRegisteredAccountPrivacyJobTypes()).toEqual([]);
        expect(getUnserviceableAccountPrivacyJobTypes()).toEqual([
            'export',
            'deactivation',
            'deletion',
        ]);
    });

    test('services a claimed job with a handler registered in the registry', async () => {
        const handler = jest.fn(async () => ({ status: 'ready' }));
        registerAccountPrivacyHandlers({ export: handler });

        expect(getRegisteredAccountPrivacyJobTypes()).toEqual(['export']);
        expect(getUnserviceableAccountPrivacyJobTypes()).toEqual([
            'deactivation',
            'deletion',
        ]);

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
                status: 'ready',
                failureCode: '',
            });

        const result = await processNextPrivacyJob({ workerId: 'privacy-worker-1' });

        expect(handler).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ type: 'export', status: 'ready' });
        expect(AccountPrivacyJob.findOneAndUpdate.mock.calls[1][1].$set).toMatchObject({
            status: 'ready',
            failureCode: '',
        });
    });
});
