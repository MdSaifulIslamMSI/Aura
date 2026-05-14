'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAuthCase } = require('../helpers/matrix-engine');

test('JWT tampering states reject admin route access', () => {
    for (const tokenState of ['tampered_access_token', 'token_signed_with_wrong_secret', 'token_without_required_claims']) {
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
    }
});
