'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAuthCase } = require('../helpers/matrix-engine');

test('unknown, malformed, SQL, and XSS email cases use generic rejection', () => {
    for (const emailCase of ['unknown_email', 'malformed_email', 'sql_payload_email', 'xss_payload_email']) {
        const result = evaluateAuthCase({
            userRoles: 'customer',
            accountStates: 'active',
            passwordCases: 'valid_password',
            emailCases: emailCase,
            tokenStates: 'valid_access_token',
            sessionStates: 'active_session',
            otpStates: 'correct_otp',
            deviceStates: 'known_device',
            rateLimitStates: 'normal_request',
            routeTypes: 'authenticated_customer_route',
        });
        assert.equal(result.allowed, false);
        assert.equal(result.expectedResponsePrivacy.genericCredentialError, true);
    }
});
