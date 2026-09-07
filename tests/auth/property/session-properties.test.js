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

const DENIED_SESSIONS = new Set([
    'expired_session', 'logged_out_session', 'revoked_session',
    'password_changed_session', 'reset_password_session',
]);

test('property: denied sessions always carry a session_* reason', () => {
    for (const sessionStates of [
        'active_session', 'expired_session', 'logged_out_session', 'revoked_session',
        'concurrent_session', 'suspicious_session', 'password_changed_session', 'reset_password_session',
    ]) {
        const result = evaluateAuthCase({ ...baseCase, sessionStates });
        assert.equal(result.allowed, !DENIED_SESSIONS.has(sessionStates), sessionStates);
        if (!result.allowed) {
            assert.ok(result.reasons.some((reason) => reason.startsWith('session_')), sessionStates);
        }
    }
});

test('property: allowed sessions never carry reasons', () => {
    for (const sessionStates of ['active_session', 'concurrent_session', 'suspicious_session']) {
        const result = evaluateAuthCase({ ...baseCase, sessionStates });
        assert.equal(result.allowed, true);
        assert.deepEqual(result.reasons, []);
    }
});
