'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAuthCase } = require('../helpers/matrix-engine');

test('customer cannot access admin, seller, support, delivery, or super-admin routes', () => {
    for (const routeTypes of ['seller_route', 'admin_route', 'super_admin_route', 'support_route', 'delivery_route']) {
        const result = evaluateAuthCase({
            userRoles: 'customer',
            accountStates: 'active',
            passwordCases: 'valid_password',
            emailCases: 'valid_email',
            tokenStates: 'valid_access_token',
            sessionStates: 'active_session',
            otpStates: 'correct_otp',
            deviceStates: 'known_device',
            rateLimitStates: 'normal_request',
            routeTypes,
        });
        assert.equal(result.allowed, false);
        assert.equal(result.status, 403);
    }
});
