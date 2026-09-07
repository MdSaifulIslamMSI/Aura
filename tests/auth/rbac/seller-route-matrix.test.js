'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAuthCase } = require('../helpers/matrix-engine');

const sellerBase = {
    accountStates: 'active',
    passwordCases: 'valid_password',
    emailCases: 'valid_email',
    tokenStates: 'valid_access_token',
    sessionStates: 'active_session',
    otpStates: 'correct_otp',
    deviceStates: 'known_device',
    rateLimitStates: 'normal_request',
    routeTypes: 'seller_route',
};

test('sellers and their admins reach seller routes', () => {
    for (const userRoles of ['seller', 'admin', 'super_admin']) {
        const result = evaluateAuthCase({ ...sellerBase, userRoles });
        assert.equal(result.allowed, true);
        assert.equal(result.status, 200);
    }
});

test('customers, support and couriers are fenced out with 403', () => {
    for (const userRoles of ['customer', 'support_staff', 'delivery_partner']) {
        const result = evaluateAuthCase({ ...sellerBase, userRoles });
        assert.equal(result.allowed, false);
        assert.equal(result.status, 403);
        assert.ok(result.reasons.some((reason) => reason.startsWith('forbidden_')));
    }
});

test('forbidden responses never reveal the underlying policy', () => {
    const result = evaluateAuthCase({ ...sellerBase, userRoles: 'customer' });
    assert.equal(result.expectedResponsePrivacy.forbiddenDoesNotRevealPolicy, true);
});
