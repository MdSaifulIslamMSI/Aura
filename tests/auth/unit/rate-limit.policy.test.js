'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAuthCase } = require('../helpers/matrix-engine');

test('abuse and spam rate-limit states produce rate-limited protected outcomes', () => {
    for (const rateLimitState of ['repeated_wrong_password', 'rapid_same_ip', 'rapid_same_account', 'distributed_ip_same_account', 'otp_resend_spam', 'password_reset_spam']) {
        const result = evaluateAuthCase({
            userRoles: 'customer',
            accountStates: 'active',
            passwordCases: 'valid_password',
            emailCases: 'valid_email',
            tokenStates: 'valid_access_token',
            sessionStates: 'active_session',
            otpStates: 'correct_otp',
            deviceStates: 'known_device',
            rateLimitStates: rateLimitState,
            routeTypes: 'authenticated_customer_route',
        });
        assert.equal(result.allowed, false);
        assert.equal(result.status, 429);
    }
});
