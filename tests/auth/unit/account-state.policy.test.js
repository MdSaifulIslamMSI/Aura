'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAuthCase } = require('../helpers/matrix-engine');

test('blocked account states reject otherwise valid protected requests', () => {
    for (const accountState of ['unverified_email', 'disabled', 'locked', 'deleted', 'password_reset_required', 'mfa_required']) {
        const result = evaluateAuthCase({
            userRoles: 'customer',
            accountStates: accountState,
            passwordCases: 'valid_password',
            emailCases: 'valid_email',
            tokenStates: 'valid_access_token',
            sessionStates: 'active_session',
            otpStates: 'correct_otp',
            deviceStates: 'known_device',
            rateLimitStates: 'normal_request',
            routeTypes: 'authenticated_customer_route',
        });
        assert.equal(result.allowed, false);
    }
});
