'use strict';

jest.mock('../config/redis', () => {
    const store = new Map();
    const client = {
        sendCommand: async (args) => {
            const [cmd, key, ...rest] = args;
            if (cmd === 'SADD') {
                const set = store.get(key) || new Set();
                set.add(rest[0]);
                store.set(key, set);
                return set.size;
            }
            if (cmd === 'SCARD') return (store.get(key) || new Set()).size;
            if (cmd === 'INCR') {
                const next = Number(store.get(key) || 0) + 1;
                store.set(key, next);
                return next;
            }
            if (cmd === 'GET') return store.get(key) || 0;
            if (cmd === 'PEXPIRE' || cmd === 'SET' || cmd === 'DEL') return 1;
            throw new Error(`unsupported command ${cmd}`);
        },
    };
    return { getRedisClient: () => client, flags: { redisPrefix: 'aura_test' } };
});

const fs = require('fs');
const path = require('path');

const {
    appendSecurityEventToLedger,
    canonicalize,
    computeRecordIntegrity,
    isSecurityEventLedgerEnabled,
    verifySecurityEventLedger,
} = require('../services/securityEventLedgerService');

const ledgerState = { seq: 0, lastHash: '', records: [] };

jest.mock('../models/SecurityEventLedger', () => ({
    findOneAndUpdate: jest.fn(async (query, update) => {
        const returningNew = Boolean(update && update.options && update.options.new);
        const previous = { _id: query._id, seq: ledgerState.seq, lastHash: ledgerState.lastHash };
        if (update && update.$inc) ledgerState.seq += update.$inc.seq;
        if (update && update.$set) Object.assign(ledgerState, update.$set);
        if (update && update.$set && update.$set.seq !== undefined) ledgerState.seq = update.$set.seq;
        return returningNew
            ? { _id: query._id, seq: ledgerState.seq, lastHash: ledgerState.lastHash }
            : previous;
    }),
    create: jest.fn(async (doc) => {
        ledgerState.records.push(doc);
        return doc;
    }),
    find: jest.fn(() => ({
        sort: () => ({
            limit: () => ({
                lean: async () => ledgerState.records.slice().sort((a, b) => a.seq - b.seq),
            }),
        }),
    })),
}));

const {
    buildDeviceFingerprintAttestation,
    verifyDeviceFingerprintAttestation,
} = require('../services/deviceFingerprintAttestationService');

const {
    evaluateBehaviorSignals,
    recordAuthObservation,
} = require('../services/authBehaviorBaselineService');

describe('securityEventLedgerService', () => {
    const originalEnv = {
        SECURITY_EVENT_LEDGER_ENABLED: process.env.SECURITY_EVENT_LEDGER_ENABLED,
        SECURITY_EVENT_LEDGER_SECRET: process.env.SECURITY_EVENT_LEDGER_SECRET,
    };

    beforeEach(() => {
        process.env.SECURITY_EVENT_LEDGER_ENABLED = 'true';
        process.env.SECURITY_EVENT_LEDGER_SECRET = 'ledger-test-secret';
        ledgerState.seq = 0;
        ledgerState.lastHash = '';
        ledgerState.records.length = 0;
    });

    afterEach(() => {
        Object.entries(originalEnv).forEach(([key, value]) => {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        });
    });

    it('reports disabled when the flag is off', async () => {
        process.env.SECURITY_EVENT_LEDGER_ENABLED = 'false';
        const outcome = await appendSecurityEventToLedger({ event: 'x' });
        expect(outcome.enabled).toBe(false);
        expect(isSecurityEventLedgerEnabled()).toBe(false);
    });

    it('appends chained, signed records and verifies them', async () => {
        await appendSecurityEventToLedger({ event: 'a', requestId: 'r1' });
        await appendSecurityEventToLedger({ event: 'b', requestId: 'r2' });
        await appendSecurityEventToLedger({ event: 'c', requestId: 'r3' });

        expect(ledgerState.records).toHaveLength(3);
        expect(ledgerState.records[0].prevHash).toBe('genesis');
        expect(ledgerState.records[1].prevHash).toBe(ledgerState.records[0].hash);

        const outcome = await verifySecurityEventLedger({});
        expect(outcome.verified).toBe(true);
        expect(outcome.checked).toBe(3);
    });

    it('detects payload tampering', async () => {
        await appendSecurityEventToLedger({ event: 'a', requestId: 'r1' });
        await appendSecurityEventToLedger({ event: 'b', requestId: 'r2' });

        ledgerState.records[1].payload.event = 'tampered';

        const outcome = await verifySecurityEventLedger({});
        expect(outcome.verified).toBe(false);
        expect(outcome.reason).toBe('integrity_mismatch');
        expect(outcome.brokenAt).toBe(2);
    });

    it('canonicalizes payloads deterministically regardless of key order', () => {
        expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
    });

    it('computeRecordIntegrity binds seq, prevHash, and payload', () => {
        const first = computeRecordIntegrity({ seq: 1, prevHash: 'genesis', payload: { event: 'x' } });
        const second = computeRecordIntegrity({ seq: 2, prevHash: first.hash, payload: { event: 'x' } });
        expect(first.hash).not.toBe(second.hash);
        expect(first.signature).toBeTruthy();
    });
});

