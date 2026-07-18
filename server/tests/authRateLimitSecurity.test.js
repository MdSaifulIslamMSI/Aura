const express = require('express');
const request = require('supertest');

describe('auth route rate-limit security', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        jest.dontMock('../middleware/distributedRateLimit');
        jest.dontMock('../middleware/turnstileMiddleware');
        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../middleware/routeSecurityGuards');
        jest.dontMock('../middleware/csrfMiddleware');
        jest.dontMock('../middleware/validate');
        jest.dontMock('../routes/otpRoutes');
        jest.dontMock('../controllers/otpController');
        jest.dontMock('../controllers/authController');
        jest.dontMock('../controllers/mfaController');
    });

    const buildApp = () => {
        let requestBootstrapDeviceChallenge;
        let establishSessionCookie;
        let issueDesktopHandoffToken;

        jest.isolateModules(() => {
            const limiterCounts = new Map();

            jest.doMock('../middleware/distributedRateLimit', () => ({
                createDistributedRateLimit: (config = {}) => {
                    const max = Number(config.max || 1);
                    const keyGenerator = typeof config.keyGenerator === 'function'
                        ? config.keyGenerator
                        : (req) => req.ip || 'unknown';

                    return (req, res, next) => {
                        const key = [
                            String(config.name || 'limiter').trim(),
                            String(keyGenerator(req) || 'unknown').trim(),
                        ].join(':');
                        const nextCount = Number(limiterCounts.get(key) || 0) + 1;
                        limiterCounts.set(key, nextCount);
                        res.setHeader('x-test-rate-limiter', String(config.name || ''));
                        res.setHeader('x-test-rate-limit-key', key);

                        if (nextCount > max) {
                            const message = typeof config.message === 'string'
                                ? { message: config.message }
                                : (config.message || { message: 'Too many requests' });
                            return res.status(429).json(message);
                        }
                        return next();
                    };
                },
            }));
            jest.doMock('../middleware/turnstileMiddleware', () => ({
                requireTurnstile: () => (_req, _res, next) => next(),
            }));
            jest.doMock('../middleware/authMiddleware', () => ({
                protect: (req, _res, next) => {
                    req.authUid = 'uid-rate-limit-test';
                    req.user = { id: 'uid-rate-limit-test', email: 'rate-limit@example.test' };
                    next();
                },
                protectOptional: (_req, _res, next) => next(),
                protectPhoneFactorProof: (req, _res, next) => {
                    req.authUid = 'uid-rate-limit-test';
                    req.user = { id: 'uid-rate-limit-test', email: 'rate-limit@example.test' };
                    next();
                },
            }));
            jest.doMock('../middleware/routeSecurityGuards', () => ({
                sensitiveActions: new Proxy({}, { get: () => (_req, _res, next) => next() }),
            }));
            jest.doMock('../middleware/csrfMiddleware', () => ({
                csrfTokenGenerator: (_req, _res, next) => next(),
                csrfTokenValidator: (_req, _res, next) => next(),
                csrfTokenValidatorUnlessBearerAuth: (_req, _res, next) => next(),
            }));
            jest.doMock('../middleware/validate', () => () => (_req, _res, next) => next());
            jest.doMock('../routes/otpRoutes', () => express.Router());

            requestBootstrapDeviceChallenge = jest.fn((_req, res) => res.json({
                success: true,
                deviceChallenge: { token: 'issued-device-challenge' },
            }));
            establishSessionCookie = jest.fn((_req, _res, next) => next());
            issueDesktopHandoffToken = jest.fn((_req, res) => res.json({ customToken: 'handoff' }));

            jest.doMock('../controllers/authController', () => ({
                establishSessionCookie,
                generateBackupRecoveryCodes: (_req, res) => res.status(201).json({ success: true }),
                getSession: (_req, res) => res.json({ ok: true }),
                logoutSession: (_req, res) => res.json({ success: true }),
                requestBootstrapDeviceChallenge,
                syncSession: (_req, res) => res.json({ synced: true }),
                completePhoneFactorLogin: (_req, res) => res.json({ completed: true }),
                completePhoneFactorVerification: (_req, res) => res.json({ completed: true }),
                completeDuoLogin: (_req, res) => res.json({ ok: true }),
                completeEnterpriseLogin: (_req, res) => res.json({ ok: true }),
                verifyBackupRecoveryCode: (_req, res) => res.json({ success: true }),
                verifyDeviceChallenge: (_req, res) => res.json({ ok: true }),
                issueDesktopHandoffToken,
                issueDesktopOwnerAccessToken: (_req, res) => res.json({ customToken: 'owner-access' }),
                startEnterpriseLogin: (_req, res) => res.json({ ok: true }),
                startDuoLogin: (_req, res) => res.json({ ok: true }),
                startDuoStepUp: (_req, res) => res.json({ ok: true }),
            }));
            jest.doMock('../controllers/mfaController', () => ({
                createStepUpChallenge: (_req, res) => res.json({ ok: true }),
                disableTotp: (_req, res) => res.json({ ok: true }),
                getMfaSecurityCenter: (_req, res) => res.json({ ok: true }),
                getTotpQr: (_req, res) => res.json({ ok: true }),
                passkeyLoginOptions: (_req, res) => res.json({ ok: true }),
                passkeyLoginVerify: (_req, res) => res.json({ ok: true }),
                passkeyRegisterOptions: (_req, res) => res.json({ ok: true }),
                passkeyRegisterVerify: (_req, res) => res.json({ ok: true }),
                passkeyRemove: (_req, res) => res.json({ ok: true }),
                renameTrustedDevice: (_req, res) => res.json({ ok: true }),
                recoveryRegenerate: (_req, res) => res.json({ ok: true }),
                recoveryVerify: (_req, res) => res.json({ ok: true }),
                revokeOtherTrustedDevices: (_req, res) => res.json({ ok: true }),
                revokeTrustedDevice: (_req, res) => res.json({ ok: true }),
                setupTotp: (_req, res) => res.json({ ok: true }),
                verifyTotpLogin: (_req, res) => res.json({ ok: true }),
                verifyTotpSetup: (_req, res) => res.json({ ok: true }),
            }));

            const authRoutes = require('../routes/authRoutes');
            const isolatedApp = express();
            isolatedApp.use(express.json());
            isolatedApp.use('/api/auth', authRoutes);
            isolatedApp.use((err, _req, res, _next) => {
                res.status(err.statusCode || err.status || 500).json({
                    message: err.message || 'Internal Server Error',
                });
            });
            buildApp.app = isolatedApp;
        });

        return {
            app: buildApp.app,
            establishSessionCookie,
            issueDesktopHandoffToken,
            requestBootstrapDeviceChallenge,
        };
    };

    test('password reset limiter separates verified reset flows while retaining network flood protection', () => {
        const limiterConfigs = [];

        jest.isolateModules(() => {
            jest.doMock('../middleware/distributedRateLimit', () => ({
                createDistributedRateLimit: (config = {}) => {
                    limiterConfigs.push(config);
                    return (_req, _res, next) => next();
                },
            }));
            jest.doMock('../middleware/turnstileMiddleware', () => ({
                requireTurnstile: () => (_req, _res, next) => next(),
            }));
            jest.doMock('../controllers/otpController', () => ({
                checkUserExists: (_req, res) => res.json({ success: true }),
                getOtpChallenge: (_req, res) => res.json({ success: true }),
                resetPasswordWithOtp: (_req, res) => res.json({ success: true }),
                sendOtp: (_req, res) => res.json({ success: true }),
                verifyOtp: (_req, res) => res.json({ success: true }),
            }));

            require('../routes/otpRoutes');
        });

        const resetFlowLimiter = limiterConfigs.find((config) => config.name === 'otp_reset_password');
        const resetNetworkLimiter = limiterConfigs.find((config) => config.name === 'otp_reset_password_ip_abuse');

        expect(resetFlowLimiter).toBeTruthy();
        expect(resetNetworkLimiter).toBeTruthy();
        expect(resetFlowLimiter.keyGenerator).toEqual(expect.any(Function));
        expect(resetNetworkLimiter.keyGenerator).toEqual(expect.any(Function));
        expect(resetNetworkLimiter.max).toBeGreaterThan(resetFlowLimiter.max);

        const firstResetFlow = {
            body: { flowToken: 'verified-reset-flow-token-user-a' },
            ip: '203.0.113.25',
        };
        const secondResetFlow = {
            body: { flowToken: 'verified-reset-flow-token-user-b' },
            ip: '203.0.113.25',
        };

        const firstFlowKey = resetFlowLimiter.keyGenerator(firstResetFlow);
        const secondFlowKey = resetFlowLimiter.keyGenerator(secondResetFlow);

        expect(firstFlowKey).not.toBe(secondFlowKey);
        expect(firstFlowKey).not.toContain(firstResetFlow.body.flowToken);
        expect(secondFlowKey).not.toContain(secondResetFlow.body.flowToken);
        expect(resetNetworkLimiter.keyGenerator(firstResetFlow))
            .toBe(resetNetworkLimiter.keyGenerator(secondResetFlow));
    });

    test('rotating device IDs does not bypass trusted-device bootstrap challenge limits', async () => {
        const { app, requestBootstrapDeviceChallenge } = buildApp();
        const email = 'Recovery.Target@Example.Test';
        const responses = [];

        for (let index = 0; index < 31; index += 1) {
            responses.push(await request(app)
                .post('/api/auth/bootstrap-device-challenge')
                .set('X-Aura-Device-Id', `rotated-device-${index}`)
                .send({
                    scope: 'otp-send:forgot-password',
                    email,
                    phone: '+919876543210',
                }));
        }

        expect(responses.slice(0, 30).map((res) => res.statusCode))
            .toEqual(Array.from({ length: 30 }, () => 200));
        expect(responses[30].statusCode).toBe(429);
        expect(responses[30].body.message).toMatch(/too many trusted device challenge requests/i);
        expect(responses[30].body.deviceChallenge).toBeUndefined();
        expect(requestBootstrapDeviceChallenge).toHaveBeenCalledTimes(30);
    });

    test('authenticated MFA limiters key by the verified account after protect runs', async () => {
        const { app } = buildApp();

        const challenge = await request(app)
            .post('/api/auth/mfa/step-up')
            .send({ action: 'profile-security' });
        const verification = await request(app)
            .post('/api/auth/mfa/totp/verify-login')
            .send({ challengeId: 'attacker-controlled-challenge', code: '000000' });
        const mutation = await request(app)
            .patch('/api/auth/mfa/trusted-devices/device-owner-0001')
            .send({ label: 'Work laptop' });

        expect(challenge.headers['x-test-rate-limit-key'])
            .toBe('auth_mfa_challenge:uid:uid-rate-limit-test');
        expect(verification.headers['x-test-rate-limit-key'])
            .toBe('auth_mfa_verify:uid:uid-rate-limit-test');
        expect(mutation.headers['x-test-rate-limit-key'])
            .toBe('auth_session_mutation:uid-rate-limit-test');
    });

    test('desktop handoff refreshes the authenticated browser session before issuing its token', async () => {
        const { app, establishSessionCookie, issueDesktopHandoffToken } = buildApp();

        const response = await request(app)
            .post('/api/auth/desktop-handoff/custom-token')
            .send({ requestId: '123e4567-e89b-42d3-a456-426614174000' });

        expect(response.statusCode).toBe(200);
        expect(establishSessionCookie).toHaveBeenCalledTimes(1);
        expect(issueDesktopHandoffToken).toHaveBeenCalledTimes(1);
        expect(establishSessionCookie.mock.invocationCallOrder[0])
            .toBeLessThan(issueDesktopHandoffToken.mock.invocationCallOrder[0]);
    });
});
