require('dotenv').config();

const mongoose = require('mongoose');
const Product = require('../models/Product');
const { resolveProductImage, isWeakImageUrl } = require('../services/productImageResolver');

const BATCH_SIZE = Number(process.env.IMAGE_REPLACE_BATCH_SIZE || 500);
const FORCE = String(process.env.IMAGE_REPLACE_FORCE || 'false').toLowerCase() === 'true';

const run = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI missing in environment');
    }

    await mongoose.connect(process.env.MONGO_URI);

    const filter = FORCE
        ? {}
        : {
            $or: [
                { image: { $regex: '^https?://picsum\\.photos/', $options: 'i' } },
                { image: { $regex: '^https?://via\\.placeholder\\.com/', $options: 'i' } },
                { image: { $regex: '^https?://placehold\\.co/', $options: 'i' } },
                { image: { $regex: '^https?://dummyimage\\.com/', $options: 'i' } },
            ],
        };

    const totalCandidates = await Product.countDocuments(filter);
    console.log(`[image-replace] candidates=${totalCandidates.toLocaleString()} force=${FORCE}`);

    if (totalCandidates === 0) {
        console.log('[image-replace] nothing to update');
        return;
    }

    const cursor = Product.find(filter)
        .select('_id id externalId source catalogVersion title brand category image imageKey')
        .lean()
        .cursor();

    let scanned = 0;
    let updated = 0;
    let skipped = 0;
    let ops = [];

    const flush = async () => {
        if (ops.length === 0) return;
        await Product.bulkWrite(ops, { ordered: false });
        updated += ops.length;
        ops = [];
    };

    for await (const product of cursor) {
        scanned += 1;
        const shouldReplace = FORCE || isWeakImageUrl(product.image);
        if (!shouldReplace) {
            skipped += 1;
            continue;
        }

        const nextImage = resolveProductImage({
            existingImage: product.image,
            title: product.title,
            brand: product.brand,
            category: product.category,
            source: product.source,
            catalogVersion: product.catalogVersion,
            externalId: product.externalId,
            id: product.id,
            forceSemantic: true,
        });
        const nextImageKey = Product.normalizeImageKey(nextImage);

        if (nextImage === product.image && nextImageKey === product.imageKey) {
            skipped += 1;
            continue;
        }

        ops.push({
            updateOne: {
                filter: { _id: product._id },
                update: {
                    $set: {
                        image: nextImage,
                        imageKey: nextImageKey,
                        updatedAt: new Date(),
                    },
                },
            },
        });

        if (ops.length >= BATCH_SIZE) {
            await flush();
        }

        if (scanned % 10000 === 0) {
            console.log(`[image-replace] scanned=${scanned.toLocaleString()} updated=${updated.toLocaleString()} pendingOps=${ops.length}`);
        }
    }

    await flush();

    console.log('[image-replace] done', JSON.stringify({
        scanned,
        updated,
        skipped,
    }, null, 2));
};

run()
    .catch((error) => {
        console.error('[image-replace] failed', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
