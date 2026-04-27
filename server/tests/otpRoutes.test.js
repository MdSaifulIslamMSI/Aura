const request = require('supertest');
const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const mockGetUserByEmail = jest.fn();
const mockUpdateUser = jest.fn();
const mockRevokeRefreshTokens = jest.fn();

// Mock services
jest.mock('../services/emailService', () => ({
    sendOtpEmail: jest.fn().mockResolvedValue({ provider: 'mock-email' }),
}));

jest.mock('../services/sms', () => ({
    sendOtpSms: jest.fn().mockResolvedValue({ channel: 'sms' }),
    normalizePhoneE164: jest.fn((phone) => phone.startsWith('+') ? phone : `+91${phone}`),
}));

jest.mock('../config/firebase', () => ({
    auth: () => ({
        getUserByEmail: mockGetUserByEmail,
        updateUser: mockUpdateUser,
        revokeRefreshTokens: mockRevokeRefreshTokens,
    }),
}));

const app = require('../index');
const User = require('../models/User');
const { issueOtpFlowToken } = require('../utils/otpFlowToken');
const { registerOtpFlowGrant } = require('../services/otpFlowGrantService');
const trustedDeviceChallengeService = require('../services/trustedDeviceChallengeService');
const { hashTrustedDeviceSessionToken } = trustedDeviceChallengeService;

const { sendOtpEmail } = require('../services/emailService');
const { sendOtpSms } = require('../services/sms');

const GENERIC_ACCOUNT_DISCOVERY_MESSAGE = 'If an account exists, verification instructions have been sent.';
const GENERIC_ACCOUNT_RESPONSE_MESSAGE = 'If the account details are valid, we will continue with verification steps.';
const buildRuntimeSecret = (label = 'test') => `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}-suite`;

