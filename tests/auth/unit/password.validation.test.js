'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAuthCase } = require('../helpers/matrix-engine');

function caseFor(passwordCases) {
    return {
        userRoles: 'customer',
        accountStates: 'active',
        passwordCases,
        emailCases: 'valid_email',
        tokenStates: 'valid_access_token',
        sessionStates: 'active_session',
        otpStates: 'correct_otp',
        deviceStates: 'known_device',
        rateLimitStates: 'normal_request',
        routeTypes: 'authenticated_customer_route',
    };
}

test('invalid password cases never authenticate protected routes', () => {
    for (const passwordCase of ['wrong_password', 'empty_password', 'short_password', 'sql_payload_password', 'xss_payload_password', 'leaked_common_password']) {
        const result = evaluateAuthCase(caseFor(passwordCase));
        assert.equal(result.allowed, false);
        assert.equal(result.expectedResponsePrivacy.genericCredentialError, true);
    }
});
