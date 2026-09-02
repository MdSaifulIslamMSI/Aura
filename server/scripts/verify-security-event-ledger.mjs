#!/usr/bin/env node
// Phase 5B: verify the tamper-evident security event ledger. Replays the
// chain in sequence order and validates every hash link and HMAC signature.
// Exit 0 = chain intact; exit 1 = tampering detected, gap, or misconfiguration.
//
// Usage: node server/scripts/verify-security-event-ledger.mjs [--limit N]

const mongoose = require('mongoose');
const { verifySecurityEventLedger } = require('../services/securityEventLedgerService');

const args = process.argv.slice(2);
const limitIndex = args.indexOf('--limit');
const limit = limitIndex !== -1 ? Number(args[limitIndex + 1]) || 10000 : 10000;

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/aura';

mongoose
    .connect(mongoUri)
    .then(() => verifySecurityEventLedger({ limit }))
    .then((outcome) => {
        if (outcome.verified) {
            console.log(`[security-ledger] OK — ${outcome.checked} records verified; head ${outcome.headHash || 'genesis'}.`);
            process.exitCode = 0;
        } else {
            console.error(`[security-ledger] TAMPERING OR GAP DETECTED: ${outcome.reason} at seq ${outcome.brokenAt} (checked ${outcome.checked}).`);
            process.exitCode = 1;
        }
    })
    .catch((error) => {
        console.error(`[security-ledger] verification failed to run: ${error?.message || error}`);
        process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
