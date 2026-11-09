'use strict';

// Regression coverage for the 2026-11-09 production incident: overlapping
// ledger appends re-issued sequence numbers (E11000 duplicate key on seq_1)
// and dropped 13 security events. The chain is sequential by construction, so
// allocation, insert, and head update must be one atomic unit.

const SecurityEventLedger = require('../models/SecurityEventLedger');
const SecurityEventLedgerHead = require('../models/SecurityEventLedgerHead');
const {
    appendSecurityEventToLedger,
    verifySecurityEventLedger,
} = require('../services/securityEventLedgerService');

const CONCURRENT_APPENDS = 20;

describe('securityEventLedgerService concurrent appends', () => {
    const originalEnv = {
        SECURITY_EVENT_LEDGER_ENABLED: process.env.SECURITY_EVENT_LEDGER_ENABLED,
        SECURITY_EVENT_LEDGER_SECRET: process.env.SECURITY_EVENT_LEDGER_SECRET,
        SECURITY_EVENT_LEDGER_PQC_MODE: process.env.SECURITY_EVENT_LEDGER_PQC_MODE,
        SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF: process.env.SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF,
    };

    beforeEach(async () => {
        process.env.SECURITY_EVENT_LEDGER_ENABLED = 'true';
        process.env.SECURITY_EVENT_LEDGER_SECRET = 'ledger-concurrency-test-secret';
        process.env.SECURITY_EVENT_LEDGER_PQC_MODE = 'off';
        delete process.env.SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF;

        await SecurityEventLedger.deleteMany({});
        await SecurityEventLedgerHead.deleteMany({});
        // The unique seq index is the guard that turns a re-issued sequence
        // into a dropped event, so it must exist before the race runs.
        await SecurityEventLedger.init();
        await SecurityEventLedgerHead.init();
    });

    afterEach(() => {
        Object.entries(originalEnv).forEach(([key, value]) => {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        });
    });

    test('every concurrent append gets a unique, contiguous sequence number', async () => {
        const outcomes = await Promise.all(
            Array.from({ length: CONCURRENT_APPENDS }, (_, index) => (
                appendSecurityEventToLedger({
                    event: 'rate_limit.hit',
                    requestId: `req-concurrent-${index}`,
                })
            ))
        );

        const failed = outcomes.filter((outcome) => !outcome.appended);
        expect(failed).toEqual([]);

        const seqs = outcomes.map((outcome) => outcome.seq).sort((a, b) => a - b);
        expect(new Set(seqs).size).toBe(CONCURRENT_APPENDS);
        expect(seqs).toEqual(Array.from({ length: CONCURRENT_APPENDS }, (_, index) => index + 1));

        const verified = await verifySecurityEventLedger({});
        expect(verified.verified).toBe(true);
        expect(verified.checked).toBe(CONCURRENT_APPENDS);
    }, 30000);
});
