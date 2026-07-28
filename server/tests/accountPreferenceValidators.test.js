const {
    updateAccountPreferencesSchema,
} = require('../validators/accountPreferenceValidators');

describe('account preference validators', () => {
    test('accepts supported versioned preferences', () => {
        expect(updateAccountPreferencesSchema.safeParse({
            body: {
                version: 2,
                notifications: {
                    orderUpdates: { email: true, push: false },
                    marketing: { email: false },
                },
                localization: {
                    language: 'hi',
                    locale: 'hi-IN',
                    currency: 'INR',
                },
                accessibility: {
                    reducedMotion: true,
                },
            },
        }).success).toBe(true);
    });

    test('rejects unknown preference groups, topics, and channels', () => {
        expect(updateAccountPreferencesSchema.safeParse({
            body: {
                version: 0,
                role: 'admin',
            },
        }).success).toBe(false);
        expect(updateAccountPreferencesSchema.safeParse({
            body: {
                version: 0,
                notifications: {
                    unknownTopic: { email: true },
                },
            },
        }).success).toBe(false);
        expect(updateAccountPreferencesSchema.safeParse({
            body: {
                version: 0,
                notifications: {
                    marketing: { whatsapp: true },
                },
            },
        }).success).toBe(false);
    });
});
