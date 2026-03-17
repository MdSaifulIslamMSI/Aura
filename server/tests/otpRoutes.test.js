const request = require('supertest');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const app = require('../index');
const User = require('../models/User');

// Mock services
jest.mock('../services/emailService', () => ({
    sendOtpEmail: jest.fn().mockResolvedValue({ provider: 'mock-email' }),
}));

jest.mock('../services/sms', () => ({
    sendOtpSms: jest.fn().mockResolvedValue({ channel: 'sms' }),
    normalizePhoneE164: jest.fn((phone) => phone.startsWith('+') ? phone : `+91${phone}`),
}));

const { sendOtpEmail } = require('../services/emailService');
const { sendOtpSms } = require('../services/sms');

const GENERIC_ACCOUNT_DISCOVERY_MESSAGE = 'If an account exists, verification instructions have been sent.';
const GENERIC_ACCOUNT_RESPONSE_MESSAGE = 'If the account details are valid, we will continue with verification steps.';

describe('OTP API Routes Integration', () => {
    let originalEnv;

    beforeAll(() => {
        originalEnv = { ...process.env };
        process.env.OTP_FLOW_SECRET = 'test-secret';
        process.env.OTP_CHALLENGE_SECRET = 'test-challenge-secret';
        process.env.OTP_EMAIL_SEND_IN_TEST = 'true';
        process.env.OTP_SMS_SEND_IN_TEST = 'true';
    });

    afterAll(async () => {
        process.env = originalEnv;
        await mongoose.connection.close();
    });

    beforeEach(async () => {
        jest.clearAllMocks();
        await User.deleteMany({});
    });

    const uniqueUser = (prefix = 'user') => {
        const stamp = Date.now() + Math.floor(Math.random() * 1000);
        return {
            name: 'Test User',
            email: `${prefix}_${stamp}@test.com`,
            phone: `+91${String(stamp).slice(-10)}`,
        };
    };

    describe('POST /api/otp/send', () => {
        test('should return 400 for missing email', async () => {
            const res = await request(app).post('/api/otp/send')
                .send({ phone: '9999911111', purpose: 'signup' });
            expect(res.statusCode).toBe(400);
        });

        test('should return 200 with generic response for login (indistinguishable)', async () => {
            const u = uniqueUser();
            const res = await request(app).post('/api/otp/send')
                .send({ email: u.email, phone: u.phone, purpose: 'login' });
            expect(res.statusCode).toBe(200);
            expect(res.body.message).toBe(GENERIC_ACCOUNT_RESPONSE_MESSAGE);
        });

        test('should return 200 with dynamic message for signup', async () => {
            const u = uniqueUser();
            const res = await request(app).post('/api/otp/send')
                .send({ email: u.email, phone: u.phone, purpose: 'signup' });
            expect(res.statusCode).toBe(200);
            expect(res.body.message).toContain(u.email);
        });

        test('should return 503 if all delivery channels fail', async () => {
            sendOtpEmail.mockRejectedValue(new Error('SMTP Down'));
            sendOtpSms.mockRejectedValue(new Error('SMS Down'));
            
            const u = uniqueUser();
            const res = await request(app).post('/api/otp/send')
                .send({ email: u.email, phone: u.phone, purpose: 'signup' });
            
            expect(res.statusCode).toBe(503);
            const user = await User.findOne({ email: u.email });
            expect(user).toBeNull(); // State rolled back
        });
    });

    describe('POST /api/otp/verify', () => {
        test('should verify valid signup OTP', async () => {
            const u = uniqueUser();
            const otpPlain = '123456';
            const otpHash = await bcrypt.hash(otpPlain, 8);
            
            const user = await User.create({
                ...u,
                isVerified: false,
                otp: otpHash,
                otpExpiry: new Date(Date.now() + 100000),
                otpPurpose: 'signup'
            });

            const res = await request(app).post('/api/otp/verify')
                .send({ phone: u.phone, otp: otpPlain, purpose: 'signup' });
            
            expect(res.statusCode).toBe(200);
            expect(res.body.verified).toBe(true);
            
            const updated = await User.findById(user._id);
            expect(updated.isVerified).toBe(true);
        });

        test('should return 401 for incorrect OTP', async () => {
            const u = uniqueUser();
            const otpHash = await bcrypt.hash('123456', 8);
            await User.create({
                ...u,
                isVerified: false,
                otp: otpHash,
                otpExpiry: new Date(Date.now() + 100000),
                otpPurpose: 'signup'
            });

            const res = await request(app).post('/api/otp/verify')
                .send({ phone: u.phone, otp: '654321', purpose: 'signup' });
            expect(res.statusCode).toBe(401);
        });
    });

    describe('POST /api/otp/check-user', () => {
        test('should return generic discovery message for unknown phone', async () => {
            const res = await request(app).post('/api/otp/check-user')
                .send({ phone: '+918888877777' });
            expect(res.statusCode).toBe(200);
            expect(res.body.message).toBe(GENERIC_ACCOUNT_DISCOVERY_MESSAGE);
            expect(res.body.exists).toBeUndefined();
        });
    });
});
