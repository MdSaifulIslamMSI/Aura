'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../server/.env') });
const mongoose = require('mongoose');
const User = require('../../server/models/User');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error('Error: MONGO_URI is not set in server/.env');
    process.exit(1);
}

const prefix = 'test_auth_load_';
const count = Number(process.env.AUTH_LOAD_SEEDED_USERS || 100);

async function purge() {
    console.log(`Purging users starting with email prefix "${prefix}"...`);
    const res = await User.deleteMany({ email: new RegExp(`^${prefix}`) });
    console.log(`Purged ${res.deletedCount} users.`);
}

async function seed() {
    await purge();
    console.log(`Seeding ${count} users with prefix "${prefix}"...`);

    const usersToCreate = [];
    for (let i = 1; i <= count; i++) {
        usersToCreate.push({
            name: `Test Load User ${i}`,
            email: `${prefix}user_${i}@example.test`,
            phone: `+9199999${String(i).padStart(5, '0')}`,
            authUid: `test_auth_uid_${i}`,
            isVerified: true,
            accountState: 'active',
            authAssurance: 'password+otp'
        });
    }

    const res = await User.insertMany(usersToCreate);
    console.log(`Successfully seeded ${res.length} users.`);
}

async function main() {
    console.log('Connecting to database...');
    await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 15000
    });
    console.log('Connected to MongoDB.');

    const args = process.argv.slice(2);
    if (args.includes('--purge')) {
        await purge();
    } else {
        await seed();
    }
}

main()
    .then(() => {
        console.log('Done!');
        process.exit(0);
    })
    .catch((err) => {
        console.error('Fatal Error:', err);
        process.exit(1);
    })
    .finally(() => {
        mongoose.disconnect().catch(() => {});
    });
