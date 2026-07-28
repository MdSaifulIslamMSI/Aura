jest.mock('../config/firebase', () => ({
    auth: jest.fn(),
}));
jest.mock('../config/db', () => jest.fn());
jest.mock('../models/User');

const { toSafeResult } = require('../scripts/bootstrap_staging_smoke_accounts');

describe('staging smoke account bootstrap output', () => {
    test('reports readiness without exposing account identifiers', () => {
        const result = toSafeResult({
            label: 'customer',
            backendUser: {
                _id: '507f1f77bcf86cd799439299',
                email: 'private@example.test',
                isAdmin: false,
                isSeller: false,
            },
        });

        expect(result).toEqual({
            label: 'customer',
            ready: true,
            isAdmin: false,
            isSeller: false,
        });
        expect(JSON.stringify(result)).not.toContain('private@example.test');
        expect(JSON.stringify(result)).not.toContain('507f1f77bcf86cd799439299');
    });
});
