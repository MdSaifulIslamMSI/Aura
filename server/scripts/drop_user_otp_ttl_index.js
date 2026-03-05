const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is required');
    }

    await mongoose.connect(process.env.MONGO_URI);
    const collection = mongoose.connection.collection('users');
    const indexes = await collection.indexes();
    const otpTtlIndex = indexes.find(
        (index) => index.key?.otpExpiry === 1 && Number(index.expireAfterSeconds) === 0
    );

    if (!otpTtlIndex) {
        console.log('No OTP TTL index found on users collection.');
        return;
    }

    await collection.dropIndex(otpTtlIndex.name);
    console.log(`Dropped index: ${otpTtlIndex.name}`);
};

run()
    .then(async () => {
        await mongoose.connection.close();
    })
    .catch(async (error) => {
        console.error('Failed to drop OTP TTL index:', error.message);
        await mongoose.connection.close();
        process.exit(1);
    });
