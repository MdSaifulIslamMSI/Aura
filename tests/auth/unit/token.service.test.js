'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAuthCase } = require('../helpers/matrix-engine');

test('refresh tokens and tampered access tokens are not accepted as protected-route access', () => {
    for (const tokenState of ['valid_refresh_token', 'reused_refresh_token', 'tampered_access_token', 'token_with_wrong_role']) {
        const result = evaluateAuthCase({
            userRoles: 'admin',
            accountStates: 'active',
            passwordCases: 'valid_password',
            emailCases: 'valid_email',
            tokenStates: tokenState,
            sessionStates: 'active_session',
            otpStates: 'correct_otp',
            deviceStates: 'known_device',
            rateLimitStates: 'normal_request',
            routeTypes: 'admin_route',
        });
        assert.equal(result.allowed, false);
        assert.equal(result.status, 401);
    }
});
