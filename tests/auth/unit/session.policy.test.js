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

test('active sessions are accepted on customer routes', () => {
    const result = evaluateAuthCase({ ...baseCase, sessionStates: 'active_session' });
    assert.equal(result.allowed, true);
    assert.equal(result.status, 200);
});

test('dead sessions are rejected with session reasons', () => {
    for (const sessionStates of ['expired_session', 'logged_out_session', 'revoked_session']) {
        const result = evaluateAuthCase({ ...baseCase, sessionStates });
        assert.equal(result.allowed, false);
        assert.equal(result.status, 401);
        assert.ok(result.reasons.some((reason) => reason.startsWith('session_')));
    }
});

test('password-rotation sessions force re-login even with valid tokens', () => {
    for (const sessionStates of ['password_changed_session', 'reset_password_session']) {
        const result = evaluateAuthCase({ ...baseCase, sessionStates });
        assert.equal(result.allowed, false);
        assert.equal(result.status, 401);
    }
});

test('public routes skip session checks by contract', () => {
    const result = evaluateAuthCase({ ...baseCase, sessionStates: 'expired_session', routeTypes: 'public_route' });
    assert.equal(result.allowed, true);
});
