'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertSafeAuthTestBaseUrl } = require('../helpers/auth-test-client');

test('auth integration client defaults to local-safe base URL', () => {
    assert.equal(assertSafeAuthTestBaseUrl(), 'http://localhost:5000');
});

test('auth integration client refuses production by default', () => {
    assert.throws(() => assertSafeAuthTestBaseUrl('https://aurapilot.vercel.app'), /Refusing to run auth tests/);
});
