'use strict';

function buildAuthUser(overrides = {}) {
    return {
        email: 'customer@example.test',
        password: 'Correct-Horse-Battery-42!',
        role: 'customer',
        accountState: 'active',
        isVerified: true,
        isAdmin: false,
        isSeller: false,
        ...overrides,
    };
}

module.exports = { buildAuthUser };
