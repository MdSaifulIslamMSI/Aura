'use strict';

const SecurityEventLedgerHead = require('../models/SecurityEventLedgerHead');

describe('SecurityEventLedgerHead', () => {
    it('uses a string _id so the counter document id can be stored', () => {
        // Regression: the counter was upserted through the event model, whose
        // ObjectId _id rejected 'security_event_ledger_head' at runtime.
        expect(SecurityEventLedgerHead.schema.path('_id').instance).toBe('String');
    });
});
