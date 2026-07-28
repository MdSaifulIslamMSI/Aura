const {
    privacyRequestIdSchema,
    requestDeactivationSchema,
    requestDeletionSchema,
    requestExportSchema,
} = require('../validators/accountPrivacyValidators');

describe('account privacy validators', () => {
    test('accepts only exact destructive confirmations', () => {
        expect(requestDeactivationSchema.safeParse({
            body: { confirmation: 'DEACTIVATE' },
        }).success).toBe(true);
        expect(requestDeletionSchema.safeParse({
            body: { confirmation: 'DELETE MY ACCOUNT' },
        }).success).toBe(true);
        expect(requestDeletionSchema.safeParse({
            body: { confirmation: 'delete my account' },
        }).success).toBe(false);
        expect(requestExportSchema.safeParse({
            body: { scope: 'account' },
        }).success).toBe(true);
    });

    test('rejects arbitrary request identifiers and authority fields', () => {
        expect(privacyRequestIdSchema.safeParse({
            params: { requestId: 'not-an-object-id' },
        }).success).toBe(false);
        expect(requestDeletionSchema.safeParse({
            body: {
                confirmation: 'DELETE MY ACCOUNT',
                userId: 'other-user',
            },
        }).success).toBe(false);
    });
});
