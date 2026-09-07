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

const ABUSIVE_STATES = [
    'repeated_wrong_password',
    'rapid_same_ip',
    'rapid_same_account',
    'distributed_ip_same_account',
    'otp_resend_spam',
    'password_reset_spam',
];

test('property: rate-limit verdicts are monotone — abusive never passes, normal always does', () => {
    for (const rateLimitStates of [...ABUSIVE_STATES, 'normal_request']) {
        const result = evaluateAuthCase({ ...baseCase, rateLimitStates });
        assert.equal(result.allowed, rateLimitStates === 'normal_request', rateLimitStates);
    }
});

test('property: every abusive verdict blames rate limiting, nothing else', () => {
    for (const rateLimitStates of ABUSIVE_STATES) {
        const result = evaluateAuthCase({ ...baseCase, rateLimitStates });
        assert.deepEqual(result.reasons, [`rate_limit_${rateLimitStates}`]);
        assert.equal(result.status, 429);
    }
});
