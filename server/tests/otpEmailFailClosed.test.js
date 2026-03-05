const originalOtpFlags = {
    OTP_EMAIL_SEND_IN_TEST: process.env.OTP_EMAIL_SEND_IN_TEST,
    OTP_EMAIL_FAIL_CLOSED: process.env.OTP_EMAIL_FAIL_CLOSED,
    OTP_EMAIL_CONTEXT_ENABLED: process.env.OTP_EMAIL_CONTEXT_ENABLED,
    OTP_EMAIL_TTL_MINUTES: process.env.OTP_EMAIL_TTL_MINUTES,
};

process.env.OTP_EMAIL_SEND_IN_TEST = 'true';
process.env.OTP_EMAIL_FAIL_CLOSED = 'true';
process.env.OTP_EMAIL_CONTEXT_ENABLED = 'true';
process.env.OTP_EMAIL_TTL_MINUTES = '5';

jest.mock('../services/emailService', () => ({
    sendOtpEmail: jest.fn(),
}));

const request = require('supertest');
const app = require('../index');
const User = require('../models/User');
const { sendOtpEmail } = require('../services/emailService');

let counter = 0;
const stamp = Date.now();

const uniqueIdentity = () => {
    counter += 1;
    return {
        email: `otp_fail_closed_${stamp}_${counter}@test.com`,
        phone: `8${String(stamp).slice(-4)}${String(counter).padStart(5, '0')}`,
    };
};

jest.setTimeout(15000);

describe('OTP Email Fail-Closed', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterAll(() => {
        process.env.OTP_EMAIL_SEND_IN_TEST = originalOtpFlags.OTP_EMAIL_SEND_IN_TEST;
        process.env.OTP_EMAIL_FAIL_CLOSED = originalOtpFlags.OTP_EMAIL_FAIL_CLOSED;
        process.env.OTP_EMAIL_CONTEXT_ENABLED = originalOtpFlags.OTP_EMAIL_CONTEXT_ENABLED;
        process.env.OTP_EMAIL_TTL_MINUTES = originalOtpFlags.OTP_EMAIL_TTL_MINUTES;
    });

    test('returns 200 and persists OTP state when email send succeeds', async () => {
        const identity = uniqueIdentity();
        sendOtpEmail.mockResolvedValue({ provider: 'gmail', providerMessageId: 'msg_ok' });

        const res = await request(app)
            .post('/api/otp/send')
            .send({
                email: identity.email,
                phone: identity.phone,
                purpose: 'signup',
            });

        expect(res.statusCode).toBe(200);
        expect(sendOtpEmail).toHaveBeenCalledTimes(1);

        const saved = await User.findOne({ email: identity.email }).select('+otp +otpPurpose +otpExpiry');
        expect(saved).not.toBeNull();
        expect(saved.otp).toMatch(/^\$2[ab]\$/);
        expect(saved.otpPurpose).toBe('signup');
        expect(saved.otpExpiry).toBeTruthy();
    });

    test('returns 503 and cleans pending signup record when email send fails', async () => {
        const identity = uniqueIdentity();
        sendOtpEmail.mockRejectedValue(new Error('SMTP unavailable'));

        const res = await request(app)
            .post('/api/otp/send')
            .send({
                email: identity.email,
                phone: identity.phone,
                purpose: 'signup',
            });

        expect(res.statusCode).toBe(503);
        expect(sendOtpEmail).toHaveBeenCalledTimes(1);

        const pending = await User.findOne({ email: identity.email });
        expect(pending).toBeNull();
    });

    test('returns 503 and clears OTP fields for verified user when login email send fails', async () => {
        const identity = uniqueIdentity();
        await User.create({
            name: 'Verified User',
            email: identity.email,
            phone: identity.phone,
            isVerified: true,
        });

        sendOtpEmail.mockRejectedValue(new Error('SMTP timeout'));

        const res = await request(app)
            .post('/api/otp/send')
            .send({
                email: identity.email,
                phone: identity.phone,
                purpose: 'login',
            });

        expect(res.statusCode).toBe(503);
        expect(sendOtpEmail).toHaveBeenCalledTimes(1);

        const user = await User.findOne({ email: identity.email }).select('+otp +otpExpiry +otpPurpose +otpAttempts +otpLockedUntil');
        expect(user).not.toBeNull();
        expect(user.otp).toBeNull();
        expect(user.otpExpiry).toBeNull();
        expect(user.otpPurpose).toBeNull();
        expect(user.otpAttempts).toBe(0);
        expect(user.otpLockedUntil).toBeNull();
    });
});
