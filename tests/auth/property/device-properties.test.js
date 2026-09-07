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
    sessionStates: 'active_session',
    otpStates: 'correct_otp',
    rateLimitStates: 'normal_request',
    routeTypes: 'authenticated_customer_route',
};

const STEP_UP_DEVICES = new Set(['suspicious_device', 'vpn_like_ip', 'impossible_travel_pattern']);

test('property: risky devices deny with step-up, others pass clean', () => {
    for (const deviceStates of [
        'known_device', 'new_device', 'suspicious_device', 'changed_user_agent',
        'changed_ip', 'vpn_like_ip', 'impossible_travel_pattern',
    ]) {
        const result = evaluateAuthCase({ ...baseCase, deviceStates });
        assert.equal(result.allowed, !STEP_UP_DEVICES.has(deviceStates), deviceStates);
        assert.equal(result.requiresReauth, STEP_UP_DEVICES.has(deviceStates), deviceStates);
    }
});

test('property: step-up denials always explain the device signal', () => {
    for (const deviceStates of STEP_UP_DEVICES) {
        const result = evaluateAuthCase({ ...baseCase, deviceStates });
        assert.ok(result.reasons.includes(`device_${deviceStates}`));
        assert.equal(result.status, 401);
    }
});
