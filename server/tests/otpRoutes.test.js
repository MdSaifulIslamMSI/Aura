<<<<<<< ours
const originalOtpFlags = {
    OTP_EMAIL_SEND_IN_TEST: process.env.OTP_EMAIL_SEND_IN_TEST,
    OTP_EMAIL_FAIL_CLOSED: process.env.OTP_EMAIL_FAIL_CLOSED,
    OTP_SMS_SEND_IN_TEST: process.env.OTP_SMS_SEND_IN_TEST,
    OTP_SMS_FAIL_CLOSED: process.env.OTP_SMS_FAIL_CLOSED,
    OTP_ALLOW_FAIL_OPEN_WITHOUT_DELIVERY: process.env.OTP_ALLOW_FAIL_OPEN_WITHOUT_DELIVERY,
};

process.env.OTP_EMAIL_SEND_IN_TEST = 'true';
process.env.OTP_SMS_SEND_IN_TEST = 'true';
process.env.OTP_EMAIL_FAIL_CLOSED = 'false';
process.env.OTP_SMS_FAIL_CLOSED = 'false';
process.env.OTP_ALLOW_FAIL_OPEN_WITHOUT_DELIVERY = 'false';

=======
>>>>>>> theirs
jest.mock('../services/emailService', () => ({
    sendOtpEmail: jest.fn(),
}));

jest.mock('../services/sms', () => ({
    sendOtpSms: jest.fn(),
<<<<<<< ours
    normalizePhoneE164: jest.fn((phone) => phone.startsWith('+') ? phone : `+${phone}`),
=======
    normalizePhoneE164: jest.fn((value) => value),
>>>>>>> theirs
}));

const request = require('supertest');
<<<<<<< ours
<<<<<<< ours
const bcrypt = require('bcryptjs');
=======

jest.mock('../services/emailService', () => ({
    sendOtpEmail: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/sms', () => ({
    sendOtpSms: jest.fn().mockResolvedValue({ channel: 'sms' }),
    normalizePhoneE164: jest.fn((phone) => phone),
}));

>>>>>>> theirs
const app = require('../index');
const User = require('../models/User');
<<<<<<< ours
=======
const bcrypt = require('bcryptjs');
const app = require('../index');
const User = require('../models/User');
<<<<<<< ours
const OtpSession = require('../models/OtpSession');
>>>>>>> theirs

jest.setTimeout(15000);

