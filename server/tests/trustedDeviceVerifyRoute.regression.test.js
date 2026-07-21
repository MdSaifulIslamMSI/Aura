const request = require('supertest');

describe('trusted-device verification route regression', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('reaches device proof without the factor-change guard and retains the surrounding controls', async () => {
        let app;
        let authRouter;
        const authGuardRateLimit = jest.fn((_req, _res, next) => next());
        const protect = jest.fn((req, _res, next) => {
            req.user = { _id: 'user-1', email: 'verified@example.com' };
            req.authUid = 'uid-verified';
            next();
        });
        const trustedDeviceVerificationLimiter = jest.fn((_req, _res, next) => next());
        const csrfTokenValidatorUnlessBearerAuth = jest.fn((_req, _res, next) => next());
        const authFactorChange = jest.fn((_req, res) => res.status(409).json({
            code: 'UNEXPECTED_FACTOR_CHANGE_GUARD',
        }));
        const verifyDeviceChallenge = jest.fn((_req, res) => res.json({
            success: true,
            status: 'mfa_challenge_required',
        }));
        const distributedLimiters = new Map();
        const passThrough = jest.fn((_req, _res, next) => next());
        const endpoint = jest.fn((_req, res) => res.status(204).end());

        jest.doMock('express-rate-limit', () => ({
            rateLimit: jest.fn(() => authGuardRateLimit),
        }));
        jest.doMock('../middleware/distributedRateLimit', () => ({
            createDistributedRateLimit: jest.fn(({ name }) => {
                const limiter = name === 'auth_verify_device'
                    ? trustedDeviceVerificationLimiter
                    : jest.fn((_req, _res, next) => next());
                distributedLimiters.set(name, limiter);
                return limiter;
            }),
        }));
        jest.doMock('../controllers/authController', () => ({
            establishSessionCookie: passThrough,
            generateBackupRecoveryCodes: endpoint,
            getSession: endpoint,
            logoutSession: endpoint,
            requestBootstrapDeviceChallenge: endpoint,
            syncSession: endpoint,
            completePhoneFactorLogin: endpoint,
            completePhoneFactorVerification: endpoint,
            completeDuoLogin: endpoint,
            completeEnterpriseLogin: endpoint,
            verifyBackupRecoveryCode: endpoint,
            verifyDeviceChallenge,
            issueDesktopHandoffToken: endpoint,
            prepareDesktopHandoff: endpoint,
            issueDesktopOwnerAccessToken: endpoint,
            startEnterpriseLogin: endpoint,
            startDuoLogin: endpoint,
            startDuoStepUp: endpoint,
        }));
        jest.doMock('../controllers/mfaController', () => ({
            createStepUpChallenge: endpoint,
            disableTotp: endpoint,
            getMfaSecurityCenter: endpoint,
            getTotpQr: endpoint,
            passkeyLoginOptions: endpoint,
            passkeyLoginVerify: endpoint,
            passkeyRegisterOptions: endpoint,
            passkeyRegisterVerify: endpoint,
            passkeyRemove: endpoint,
            renameTrustedDevice: endpoint,
            recoveryRegenerate: endpoint,
            recoveryVerify: endpoint,
            revokeOtherTrustedDevices: endpoint,
            revokeTrustedDevice: endpoint,
            setupTotp: endpoint,
            verifyTotpLogin: endpoint,
            verifyTotpSetup: endpoint,
        }));
        jest.doMock('../middleware/authMiddleware', () => ({
            protect,
            protectOptional: passThrough,
            protectPhoneFactorProof: passThrough,
        }));
        jest.doMock('../middleware/validate', () => jest.fn(() => passThrough));
        jest.doMock('../middleware/routeSecurityGuards', () => ({
            sensitiveActions: {
                accountRecoveryChange: passThrough,
                authFactorChange,
            },
        }));
        jest.doMock('../validators/userValidators', () => ({ loginSchema: {} }));
        jest.doMock('../middleware/csrfMiddleware', () => ({
            csrfTokenGenerator: passThrough,
            csrfTokenValidator: passThrough,
            csrfTokenValidatorUnlessBearerAuth,
        }));
        jest.doMock('../middleware/turnstileMiddleware', () => ({
            requireTurnstile: jest.fn(() => passThrough),
        }));
        jest.doMock('../routes/otpRoutes', () => {
            const express = require('express');
            return express.Router();
        });

        jest.isolateModules(() => {
            const express = require('express');
            authRouter = require('../routes/authRoutes');
            app = express();
            app.use(express.json());
            app.use('/api/auth', authRouter);
        });

        const res = await request(app)
            .post('/api/auth/verify-device')
            .set('x-aura-device-id', 'device-test-1234')
            .send({ token: 'challenge-token', proof: 'challenge-proof' });

        expect(res.statusCode).toBe(200);
        expect(res.body.status).toBe('mfa_challenge_required');
        expect(authGuardRateLimit).toHaveBeenCalledTimes(1);
        expect(protect).toHaveBeenCalledTimes(1);
        expect(distributedLimiters.get('auth_verify_device')).toBe(trustedDeviceVerificationLimiter);
        expect(trustedDeviceVerificationLimiter).toHaveBeenCalledTimes(1);
        expect(csrfTokenValidatorUnlessBearerAuth).toHaveBeenCalledTimes(1);
        expect(verifyDeviceChallenge).toHaveBeenCalledTimes(1);
        expect(authFactorChange).not.toHaveBeenCalled();

        const factorChangeRoute = authRouter.stack.find((layer) => (
            layer.route?.path === '/mfa/totp/disable'
            && layer.route?.methods?.post
        ));
        expect(factorChangeRoute).toBeTruthy();
        expect(factorChangeRoute.route.stack.some((layer) => layer.handle === authFactorChange)).toBe(true);
    });
});
