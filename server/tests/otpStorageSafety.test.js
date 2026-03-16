const mongoose = require('mongoose');
const User = require('../models/User');
const OtpSession = require('../models/OtpSession');

describe('OTP Storage Safety', () => {

    test('otp sessions schema defines unique index on identityKey + purpose', async () => {
        const schemaIndexes = OtpSession.schema.indexes();
        const hasIdentityUnique = schemaIndexes.some(
            ([keys, options]) => keys?.identityKey === 1 && keys?.purpose === 1 && options?.unique === true
        );
        expect(hasIdentityUnique).toBe(true);
    });

    test('users collection does not have destructive TTL index on otpExpiry', async () => {
        let hasOtpTtl = false;
        try {
            const indexes = await User.collection.indexes();
            hasOtpTtl = indexes.some(
                (index) => index.key?.otpExpiry === 1 && Number(index.expireAfterSeconds) === 0
            );
        } catch (error) {
            const nsMissing = String(error?.message || '').toLowerCase().includes('ns does not exist');
            if (!nsMissing) throw error;
            const schemaIndexes = User.schema.indexes();
            hasOtpTtl = schemaIndexes.some(
                ([keys, options]) => keys?.otpExpiry === 1 && Number(options?.expireAfterSeconds) === 0
            );
        }
        expect(hasOtpTtl).toBe(false);
    });

    test('otp sessions collection has TTL index on expiresAt', async () => {
        let hasSessionTtl = false;

        try {
            // Ensure collection exists in environments where collection creation is allowed.
            await OtpSession.create({
                identityKey: '+14155550123',
                user: new mongoose.Types.ObjectId(),
                purpose: 'signup',
                otpHash: 'hash',
                expiresAt: new Date(Date.now() + 60_000),
            });
            await OtpSession.createIndexes();

            const indexes = await OtpSession.collection.indexes();
            hasSessionTtl = indexes.some(
                (index) => index.key?.expiresAt === 1 && Number(index.expireAfterSeconds) === 0
            );
        } catch (error) {
            const storageBlocked = String(error?.message || '').toLowerCase().includes('cannot create a new collection');
            if (!storageBlocked) throw error;

            // Fallback for constrained DB users: validate TTL is declared in schema metadata.
            const schemaIndexes = OtpSession.schema.indexes();
            hasSessionTtl = schemaIndexes.some(
                ([keys, options]) => keys?.expiresAt === 1 && Number(options?.expireAfterSeconds) === 0
            );
        }

        expect(hasSessionTtl).toBe(true);
    });
});
