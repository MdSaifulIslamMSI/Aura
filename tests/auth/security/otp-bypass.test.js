'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAuthCase } = require('../helpers/matrix-engine');

test('OTP bypass states reject MFA-required account access', () => {
    for (const otpState of ['wrong_otp', 'expired_otp', 'reused_otp', 'missing_otp', 'otp_for_different_user']) {
        const result = evaluateAuthCase({
            userRoles: 'customer',
            accountStates: 'mfa_required',
            passwordCases: 'valid_password',
            emailCases: 'valid_email',
            tokenStates: 'valid_access_token',
            sessionStates: 'active_session',
            otpStates: otpState,
            deviceStates: 'known_device',
            rateLimitStates: 'normal_request',
            routeTypes: 'authenticated_customer_route',
        });
        assert.equal(result.allowed, false);
    }
});
