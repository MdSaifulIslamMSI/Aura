const crypto = require('crypto');
const mongoose = require('mongoose');
const SecurityEventLedger = require('../models/SecurityEventLedger');
const SecurityEventLedgerHead = require('../models/SecurityEventLedgerHead');
const logger = require('../utils/logger');
const { getPqcCapabilities } = require('../security/pqc/algorithms');
const hybridSignature = require('../security/pqc/hybridSignature');
const { PqcKeyRegistry, parseReferenceList } = require('../security/pqc/keyRegistry');

// Phase 5B: durable, tamper-evident sink for security events. Every record is
// signed with SECURITY_EVENT_LEDGER_SECRET and chained to its predecessor via a
// monotonic sequence number. Because each hash binds the previous hash, appends
// are sequential by construction: reserving `seq`, writing the record, and
// advancing `lastHash` happen in one transaction, so concurrent writers cannot
// fork the chain or re-issue a sequence number. An attacker with database
// access can delete or alter records, but every modification breaks the chain
// and is detected by server/scripts/verify-security-event-ledger.mjs.
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

const PQC_MODES = new Set(['off', 'auto', 'require']);
const PQC_SIGNATURE_CONTEXT = 'aura:security-event-ledger:v1';
const PQC_REQUIRED_FROM_SEQ_ENV = 'SECURITY_EVENT_LEDGER_PQC_REQUIRED_FROM_SEQ';

let ledgerPqcState = null;
let ledgerPqcPrimingPromise = null;

const resolveLedgerPqcMode = () => String(
    process.env.SECURITY_EVENT_LEDGER_PQC_MODE || 'off'
).trim().toLowerCase() || 'off';

const resolveLedgerPqcSigningKeyRef = () => String(
    process.env.SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF
    || process.env.PQC_SIGNING_KEY_REF
    || ''
).trim();

const resolveLedgerPqcPreviousKeyRefs = () => parseReferenceList(
    process.env.SECURITY_EVENT_LEDGER_PQC_PREVIOUS_KEY_REFS
    || process.env.PQC_SIGNING_PREVIOUS_KEY_REFS
    || ''
);

const assertValidLedgerPqcMode = () => {
    const mode = resolveLedgerPqcMode();
    if (!PQC_MODES.has(mode)) {
        throw new Error(
            `SECURITY_EVENT_LEDGER_PQC_MODE=${mode} is invalid; use off, auto, or require`
        );
    }
    return mode;
};

const computePqcSignedMessage = ({ seq, prevHash, hash, payload }) => canonicalize({
    seq,
    prevHash,
    hash,
    payload,
});

/**
 * Load ledger signing keys once. `auto` signs when key material is present and
 * degrades to the HMAC chain otherwise; `require` refuses to append unsigned.
 * In `off` mode a configured key is still loaded for verification only.
 */
const primeSecurityEventLedgerPqc = async () => {
    if (ledgerPqcState) return ledgerPqcState;
    if (ledgerPqcPrimingPromise) return ledgerPqcPrimingPromise;

    ledgerPqcPrimingPromise = (async () => {
        const configuredMode = assertValidLedgerPqcMode();
        const reference = resolveLedgerPqcSigningKeyRef();
        const capabilities = getPqcCapabilities();

        if (!reference) {
            if (configuredMode === 'require') {
                throw new Error(
                    'SECURITY_EVENT_LEDGER_PQC_MODE=require requires SECURITY_EVENT_LEDGER_PQC_SIGNING_KEY_REF'
                );
            }
            ledgerPqcState = {
                configuredMode,
                effectiveMode: 'off',
                current: null,
                previous: [],
                unavailableReason: configuredMode === 'auto' ? 'no-key-reference' : null,
                capabilities,
            };
            return ledgerPqcState;
        }

        if (!capabilities.algorithms.mlDsa.available) {
            const reason = capabilities.reasons.join('; ') || 'ML-DSA is unavailable';
            if (configuredMode === 'require') {
                throw new Error(`Security ledger PQC mode require cannot start: ${reason}`);
            }
            ledgerPqcState = {
                configuredMode,
                effectiveMode: 'off',
                current: null,
                previous: [],
                unavailableReason: reason,
                capabilities,
            };
            logger.warn('security_ledger.pqc_unavailable', { mode: configuredMode, reason });
            return ledgerPqcState;
        }

        try {
            const registry = new PqcKeyRegistry({ logger });
            const { current, previous } = await registry.loadRotated(
                'hybrid-signature',
                reference,
                resolveLedgerPqcPreviousKeyRefs()
            );
            const effectiveMode = configuredMode === 'off' ? 'verify-only' : 'sign';
            ledgerPqcState = {
                configuredMode,
                effectiveMode,
                current,
                previous,
                registry,
                unavailableReason: null,
                capabilities,
            };
            logger.info('security_ledger.pqc_primed', {
                configuredMode,
                effectiveMode,
                keyId: current.keyId,
                keySource: current.source,
                previousKeys: previous.length,
            });
            return ledgerPqcState;
        } catch (error) {
            if (configuredMode === 'require') {
                throw new Error(`Security ledger PQC key material could not load: ${error.message}`);
            }
            ledgerPqcState = {
                configuredMode,
                effectiveMode: 'off',
                current: null,
                previous: [],
                unavailableReason: error.message,
                capabilities,
            };
            logger.warn('security_ledger.pqc_unavailable', { mode: configuredMode, reason: error.message });
            return ledgerPqcState;
        }
    })();

    try {
        return await ledgerPqcPrimingPromise;
    } finally {
        ledgerPqcPrimingPromise = null;
    }
};

