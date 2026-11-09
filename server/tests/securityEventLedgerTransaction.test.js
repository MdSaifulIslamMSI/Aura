'use strict';

// Guards the transaction plumbing rather than MongoDB's isolation semantics:
// the atomicity fix in the concurrency suite only holds if every head and
// record write actually joins the session. A write that silently drops
// `{ session }` still passes on a standalone test Mongo (which uses the
// serialized fallback) but breaks the chain on the production replica set.

const mockSession = {
    withTransaction: jest.fn(async (fn) => fn()),
    endSession: jest.fn(async () => {}),
};
const mockHeadCalls = [];
const mockLedgerCalls = [];
const mockHeadState = { seq: 0, lastHash: '' };

jest.mock('mongoose', () => ({
    startSession: jest.fn(async () => mockSession),
}));

jest.mock('../models/SecurityEventLedgerHead', () => ({
    findOneAndUpdate: jest.fn(async (query, update, options = {}) => {
        mockHeadCalls.push({ query, update, options });
        const previous = {
            _id: query._id,
            seq: mockHeadState.seq,
            lastHash: mockHeadState.lastHash,
        };
        if (update.$inc?.seq) mockHeadState.seq += update.$inc.seq;
        if (update.$set) Object.assign(mockHeadState, update.$set);
        return previous;
    }),
}));

jest.mock('../models/SecurityEventLedger', () => ({
    create: jest.fn(async (docs, options = {}) => {
        mockLedgerCalls.push({ docs, options });
        return docs;
    }),
}));

const mongoose = require('mongoose');
const { appendSecurityEventToLedger } = require('../services/securityEventLedgerService');

describe('securityEventLedgerService transaction wiring', () => {
    const originalEnv = {
        SECURITY_EVENT_LEDGER_ENABLED: process.env.SECURITY_EVENT_LEDGER_ENABLED,
        SECURITY_EVENT_LEDGER_SECRET: process.env.SECURITY_EVENT_LEDGER_SECRET,
        SECURITY_EVENT_LEDGER_PQC_MODE: process.env.SECURITY_EVENT_LEDGER_PQC_MODE,
        SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF: process.env.SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF,
    };

    beforeEach(() => {
        process.env.SECURITY_EVENT_LEDGER_ENABLED = 'true';
        process.env.SECURITY_EVENT_LEDGER_SECRET = 'ledger-transaction-test-secret';
        process.env.SECURITY_EVENT_LEDGER_PQC_MODE = 'off';
        delete process.env.SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF;

        mockHeadState.seq = 0;
        mockHeadState.lastHash = '';
        mockHeadCalls.length = 0;
        mockLedgerCalls.length = 0;
        jest.clearAllMocks();
    });

    afterEach(() => {
        Object.entries(originalEnv).forEach(([key, value]) => {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        });
    });

    test('joins every head and record write to one transaction session', async () => {
        const outcome = await appendSecurityEventToLedger({ event: 'rate_limit.hit', requestId: 'r1' });

        expect(outcome).toMatchObject({ enabled: true, appended: true, seq: 1 });
        expect(mongoose.startSession).toHaveBeenCalledTimes(1);
        expect(mockSession.withTransaction).toHaveBeenCalledTimes(1);

        expect(mockHeadCalls).toHaveLength(2);
        mockHeadCalls.forEach((call) => {
            expect(call.options.session).toBe(mockSession);
        });
        expect(mockLedgerCalls).toHaveLength(1);
        expect(mockLedgerCalls[0].options.session).toBe(mockSession);

        // `$inc` already advanced the counter. Re-publishing `seq` is what
        // allowed a slower append to regress it and re-issue a used number.
        expect(mockHeadCalls[1].update.$set).toEqual({ lastHash: expect.any(String) });
        expect(mockHeadCalls[1].update.$set).not.toHaveProperty('seq');

        expect(mockSession.endSession).toHaveBeenCalledTimes(1);
    });

    test('ends the session when the transaction fails', async () => {
        mockSession.withTransaction.mockRejectedValueOnce(new Error('transaction aborted'));

        const outcome = await appendSecurityEventToLedger({ event: 'rate_limit.hit', requestId: 'r2' });

        expect(outcome).toMatchObject({ enabled: true, appended: false, error: 'transaction aborted' });
        expect(mockLedgerCalls).toHaveLength(0);
        expect(mockSession.endSession).toHaveBeenCalledTimes(1);
    });
});