describe('OTP API Routes Integration', () => {
    let originalEnv;

    beforeAll(() => {
        originalEnv = { ...process.env };
        process.env.OTP_FLOW_SECRET = buildRuntimeSecret('otp-flow');
        process.env.OTP_CHALLENGE_SECRET = buildRuntimeSecret('otp-challenge');
        process.env.OTP_EMAIL_SEND_IN_TEST = 'true';
        process.env.OTP_SMS_SEND_IN_TEST = 'true';
    });

    afterAll(async () => {
        process.env = originalEnv;
        await mongoose.connection.close();
    });

    beforeEach(async () => {
        jest.clearAllMocks();
        mockGetUserByEmail.mockResolvedValue({ uid: 'firebase-user-1' });
        mockUpdateUser.mockResolvedValue({ uid: 'firebase-user-1' });
        mockRevokeRefreshTokens.mockResolvedValue();
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

        test('should require international phone format when global login mode is enabled', async () => {
            const originalRequireInternationalPhoneFormat = process.env.AUTH_REQUIRE_INTERNATIONAL_PHONE_FORMAT;
            process.env.AUTH_REQUIRE_INTERNATIONAL_PHONE_FORMAT = 'true';

            try {
                const res = await request(app).post('/api/otp/send')
                    .send({ email: 'global-user@test.com', phone: '9999911111', purpose: 'signup' });

                expect(res.statusCode).toBe(400);
                expect(res.body.message).toContain('international phone format');
            } finally {
                if (originalRequireInternationalPhoneFormat === undefined) {
                    delete process.env.AUTH_REQUIRE_INTERNATIONAL_PHONE_FORMAT;
                } else {
                    process.env.AUTH_REQUIRE_INTERNATIONAL_PHONE_FORMAT = originalRequireInternationalPhoneFormat;
                }
            }
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

        test('should mark signup email OTP as verified without activating the account yet', async () => {
            const u = uniqueUser();
            const otpPlain = '123456';
            const otpHash = await bcrypt.hash(otpPlain, 8);
            const user = await User.create({
                ...u,
                isVerified: false,
                otp: otpHash,
                otpExpiry: new Date(Date.now() + 100000),
                otpPurpose: 'signup',
            });

            const res = await request(app).post('/api/otp/verify')
                .send({ phone: u.phone, otp: otpPlain, purpose: 'signup', email: u.email, factor: 'email' });

            expect(res.statusCode).toBe(200);
            expect(res.body.nextFactor).toBe('phone');

            const updated = await User.findById(user._id).select('+signupEmailOtpVerifiedAt');
            expect(updated.isVerified).toBe(false);
            expect(updated.signupEmailOtpVerifiedAt).toBeTruthy();
        });

        test('should mark forgot-password email OTP as verified before Firebase phone completion', async () => {
            const u = uniqueUser();
            const otpPlain = '123456';
            const otpHash = await bcrypt.hash(otpPlain, 8);
            const user = await User.create({
                ...u,
                isVerified: true,
                otp: otpHash,
                otpExpiry: new Date(Date.now() + 100000),
                otpPurpose: 'forgot-password',
            });

            const res = await request(app).post('/api/otp/verify')
                .send({ phone: u.phone, otp: otpPlain, purpose: 'forgot-password', email: u.email, factor: 'email' });

            expect(res.statusCode).toBe(200);
            expect(res.body.nextFactor).toBe('phone');

            const updated = await User.findById(user._id).select('+resetEmailOtpVerifiedAt +resetOtpVerifiedAt');
            expect(updated.resetEmailOtpVerifiedAt).toBeTruthy();
            expect(updated.resetOtpVerifiedAt).toBeNull();
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

    describe('POST /api/otp/reset-password', () => {
        test('should update Firebase password after a recent forgot-password OTP verification', async () => {
            const u = uniqueUser();
            const user = await User.create({
                ...u,
                isVerified: true,
                resetOtpVerifiedAt: new Date(),
            });
            const { flowToken, flowTokenExpiresAt, tokenState } = issueOtpFlowToken({
                userId: user._id,
                purpose: 'forgot-password',
                factor: 'otp',
                signalBond: {
                    deviceId: 'device-reset-123',
                },
            });
            await registerOtpFlowGrant({
                tokenId: tokenState.tokenId,
                userId: user._id,
                purpose: 'forgot-password',
                factor: 'otp',
                currentStep: 'otp-verified',
                nextStep: tokenState.nextStep,
                expiresAt: flowTokenExpiresAt,
            });

            const res = await request(app).post('/api/otp/reset-password')
                .set('X-Aura-Device-Id', 'device-reset-123')
                .send({
                    flowToken,
                    password: 'Orbital!59Qa',
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.message).toContain('Password reset successful');
            expect(mockGetUserByEmail).toHaveBeenCalledWith(u.email);
            expect(mockUpdateUser).toHaveBeenCalledWith('firebase-user-1', {
                password: 'Orbital!59Qa',
            });
            expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('firebase-user-1');

            const updated = await User.findById(user._id).select('+resetOtpVerifiedAt');
            expect(updated.resetOtpVerifiedAt).toBeNull();
        });

        test('should accept a scoped recovery-code flow token for password reset', async () => {
            const u = uniqueUser();
            const user = await User.create({
                ...u,
                isVerified: true,
                resetOtpVerifiedAt: new Date(),
            });
            const { flowToken, flowTokenExpiresAt, tokenState } = issueOtpFlowToken({
                userId: user._id,
                purpose: 'forgot-password',
                factor: 'recovery-code',
            });
            await registerOtpFlowGrant({
                tokenId: tokenState.tokenId,
                userId: user._id,
                purpose: 'forgot-password',
                factor: 'recovery-code',
                currentStep: 'recovery-code-verified',
                nextStep: tokenState.nextStep,
                expiresAt: flowTokenExpiresAt,
            });

            const res = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: 'Orbital!59Qa',
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.message).toContain('Password reset successful');
            expect(mockGetUserByEmail).toHaveBeenCalledWith(u.email);
            expect(mockUpdateUser).toHaveBeenCalledWith('firebase-user-1', {
                password: 'Orbital!59Qa',
            });
        });

        test('should reject password reset when the recovery token is replayed from a different device', async () => {
            const u = uniqueUser();
            const user = await User.create({
                ...u,
                isVerified: true,
                resetOtpVerifiedAt: new Date(),
            });
            const { flowToken, flowTokenExpiresAt, tokenState } = issueOtpFlowToken({
                userId: user._id,
                purpose: 'forgot-password',
                factor: 'otp',
                signalBond: {
                    deviceId: 'device-reset-123',
                },
            });
            await registerOtpFlowGrant({
                tokenId: tokenState.tokenId,
                userId: user._id,
                purpose: 'forgot-password',
                factor: 'otp',
                currentStep: 'otp-verified',
                nextStep: tokenState.nextStep,
                expiresAt: flowTokenExpiresAt,
            });

            const res = await request(app).post('/api/otp/reset-password')
                .set('X-Aura-Device-Id', 'device-other-456')
                .send({
                    flowToken,
                    password: 'Orbital!59Qa',
                });

            expect(res.statusCode).toBe(403);
            expect(res.body.message).toContain('device bond mismatch');
            expect(mockUpdateUser).not.toHaveBeenCalled();
        });

        test('should reject password reset when the verified recovery session is missing', async () => {
            const u = uniqueUser();
            const user = await User.create({
                ...u,
                isVerified: true,
                resetOtpVerifiedAt: null,
            });
            const { flowToken, flowTokenExpiresAt, tokenState } = issueOtpFlowToken({
                userId: user._id,
                purpose: 'forgot-password',
                factor: 'otp',
            });
            await registerOtpFlowGrant({
                tokenId: tokenState.tokenId,
                userId: user._id,
                purpose: 'forgot-password',
                factor: 'otp',
                currentStep: 'otp-verified',
                nextStep: tokenState.nextStep,
                expiresAt: flowTokenExpiresAt,
            });

            const res = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: 'Orbital!59Qa',
                });

            expect(res.statusCode).toBe(403);
            expect(res.body.message).toContain('Password reset verification is required');
            expect(mockUpdateUser).not.toHaveBeenCalled();
        });

        test('should reject password reset when the flow token only represents the email factor', async () => {
            const u = uniqueUser();
            const user = await User.create({
                ...u,
                isVerified: true,
                resetOtpVerifiedAt: new Date(),
            });
            const { flowToken, flowTokenExpiresAt, tokenState } = issueOtpFlowToken({
                userId: user._id,
                purpose: 'forgot-password',
                factor: 'email',
            });
            await registerOtpFlowGrant({
                tokenId: tokenState.tokenId,
                userId: user._id,
                purpose: 'forgot-password',
                factor: 'email',
                currentStep: 'email-verified',
                nextStep: tokenState.nextStep,
                expiresAt: flowTokenExpiresAt,
            });

            const res = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: 'Orbital!59Qa',
                });

            expect(res.statusCode).toBe(403);
            expect(res.body.message).toContain('factor mismatch');
            expect(mockUpdateUser).not.toHaveBeenCalled();
        });

        test('should reject predictable new passwords even after OTP verification', async () => {
            const u = uniqueUser();
            const user = await User.create({
                ...u,
                isVerified: true,
                resetOtpVerifiedAt: new Date(),
            });
            const { flowToken, flowTokenExpiresAt, tokenState } = issueOtpFlowToken({
                userId: user._id,
                purpose: 'forgot-password',
                factor: 'otp',
            });
            await registerOtpFlowGrant({
                tokenId: tokenState.tokenId,
                userId: user._id,
                purpose: 'forgot-password',
                factor: 'otp',
                currentStep: 'otp-verified',
                nextStep: tokenState.nextStep,
                expiresAt: flowTokenExpiresAt,
            });

            const res = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: 'Secure1234!Aa',
                });

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toContain('sequential characters');
            expect(mockUpdateUser).not.toHaveBeenCalled();
        });

        test('should reject a replayed recovery token even from the same device after one successful reset', async () => {
            const u = uniqueUser();
            const user = await User.create({
                ...u,
                isVerified: true,
                resetOtpVerifiedAt: new Date(),
            });
            const { flowToken, flowTokenExpiresAt, tokenState } = issueOtpFlowToken({
                userId: user._id,
                purpose: 'forgot-password',
                factor: 'otp',
                signalBond: {
                    deviceId: 'device-reset-123',
                },
            });
            await registerOtpFlowGrant({
                tokenId: tokenState.tokenId,
                userId: user._id,
                purpose: 'forgot-password',
                factor: 'otp',
                currentStep: 'otp-verified',
                nextStep: tokenState.nextStep,
                expiresAt: flowTokenExpiresAt,
            });

            const firstRes = await request(app).post('/api/otp/reset-password')
                .set('X-Aura-Device-Id', 'device-reset-123')
                .send({
                    flowToken,
                    password: 'Orbital!59Qa',
                });

            expect(firstRes.statusCode).toBe(200);

            await User.updateOne(
                { _id: user._id },
                { $set: { resetOtpVerifiedAt: new Date() } }
            );

            const replayRes = await request(app).post('/api/otp/reset-password')
                .set('X-Aura-Device-Id', 'device-reset-123')
                .send({
                    flowToken,
                    password: 'Orbital!59Qa',
                });

            expect(replayRes.statusCode).toBe(409);
            expect(replayRes.body.message).toContain('already used');
            expect(mockUpdateUser).toHaveBeenCalledTimes(1);
        });

        test('should keep recovery blocked when the trusted device is only browser-key registered', async () => {
            const u = uniqueUser();
            const { publicKey } = crypto.generateKeyPairSync('rsa', {
                modulusLength: 2048,
                publicKeyEncoding: { format: 'der', type: 'spki' },
                privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
            });
            const publicKeySpkiBase64 = Buffer.from(publicKey).toString('base64');
            const user = await User.create({
                ...u,
                isVerified: true,
                resetOtpVerifiedAt: new Date(),
                trustedDevices: [{
                    deviceId: 'device-reset-123',
                    label: 'Trusted Browser',
                    method: 'browser_key',
                    algorithm: 'RSA-PSS-SHA256',
                    publicKeySpkiBase64,
                    createdAt: new Date(),
                    lastSeenAt: new Date(),
                    lastVerifiedAt: new Date(),
                }],
            });
            const trustedDeviceSessionToken = trustedDeviceChallengeService.issueTrustedDeviceSession({
                user,
                deviceId: 'device-reset-123',
            }).deviceSessionToken;
            const { flowToken, flowTokenExpiresAt, tokenState } = issueOtpFlowToken({
                userId: user._id,
                purpose: 'forgot-password',
                factor: 'otp',
                signalBond: {
                    deviceId: 'device-reset-123',
                    deviceSessionHash: hashTrustedDeviceSessionToken(trustedDeviceSessionToken),
                },
            });
            await registerOtpFlowGrant({
                tokenId: tokenState.tokenId,
                userId: user._id,
                purpose: 'forgot-password',
                factor: 'otp',
                currentStep: 'otp-verified',
                nextStep: tokenState.nextStep,
                expiresAt: flowTokenExpiresAt,
            });

            const spoofedRes = await request(app).post('/api/otp/reset-password')
                .set('X-Aura-Device-Id', 'device-reset-123')
                .send({
                    flowToken,
                    password: 'Orbital!59Qa',
                });

            expect(spoofedRes.statusCode).toBe(403);
            expect(spoofedRes.body.message).toContain('Fresh trusted device verification is required');
            expect(mockUpdateUser).not.toHaveBeenCalled();

            const bootstrapChallenge = await trustedDeviceChallengeService.issueTrustedDeviceBootstrapChallenge({
                req: {
                    headers: {
                        'x-aura-device-id': 'device-reset-123',
                        'x-aura-device-label': 'Trusted Browser',
                        'x-aura-device-session': trustedDeviceSessionToken,
                    },
                },
                user,
                scope: 'reset-password',
            });
            expect(bootstrapChallenge).toBeNull();

            const stillBlockedRes = await request(app).post('/api/otp/reset-password')
                .set('X-Aura-Device-Id', 'device-reset-123')
                .set('X-Aura-Device-Session', trustedDeviceSessionToken)
                .send({
                    flowToken,
                    password: 'Orbital!59Qa',
                });

            expect(stillBlockedRes.statusCode).toBe(403);
            expect(stillBlockedRes.body.message).toContain('Fresh trusted device verification is required');
            expect(mockUpdateUser).not.toHaveBeenCalled();
        });
    });
});
