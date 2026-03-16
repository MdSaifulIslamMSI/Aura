/* eslint-disable no-console */
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const OtpSession = require('../models/OtpSession');
const User = require('../models/User');
const { normalizePhoneE164 } = require('../services/sms');

const canonicalizePhoneIdentity = (value) => {
    const raw = typeof value === 'string' ? value.trim().replace(/[\s\-()]/g, '') : '';
    if (!raw) return '';
    try {
        return normalizePhoneE164(raw);
    } catch {
        return '';
    }
};

const run = async () => {
    await connectDB();

    const sessions = await OtpSession.find({
        $or: [
            { identityKey: { $exists: false } },
            { identityKey: null },
            { identityKey: '' },
        ],
    }).lean();

    let migrated = 0;
    let skipped = 0;

    for (const session of sessions) {
        const user = await User.findById(session.user, 'phone').lean();
        const identityKey = canonicalizePhoneIdentity(user?.phone);
        if (!identityKey) {
            skipped += 1;
            continue;
        }

        await OtpSession.updateOne(
            { _id: session._id },
            { $set: { identityKey } }
        );
        migrated += 1;
    }

    console.log(`otp-session identity migration complete: migrated=${migrated} skipped=${skipped}`);
};

run()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close();
    });
