'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAuthCase } = require('../helpers/matrix-engine');

test('valid refresh token is never a valid access token for protected routes', () => {
    const result = evaluateAuthCase({
        userRoles: 'customer',
        accountStates: 'active',
        passwordCases: 'valid_password',
        emailCases: 'valid_email',
        tokenStates: 'valid_refresh_token',
        sessionStates: 'active_session',
        otpStates: 'correct_otp',
        deviceStates: 'known_device',
        rateLimitStates: 'normal_request',
        routeTypes: 'authenticated_customer_route',
    });
    assert.equal(result.allowed, false);
    assert.equal(result.status, 401);
});
