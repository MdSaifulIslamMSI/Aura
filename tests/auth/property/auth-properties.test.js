'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAuthCase, generateAuthCases } = require('../helpers/matrix-engine');

test('generated unsafe protected cases are rejected, forbidden, rate-limited, or reauth-gated', () => {
    const batch = generateAuthCases({ mode: 'security', seed: 'AUTH-PROPERTY-SAFE-REJECT', limit: 1000, expansionLevel: 'level_2_risk' });
    for (const authCase of batch.cases) {
        const result = evaluateAuthCase(authCase);
        if (result.reasons.length > 0 && authCase.routeTypes !== 'public_route') {
            assert.equal(result.allowed, false);
            assert.ok([401, 403, 429].includes(result.status));
        }
    }
});
