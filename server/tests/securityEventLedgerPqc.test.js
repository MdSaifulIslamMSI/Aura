'use strict';

const { generateHybridSigningKey } = require('../security/pqc/keyMaterial');

const mockLedgerState = { seq: 0, lastHash: '', records: [] };

jest.mock('../models/SecurityEventLedger', () => ({
    findOneAndUpdate: jest.fn(async (query, update) => {
        const returningNew = Boolean(update && update.options && update.options.new);
        const previous = { _id: query._id, seq: mockLedgerState.seq, lastHash: mockLedgerState.lastHash };
        if (update && update.$inc) mockLedgerState.seq += update.$inc.seq;
        if (update && update.$set) Object.assign(mockLedgerState, update.$set);
        if (update && update.$set && update.$set.seq !== undefined) mockLedgerState.seq = update.$set.seq;
        return returningNew
            ? { _id: query._id, seq: mockLedgerState.seq, lastHash: mockLedgerState.lastHash }
            : previous;
    }),
    create: jest.fn(async (doc) => {
        mockLedgerState.records.push(doc);
        return doc;
    }),
    find: jest.fn(() => ({
        sort: () => ({
            limit: () => ({
                lean: async () => mockLedgerState.records.slice().sort((a, b) => a.seq - b.seq),
            }),
        }),
    })),
}));

const ENV_KEYS = [
    'SECURITY_EVENT_LEDGER_ENABLED',
    'SECURITY_EVENT_LEDGER_SECRET',
    'SECURITY_EVENT_LEDGER_PQC_MODE',
    'SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF',
    'SECURITY_EVENT_LEDGER_PQC_PREVIOUS_KEY_REFS',
    'SECURITY_EVENT_LEDGER_PQC_REQUIRED_FROM_SEQ',
];

const loadService = () => {
    jest.resetModules();
    // eslint-disable-next-line global-require
    return require('../services/securityEventLedgerService');
};

describe('securityEventLedgerService PQ signatures', () => {
    const originalEnv = {};
    ENV_KEYS.forEach((key) => { originalEnv[key] = process.env[key]; });

    beforeEach(() => {
        ENV_KEYS.forEach((key) => delete process.env[key]);
        process.env.SECURITY_EVENT_LEDGER_ENABLED = 'true';
        process.env.SECURITY_EVENT_LEDGER_SECRET = 'ledger-pqc-test-secret';
        mockLedgerState.seq = 0;
        mockLedgerState.lastHash = '';
        mockLedgerState.records.length = 0;
    });

    afterEach(() => {
        Object.entries(originalEnv).forEach(([key, value]) => {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        });
    });

    test('require mode signs every record with Ed25519+ML-DSA-65', async () => {
        const signingKey = generateHybridSigningKey();
        process.env.SECURITY_EVENT_LEDGER_PQC_MODE = 'require';
        process.env.SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF = JSON.stringify(signingKey);

        const service = loadService();
        const first = await service.appendSecurityEventToLedger({ event: 'a', requestId: 'r1' });
        const second = await service.appendSecurityEventToLedger({ event: 'b', requestId: 'r2' });

        expect(first.pqc).toMatchObject({ mode: 'require', signed: true, keyId: signingKey.keyId });
        expect(second.pqc.signed).toBe(true);
        expect(mockLedgerState.records[0].pqcSignature.startsWith('pqcsig1.')).toBe(true);
        expect(mockLedgerState.records[0].pqcKeyId).toBe(signingKey.keyId);
        expect(mockLedgerState.records[0].pqcAlgorithm).toBe('Ed25519+ML-DSA-65');

        const outcome = await service.verifySecurityEventLedger({});
        expect(outcome.verified).toBe(true);
        expect(outcome.pqc).toMatchObject({ mode: 'require', checked: 2, unsigned: 0 });
    });

    test('detects a tampered PQ signature even when the HMAC chain is intact', async () => {
        const signingKey = generateHybridSigningKey();
        process.env.SECURITY_EVENT_LEDGER_PQC_MODE = 'require';
        process.env.SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF = JSON.stringify(signingKey);

        const service = loadService();
        await service.appendSecurityEventToLedger({ event: 'a', requestId: 'r1' });
        await service.appendSecurityEventToLedger({ event: 'b', requestId: 'r2' });

        const record = mockLedgerState.records[0];
        record.pqcSignature = record.pqcSignature.slice(0, -4)
            + (record.pqcSignature.endsWith('AAAA') ? 'BBBB' : 'AAAA');

        const outcome = await service.verifySecurityEventLedger({});
        expect(outcome.verified).toBe(false);
        expect(outcome.reason).toBe('pqc_signature_mismatch');
        expect(outcome.brokenAt).toBe(1);
    });

    test('require mode blocks an unsigned append without consuming a sequence number', async () => {
        process.env.SECURITY_EVENT_LEDGER_PQC_MODE = 'require';

        const service = loadService();
        const outcome = await service.appendSecurityEventToLedger({ event: 'a', requestId: 'r1' });

        expect(outcome.appended).toBe(false);
        expect(outcome.error).toBe('pqc_signing_unavailable');
        expect(mockLedgerState.records).toHaveLength(0);
        expect(mockLedgerState.seq).toBe(0);

        // Once the key is available, the chain must start at seq 1 rather than
        // inheriting a hole from the blocked attempt.
        const signingKey = generateHybridSigningKey();
        process.env.SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF = JSON.stringify(signingKey);
        const appended = await service.appendSecurityEventToLedger({ event: 'b', requestId: 'r2' });
        expect(appended).toMatchObject({ appended: true, seq: 1 });

        const verified = await service.verifySecurityEventLedger({});
        expect(verified.verified).toBe(true);
    });

    test('verifies records signed under a previous key during rotation', async () => {
        const oldKey = generateHybridSigningKey();
        const newKey = generateHybridSigningKey();
        process.env.SECURITY_EVENT_LEDGER_PQC_MODE = 'require';
        process.env.SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF = JSON.stringify(oldKey);

        const before = loadService();
        await before.appendSecurityEventToLedger({ event: 'before', requestId: 'r1' });

        process.env.SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF = JSON.stringify(newKey);
        process.env.SECURITY_EVENT_LEDGER_PQC_PREVIOUS_KEY_REFS = JSON.stringify(oldKey);
        const after = loadService();
        await after.appendSecurityEventToLedger({ event: 'after', requestId: 'r2' });

        const outcome = await after.verifySecurityEventLedger({});
        expect(outcome.verified).toBe(true);
        expect(outcome.pqc.checked).toBe(2);
    });

    test('off mode keeps the legacy HMAC path and reports unsigned records', async () => {
        const service = loadService();
        await service.appendSecurityEventToLedger({ event: 'a', requestId: 'r1' });
        await service.appendSecurityEventToLedger({ event: 'b', requestId: 'r2' });

        expect(mockLedgerState.records[0].pqcSignature).toBeUndefined();
        const outcome = await service.verifySecurityEventLedger({});
        expect(outcome.verified).toBe(true);
        expect(outcome.pqc).toMatchObject({ mode: 'off', checked: 0, unsigned: 2 });
    });
});