describe('deviceFingerprintAttestationService', () => {
    const originalEnv = {
        SIGNED_DEVICE_FINGERPRINT_ENABLED: process.env.SIGNED_DEVICE_FINGERPRINT_ENABLED,
        DEVICE_FP_ATTEST_SECRET: process.env.DEVICE_FP_ATTEST_SECRET,
        AUTH_RISK_SIGNAL_SECRET: process.env.AUTH_RISK_SIGNAL_SECRET,
    };

    beforeEach(() => {
        process.env.SIGNED_DEVICE_FINGERPRINT_ENABLED = 'true';
        process.env.DEVICE_FP_ATTEST_SECRET = 'dfp-test-secret';
        delete process.env.AUTH_RISK_SIGNAL_SECRET;
    });

    afterEach(() => {
        Object.entries(originalEnv).forEach(([key, value]) => {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        });
    });

    it('builds an attestation that verifies against the same fingerprint and session', () => {
        const { enabled, attestation } = buildDeviceFingerprintAttestation({
            fingerprint: 'fp-abc-123',
            sessionId: 'session-1',
        });
        expect(enabled).toBe(true);
        expect(attestation).toContain('.');

        const outcome = verifyDeviceFingerprintAttestation({
            attestation,
            fingerprint: 'fp-abc-123',
            sessionId: 'session-1',
        });
        expect(outcome.trusted).toBe(true);
        expect(outcome.fingerprint).toBe('fp-abc-123');
    });

    it('rejects a rotated fingerprint that does not match the attestation', () => {
        const { attestation } = buildDeviceFingerprintAttestation({
            fingerprint: 'fp-real',
            sessionId: 'session-1',
        });
        const outcome = verifyDeviceFingerprintAttestation({
            attestation,
            fingerprint: 'fp-rotated',
            sessionId: 'session-1',
        });
        expect(outcome.trusted).toBe(false);
    });

    it('rejects a different session binding', () => {
        const { attestation } = buildDeviceFingerprintAttestation({
            fingerprint: 'fp-abc-123',
            sessionId: 'session-1',
        });
        const outcome = verifyDeviceFingerprintAttestation({
            attestation,
            fingerprint: 'fp-abc-123',
            sessionId: 'session-2',
        });
        expect(outcome.trusted).toBe(false);
    });

    it('rejects a tampered signature', () => {
        const { attestation } = buildDeviceFingerprintAttestation({
            fingerprint: 'fp-abc-123',
            sessionId: 'session-1',
        });
        const [payload] = attestation.split('.');
        const outcome = verifyDeviceFingerprintAttestation({
            attestation: `${payload}.forged-signature`,
            fingerprint: 'fp-abc-123',
            sessionId: 'session-1',
        });
        expect(outcome.trusted).toBe(false);
    });

    it('is disabled when the flag is off', () => {
        process.env.SIGNED_DEVICE_FINGERPRINT_ENABLED = 'false';
        const outcome = buildDeviceFingerprintAttestation({ fingerprint: 'fp', sessionId: 's' });
        expect(outcome.enabled).toBe(false);
        expect(outcome.attestation).toBe('');
    });
});

describe('authBehaviorBaselineService', () => {
    const originalEnv = { AUTH_BEHAVIOR_BASELINE_ENABLED: process.env.AUTH_BEHAVIOR_BASELINE_ENABLED };

    beforeEach(() => {
        process.env.AUTH_BEHAVIOR_BASELINE_ENABLED = 'true';
    });

    afterEach(() => {
        Object.entries(originalEnv).forEach(([key, value]) => {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        });
    });

    it('tracks distinct source IPs across observations', async () => {
        const uid = 'baseline-user-1';
        await recordAuthObservation({ uid, ip: '1.1.1.1' });
        await recordAuthObservation({ uid, ip: '2.2.2.2' });
        await recordAuthObservation({ uid, ip: '3.3.3.3' });
        await recordAuthObservation({ uid, ip: '1.1.1.1' });

        const signals = await evaluateBehaviorSignals({ uid });
        expect(signals.enabled).toBe(true);
        expect(signals.distinctIpCount).toBe(3);
        expect(signals.attempts15m).toBe(4);
    });

    it('is inert when the flag is off', async () => {
        process.env.AUTH_BEHAVIOR_BASELINE_ENABLED = 'false';
        const uid = 'baseline-user-2';
        const recorded = await recordAuthObservation({ uid, ip: '1.1.1.1' });
        expect(recorded.enabled).toBe(false);
        const signals = await evaluateBehaviorSignals({ uid });
        expect(signals.enabled).toBe(false);
        expect(signals.distinctIpCount).toBe(0);
    });
});

describe('phase 5B wiring contracts', () => {
    const serverRoot = path.join(__dirname, '..');

    it('streams security events into the ledger from the logger', () => {
        const source = fs.readFileSync(path.join(serverRoot, 'security', 'securityEventLogger.js'), 'utf8');
        expect(source).toContain('appendSecurityEventToLedger');
    });

    it('issues the attestation at session establishment and prefers it in the lockout gate', () => {
        const controller = fs.readFileSync(path.join(serverRoot, 'controllers', 'authController.js'), 'utf8');
        const gate = fs.readFileSync(path.join(serverRoot, 'middleware', 'loginLockoutGate.js'), 'utf8');
        expect(controller).toContain('buildDeviceFingerprintAttestation');
        expect(controller).toContain('evaluateBehaviorSignals');
        expect(gate).toContain('resolveTrustedDeviceFingerprint');
    });

    it('keeps the four CSP copies in sync', () => {
        const script = path.join(serverRoot, '..', 'scripts', 'security', 'check-csp-drift.mjs');
        const outcome = require('child_process').spawnSync('node', [script], { encoding: 'utf8' });
        expect(outcome.status).toBe(0);
    });
});