const getSecurityLedgerPqcStatus = () => {
    const capabilities = getPqcCapabilities();
    return {
        configuredMode: resolveLedgerPqcMode(),
        effectiveMode: ledgerPqcState?.effectiveMode || 'off',
        active: Boolean(ledgerPqcState?.current),
        keyId: ledgerPqcState?.current?.keyId || null,
        keySource: ledgerPqcState?.current?.source || null,
        previousKeys: ledgerPqcState?.previous?.length || 0,
        algorithm: 'Ed25519+ML-DSA-65',
        unavailableReason: ledgerPqcState?.unavailableReason || null,
        capabilities: {
            available: capabilities.algorithms.mlDsa.available,
            fullyAvailable: capabilities.fullyAvailable,
            nodeVersion: capabilities.nodeVersion,
            opensslVersion: capabilities.opensslVersion,
        },
    };
};

const canonicalize = (payload) => JSON.stringify(payload, Object.keys(payload || {}).sort());

const computeRecordIntegrity = ({ seq, prevHash, payload }) => {
    const secret = getLedgerSecret();
    const canonical = `${seq}|${prevHash}|${canonicalize(payload)}`;
    const hash = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
    const signature = crypto.createHmac('sha256', secret).update(`${canonical}|${hash}`).digest('hex');
    return { hash, signature };
};

const TRANSACTION_OPTIONS = {
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' },
};

const isUnsupportedTransactionError = (error) => {
    const message = String(error?.message || '').toLowerCase();
    return (
        message.includes('transaction numbers are only allowed on a replica set member or mongos')
        || message.includes('transactions are not supported')
        || message.includes('does not support retryable writes')
    );
};

// Production always runs on a replica set (guarded by config/db.js), so a
// failed transaction there is a real fault and must surface as a dropped
// append. A single-node development Mongo cannot transact; serialize appends
// in-process instead so the chain stays coherent without inventing a second
// unsupported topology.
const canFallBackToSerializedAppend = () => String(process.env.NODE_ENV || '') !== 'production';

let serializedAppendTail = Promise.resolve();
let transactionsUnavailable = false;

const runSerializedAppend = async (task) => {
    const previous = serializedAppendTail;
    let release;
    serializedAppendTail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
        return await task(null);
    } finally {
        release();
    }
};

// A record's hash binds it to its predecessor, so appends are sequential by
// construction. Reserving a seq and publishing the record must therefore be
// one atomic unit: when two appends overlapped, the slower one could publish
// an older `seq`/`lastHash` after a newer one had already advanced the head,
// re-issuing a sequence number that was already stored (E11000 on seq_1) and
// forking the chain.
const runLedgerAppend = async (task) => {
    if (!transactionsUnavailable) {
        let session = null;
        try {
            session = await mongoose.startSession();
            let result;
            await session.withTransaction(async () => {
                result = await task(session);
            }, TRANSACTION_OPTIONS);
            return result;
        } catch (error) {
            if (!isUnsupportedTransactionError(error) || !canFallBackToSerializedAppend()) {
                throw error;
            }
            transactionsUnavailable = true;
            logger.warn('security_ledger.transactions_unavailable', {
                error: error?.message || 'unknown',
                fallback: 'serialized_single_process',
            });
        } finally {
            if (session) {
                try {
                    await session.endSession();
                } catch {
                    // Session cleanup must never mask the append outcome.
                }
            }
        }
    }
    return runSerializedAppend(task);
};

class LedgerSigningBlockedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'LedgerSigningBlockedError';
    }
}

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
        // `require` must prove signing works before the atomic counter reserves
        // a sequence number. Otherwise a blocked append advances `seq` without
        // a record, which verifySecurityEventLedger reports as a chain gap.
        const configuredMode = resolveLedgerPqcMode();
        const shouldConsiderPqc = configuredMode !== 'off' || resolveLedgerPqcSigningKeyRef();
        let prePrimedState = null;
        if (configuredMode === 'require' || !PQC_MODES.has(configuredMode)) {
            try {
                prePrimedState = await primeSecurityEventLedgerPqc();
                if (prePrimedState.effectiveMode !== 'sign' || !prePrimedState.current) {
                    throw new Error(prePrimedState.unavailableReason || 'PQC signing key is not active');
                }
            } catch (error) {
                logger.error('security_ledger.pqc_signing_blocked', {
                    event: String(event?.event || ''),
                    mode: configuredMode,
                    error: error?.message || 'unknown',
                });
                return {
                    enabled: true,
                    appended: false,
                    error: 'pqc_signing_unavailable',
                    pqc: { mode: configuredMode, signed: false },
                };
            }
        }

        const appendRecord = async (session) => {
            const sessionOptions = session ? { session } : {};
            const counter = await SecurityEventLedgerHead.findOneAndUpdate(
                { _id: COUNTER_DOC_ID },
                { $inc: { seq: 1 } },
                { upsert: true, new: false, setDefaultsOnInsert: true, ...sessionOptions }
            );
            const seq = Number(counter?.seq || 0) + 1;
            const prevHash = String(counter?.lastHash || '') || GENESIS_HASH;
            const { hash, signature } = computeRecordIntegrity({ seq, prevHash, payload: event });

            // PQ signatures are an additive layer over the HMAC chain. `require`
            // blocks the append instead of silently writing an unsigned record;
            // `auto` falls back to the chain when key material is unavailable.
            const pqcDoc = {};
            let pqcOutcome = { mode: configuredMode, signed: false, keyId: null };
            if (shouldConsiderPqc) {
                try {
                    const state = prePrimedState || await primeSecurityEventLedgerPqc();
                    if (state.effectiveMode === 'sign' && state.current) {
                        const signed = hybridSignature.sign(
                            computePqcSignedMessage({ seq, prevHash, hash, payload: event }),
                            state.current,
                            { context: PQC_SIGNATURE_CONTEXT }
                        );
                        pqcDoc.pqcSignature = hybridSignature.serializeSignature(signed);
                        pqcDoc.pqcKeyId = signed.keyId;
                        pqcDoc.pqcAlgorithm = signed.alg;
                        pqcOutcome = { mode: configuredMode, signed: true, keyId: signed.keyId };
                    } else if (configuredMode === 'require') {
                        throw new Error(state.unavailableReason || 'PQC signing key is not active');
                    }
                } catch (error) {
                    if (configuredMode === 'require' || !PQC_MODES.has(configuredMode)) {
                        // Abort the transaction so a blocked append does not
                        // consume the sequence number reserved above.
                        throw new LedgerSigningBlockedError(error?.message || 'unknown');
                    }
                    logger.warn('security_ledger.pqc_signing_fallback', {
                        event: String(event?.event || ''),
                        mode: configuredMode,
                        error: error?.message || 'unknown',
                    });
                }
            }

            const [created] = await SecurityEventLedger.create([{
                seq,
                eventId: String(event?.requestId || '') + ':' + seq,
                prevHash,
                hash,
                signature,
                payload: event,
                ...pqcDoc,
            }], sessionOptions);
            if (!created) {
                throw new Error('ledger record was not persisted');
            }

            // `seq` was already advanced atomically by the `$inc` above.
            // Writing it again here regressed the counter whenever a slower
            // append published after a faster one, re-issuing a used number.
            await SecurityEventLedgerHead.findOneAndUpdate(
                { _id: COUNTER_DOC_ID },
                { $set: { lastHash: hash } },
                sessionOptions
            );

            return { seq, hash, pqc: pqcOutcome };
        };

        const appended = await runLedgerAppend(appendRecord);
        return { enabled: true, appended: true, ...appended };
    } catch (error) {
        if (error instanceof LedgerSigningBlockedError) {
            logger.error('security_ledger.pqc_signing_blocked', {
                event: String(event?.event || ''),
                mode: resolveLedgerPqcMode(),
                error: error.message,
            });
            return {
                enabled: true,
                appended: false,
                error: 'pqc_signing_unavailable',
                pqc: { mode: resolveLedgerPqcMode(), signed: false },
            };
        }
        logger.warn('security_ledger.append_failed', {
            event: String(event?.event || ''),
            error: error?.message || 'unknown',
        });
        return { enabled: true, appended: false, error: error?.message || 'unknown' };
    }
};

