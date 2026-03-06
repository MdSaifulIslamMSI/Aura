const User = require('../models/User');

const makeUser = (overrides = {}) => User.create({
    name: 'User Under Test',
    email: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    isVerified: true,
    ...overrides,
});

describe('User Phone Index Integrity', () => {
    test('allows multiple users with no phone number or blank phone values', async () => {
        await expect(makeUser()).resolves.toBeTruthy();
        await expect(makeUser({ phone: '' })).resolves.toBeTruthy();
        await expect(makeUser({ phone: '   ' })).resolves.toBeTruthy();
        await expect(makeUser({ phone: null })).resolves.toBeTruthy();
    });

    test('rejects duplicate non-empty phone numbers', async () => {
        await makeUser({ phone: '+919876543210' });
        await expect(makeUser({ phone: '+919876543210' })).rejects.toThrow(/duplicate key/i);
    });
});
