'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ROUTE_POLICY } = require('../helpers/matrix-engine');

test('route policy keeps super admin exclusive to super admin route', () => {
    assert.deepEqual(ROUTE_POLICY.super_admin_route, ['super_admin']);
});

test('seller routes allow seller and privileged admin roles', () => {
    assert.deepEqual(ROUTE_POLICY.seller_route, ['seller', 'admin', 'super_admin']);
});