// Replays the chain in sequence order and validates every link + signature.
const verifySecurityEventLedger = async (options = {}) => {
    const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 10000;
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
    let pqcChecked = 0;
    let pqcUnsigned = 0;
    const configuredMode = resolveLedgerPqcMode();
    const hasPqcSignatures = records.some((record) => Boolean(record.pqcSignature));

    // A record that carries a PQ signature must be checked: skipping it would
    // turn the strongest layer into decoration. Load keys on demand so the
    // verifier CLI works without a server boot.
    if (hasPqcSignatures || configuredMode === 'require' || resolveLedgerPqcSigningKeyRef()) {
        if (!PQC_MODES.has(configuredMode)) {
            return {
                verified: false,
                reason: 'pqc_config_invalid',
                checked: 0,
                pqc: { mode: configuredMode, checked: 0, unsigned: records.length },
            };
        }
        try {
            await primeSecurityEventLedgerPqc();
        } catch (error) {
            if (hasPqcSignatures || configuredMode === 'require') {
                return {
                    verified: false,
                    reason: 'pqc_key_unavailable',
                    checked: 0,
                    error: error?.message || 'unknown',
                    pqc: { mode: configuredMode, checked: 0, unsigned: records.length },
                };
            }
        }
    }

    const requiredFromRaw = options.pqcRequiredFromSeq
        ?? process.env[PQC_REQUIRED_FROM_SEQ_ENV]
        ?? 0;
    const requiredFromSeq = Number.isFinite(Number(requiredFromRaw)) ? Number(requiredFromRaw) : 0;
    const pqcKeys = ledgerPqcState?.current
        ? [ledgerPqcState.current, ...(ledgerPqcState.previous || [])]
        : [];

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

        if (record.pqcSignature) {
            if (!pqcKeys.length) {
                return {
                    verified: false,
                    reason: 'pqc_key_unavailable',
                    brokenAt: record.seq,
                    checked: previousSeq,
                };
            }
            const message = computePqcSignedMessage({
                seq: record.seq,
                prevHash,
                hash: record.hash,
                payload: record.payload,
            });
            const preferred = pqcKeys.filter((key) => key.keyId === record.pqcKeyId);
            const candidates = preferred.length ? preferred : pqcKeys;
            let signatureValid = false;
            for (const key of candidates) {
                try {
                    signatureValid = hybridSignature.verify(
                        message,
                        record.pqcSignature,
                        key,
                        { context: PQC_SIGNATURE_CONTEXT }
                    ).valid;
                } catch {
                    signatureValid = false;
                }
                if (signatureValid) break;
            }
            if (!signatureValid) {
                return {
                    verified: false,
                    reason: 'pqc_signature_mismatch',
                    brokenAt: record.seq,
                    checked: previousSeq,
                    pqc: { mode: configuredMode, checked: pqcChecked, unsigned: pqcUnsigned },
                };
            }
            pqcChecked += 1;
        } else {
            pqcUnsigned += 1;
            if (configuredMode === 'require' && requiredFromSeq > 0 && Number(record.seq) >= requiredFromSeq) {
                return {
                    verified: false,
                    reason: 'pqc_signature_missing',
                    brokenAt: record.seq,
                    checked: previousSeq,
                    pqc: { mode: configuredMode, checked: pqcChecked, unsigned: pqcUnsigned },
                };
            }
        }

        prevHash = record.hash;
        previousSeq = record.seq;
    }

    return {
        verified: true,
        checked: previousSeq,
        headHash: prevHash,
        pqc: {
            mode: configuredMode,
            active: Boolean(ledgerPqcState?.current),
            checked: pqcChecked,
            unsigned: pqcUnsigned,
        },
    };
};

module.exports = {
    COUNTER_DOC_ID,
    GENESIS_HASH,
    appendSecurityEventToLedger,
    canonicalize,
    computeRecordIntegrity,
    computePqcSignedMessage,
    isSecurityEventLedgerEnabled,
    primeSecurityEventLedgerPqc,
    resolveLedgerPqcMode,
    getSecurityLedgerPqcStatus,
    verifySecurityEventLedger,
};
