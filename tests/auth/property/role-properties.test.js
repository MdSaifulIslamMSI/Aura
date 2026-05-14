'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAuthCase } = require('../helpers/matrix-engine');

test('missing or invalid role behavior is represented by forbidden route policy', () => {
    const result = evaluateAuthCase({
        userRoles: 'delivery_partner',
        accountStates: 'active',
        passwordCases: 'valid_password',
        emailCases: 'valid_email',
        tokenStates: 'valid_access_token',
        sessionStates: 'active_session',
        otpStates: 'correct_otp',
        deviceStates: 'known_device',
        rateLimitStates: 'normal_request',
        routeTypes: 'support_route',
    });
    assert.equal(result.allowed, false);
    assert.equal(result.status, 403);
});
