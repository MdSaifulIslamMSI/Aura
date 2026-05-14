'use strict';

function requireIsolatedTestEnvironment() {
    if (process.env.NODE_ENV !== 'test') {
        throw new Error('Auth test database helpers require NODE_ENV=test.');
    }
}

module.exports = { requireIsolatedTestEnvironment };
