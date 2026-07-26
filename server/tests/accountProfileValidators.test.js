const { updateProfileSchema } = require('../validators/userValidators');

describe('account profile validators', () => {
    test('accepts date-only input, bounded bio, and an optimistic concurrency version', () => {
        const parsed = updateProfileSchema.parse({
            body: {
                name: 'Profile User',
                dob: '1990-01-02',
                bio: 'Short account biography',
                version: 4,
            },
        });

        expect(parsed.body).toEqual({
            name: 'Profile User',
            dob: '1990-01-02',
            bio: 'Short account biography',
            version: 4,
        });
    });

    test('rejects unknown authority fields and overlong biographies', () => {
        expect(() => updateProfileSchema.parse({
            body: {
                role: 'admin',
                bio: 'a'.repeat(201),
            },
        })).toThrow();
    });

    test('rejects future dates of birth', () => {
        expect(() => updateProfileSchema.parse({
            body: {
                dob: '2999-01-01',
            },
        })).toThrow();
    });
});
