const ORIGINAL_ENV = { ...process.env };

const leanResult = (value) => ({
    lean: jest.fn().mockResolvedValue(value),
});

jest.mock('../models/AccountPrivacyJob', () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    create: jest.fn(),
}));

const AccountPrivacyJob = require('../models/AccountPrivacyJob');
const {
    cancelPrivacyJob,
    createPrivacyJob,
    serializePrivacyJob,
} = require('../services/accountPrivacyService');

const enableCompletePolicy = () => {
    process.env.ACCOUNT_CENTER_V2_PRIVACY = 'true';
    process.env.ACCOUNT_PRIVACY_POLICY_APPROVED = 'true';
    process.env.ACCOUNT_PRIVACY_POLICY_VERSION = 'policy-2026-07';
    process.env.ACCOUNT_PRIVACY_JURISDICTIONS = 'IN';
    process.env.ACCOUNT_PRIVACY_EXPORT_RETENTION_DAYS = '7';
    process.env.ACCOUNT_PRIVACY_DELETION_GRACE_DAYS = '30';
    process.env.ACCOUNT_PRIVACY_REACTIVATION_POLICY = 'during-grace';
    process.env.ACCOUNT_PRIVACY_EXPORT_DELIVERY = 'authenticated-download';
    process.env.AWS_S3_PRIVACY_BUCKET = 'privacy-artifacts';
    process.env.ACCOUNT_PRIVACY_EXPORT_KMS_KEY_ID = 'alias/privacy-export';
};

describe('account privacy service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        enableCompletePolicy();
    });

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    test('creates an idempotent asynchronous deletion request with a grace boundary', async () => {
        AccountPrivacyJob.findOne.mockReturnValue(leanResult(null));
        AccountPrivacyJob.create.mockImplementation(async (payload) => ({
            _id: '507f1f77bcf86cd799439299',
            ...payload,
        }));

        const result = await createPrivacyJob({
            userId: '507f1f77bcf86cd799439211',
            type: 'deletion',
            idempotencyKey: 'delete-request-0001',
        });

        expect(result.replayed).toBe(false);
        expect(AccountPrivacyJob.create).toHaveBeenCalledWith(expect.objectContaining({
            user: '507f1f77bcf86cd799439211',
            type: 'deletion',
            status: 'awaiting_grace',
            idempotencyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            policyVersion: 'policy-2026-07',
            graceEndsAt: expect.any(Date),
        }));
        expect(result.job).not.toHaveProperty('idempotencyHash');
        expect(result.job.status).toBe('awaiting_grace');
    });

    test('returns the same safe request for an idempotent replay', async () => {
        AccountPrivacyJob.findOne.mockReturnValue(leanResult({
            _id: '507f1f77bcf86cd799439299',
            type: 'export',
            status: 'queued',
            policyVersion: 'policy-2026-07',
            idempotencyHash: 'must-not-leak',
        }));

        const result = await createPrivacyJob({
            userId: '507f1f77bcf86cd799439211',
            type: 'export',
            idempotencyKey: 'export-request-0001',
        });

        expect(result.replayed).toBe(true);
        expect(AccountPrivacyJob.create).not.toHaveBeenCalled();
        expect(result.job).not.toHaveProperty('idempotencyHash');
    });

    test('cancels only an owner request in a cancellable state', async () => {
        AccountPrivacyJob.findOneAndUpdate.mockResolvedValue({
            _id: '507f1f77bcf86cd799439299',
            type: 'deletion',
            status: 'cancelled',
            policyVersion: 'policy-2026-07',
        });

        const result = await cancelPrivacyJob({
            userId: '507f1f77bcf86cd799439211',
            requestId: '507f1f77bcf86cd799439299',
            type: 'deletion',
        });

        expect(AccountPrivacyJob.findOneAndUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: '507f1f77bcf86cd799439299',
                user: '507f1f77bcf86cd799439211',
                type: 'deletion',
                status: { $in: expect.any(Array) },
            }),
            expect.any(Object),
            expect.any(Object)
        );
        expect(result.status).toBe('cancelled');
    });

    test('safe serializer excludes worker, artifact, owner and idempotency internals', () => {
        expect(serializePrivacyJob({
            _id: '507f1f77bcf86cd799439299',
            user: 'must-not-leak',
            type: 'export',
            status: 'ready',
            workerId: 'must-not-leak',
            artifactKeyEncrypted: 'must-not-leak',
            idempotencyHash: 'must-not-leak',
        })).toEqual(expect.not.objectContaining({
            user: expect.anything(),
            workerId: expect.anything(),
            artifactKeyEncrypted: expect.anything(),
            idempotencyHash: expect.anything(),
        }));
    });
});
