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
const OtpSession = require('../models/OtpSession');
const OtpFlowGrant = require('../models/OtpFlowGrant');
const browserSessionService = require('../services/browserSessionService');
const logger = require('../utils/logger');
const { issueOtpFlowToken } = require('../utils/otpFlowToken');
const { registerOtpFlowGrant } = require('../services/otpFlowGrantService');
const { hashSecurityValue } = require('../security/redactSecurityMetadata');
const trustedDeviceChallengeService = require('../services/trustedDeviceChallengeService');
const { hashTrustedDeviceSessionToken } = trustedDeviceChallengeService;

const { sendOtpEmail } = require('../services/emailService');
const { sendOtpSms } = require('../services/sms');

const GENERIC_ACCOUNT_DISCOVERY_MESSAGE = 'If an account exists, verification instructions have been sent.';
const GENERIC_ACCOUNT_RESPONSE_MESSAGE = 'If the account details are valid, we will continue with verification steps.';
const GENERIC_OTP_VERIFICATION_MESSAGE = 'If account details are valid, verification will proceed.';
const buildRuntimeSecret = (label = 'test') => `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}-suite`;
const buildStrongPassword = () => String.fromCharCode(79, 114, 99, 104, 105, 100, 33, 56, 118, 82, 50, 80);
const buildPredictablePassword = () => String.fromCharCode(83, 101, 99, 117, 114, 101, 49, 50, 51, 52, 33, 65, 97);

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
        await OtpSession.deleteMany({});
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

        test('should return 200 with generic response for signup', async () => {
            const u = uniqueUser();
            const res = await request(app).post('/api/otp/send')
                .send({ email: u.email, phone: u.phone, purpose: 'signup' });
            expect(res.statusCode).toBe(200);
            expect(res.body.message).toBe(GENERIC_ACCOUNT_RESPONSE_MESSAGE);
        });

        test('should skip email delivery in tests unless explicitly enabled', async () => {
            const originalEmailSendInTest = process.env.OTP_EMAIL_SEND_IN_TEST;
            process.env.OTP_EMAIL_SEND_IN_TEST = 'false';
            const u = uniqueUser('email-disabled');

            try {
                const res = await request(app).post('/api/otp/send')
                    .send({ email: u.email, phone: u.phone, purpose: 'signup' });

                expect(res.statusCode).toBe(200);
                expect(sendOtpEmail).not.toHaveBeenCalled();
                expect(sendOtpSms).toHaveBeenCalledTimes(1);
            } finally {
                process.env.OTP_EMAIL_SEND_IN_TEST = originalEmailSendInTest;
            }
        });

        test('should throttle OTP send spam without delivering another code after the limit', async () => {
            const originalNodeEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'rate-limit-test';
            const u = uniqueUser('otp-spam');

            try {
                const responses = [];
                for (let index = 0; index < 4; index += 1) {
                    responses.push(await request(app).post('/api/otp/send')
                        .send({ email: u.email, phone: u.phone, purpose: 'signup' }));
                }

                expect(responses.slice(0, 3).map((res) => res.statusCode)).toEqual([200, 200, 200]);
                expect(responses[3].statusCode).toBe(429);
                expect(responses[3].body.message).toMatch(/too many otp requests/i);
                expect(sendOtpEmail).toHaveBeenCalledTimes(3);
                expect(sendOtpSms).toHaveBeenCalledTimes(3);

                const persistedSessions = await OtpSession.countDocuments({
                    identityKey: u.phone,
                    purpose: 'signup',
                });
                expect(persistedSessions).toBe(1);
            } finally {
                if (originalNodeEnv === undefined) {
                    delete process.env.NODE_ENV;
                } else {
                    process.env.NODE_ENV = originalNodeEnv;
                }
            }
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

        test('should mask login OTP verification for an unknown phone', async () => {
            const res = await request(app).post('/api/otp/verify')
                .send({ phone: '+918888877777', otp: '123456', purpose: 'login' });

            expect(res.statusCode).toBe(401);
            expect(res.body.message).toBe(GENERIC_OTP_VERIFICATION_MESSAGE);
        });

        test('should mask login OTP verification identity mismatch before OTP comparison', async () => {
            const u = uniqueUser();
            const otpHash = await bcrypt.hash('123456', 8);
            await User.create({
                ...u,
                isVerified: true,
                otp: otpHash,
                otpExpiry: new Date(Date.now() + 100000),
                otpPurpose: 'login',
            });

            const res = await request(app).post('/api/otp/verify')
                .send({
                    phone: u.phone,
                    email: 'other-user@test.com',
                    otp: '000000',
                    purpose: 'login',
                });

            expect(res.statusCode).toBe(401);
            expect(res.body.message).toBe(GENERIC_OTP_VERIFICATION_MESSAGE);
        });

        test('should mask legacy login OTP lockout state', async () => {
            const u = uniqueUser();
            await User.create({
                ...u,
                isVerified: true,
                otpLockedUntil: new Date(Date.now() + 15 * 60 * 1000),
            });

            const res = await request(app).post('/api/otp/verify')
                .send({
                    phone: u.phone,
                    otp: '000000',
                    purpose: 'login',
                });

            expect(res.statusCode).toBe(401);
            expect(res.body.message).toBe(GENERIC_OTP_VERIFICATION_MESSAGE);
        });

        test('should mask login OTP purpose mismatch from an existing session for another purpose', async () => {
            const u = uniqueUser();
            const user = await User.create({
                ...u,
                isVerified: true,
            });
            await OtpSession.create({
                identityKey: u.phone,
                user: user._id,
                purpose: 'forgot-password',
                otpHash: await bcrypt.hash('123456', 8),
                expiresAt: new Date(Date.now() + 100000),
            });

            const res = await request(app).post('/api/otp/verify')
                .send({
                    phone: u.phone,
                    otp: '000000',
                    purpose: 'login',
                });

            expect(res.statusCode).toBe(401);
            expect(res.body.message).toBe(GENERIC_OTP_VERIFICATION_MESSAGE);
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

        test('should return the same generic discovery message for a verified user', async () => {
            const u = uniqueUser();
            await User.create({
                ...u,
                isVerified: true,
            });

            const res = await request(app).post('/api/otp/check-user')
                .send({ phone: u.phone, email: u.email });

            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({
                success: true,
                message: GENERIC_ACCOUNT_DISCOVERY_MESSAGE,
            });
        });

        test('should return the same generic discovery message for an email phone mismatch', async () => {
            const u = uniqueUser();
            await User.create({
                ...u,
                isVerified: true,
            });

            const res = await request(app).post('/api/otp/check-user')
                .send({ phone: u.phone, email: 'other-user@test.com' });

            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({
                success: true,
                message: GENERIC_ACCOUNT_DISCOVERY_MESSAGE,
            });
        });
    });

    describe('POST /api/otp/reset-password', () => {
        test('should not let one reset flow exhaust reset-password attempts for another flow on the same network', async () => {
            const originalNodeEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'rate-limit-test';

            try {
                const responses = [];
                for (let index = 0; index < 6; index += 1) {
                    responses.push(await request(app).post('/api/otp/reset-password')
                        .set('User-Agent', 'otp-reset-rate-limit-test')
                        .set('X-Forwarded-For', '198.51.100.101')
                        .set('X-Client-Session-Id', 'otp-reset-cross-flow-test')
                        .send({
                            flowToken: `not-a-valid-reset-flow-token-${index}`,
                            password: buildStrongPassword(),
                        }));
                }

                expect(responses.map((res) => res.statusCode))
                    .toEqual(Array.from({ length: responses.length }, () => 401));
                expect(mockGetUserByEmail).not.toHaveBeenCalled();
                expect(mockUpdateUser).not.toHaveBeenCalled();
                expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
            } finally {
                if (originalNodeEnv === undefined) {
                    delete process.env.NODE_ENV;
                } else {
                    process.env.NODE_ENV = originalNodeEnv;
                }
            }
        });

        test('should throttle password reset spam without updating password or revoking sessions', async () => {
            const originalNodeEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'rate-limit-test';
            const replayedFlowToken = 'not-a-valid-reset-flow-token-replay';

            try {
                const responses = [];
                for (let index = 0; index < 6; index += 1) {
                    responses.push(await request(app).post('/api/otp/reset-password')
                        .set('User-Agent', 'otp-reset-rate-limit-test')
                        .set('X-Forwarded-For', '198.51.100.102')
                        .set('X-Client-Session-Id', 'otp-reset-same-flow-test')
                        .send({
                            flowToken: replayedFlowToken,
                            password: buildStrongPassword(),
                        }));
                }

                const blockedIndex = responses.findIndex((res) => res.statusCode === 429);
                expect(blockedIndex).toBeGreaterThan(0);
                expect(responses.slice(0, blockedIndex).map((res) => res.statusCode))
                    .toEqual(Array.from({ length: blockedIndex }, () => 401));
                expect(responses[blockedIndex].body.message).toMatch(/too many (password reset attempts|requests)/i);
                expect(mockGetUserByEmail).not.toHaveBeenCalled();
                expect(mockUpdateUser).not.toHaveBeenCalled();
                expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
            } finally {
                if (originalNodeEnv === undefined) {
                    delete process.env.NODE_ENV;
                } else {
                    process.env.NODE_ENV = originalNodeEnv;
                }
            }
        });

        test('should update Firebase password after a recent forgot-password OTP verification', async () => {
            const u = uniqueUser();
            const user = await User.create({
                ...u,
                isVerified: true,
                resetOtpVerifiedAt: new Date(),
            });
            const existingBrowserSession = await browserSessionService.createBrowserSession({
                req: {
                    headers: {
                        host: 'localhost:5173',
                    },
                    secure: false,
                },
                user,
                authUid: 'firebase-user-1',
                authToken: {
                    email: u.email,
                    email_verified: true,
                    name: u.name,
                    phone_number: u.phone,
                    auth_time: Math.floor(Date.now() / 1000) - 60,
                    iat: Math.floor(Date.now() / 1000) - 60,
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    firebase: {
                        sign_in_provider: 'password',
                    },
                },
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

            const nextPassword = buildStrongPassword();
            const res = await request(app).post('/api/otp/reset-password')
                .set('X-Aura-Device-Id', 'device-reset-123')
                .send({
                    flowToken,
                    password: nextPassword,
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.message).toContain('Password reset successful');
            expect(mockGetUserByEmail).toHaveBeenCalledWith(u.email);
            expect(mockUpdateUser).toHaveBeenCalledWith('firebase-user-1', {
                password: nextPassword,
            });
            expect(mockRevokeRefreshTokens).toHaveBeenCalledWith('firebase-user-1');

            const updated = await User.findById(user._id).select('+resetOtpVerifiedAt');
            expect(updated.resetOtpVerifiedAt).toBeNull();
            await expect(browserSessionService.getBrowserSession(existingBrowserSession.sessionId)).resolves.toBeNull();
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

            const nextPassword = buildStrongPassword();
            const res = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: nextPassword,
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.message).toContain('Password reset successful');
            expect(mockGetUserByEmail).toHaveBeenCalledWith(u.email);
            expect(mockUpdateUser).toHaveBeenCalledWith('firebase-user-1', {
                password: nextPassword,
            });
        });

        test('should reject a wrong-purpose grant without changing password or revoking sessions', async () => {
            const u = uniqueUser();
            const user = await User.create({
                ...u,
                isVerified: true,
                resetOtpVerifiedAt: new Date(),
            });
            const existingBrowserSession = await browserSessionService.createBrowserSession({
                req: {
                    headers: {
                        host: 'localhost:5173',
                    },
                    secure: false,
                },
                user,
                authUid: 'firebase-user-1',
                authToken: {
                    email: u.email,
                    email_verified: true,
                    name: u.name,
                    phone_number: u.phone,
                    auth_time: Math.floor(Date.now() / 1000) - 60,
                    iat: Math.floor(Date.now() / 1000) - 60,
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    firebase: {
                        sign_in_provider: 'password',
                    },
                },
            });
            const { flowToken, flowTokenExpiresAt, tokenState } = issueOtpFlowToken({
                userId: user._id,
                purpose: 'login',
                factor: 'otp',
            });
            await registerOtpFlowGrant({
                tokenId: tokenState.tokenId,
                userId: user._id,
                purpose: 'login',
                factor: 'otp',
                currentStep: 'otp-verified',
                nextStep: tokenState.nextStep,
                expiresAt: flowTokenExpiresAt,
            });

            const res = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: buildStrongPassword(),
                });

            expect(res.statusCode).toBe(403);
            expect(res.body.message).toContain('purpose mismatch');
            expect(mockUpdateUser).not.toHaveBeenCalled();
            expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
            await expect(browserSessionService.getBrowserSession(existingBrowserSession.sessionId))
                .resolves.not.toBeNull();
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

            const nextPassword = buildStrongPassword();
            const res = await request(app).post('/api/otp/reset-password')
                .set('X-Aura-Device-Id', 'device-other-456')
                .send({
                    flowToken,
                    password: nextPassword,
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

            const nextPassword = buildStrongPassword();
            const res = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: nextPassword,
                });

            expect(res.statusCode).toBe(403);
            expect(res.body.message).toContain('Password reset verification is required');
            expect(mockUpdateUser).not.toHaveBeenCalled();
        });

        test('should reject stale reset verification without changing password or revoking sessions', async () => {
            const u = uniqueUser();
            const staleVerifiedAt = new Date(Date.now() - (16 * 60 * 1000));
            const user = await User.create({
                ...u,
                isVerified: true,
                resetOtpVerifiedAt: staleVerifiedAt,
            });
            const existingBrowserSession = await browserSessionService.createBrowserSession({
                req: {
                    headers: {
                        host: 'localhost:5173',
                    },
                    secure: false,
                },
                user,
                authUid: 'firebase-user-1',
                authToken: {
                    email: u.email,
                    email_verified: true,
                    name: u.name,
                    phone_number: u.phone,
                    auth_time: Math.floor(Date.now() / 1000) - 60,
                    iat: Math.floor(Date.now() / 1000) - 60,
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    firebase: {
                        sign_in_provider: 'password',
                    },
                },
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
                    password: buildStrongPassword(),
                });

            expect(res.statusCode).toBe(403);
            expect(res.body.message).toContain('expired');
            expect(mockUpdateUser).not.toHaveBeenCalled();
            expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
            const updated = await User.findById(user._id).select('+resetOtpVerifiedAt');
            expect(updated.resetOtpVerifiedAt).toBeNull();
            await expect(browserSessionService.getBrowserSession(existingBrowserSession.sessionId))
                .resolves.not.toBeNull();
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

            const nextPassword = buildStrongPassword();
            const res = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: nextPassword,
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

            const predictablePassword = buildPredictablePassword();
            const res = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: predictablePassword,
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

            const nextPassword = buildStrongPassword();
            const firstRes = await request(app).post('/api/otp/reset-password')
                .set('X-Aura-Device-Id', 'device-reset-123')
                .send({
                    flowToken,
                    password: nextPassword,
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
                    password: nextPassword,
                });

            expect(replayRes.statusCode).toBe(409);
            expect(replayRes.body.message).toContain('already used');
            expect(mockUpdateUser).toHaveBeenCalledTimes(1);
        });

        test('should not revoke sessions or refresh tokens when password update fails', async () => {
            const u = uniqueUser();
            const user = await User.create({
                ...u,
                isVerified: true,
                resetOtpVerifiedAt: new Date(),
            });
            const existingBrowserSession = await browserSessionService.createBrowserSession({
                req: {
                    headers: {
                        host: 'localhost:5173',
                    },
                    secure: false,
                },
                user,
                authUid: 'firebase-user-1',
                authToken: {
                    email: u.email,
                    email_verified: true,
                    name: u.name,
                    phone_number: u.phone,
                    auth_time: Math.floor(Date.now() / 1000) - 60,
                    iat: Math.floor(Date.now() / 1000) - 60,
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    firebase: {
                        sign_in_provider: 'password',
                    },
                },
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
            mockUpdateUser.mockRejectedValueOnce(new Error('firebase password update failed'));

            const res = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: buildStrongPassword(),
                });

            expect(res.statusCode).toBe(503);
            expect(res.body.code).toBe('OTP_RESET_FIREBASE_UPDATE_FAILED');
            expect(mockUpdateUser).toHaveBeenCalledTimes(1);
            expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
            await expect(browserSessionService.getBrowserSession(existingBrowserSession.sessionId))
                .resolves.not.toBeNull();
        });

        test('should allow retry after a transient password update failure without unsafe side effects', async () => {
            const u = uniqueUser();
            const user = await User.create({
                ...u,
                isVerified: true,
                resetOtpVerifiedAt: new Date(),
            });
            const existingBrowserSession = await browserSessionService.createBrowserSession({
                req: {
                    headers: {
                        host: 'localhost:5173',
                    },
                    secure: false,
                },
                user,
                authUid: 'firebase-user-1',
                authToken: {
                    email: u.email,
                    email_verified: true,
                    name: u.name,
                    phone_number: u.phone,
                    auth_time: Math.floor(Date.now() / 1000) - 60,
                    iat: Math.floor(Date.now() / 1000) - 60,
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    firebase: {
                        sign_in_provider: 'password',
                    },
                },
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

            mockUpdateUser.mockRejectedValueOnce(new Error('firebase password update failed'));
            const nextPassword = buildStrongPassword();

            const failedRes = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: nextPassword,
                });

            expect(failedRes.statusCode).toBe(503);
            expect(failedRes.body.code).toBe('OTP_RESET_FIREBASE_UPDATE_FAILED');
            expect(mockUpdateUser).toHaveBeenCalledTimes(1);
            expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
            await expect(browserSessionService.getBrowserSession(existingBrowserSession.sessionId))
                .resolves.not.toBeNull();

            const retryRes = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: nextPassword,
                });

            expect(retryRes.statusCode).toBe(200);
            expect(mockUpdateUser).toHaveBeenCalledTimes(2);
            expect(mockRevokeRefreshTokens).toHaveBeenCalledTimes(1);
            await expect(browserSessionService.getBrowserSession(existingBrowserSession.sessionId))
                .resolves.toBeNull();

            await User.updateOne(
                { _id: user._id },
                { $set: { resetOtpVerifiedAt: new Date() } }
            );

            const replayRes = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: nextPassword,
                });

            expect(replayRes.statusCode).toBe(409);
            expect(mockUpdateUser).toHaveBeenCalledTimes(2);
        });

        test('should not report password reset failure after password update succeeds but Firebase session revocation fails', async () => {
            const u = uniqueUser();
            const user = await User.create({
                ...u,
                isVerified: true,
                resetOtpVerifiedAt: new Date(),
            });
            const existingBrowserSession = await browserSessionService.createBrowserSession({
                req: {
                    headers: {
                        host: 'localhost:5173',
                    },
                    secure: false,
                },
                user,
                authUid: 'firebase-user-1',
                authToken: {
                    email: u.email,
                    email_verified: true,
                    name: u.name,
                    phone_number: u.phone,
                    auth_time: Math.floor(Date.now() / 1000) - 60,
                    iat: Math.floor(Date.now() / 1000) - 60,
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    firebase: {
                        sign_in_provider: 'password',
                    },
                },
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

            mockRevokeRefreshTokens.mockRejectedValueOnce(new Error('firebase token revocation failed'));
            const nextPassword = buildStrongPassword();

            const res = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: nextPassword,
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.sessionCleanupPending).toBe(true);
            expect(mockUpdateUser).toHaveBeenCalledTimes(1);
            expect(mockRevokeRefreshTokens).toHaveBeenCalledTimes(1);
            await expect(browserSessionService.getBrowserSession(existingBrowserSession.sessionId))
                .resolves.toBeNull();

            const updatedUser = await User.findById(user._id).lean();
            expect(updatedUser.authTokensRevokedAfter).toBeTruthy();
            expect(new Date(updatedUser.authTokensRevokedAfter).getTime()).toBeGreaterThanOrEqual(user.createdAt.getTime());

            const grant = await OtpFlowGrant.findOne({ tokenId: tokenState.tokenId });
            expect(grant.state).toBe('consumed');

            const replayRes = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: nextPassword,
                });

            expect([403, 409]).toContain(replayRes.statusCode);
            expect(mockUpdateUser).toHaveBeenCalledTimes(1);
        });

        test('should continue reset cleanup when targeted browser session revocation fails', async () => {
            const u = uniqueUser();
            const user = await User.create({
                ...u,
                isVerified: true,
                resetOtpVerifiedAt: new Date(),
            });
            const existingBrowserSession = await browserSessionService.createBrowserSession({
                req: {
                    headers: {
                        host: 'localhost:5173',
                    },
                    secure: false,
                },
                user,
                authUid: 'firebase-user-1',
                authToken: {
                    email: u.email,
                    email_verified: true,
                    name: u.name,
                    phone_number: u.phone,
                    auth_time: Math.floor(Date.now() / 1000) - 60,
                    iat: Math.floor(Date.now() / 1000) - 60,
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    firebase: {
                        sign_in_provider: 'password',
                    },
                },
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

            const revokeUserSpy = jest
                .spyOn(browserSessionService, 'revokeBrowserSessionsForUser')
                .mockRejectedValueOnce(Object.assign(new Error('targeted revoke failed'), {
                    code: 'AUTH_SESSION_STORE_UNAVAILABLE',
                }));
            const revokeAllSpy = jest.spyOn(browserSessionService, 'revokeAllBrowserSessions');
            const nextPassword = buildStrongPassword();
            let res;
            let revokeAllCallCount = 0;

            try {
                res = await request(app).post('/api/otp/reset-password')
                    .send({
                        flowToken,
                        password: nextPassword,
                    });
            } finally {
                revokeAllCallCount = revokeAllSpy.mock.calls.length;
                revokeUserSpy.mockRestore();
                revokeAllSpy.mockRestore();
            }

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.sessionCleanupPending).toBe(true);
            expect(mockUpdateUser).toHaveBeenCalledTimes(1);
            expect(mockRevokeRefreshTokens).toHaveBeenCalledTimes(1);
            expect(revokeAllCallCount).toBe(1);
            await expect(browserSessionService.getBrowserSession(existingBrowserSession.sessionId))
                .resolves.toBeNull();

            const updatedUser = await User.findById(user._id).lean();
            expect(updatedUser.authTokensRevokedAfter).toBeTruthy();

            const grant = await OtpFlowGrant.findOne({ tokenId: tokenState.tokenId });
            expect(grant.state).toBe('consumed');

            const replayRes = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: nextPassword,
                });

            expect([403, 409]).toContain(replayRes.statusCode);
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

            const nextPassword = buildStrongPassword();
            const spoofedRes = await request(app).post('/api/otp/reset-password')
                .set('X-Aura-Device-Id', 'device-reset-123')
                .send({
                    flowToken,
                    password: nextPassword,
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
                    password: nextPassword,
                });
            expect(stillBlockedRes.statusCode).toBe(403);
            expect(stillBlockedRes.body.message).toContain('Fresh trusted device verification is required');
            expect(mockUpdateUser).not.toHaveBeenCalled();
        }, 15000);

        test('should release reserved token grant and return 503 if Firebase user lookup fails', async () => {
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

            mockGetUserByEmail.mockRejectedValue(new Error('Firebase network failure'));

            const res = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: buildStrongPassword(),
                });

            expect(res.statusCode).toBe(503);
            expect(res.body.code).toBe('OTP_RESET_FIREBASE_LOOKUP_FAILED');
            expect(res.body.message).toContain('Unable to update password right now');

            // Assert token was released back to 'active'
            const grant = await OtpFlowGrant.findOne({ tokenId: tokenState.tokenId });
            expect(grant.state).toBe('active');
        });

        test('should release reserved token grant and return 503 if Firebase updateUser fails', async () => {
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

            mockGetUserByEmail.mockResolvedValue({ uid: 'firebase-user-1' });
            mockUpdateUser.mockRejectedValue(new Error(
                `Firebase auth update failed for ${u.email} and ${u.phone}`
            ));
            const errorLogSpy = jest.spyOn(logger, 'error');

            try {
                const res = await request(app).post('/api/otp/reset-password')
                    .send({
                        flowToken,
                        password: buildStrongPassword(),
                    });

                expect(res.statusCode).toBe(503);
                expect(res.body.code).toBe('OTP_RESET_FIREBASE_UPDATE_FAILED');
                expect(res.body.message).toContain('Unable to update password right now');

                const [, resetLog] = errorLogSpy.mock.calls.find(
                    ([event]) => event === 'otp.reset_password_failed'
                );
                expect(resetLog).toEqual(expect.objectContaining({
                    route: 'otp.reset-password',
                    stage: 'firebase_password_update',
                    publicCode: 'OTP_RESET_FIREBASE_UPDATE_FAILED',
                    flowHash: expect.stringMatching(/^[a-f0-9]{16}$/),
                    emailHash: hashSecurityValue(u.email),
                    phoneHash: hashSecurityValue(u.phone),
                    ipHash: expect.stringMatching(/^[a-f0-9]{16}$/),
                    providerMessage: 'Firebase auth update failed for [EMAIL_REDACTED] and [PHONE_REDACTED]',
                }));
                expect(JSON.stringify(resetLog)).not.toContain(flowToken);
                expect(JSON.stringify(resetLog)).not.toContain(u.email);
                expect(JSON.stringify(resetLog)).not.toContain(u.phone);
                expect(resetLog).not.toHaveProperty('email');
                expect(resetLog).not.toHaveProperty('phone');

                // Assert token was released back to 'active'
                const grant = await OtpFlowGrant.findOne({ tokenId: tokenState.tokenId });
                expect(grant.state).toBe('active');
            } finally {
                errorLogSpy.mockRestore();
            }
        });

        test('should prevent concurrent reset password requests using the same flowToken', async () => {
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

            // Delay the Firebase lookup so the first request holds the reservation lock
            let resolveLookup;
            const lookupPromise = new Promise((resolve) => {
                resolveLookup = () => resolve({ uid: 'firebase-user-1' });
            });
            mockGetUserByEmail.mockImplementation(() => lookupPromise);
            mockUpdateUser.mockResolvedValue({});
            mockRevokeRefreshTokens.mockResolvedValue({});

            // Trigger the first request (will hang waiting for lookupPromise to resolve)
            let firstRes;
            const firstRequestPromise = request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: buildStrongPassword(),
                })
                .then((res) => {
                    firstRes = res;
                });

            // Wait a brief moment to ensure request A has acquired the MongoDB reservation lock
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Trigger the second request with the same flow token
            const secondRes = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: buildStrongPassword(),
                });

            // The second request must be rejected with 409 because the token is currently 'reserved'
            expect(secondRes.statusCode).toBe(409);
            expect(secondRes.body.message).toContain('already being used');

            // Now resolve the first request's Firebase lookup so it can complete
            resolveLookup();
            await firstRequestPromise;

            expect(firstRes.statusCode).toBe(200);
            expect(firstRes.body.message).toContain('Password reset successful');

            // The token should end up as 'consumed'
            const grant = await OtpFlowGrant.findOne({ tokenId: tokenState.tokenId });
            expect(grant.state).toBe('consumed');
        }, 15000);

        test('should reject password reset and not change password if database failure occurs during token reservation', async () => {
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

            // Spy on findOneAndUpdate to mock a database query failure
            const findOneAndUpdateSpy = jest.spyOn(OtpFlowGrant, 'findOneAndUpdate')
                .mockRejectedValueOnce(new Error('Mongoose query database connection failure'));

            const res = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: buildStrongPassword(),
                });

            expect(res.statusCode).toBe(500);
            
            // Verify Firebase was NEVER called
            expect(mockGetUserByEmail).not.toHaveBeenCalled();
            expect(mockUpdateUser).not.toHaveBeenCalled();

            // Verify the token wasn't consumed or reserved
            const grant = await OtpFlowGrant.findOne({ tokenId: tokenState.tokenId });
            expect(grant.state).toBe('active');

            findOneAndUpdateSpy.mockRestore();
        });

        test('should handle database failure during token consumption safely after successful Firebase update', async () => {
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

            mockGetUserByEmail.mockResolvedValue({ uid: 'firebase-user-1' });
            mockUpdateUser.mockResolvedValue({});

            // Spy on findOneAndUpdate to mock a database query failure only for consumeReservedOtpFlowGrant
            const originalFindOneAndUpdate = OtpFlowGrant.findOneAndUpdate;
            let callCount = 0;
            const findOneAndUpdateSpy = jest.spyOn(OtpFlowGrant, 'findOneAndUpdate')
                .mockImplementation((filter, update, options) => {
                    callCount += 1;
                    if (callCount === 2) {
                        return Promise.reject(new Error('Database write connection lost during consumption'));
                    }
                    return originalFindOneAndUpdate.call(OtpFlowGrant, filter, update, options);
                });

            const res = await request(app).post('/api/otp/reset-password')
                .send({
                    flowToken,
                    password: buildStrongPassword(),
                });

            expect(res.statusCode).toBe(500);
            
            // Verify Firebase updateUser WAS called successfully
            expect(mockUpdateUser).toHaveBeenCalledTimes(1);

            // Verify the token remains in 'reserved' state and was not consumed or active
            const grant = await OtpFlowGrant.findOne({ tokenId: tokenState.tokenId });
            expect(grant.state).toBe('reserved');

            findOneAndUpdateSpy.mockRestore();
        });
    });
});
