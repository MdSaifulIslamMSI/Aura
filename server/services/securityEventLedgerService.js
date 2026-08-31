const crypto = require('crypto');
const SecurityEventLedger = require('../models/SecurityEventLedger');
const logger = require('../utils/logger');

// Phase 5B: durable, tamper-evident sink for security events. Every record is
// signed with SECURITY_EVENT_LEDGER_SECRET and chained to its predecessor via
// an atomic counter (seq + lastHash live in one document, so concurrent
// writers can never fork the chain). An attacker with database access can
// delete or alter records, but every modification breaks the chain and is
// detected by server/scripts/verify-security-event-ledger.mjs.
//
// Flag: SECURITY_EVENT_LEDGER_ENABLED=true. The secret must be set when the
// flag is on; without it the append degrades to a loud no-op (never blocking
// the request path).

const COUNTER_DOC_ID = 'security_event_ledger_head';
const GENESIS_HASH = 'genesis';

const isSecurityEventLedgerEnabled = () => (
    String(process.env.SECURITY_EVENT_LEDGER_ENABLED || '').trim().toLowerCase() === 'true'
);

const getLedgerSecret = () => String(process.env.SECURITY_EVENT_LEDGER_SECRET || '').trim();

const canonicalize = (payload) => JSON.stringify(payload, Object.keys(payload || {}).sort());

const computeRecordIntegrity = ({ seq, prevHash, payload }) => {
    const secret = getLedgerSecret();
    const canonical = `${seq}|${prevHash}|${canonicalize(payload)}`;
    const hash = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
    const signature = crypto.createHmac('sha256', secret).update(`${canonical}|${hash}`).digest('hex');
    return { hash, signature };
};

// Fire-and-forget append. Never throws; a ledger failure must not change the
// request outcome (console + ring buffer remain the primary trail).
const appendSecurityEventToLedger = async (event) => {
    if (!isSecurityEventLedgerEnabled()) {
        return { enabled: false, appended: false };
    }
    const secret = getLedgerSecret();
    if (!secret) {
        logger.warn('security_ledger.secret_missing', { event: String(event?.event || '') });
        return { enabled: true, appended: false, error: 'secret_missing' };
    }

    try {
        const counter = await SecurityEventLedger.findOneAndUpdate(
            { _id: COUNTER_DOC_ID },
            { $inc: { seq: 1 } },
            { upsert: true, new: false, setDefaultsOnInsert: true }
        );
        const seq = Number(counter?.seq || 0) + 1;
        const prevHash = String(counter?.lastHash || '') || GENESIS_HASH;
        const { hash, signature } = computeRecordIntegrity({ seq, prevHash, payload: event });

        await SecurityEventLedger.create({
            seq,
            eventId: String(event?.requestId || '') + ':' + seq,
            prevHash,
            hash,
            signature,
            payload: event,
        });

        await SecurityEventLedger.findOneAndUpdate(
            { _id: COUNTER_DOC_ID },
            { $set: { lastHash: hash, seq } }
        );

        return { enabled: true, appended: true, seq, hash };
    } catch (error) {
        logger.warn('security_ledger.append_failed', {
            event: String(event?.event || ''),
            error: error?.message || 'unknown',
        });
        return { enabled: true, appended: false, error: error?.message || 'unknown' };
    }
};

// Replays the chain in sequence order and validates every link + signature.
const verifySecurityEventLedger = async ({ limit = 10000 } = {}) => {
    const secret = getLedgerSecret();
    if (!secret) {
        return { verified: false, reason: 'secret_missing', checked: 0 };
    }

    const records = await SecurityEventLedger.find({})
        .sort({ seq: 1 })
        .limit(limit)
        .lean();

    let prevHash = GENESIS_HASH;
    let previousSeq = 0;
    for (const record of records) {
        if (Number(record.seq) !== previousSeq + 1) {
            return { verified: false, reason: 'sequence_gap', brokenAt: record.seq, checked: previousSeq };
        }
        const expected = computeRecordIntegrity({ seq: record.seq, prevHash, payload: record.payload });
        if (record.prevHash !== prevHash || record.hash !== expected.hash || record.signature !== expected.signature) {
            return {
                verified: false,
                reason: 'integrity_mismatch',
                brokenAt: record.seq,
                checked: previousSeq,
            };
        }
        prevHash = record.hash;
        previousSeq = record.seq;
    }

    return { verified: true, checked: previousSeq, headHash: prevHash };
};

module.exports = {
    COUNTER_DOC_ID,
    GENESIS_HASH,
    appendSecurityEventToLedger,
    canonicalize,
    computeRecordIntegrity,
    isSecurityEventLedgerEnabled,
    verifySecurityEventLedger,
};
