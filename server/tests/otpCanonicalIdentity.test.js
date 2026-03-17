const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../index');
const User = require('../models/User');
const OtpSession = require('../models/OtpSession');

const SALT = 8;

describe('OTP canonical identity enforcement', () => {
    test('login send rejects tail-overlap phone mismatch when canonical identity differs', async () => {
        await User.create({
            name: 'Tail Overlap',
            email: 'tail.overlap@example.com',
            phone: '+14155551234',
            isVerified: true,
        });

        const res = await request(app)
            .post('/api/otp/send')
            .send({
                email: 'tail.overlap@example.com',
                phone: '4155551234',
                purpose: 'login',
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe('If the account details are valid, we will continue with verification steps.');
    });

    test('verify attempts/lockout update only canonical identity', async () => {
        const otpHash = await bcrypt.hash('123456', SALT);
        const nowPlusFive = new Date(Date.now() + 5 * 60 * 1000);

        const userA = await User.create({
            name: 'User A',
            email: 'canon.a@example.com',
            phone: '+14155551234',
            isVerified: true,
            otp: otpHash,
            otpExpiry: nowPlusFive,
            otpPurpose: 'signup',
            otpAttempts: 0,
        });

        const userB = await User.create({
            name: 'User B',
            email: 'canon.b@example.com',
            phone: '+914155551234',
            isVerified: true,
            otp: otpHash,
            otpExpiry: nowPlusFive,
            otpPurpose: 'signup',
            otpAttempts: 0,
        });

        const res = await request(app)
            .post('/api/otp/verify')
            .send({ phone: '4155551234', otp: '000000', purpose: 'signup' });

        expect(res.statusCode).toBe(401);

        const refreshedA = await User.findById(userA._id).select('+otpAttempts');
        const refreshedB = await User.findById(userB._id).select('+otpAttempts');

        expect(refreshedA.otpAttempts).toBe(0);
        expect(refreshedB.otpAttempts).toBe(1);
    });

    test('verify migrates legacy otp session without identityKey', async () => {
        const user = await User.create({
            name: 'Legacy Session',
            email: 'legacy.session@example.com',
            phone: '+14155550000',
            isVerified: false,
        });

        const otpHash = await bcrypt.hash('654321', SALT);
        await OtpSession.collection.insertOne({
            user: user._id,
            purpose: 'signup',
            otpHash,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            attempts: 0,
            lockedUntil: null,
            lastSentAt: new Date(),
            requestMeta: {},
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const res = await request(app)
            .post('/api/otp/verify')
            .send({ phone: '+14155550000', otp: '000000', purpose: 'signup' });

        expect(res.statusCode).toBe(401);

        const migrated = await OtpSession.findOne({ identityKey: '+14155550000', purpose: 'signup' });
        expect(migrated).not.toBeNull();
        expect(String(migrated.user)).toBe(String(user._id));
    }, 15000);
});
