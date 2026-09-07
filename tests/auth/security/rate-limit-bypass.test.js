'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAuthCase } = require('../helpers/matrix-engine');

const baseCase = {
    userRoles: 'customer',
    accountStates: 'active',
    passwordCases: 'valid_password',
    emailCases: 'valid_email',
    tokenStates: 'valid_access_token',
    sessionStates: 'active_session',
    otpStates: 'correct_otp',
    deviceStates: 'known_device',
    routeTypes: 'authenticated_customer_route',
};

test('every abusive rate-limit state is rejected with 429', () => {
    for (const rateLimitStates of [
        'repeated_wrong_password',
        'rapid_same_ip',
        'rapid_same_account',
        'distributed_ip_same_account',
        'otp_resend_spam',
        'password_reset_spam',
    ]) {
        const result = evaluateAuthCase({ ...baseCase, rateLimitStates });
        assert.equal(result.allowed, false);
        assert.equal(result.status, 429);
        assert.ok(result.reasons.some((reason) => reason.startsWith('rate_limit_')));
    }
});

test('normal traffic is never rate-limited', () => {
    const result = evaluateAuthCase({ ...baseCase, rateLimitStates: 'normal_request' });
    assert.equal(result.allowed, true);
    assert.equal(result.status, 200);
});

test('distributed attacks are attributed to the account, not just the IP', () => {
    const result = evaluateAuthCase({ ...baseCase, rateLimitStates: 'distributed_ip_same_account' });
    assert.ok(result.reasons.includes('rate_limit_distributed_ip_same_account'));
});
