const {
    getAccountSessionsSchema,
    revokeAccountSessionSchema,
    revokeOtherAccountSessionsSchema,
} = require('../validators/accountSessionValidators');

describe('account session validators', () => {
    test('bounds and coerces the session list limit', () => {
        expect(getAccountSessionsSchema.parse({
            query: { limit: '20' },
        }).query.limit).toBe(20);

        expect(getAccountSessionsSchema.safeParse({
            query: { limit: '21' },
        }).success).toBe(false);
    });

    test('accepts only an opaque alias and an empty mutation body', () => {
        expect(revokeAccountSessionSchema.safeParse({
            params: { sessionAlias: 'a'.repeat(43) },
            body: {},
        }).success).toBe(true);

        expect(revokeAccountSessionSchema.safeParse({
            params: { sessionAlias: 'raw-session-id' },
            body: {},
        }).success).toBe(false);

        expect(revokeAccountSessionSchema.safeParse({
            params: { sessionAlias: 'a'.repeat(43) },
            body: { userId: 'another-user' },
        }).success).toBe(false);
    });

    test('rejects client-supplied authority on revoke-others', () => {
        expect(revokeOtherAccountSessionsSchema.safeParse({
            body: { preserveSessionId: 'client-chosen-session' },
        }).success).toBe(false);
    });
});
