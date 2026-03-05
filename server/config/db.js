const mongoose = require('mongoose');
const logger = require('../utils/logger');

const dropLegacyUserOtpTtlIndex = async () => {
    try {
        const usersCollection = mongoose.connection.collection('users');
        const indexes = await usersCollection.indexes();
        const otpTtlIndex = indexes.find(
            (index) => index.key?.otpExpiry === 1 && Number(index.expireAfterSeconds) === 0
        );

        if (!otpTtlIndex) {
            return;
        }

        await usersCollection.dropIndex(otpTtlIndex.name);
        logger.warn('db.legacy_otp_ttl_index_dropped', { indexName: otpTtlIndex.name });
    } catch (error) {
        const message = String(error?.message || '').toLowerCase();
        const missingNamespace = message.includes('ns does not exist') || message.includes('namespace not found');
        if (!missingNamespace) {
            logger.warn('db.legacy_otp_ttl_index_drop_failed', { error: error.message });
        }
    }
};

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI);
        logger.info('db.connected', { host: conn.connection.host });
        await dropLegacyUserOtpTtlIndex();
    } catch (error) {
        logger.error('db.connect_failed', { error: error.message });
        process.exit(1);
    }
};

module.exports = connectDB;
