/**
 * Migration: replace plaintext request signals on PaymentIntent.metadata.
 *
 * Payment intents used to persist the raw client IP (metadata.ip) and raw
 * user agent (metadata.userAgent). Risk/fraud lookups now count by the
 * truncated hashes in metadata.ipHash / metadata.userAgentHash (the same
 * representation FraudDecision.requestMeta uses), so the plaintext values
 * must be rewritten as hashes and removed.
 *
 * Dry-run by default: reports how many documents carry plaintext signals.
 * With --execute: batches through every matching document, sets the hashes,
 * and unsets the plaintext fields. Safe to re-run (only documents that
 * still carry plaintext are touched). Intents created after the cutover
 * already carry hashes and no plaintext.
 *
 * The 1h/24h risk windows make the transition seamless: pre-cutover intents
 * age out of every lookup window within a day even if this migration runs late.
 *
 * Usage:
 *   node scripts/migrate_payment_intent_signal_hash.js            # audit only
 *   node scripts/migrate_payment_intent_signal_hash.js --execute  # rewrite
 */
const mongoose = require('mongoose');
require('dotenv').config();
const { hashSignalValue } = require('../utils/signalHash');

const BATCH_SIZE = 500;

const run = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is required');
    }

    const execute = process.argv.includes('--execute');

    await mongoose.connect(process.env.MONGO_URI);
    const collection = mongoose.connection.collection('paymentintents');

    const plaintextCount = await collection.countDocuments({
        $or: [
            { 'metadata.ip': { $exists: true, $nin: ['', null] } },
            { 'metadata.userAgent': { $exists: true, $nin: ['', null] } },
        ],
    });
    console.log(`PaymentIntents still carrying plaintext request signals: ${plaintextCount}`);

    if (!execute) {
        console.log('Dry run complete. Re-run with --execute to rewrite the signals.');
        return;
    }

    let hashedIps = 0;
    let hashedUserAgents = 0;
    let rewritten = 0;
    let cursor;

    do {
        const query = {
            _id: cursor ? { $gt: cursor } : undefined,
            $or: [
                { 'metadata.ip': { $exists: true, $nin: ['', null] } },
                { 'metadata.userAgent': { $exists: true, $nin: ['', null] } },
            ],
        };
        const docs = await collection.find(query).sort({ _id: 1 }).limit(BATCH_SIZE).toArray();
        if (docs.length === 0) break;
        cursor = docs[docs.length - 1]._id;

        const operations = docs.map((doc) => {
            const set = {};
            const unset = {};
            const ip = typeof doc.metadata?.ip === 'string' ? doc.metadata.ip : '';
            const userAgent = typeof doc.metadata?.userAgent === 'string' ? doc.metadata.userAgent : '';
            if (ip) {
                set['metadata.ipHash'] = hashSignalValue(ip);
                unset['metadata.ip'] = '';
                hashedIps += 1;
            }
            if (userAgent) {
                set['metadata.userAgentHash'] = hashSignalValue(userAgent);
                unset['metadata.userAgent'] = '';
                hashedUserAgents += 1;
            }
            return {
                updateOne: { filter: { _id: doc._id }, update: { $set: set, $unset: unset } },
            };
        });

        if (operations.length > 0) {
            await collection.bulkWrite(operations, { ordered: false });
            rewritten += operations.length;
            console.log(`Rewrote ${rewritten} of ${plaintextCount} documents...`);
        }
    } while (true);

    console.log(`Done. Hashed ${hashedIps} ips and ${hashedUserAgents} user agents across ${rewritten} documents.`);
};

run()
    .then(async () => {
        await mongoose.connection.close();
    })
    .catch(async (error) => {
        console.error('payment intent signal hash migration failed:', error.message);
        try {
            await mongoose.connection.close();
        } catch {
            // connection may not be open yet
        }
        process.exit(1);
    });
