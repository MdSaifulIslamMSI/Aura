const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is required');
    }

    await mongoose.connect(process.env.MONGO_URI);
    const collection = mongoose.connection.collection('users');
    const indexes = await collection.indexes();

    const phoneIndexes = indexes.filter((index) => index.key?.phone === 1);
    for (const index of phoneIndexes) {
        await collection.dropIndex(index.name);
        console.log(`Dropped phone index: ${index.name}`);
    }

    await collection.createIndex(
        { phone: 1 },
        {
            name: 'phone_1_sparse_unique',
            unique: true,
            sparse: true,
        }
    );
    console.log('Created sparse unique phone index: phone_1_sparse_unique');

    await collection.createIndex(
        { phone: 1, isVerified: 1 },
        { name: 'phone_1_isVerified_1' }
    );
    console.log('Created lookup index: phone_1_isVerified_1');
};

run()
    .then(async () => {
        await mongoose.connection.close();
    })
    .catch(async (error) => {
        console.error('Failed to migrate user phone index:', error.message);
        await mongoose.connection.close();
        process.exit(1);
    });
