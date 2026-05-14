'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAuthCase } = require('../helpers/matrix-engine');

function resultFor(emailCases, passwordCases) {
    return evaluateAuthCase({
        userRoles: 'customer',
        accountStates: 'active',
        passwordCases,
        emailCases,
        tokenStates: 'valid_access_token',
        sessionStates: 'active_session',
        otpStates: 'correct_otp',
        deviceStates: 'known_device',
        rateLimitStates: 'normal_request',
        routeTypes: 'authenticated_customer_route',
    });
}

test('unknown email and wrong password share generic credential privacy shape', () => {
    assert.equal(resultFor('unknown_email', 'valid_password').expectedResponsePrivacy.genericCredentialError, true);
    assert.equal(resultFor('valid_email', 'wrong_password').expectedResponsePrivacy.genericCredentialError, true);
});
