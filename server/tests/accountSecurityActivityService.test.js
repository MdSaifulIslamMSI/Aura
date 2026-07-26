jest.mock('../models/AuthSecurityEventOutbox');

const AuthSecurityEventOutbox = require('../models/AuthSecurityEventOutbox');
const {
    ACTIVITY_RETENTION_DAYS,
    listAccountSecurityActivity,
    __private: { encodeCursor },
} = require('../services/accountSecurityActivityService');

const ownerId = '507f1f77bcf86cd799439120';

describe('customer-safe account security activity', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('filters by authenticated owner and returns only allowlisted fields', async () => {
        const records = [{
            _id: '507f1f77bcf86cd799439121',
            createdAt: new Date('2026-07-26T11:00:00.000Z'),
            payload: {
                event: 'mfa.passkey.registered',
                outcome: 'success',
                occurredAt: '2026-07-26T11:00:00.000Z',
                userId: ownerId,
                requestId: 'must-not-leak',
                meta: { credentialId: 'must-not-leak' },
            },
        }];
        const lean = jest.fn().mockResolvedValue(records);
        const limit = jest.fn().mockReturnValue({ lean });
        const sort = jest.fn().mockReturnValue({ limit });
        const select = jest.fn().mockReturnValue({ sort });
        AuthSecurityEventOutbox.find.mockReturnValue({ select });

        const result = await listAccountSecurityActivity({ userId: ownerId, limit: 20 });

        expect(AuthSecurityEventOutbox.find).toHaveBeenCalledWith(expect.objectContaining({
            'payload.userId': ownerId,
            'payload.event': { $in: expect.arrayContaining(['mfa.passkey.registered']) },
        }));
        expect(select).toHaveBeenCalledWith('payload.event payload.outcome payload.occurredAt createdAt');
        expect(result).toEqual({
            version: 1,
            retentionDays: ACTIVITY_RETENTION_DAYS,
            activity: [{
                type: 'passkey_added',
                outcome: 'success',
                occurredAt: '2026-07-26T11:00:00.000Z',
            }],
            pagination: { limit: 20, hasMore: false, nextCursor: null },
        });
        expect(JSON.stringify(result)).not.toContain('credentialId');
        expect(JSON.stringify(result)).not.toContain('requestId');
        expect(JSON.stringify(result)).not.toContain(ownerId);
    });

    test('rejects tampered cursors before querying', async () => {
        const valid = encodeCursor({
            createdAt: '2026-07-26T11:00:00.000Z',
            id: '507f1f77bcf86cd799439121',
            userId: ownerId,
        });
        const tampered = `${valid.slice(0, -1)}${valid.endsWith('a') ? 'b' : 'a'}`;

        await expect(listAccountSecurityActivity({
            userId: ownerId,
            cursor: tampered,
        })).rejects.toMatchObject({ statusCode: 400 });
        expect(AuthSecurityEventOutbox.find).not.toHaveBeenCalled();
    });

    test('binds cursors to the authenticated owner', async () => {
        const cursor = encodeCursor({
            createdAt: '2026-07-26T11:00:00.000Z',
            id: '507f1f77bcf86cd799439121',
            userId: ownerId,
        });

        await expect(listAccountSecurityActivity({
            userId: '507f1f77bcf86cd799439199',
            cursor,
        })).rejects.toMatchObject({ statusCode: 400 });
        expect(AuthSecurityEventOutbox.find).not.toHaveBeenCalled();
    });
});
