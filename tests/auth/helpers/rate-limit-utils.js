'use strict';

function buildRateLimitAttemptKey({ ip = '127.0.0.1', account = 'customer@example.test', purpose = 'login' } = {}) {
    return `${purpose}:${account.toLowerCase()}:${ip}`;
}

module.exports = { buildRateLimitAttemptKey };
