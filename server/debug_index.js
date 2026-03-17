const mongoose = require('mongoose');
const User = require('./models/User');
const { MongoMemoryServer } = require('mongodb-memory-server');

async function debugIndex() {
    const mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    console.log('--- Initializing User Model ---');
    await User.init(); // Wait for indexes to be created

    const collection = mongoose.connection.collection('users');
    let indexes = [];
    try {
        indexes = await collection.indexes();
    } catch (err) {
        console.log('Collection does not exist yet:', err.message);
        // Insert a dummy to force collection creation
        await User.create({ name: 'Force', email: 'force@ex.com' });
        indexes = await collection.indexes();
    }
    
    console.log('--- Final Indexes ---');
    console.log(JSON.stringify(indexes, null, 2));

    try {
        await User.create({ name: 'User 1', email: 'u1@ex.com', phone: '+1234567890' });
        console.log('First user created');
        await User.create({ name: 'User 2', email: 'u2@ex.com', phone: '+1234567890' });
        console.log('Second user created (UNEXPECTED)');
    } catch (err) {
        console.log('Caught expected error:', err.message);
    }

    await mongoose.disconnect();
    await mongoServer.stop();
}

debugIndex();

