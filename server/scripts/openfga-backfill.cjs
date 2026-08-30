#!/usr/bin/env node
'use strict';

/**
 * OpenFGA tuple backfill — writes authorization tuples for EXISTING database
 * records so enforcement mode can be enabled without losing historical grants.
 *
 * Backfills:
 *   - listings -> user:<seller> owner  listing:<id> + editor (owner|admin)
 *   - orders   -> user:<buyer> buyer   order:<id>  + viewer (buyer|seller|admin)
 *
 * DRY-RUN by default (--apply to write). Resumable via --after-listing /
 * --after-order <id>.
 *
 * Prerequisites: MONGO_URI (env or server/.env) and a configured OpenFGA
 * (OPENFGA_API_URL / OPENFGA_STORE_ID / OPENFGA_AUTHORIZATION_MODEL_ID).
 *
 * Usage (from server/):
 *   node scripts/openfga-backfill.mjs                # dry run
 *   node scripts/openfga-backfill.mjs --apply
 *   node scripts/openfga-backfill.mjs --apply --batch-size 500
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { defaultService } = require('../services/authorization/openFgaService');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const batchSize = Number(args[args.indexOf('--batch-size') + 1]) || 500;
const afterListing = args.includes('--after-listing') ? args[args.indexOf('--after-listing') + 1] : undefined;
const afterOrder = args.includes('--after-order') ? args[args.indexOf('--after-order') + 1] : undefined;

if (!process.env.MONGO_URI) {
    console.error('[openfga-backfill] MONGO_URI is required (export it or add it to server/.env).');
    process.exit(2);
}
if (!defaultService.isConfigured) {
    console.error('[openfga-backfill] OpenFGA is not configured: set OPENFGA_API_URL, OPENFGA_STORE_ID, OPENFGA_AUTHORIZATION_MODEL_ID.');
    process.exit(2);
}

const connectMongo = async () => {
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 180000,
        maxPoolSize: 10,
    });
};

const backfillCollection = async ({ model, label, afterId, applyWrites }) => {
    const cursorFilter = afterId ? { _id: { $gt: afterId } } : {};
    let scanned = 0;
    let written = 0;
    let batch = [];

    const flush = async () => {
        if (batch.length === 0) return;
        if (applyWrites) await defaultService.writeTuples(batch);
        written += batch.length;
        batch = [];
    };

    const cursor = model.find(cursorFilter).sort({ _id: 1 }).batchSize(batchSize).cursor();
    for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
        scanned += 1;
        if (label === 'listings') {
            const sellerId = String(doc.seller?._id || doc.seller || '').trim();
            if (sellerId) {
                batch.push({ user: `user:${sellerId}`, relation: 'owner', object: `listing:${doc._id}` });
                batch.push({ user: `user:${sellerId}`, relation: 'editor', object: `listing:${doc._id}` });
            }
        } else {
            const buyerId = String(doc.user?._id || doc.user || '').trim();
            if (buyerId) {
                batch.push({ user: `user:${buyerId}`, relation: 'buyer', object: `order:${doc._id}` });
                batch.push({ user: `user:${buyerId}`, relation: 'viewer', object: `order:${doc._id}` });
            }
        }
        if (batch.length >= batchSize) await flush();
    }
    await flush();

    console.log(`[openfga-backfill] ${label}: scanned=${scanned} tuples=${written}${applyWrites ? '' : ' (dry run)'}`);
    return { scanned, written };
};

const main = async () => {
    await connectMongo();
    console.log(`[openfga-backfill] mode=${apply ? 'APPLY' : 'DRY RUN'} store=${defaultService.config.storeId}`);

    // Requires are deferred until after dotenv so model envs are populated.
    const Listing = require('../models/Listing.js');
    const Order = require('../models/Order.js');

    const listings = await backfillCollection({
        model: Listing,
        label: 'listings',
        afterId: afterListing,
        applyWrites: apply,
    });
    const orders = await backfillCollection({
        model: Order,
        label: 'orders',
        afterId: afterOrder,
        applyWrites: apply,
    });

    console.log(`[openfga-backfill] complete — listings: ${JSON.stringify(listings)}, orders: ${JSON.stringify(orders)}`);
    console.log('[openfga-backfill] next: set OPENFGA_ENFORCEMENT_MODE=monitor, watch disagreement logs, then enforce.');
    await mongoose.disconnect();
    process.exitCode = 0;
};

main().catch((error) => {
    console.error(`[openfga-backfill] ${error.message}`);
    process.exit(1);
});
