require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const parseAllowlistEmails = () =>
    String(process.env.ADMIN_ALLOWLIST_EMAILS || '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);

const main = async () => {
    const emails = parseAllowlistEmails();
    if (!emails.length) {
        throw new Error('ADMIN_ALLOWLIST_EMAILS is empty');
    }
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is missing');
    }

    await mongoose.connect(process.env.MONGO_URI);

    const result = await User.updateMany(
        { email: { $in: emails } },
        { $set: { isAdmin: true, isVerified: true } }
    );

    const users = await User.find({ email: { $in: emails } })
        .select('email isAdmin isVerified isSeller')
        .lean();

    console.log(JSON.stringify({
        matched: result.matchedCount,
        modified: result.modifiedCount,
        users,
    }, null, 2));
};

main()
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await mongoose.disconnect();
        } catch {
            // noop
        }
    });

