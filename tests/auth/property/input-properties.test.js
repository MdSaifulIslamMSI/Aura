'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const payloads = require('../fixtures/attack-payloads.fixture.json');

test('attack payload fixture includes SQL, NoSQL, XSS, and JWT examples', () => {
    assert.ok(payloads.payloads.sql.length >= 2);
    assert.ok(payloads.payloads.nosql.length >= 2);
    assert.ok(payloads.payloads.xss.length >= 2);
    assert.ok(payloads.payloads.jwt.length >= 2);
});
