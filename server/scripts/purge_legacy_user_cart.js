require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Cart = require('../models/Cart');

const normalizeLegacyCartItems = (items = []) => {
    const merged = new Map();

    (Array.isArray(items) ? items : []).forEach((item) => {
        const productId = Number(item?.productId ?? item?.id);
        const quantity = Number(item?.quantity ?? item?.qty ?? 1);

        if (!Number.isInteger(productId) || productId <= 0) {
            return;
        }

        if (!Number.isInteger(quantity) || quantity <= 0) {
            return;
        }

        merged.set(productId, (merged.get(productId) || 0) + quantity);
    });

    return Array.from(merged.entries()).map(([productId, quantity]) => ({
        productId,
        quantity,
    }));
};

const main = async () => {
    await connectDB();

    const legacyUsers = await User.collection.find({
        $or: [
            { cart: { $exists: true, $ne: [] } },
            { cartRevision: { $exists: true, $ne: 0 } },
            { cartSyncedAt: { $exists: true, $ne: null } },
        ],
    })
        .project({ _id: 1, cart: 1, cartRevision: 1, cartSyncedAt: 1 })
        .toArray();

    let migratedUsers = 0;
    let clearedUsers = 0;

    for (const user of legacyUsers) {
        const normalizedItems = normalizeLegacyCartItems(user?.cart || []);
        const existingCart = await Cart.findOne({ user: user._id }).select('_id items version').lean();

        if (!existingCart && normalizedItems.length > 0) {
            await Cart.create({
                user: user._id,
                version: Math.max(0, Number(user?.cartRevision || 0)),
                items: normalizedItems,
                recentMutations: [],
                updatedAtIso: user?.cartSyncedAt
                    ? new Date(user.cartSyncedAt).toISOString()
                    : new Date().toISOString(),
            });
            migratedUsers += 1;
        }

        await User.collection.updateOne(
            { _id: user._id },
            {
                $unset: {
                    cart: '',
                    cartRevision: '',
                    cartSyncedAt: '',
                },
            },
        );
        clearedUsers += 1;
    }

    console.log(JSON.stringify({
        success: true,
        scannedUsers: legacyUsers.length,
        migratedUsers,
        clearedUsers,
    }, null, 2));
};

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close().catch(() => null);
    });
