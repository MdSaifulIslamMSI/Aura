jest.mock('../models/AccountPreference');
jest.mock('../services/authSecurityTelemetryService');

const AccountPreference = require('../models/AccountPreference');
const { recordAuthSecurityEvent } = require('../services/authSecurityTelemetryService');
const {
    getAccountPreferences,
    updateAccountPreferences,
} = require('../controllers/accountPreferenceController');

const buildRequest = (body = {}) => ({
    authUid: 'preference-owner-uid',
    user: { _id: '507f1f77bcf86cd799439011' },
    body,
});

const buildResponse = () => ({
    set: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
});

describe('account preference controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns safe defaults without creating local-storage authority', async () => {
        AccountPreference.findOne.mockReturnValue({
            lean: jest.fn().mockResolvedValue(null),
        });
        const res = buildResponse();
        const next = jest.fn();

        await getAccountPreferences(buildRequest(), res, next);

        expect(res.json).toHaveBeenCalledWith({
            success: true,
            preferences: expect.objectContaining({
                schemaVersion: 1,
                version: 0,
                notifications: expect.objectContaining({
                    marketing: { email: false, sms: false, push: false },
                    security: {
                        email: true,
                        sms: true,
                        push: true,
                        mandatory: true,
                    },
                }),
            }),
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('blocks attempts to disable mandatory security notifications', async () => {
        const res = buildResponse();
        const next = jest.fn();

        await updateAccountPreferences(buildRequest({
            version: 0,
            notifications: {
                security: { email: false },
            },
        }), res, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 400,
            code: 'ACCOUNT_REQUIRED_NOTIFICATION',
        }));
        expect(AccountPreference.findOne).not.toHaveBeenCalled();
    });

    test('uses revision matching and records consent changes without preference values', async () => {
        AccountPreference.findOne.mockReturnValue({
            lean: jest.fn().mockResolvedValue({
                revision: 3,
                notifications: {
                    marketing: { email: false, sms: false, push: false },
                },
            }),
        });
        AccountPreference.findOneAndUpdate.mockResolvedValue({
            revision: 4,
            notifications: {
                marketing: { email: true, sms: false, push: false },
            },
        });
        const res = buildResponse();
        const next = jest.fn();

        await updateAccountPreferences(buildRequest({
            version: 3,
            notifications: {
                marketing: { email: true },
            },
        }), res, next);

        expect(AccountPreference.findOneAndUpdate).toHaveBeenCalledWith(
            { ownerKey: 'preference-owner-uid', revision: 3 },
            expect.objectContaining({
                $set: {
                    'notifications.marketing.email': true,
                },
                $inc: { revision: 1 },
                $push: {
                    consentAudit: {
                        $each: [expect.objectContaining({
                            preference: 'marketing',
                            channel: 'email',
                            enabled: true,
                            changedAt: expect.any(Date),
                        })],
                        $slice: -100,
                    },
                },
            }),
            { returnDocument: 'after' }
        );
        expect(recordAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
            event: 'account.preferences.updated',
            meta: {
                groups: ['notifications'],
                consentChanges: 1,
            },
        }));
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            preferences: expect.objectContaining({ version: 4 }),
        }));
        expect(next).not.toHaveBeenCalled();
    });

    test('returns a conflict instead of overwriting a newer preference revision', async () => {
        AccountPreference.findOne.mockReturnValue({
            lean: jest.fn().mockResolvedValue({ revision: 5 }),
        });
        const res = buildResponse();
        const next = jest.fn();

        await updateAccountPreferences(buildRequest({
            version: 4,
            accessibility: { reducedMotion: true },
        }), res, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 409,
            code: 'ACCOUNT_PREFERENCES_VERSION_CONFLICT',
        }));
        expect(AccountPreference.findOneAndUpdate).not.toHaveBeenCalled();
    });
});
