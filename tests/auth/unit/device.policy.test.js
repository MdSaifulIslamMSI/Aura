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
    rateLimitStates: 'normal_request',
    routeTypes: 'authenticated_customer_route',
};

test('known devices pass without friction', () => {
    const result = evaluateAuthCase({ ...baseCase, deviceStates: 'known_device' });
    assert.equal(result.allowed, true);
    assert.equal(result.status, 200);
});

test('high-risk device signals force step-up re-authentication', () => {
    for (const deviceStates of ['suspicious_device', 'vpn_like_ip', 'impossible_travel_pattern']) {
        const result = evaluateAuthCase({ ...baseCase, deviceStates });
        assert.equal(result.allowed, false);
        assert.equal(result.status, 401);
        assert.equal(result.requiresReauth, true);
        assert.ok(result.reasons.some((reason) => reason.startsWith('device_')));
    }
});

test('new and roaming devices are observable but not blocking', () => {
    for (const deviceStates of ['new_device', 'changed_user_agent', 'changed_ip']) {
        const result = evaluateAuthCase({ ...baseCase, deviceStates });
        assert.equal(result.allowed, true);
    }
});