const SALT = 8;
let sequence = 0;
const uniqueUser = () => {
    sequence += 1;
    return {
        email: `otp_routes_${Date.now()}_${sequence}@test.com`,
        phone: `8${String(Date.now()).slice(-4)}${String(sequence).padStart(5, '0')}`,
=======
=======
>>>>>>> theirs
const { sendOtpEmail } = require('../services/emailService');
const { sendOtpSms } = require('../services/sms');

jest.setTimeout(15000);

<<<<<<< ours
let counter = 0;
const stamp = Date.now();

const uniqueIdentity = () => {
    counter += 1;
    return {
        email: `otp_routes_${stamp}_${counter}@test.com`,
        phone: `8${String(stamp).slice(-4)}${String(counter).padStart(5, '0')}`,
>>>>>>> theirs
    };
=======
const originalOtpEnv = {
    OTP_EMAIL_SEND_IN_TEST: process.env.OTP_EMAIL_SEND_IN_TEST,
    OTP_EMAIL_FAIL_CLOSED: process.env.OTP_EMAIL_FAIL_CLOSED,
    OTP_SMS_SEND_IN_TEST: process.env.OTP_SMS_SEND_IN_TEST,
    OTP_SMS_FAIL_CLOSED: process.env.OTP_SMS_FAIL_CLOSED,
>>>>>>> theirs
};

describe('OTP API Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        sendOtpEmail.mockResolvedValue({ provider: 'mock-email' });
        sendOtpSms.mockResolvedValue({ channel: 'sms' });
    });

    afterAll(() => {
        process.env.OTP_EMAIL_SEND_IN_TEST = originalOtpFlags.OTP_EMAIL_SEND_IN_TEST;
        process.env.OTP_EMAIL_FAIL_CLOSED = originalOtpFlags.OTP_EMAIL_FAIL_CLOSED;
        process.env.OTP_SMS_SEND_IN_TEST = originalOtpFlags.OTP_SMS_SEND_IN_TEST;
        process.env.OTP_SMS_FAIL_CLOSED = originalOtpFlags.OTP_SMS_FAIL_CLOSED;
        process.env.OTP_ALLOW_FAIL_OPEN_WITHOUT_DELIVERY = originalOtpFlags.OTP_ALLOW_FAIL_OPEN_WITHOUT_DELIVERY;
    });

    describe('POST /api/otp/send', () => {
        test('should return 400 without email', async () => {
            const res = await request(app)
                .post('/api/otp/send')
                .send({ phone: '1234567890', purpose: 'signup' });
            expect(res.statusCode).toBe(400);
            expect(res.body.message).toContain('required');
        });

        test('should return 400 without phone', async () => {
            const res = await request(app)
                .post('/api/otp/send')
                .send({ email: 'test@test.com', purpose: 'signup' });
            expect(res.statusCode).toBe(400);
            expect(res.body.message).toContain('required');
        });

        test('should return 400 with invalid purpose', async () => {
            const res = await request(app)
                .post('/api/otp/send')
                .send({ email: 'test@test.com', phone: '1234567890', purpose: 'invalid' });
            expect(res.statusCode).toBe(400);
            expect(res.body.message).toContain('Invalid OTP purpose');
        });

<<<<<<< ours
<<<<<<< ours
        test('should return indistinguishable login responses for existing and non-existing accounts', async () => {
            const existingEmail = 'otp-existing@example.com';
            const existingPhone = '+15550001111';
            const unknownEmail = 'otp-unknown@example.com';
            const unknownPhone = '+15550002222';

            await User.deleteMany({
                email: { $in: [existingEmail, unknownEmail] },
            });

            await User.create({
                name: 'OTP Existing User',
                email: existingEmail,
                phone: existingPhone,
                isVerified: true,
            });

            const existingRes = await request(app)
                .post('/api/otp/send')
                .send({ email: existingEmail, phone: existingPhone, purpose: 'login' });

            const unknownRes = await request(app)
                .post('/api/otp/send')
                .send({ email: unknownEmail, phone: unknownPhone, purpose: 'login' });

            expect(existingRes.statusCode).toBe(200);
            expect(unknownRes.statusCode).toBe(200);
            expect(existingRes.body).toEqual(unknownRes.body);
            expect(existingRes.body).toEqual({
                success: true,
                message: 'If the account details are valid, we will continue with verification steps.',
            });
        });

        test('should return indistinguishable forgot-password responses for mismatch and non-existing accounts', async () => {
            const knownEmail = 'otp-known@example.com';
            const knownPhone = '+15550003333';
            const mismatchPhone = '+15550004444';
            const unknownEmail = 'otp-unknown-two@example.com';
            const unknownPhone = '+15550005555';

            await User.deleteMany({
                email: { $in: [knownEmail, unknownEmail] },
            });

            await User.create({
                name: 'OTP Known User',
                email: knownEmail,
                phone: knownPhone,
                isVerified: true,
            });

            const mismatchRes = await request(app)
                .post('/api/otp/send')
                .send({ email: knownEmail, phone: mismatchPhone, purpose: 'forgot-password' });

            const unknownRes = await request(app)
                .post('/api/otp/send')
                .send({ email: unknownEmail, phone: unknownPhone, purpose: 'forgot-password' });

            expect(mismatchRes.statusCode).toBe(200);
            expect(unknownRes.statusCode).toBe(200);
            expect(mismatchRes.body).toEqual(unknownRes.body);
            expect(mismatchRes.body).toEqual({
                success: true,
                message: 'If the account details are valid, we will continue with verification steps.',
            });
=======
        test('returns 200 when only email delivery succeeds', async () => {
            const identity = uniqueIdentity();
            sendOtpSms.mockRejectedValue(new Error('sms down'));

            const res = await request(app)
                .post('/api/otp/send')
                .send({
                    email: identity.email,
                    phone: identity.phone,
                    purpose: 'signup',
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.message).toContain(identity.email);
            expect(sendOtpEmail).toHaveBeenCalledTimes(1);
            expect(sendOtpSms).toHaveBeenCalledTimes(1);
        });

        test('returns 200 when only sms delivery succeeds', async () => {
            const identity = uniqueIdentity();
            sendOtpEmail.mockRejectedValue(new Error('email down'));

            const res = await request(app)
                .post('/api/otp/send')
                .send({
                    email: identity.email,
                    phone: identity.phone,
                    purpose: 'signup',
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.message).toContain(identity.phone);
            expect(sendOtpEmail).toHaveBeenCalledTimes(1);
            expect(sendOtpSms).toHaveBeenCalledTimes(1);
        });

        test('returns 200 when both email and sms deliveries succeed', async () => {
            const identity = uniqueIdentity();

            const res = await request(app)
                .post('/api/otp/send')
                .send({
                    email: identity.email,
                    phone: identity.phone,
                    purpose: 'signup',
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.message).toContain(identity.email);
            expect(res.body.message).toContain(identity.phone);
            expect(sendOtpEmail).toHaveBeenCalledTimes(1);
            expect(sendOtpSms).toHaveBeenCalledTimes(1);
        });

        test('returns 503 and rolls back signup state when neither channel delivers', async () => {
            const identity = uniqueIdentity();
            sendOtpEmail.mockRejectedValue(new Error('email down'));
            sendOtpSms.mockRejectedValue(new Error('sms down'));
=======
        test('should return 503 and rollback OTP state when all delivery channels fail', async () => {
            process.env.OTP_EMAIL_SEND_IN_TEST = 'true';
            process.env.OTP_SMS_SEND_IN_TEST = 'true';
            process.env.OTP_EMAIL_FAIL_CLOSED = 'false';
            process.env.OTP_SMS_FAIL_CLOSED = 'false';

            const stamp = Date.now();
            const identity = {
                email: `otp_all_fail_${stamp}@test.com`,
                phone: `9${String(stamp).slice(-9)}`,
            };

            await User.create({
                name: 'Existing Verified User',
                email: identity.email,
                phone: identity.phone,
                isVerified: true,
            });

            sendOtpEmail.mockRejectedValue(new Error('SMTP unavailable'));
            sendOtpSms.mockRejectedValue(new Error('SMS unavailable'));
>>>>>>> theirs

            const res = await request(app)
                .post('/api/otp/send')
                .send({
                    email: identity.email,
                    phone: identity.phone,
<<<<<<< ours
                    purpose: 'signup',
                });

            expect(res.statusCode).toBe(503);
            expect(res.body.message).toContain('Unable to deliver verification code');
            expect(sendOtpEmail).toHaveBeenCalledTimes(1);
            expect(sendOtpSms).toHaveBeenCalledTimes(1);

            const pending = await User.findOne({ email: identity.email });
            expect(pending).toBeNull();
>>>>>>> theirs
=======
                    purpose: 'login',
                });

            expect(res.statusCode).toBe(503);
            expect(res.body.message).toBe('Unable to deliver verification code right now. Please try again shortly.');
            expect(sendOtpEmail).toHaveBeenCalledTimes(1);
            expect(sendOtpSms).toHaveBeenCalledTimes(1);

            const user = await User.findOne({ email: identity.email }).select('+otp +otpExpiry +otpPurpose +otpAttempts +otpLockedUntil');
            expect(user).not.toBeNull();
            expect(user.otp).toBeNull();
            expect(user.otpExpiry).toBeNull();
            expect(user.otpPurpose).toBeNull();
            expect(user.otpAttempts).toBe(0);
            expect(user.otpLockedUntil).toBeNull();
>>>>>>> theirs
        });
    });

    describe('POST /api/otp/verify', () => {
        test('should return 400 without required fields', async () => {
            const res = await request(app)
                .post('/api/otp/verify')
                .send({ phone: '1234567890' });
            expect(res.statusCode).toBe(400);
            expect(res.body.message).toContain('required');
        });

        test('should return 404 for non-existent phone', async () => {
            const res = await request(app)
                .post('/api/otp/verify')
                .send({ phone: '0000000000', otp: '123456', purpose: 'signup' });
            expect(res.statusCode).toBe(404);
        });

<<<<<<< ours
        test('rejects linked email mismatch', async () => {
            const primary = uniqueUser();
            const secondary = uniqueUser();
            const user = await User.create({
                name: 'Primary',
                email: primary.email,
                phone: primary.phone,
                isVerified: true,
                otp: await bcrypt.hash('123456', SALT),
                otpExpiry: new Date(Date.now() + 60000),
                otpPurpose: 'login',
            });
            await User.create({ name: 'Secondary', email: secondary.email, phone: secondary.phone, isVerified: true });

            const res = await request(app)
                .post('/api/otp/verify')
                .send({ phone: user.phone, otp: '123456', purpose: 'login', email: secondary.email });
            expect(res.statusCode).toBe(403);
        });

        test('payment-challenge verification does not set login/reset markers', async () => {
            const record = uniqueUser();
            const user = await User.create({
                name: 'Payment User',
                email: record.email,
                phone: record.phone,
                isVerified: true,
                otp: await bcrypt.hash('654321', SALT),
                otpExpiry: new Date(Date.now() + 60000),
                otpPurpose: 'payment-challenge',
=======

        test('should return minimal response and not expose sensitive user fields', async () => {
            const otpPlain = '123456';
            const otpHash = await bcrypt.hash(otpPlain, 8);
            const user = await User.create({
                name: 'Sensitive User',
                email: 'sensitive@example.com',
                phone: '+15555550123',
                isAdmin: true,
                isVerified: false,
                otp: otpHash,
                otpExpiry: new Date(Date.now() + 5 * 60 * 1000),
                otpPurpose: 'signup',
            });

            await OtpSession.create({
                user: user._id,
                purpose: 'signup',
                otpHash,
                expiresAt: new Date(Date.now() + 5 * 60 * 1000),
                attempts: 0,
>>>>>>> theirs
            });

            const res = await request(app)
                .post('/api/otp/verify')
<<<<<<< ours
                .send({ phone: user.phone, otp: '654321', purpose: 'payment-challenge', intentId: 'intent_route_01' });
            expect(res.statusCode).toBe(200);
            expect(res.body.challengeToken).toBeTruthy();

            const updated = await User.findById(user._id)
                .select('+loginOtpVerifiedAt +loginOtpAssuranceExpiresAt +resetOtpVerifiedAt');
            expect(updated.loginOtpVerifiedAt).toBeNull();
            expect(updated.loginOtpAssuranceExpiresAt).toBeNull();
            expect(updated.resetOtpVerifiedAt).toBeNull();
=======
                .send({ phone: user.phone, otp: otpPlain, purpose: 'signup' });

            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual(expect.objectContaining({
                success: true,
                verified: true,
                flowToken: expect.any(String),
                flowTokenExpiresAt: expect.any(String),
                maskedIdentifier: '***0123',
            }));

            expect(res.body.user).toBeUndefined();
            expect(res.body.isAdmin).toBeUndefined();
            expect(res.body.email).toBeUndefined();
            expect(res.body.phone).toBeUndefined();
            expect(res.body.name).toBeUndefined();
>>>>>>> theirs
        });
    });

    describe('POST /api/otp/check-user', () => {
        test('should return 400 without phone', async () => {
            const res = await request(app)
                .post('/api/otp/check-user')
                .send({});
            expect(res.statusCode).toBe(400);
        });

<<<<<<< ours
<<<<<<< ours
        test('should return generic success payload for unknown phone', async () => {
=======
        test('should return generic response for unknown phone', async () => {
>>>>>>> theirs
=======
        test('should return generic response for unknown phone', async () => {
>>>>>>> theirs
            const res = await request(app)
                .post('/api/otp/check-user')
                .send({ phone: '9999999999' });
            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({
                success: true,
<<<<<<< ours
<<<<<<< ours
                message: 'If the account details are valid, you can continue with verification.',
=======
                message: 'If the account details are valid, we will continue with verification steps.',
>>>>>>> theirs
            });
=======
                message: 'If an account exists, verification instructions have been sent.'
            });
            expect(res.body.exists).toBeUndefined();
            expect(res.body.email).toBeUndefined();
            expect(res.body.phone).toBeUndefined();
            expect(res.body.reason).toBeUndefined();
            expect(res.body.registeredPhoneSuffix).toBeUndefined();
        });
    });

    describe('POST /api/otp/send (uniform login/forgot-password responses)', () => {
        test('returns same generic response for missing login account and mismatch', async () => {
            const unknownRes = await request(app)
                .post('/api/otp/send')
                .send({ email: 'unknown@example.com', phone: '+15551234567', purpose: 'login' });

            const mismatchRes = await request(app)
                .post('/api/otp/send')
                .send({ email: 'another-unknown@example.com', phone: '+15557654321', purpose: 'forgot-password' });

            expect(unknownRes.statusCode).toBe(200);
            expect(mismatchRes.statusCode).toBe(200);
            expect(unknownRes.body).toEqual({
                success: true,
                message: 'If an account exists, verification instructions have been sent.'
            });
            expect(mismatchRes.body).toEqual(unknownRes.body);
>>>>>>> theirs
        });

        test('should not return raw identifiers in payload', async () => {
            const res = await request(app)
                .post('/api/otp/check-user')
                .send({ phone: '9999999999', email: 'user@example.com' });
            expect(res.statusCode).toBe(200);
            expect(res.body.phone).toBeUndefined();
            expect(JSON.stringify(res.body)).not.toContain('user@example.com');
        });
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterAll(() => {
        process.env.OTP_EMAIL_SEND_IN_TEST = originalOtpEnv.OTP_EMAIL_SEND_IN_TEST;
        process.env.OTP_EMAIL_FAIL_CLOSED = originalOtpEnv.OTP_EMAIL_FAIL_CLOSED;
        process.env.OTP_SMS_SEND_IN_TEST = originalOtpEnv.OTP_SMS_SEND_IN_TEST;
        process.env.OTP_SMS_FAIL_CLOSED = originalOtpEnv.OTP_SMS_FAIL_CLOSED;
    });
});
