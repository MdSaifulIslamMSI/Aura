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
    otpStates: 'correct_otp',
    deviceStates: 'known_device',
    rateLimitStates: 'normal_request',
    routeTypes: 'authenticated_customer_route',
};

test('stolen sessions die with the password rotation', () => {
    for (const sessionStates of ['password_changed_session', 'reset_password_session']) {
        const result = evaluateAuthCase({ ...baseCase, sessionStates });
        assert.equal(result.allowed, false);
        assert.equal(result.status, 401);
    }
});

test('explicitly revoked sessions never resurrect', () => {
    const result = evaluateAuthCase({ ...baseCase, sessionStates: 'revoked_session' });
    assert.equal(result.allowed, false);
    assert.ok(result.reasons.includes('session_revoked_session'));
});

test('concurrent sessions inherit the base session verdict, not a fixation flaw', () => {
    const concurrent = evaluateAuthCase({ ...baseCase, sessionStates: 'concurrent_session' });
    const active = evaluateAuthCase({ ...baseCase, sessionStates: 'active_session' });
    assert.equal(concurrent.allowed, active.allowed);
});
