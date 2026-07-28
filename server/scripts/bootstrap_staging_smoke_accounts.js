require('dotenv').config();

const mongoose = require('mongoose');
const admin = require('../config/firebase');
const connectDB = require('../config/db');
const User = require('../models/User');

const normalizeText = (value) => String(value === undefined || value === null ? '' : value).trim();

const ensureFirebaseAccount = async ({
    email,
    password,
    displayName,
    phoneNumber,
}) => {
    let userRecord = null;
    try {
        userRecord = await admin.auth().getUserByEmail(email);
    } catch (error) {
        if (error.code !== 'auth/user-not-found') {
            throw error;
        }
    }

    if (!userRecord) {
        return admin.auth().createUser({
            email,
            password,
            displayName,
            ...(phoneNumber ? { phoneNumber } : {}),
            emailVerified: true,
        });
    }

    return admin.auth().updateUser(userRecord.uid, {
        password,
        displayName,
        ...(phoneNumber ? { phoneNumber } : {}),
        emailVerified: true,
    });
};

const ensureBackendUser = async ({
    email,
    name,
    phone,
    isAdmin = false,
    isSeller = false,
}) => User.findOneAndUpdate(
    { email },
    {
        $set: {
            name,
            phone: phone || undefined,
            isVerified: true,
            isAdmin,
            isSeller,
            ...(isSeller ? { sellerActivatedAt: new Date() } : { sellerActivatedAt: null }),
        },
        $setOnInsert: {
            email,
        },
    },
    {
        returnDocument: 'after',
        upsert: true,
        setDefaultsOnInsert: true,
    }
);

const requiredAccounts = [
    {
        label: 'customer',
        email: normalizeText(process.env.SMOKE_USER_EMAIL),
        password: normalizeText(process.env.SMOKE_USER_PASSWORD),
        name: normalizeText(process.env.SMOKE_USER_NAME || 'Smoke Customer'),
        phone: normalizeText(process.env.SMOKE_USER_PHONE || '+919999999999'),
        isAdmin: false,
        isSeller: false,
    },
    {
        label: 'admin',
        email: normalizeText(process.env.SMOKE_ADMIN_EMAIL),
        password: normalizeText(process.env.SMOKE_ADMIN_PASSWORD),
        name: normalizeText(process.env.SMOKE_ADMIN_NAME || 'Smoke Admin'),
        phone: normalizeText(process.env.SMOKE_ADMIN_PHONE || '+919999999998'),
        isAdmin: true,
        isSeller: false,
    },
    {
        label: 'secondary-customer',
        email: normalizeText(process.env.SMOKE_OTHER_USER_EMAIL),
        password: normalizeText(process.env.SMOKE_OTHER_USER_PASSWORD),
        name: normalizeText(process.env.SMOKE_OTHER_USER_NAME || 'Smoke Secondary Customer'),
        phone: normalizeText(process.env.SMOKE_OTHER_USER_PHONE || '+919999999997'),
        isAdmin: false,
        isSeller: false,
    },
].filter((entry) => entry.email && entry.password);

const toSafeResult = ({ label, backendUser }) => ({
    label,
    ready: true,
    isAdmin: Boolean(backendUser?.isAdmin),
    isSeller: Boolean(backendUser?.isSeller),
});

const run = async () => {
    if (requiredAccounts.length === 0) {
        throw new Error(
            'Provide dedicated staging smoke account credentials before bootstrapping accounts.'
        );
    }

    await connectDB();

    const results = [];
    for (const account of requiredAccounts) {
        const firebaseUser = await ensureFirebaseAccount({
            email: account.email,
            password: account.password,
            displayName: account.name,
            phoneNumber: account.phone || undefined,
        });

        const backendUser = await ensureBackendUser({
            email: account.email,
            name: account.name,
            phone: account.phone,
            isAdmin: account.isAdmin,
            isSeller: account.isSeller,
        });

        results.push({
            ...toSafeResult({ label: account.label, backendUser }),
            firebaseReady: Boolean(firebaseUser?.uid),
            backendReady: Boolean(backendUser?._id),
        });
    }

    console.log(JSON.stringify({
        success: true,
        results,
        generatedAt: new Date().toISOString(),
    }, null, 2));
    return results;
};

if (require.main === module) {
    run()
        .catch((error) => {
            console.error(`Smoke account bootstrap failed: ${error.message}`);
            process.exitCode = 1;
        })
        .finally(async () => {
            if (mongoose.connection.readyState !== 0) {
                await mongoose.connection.close().catch(() => null);
            }
        });
}

module.exports = {
    run,
    toSafeResult,
};
