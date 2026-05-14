'use strict';

function buildTokenState(overrides = {}) {
    return {
        accessTokenState: 'valid_access_token',
        refreshTokenState: 'valid_refresh_token',
        claims: {
            sub: 'user_test_123',
            role: 'customer',
        },
        ...overrides,
    };
}

module.exports = { buildTokenState };
