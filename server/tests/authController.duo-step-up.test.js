describe('authController Duo step-up gates', () => {
    const ORIGINAL_ENV = {
        DUO_ENABLED: process.env.DUO_ENABLED,
        DUO_CLIENT_ID: process.env.DUO_CLIENT_ID,
        DUO_CLIENT_SECRET: process.env.DUO_CLIENT_SECRET,
        DUO_OIDC_ISSUER: process.env.DUO_OIDC_ISSUER,
        DUO_DISCOVERY_URL: process.env.DUO_DISCOVERY_URL,
        DUO_REDIRECT_URI: process.env.DUO_REDIRECT_URI,
    };

    afterEach(() => {
        for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
        jest.resetModules();
        jest.dontMock('../models/User');
        jest.dontMock('../services/authRecoveryCodeService');
        jest.dontMock('../middleware/authMiddleware');
        jest.dontMock('../services/authSecurityTelemetryService');
    });

    test('recovery-code generation fails closed when Duo is enabled but incomplete', async () => {
        process.env.DUO_ENABLED = 'true';
        delete process.env.DUO_CLIENT_ID;
        delete process.env.DUO_CLIENT_SECRET;
        delete process.env.DUO_OIDC_ISSUER;
        delete process.env.DUO_DISCOVERY_URL;
        delete process.env.DUO_REDIRECT_URI;

        const generateRecoveryCodesForUser = jest.fn();
        jest.doMock('../models/User', () => ({
            findById: jest.fn(() => ({
                lean: jest.fn().mockResolvedValue({
                    _id: 'user-recovery-1',
                    trustedDevices: [{ method: 'webauthn' }],
                }),
            })),
        }));
        jest.doMock('../services/authRecoveryCodeService', () => ({
            consumeRecoveryCodeForPasswordReset: jest.fn(),
            generateRecoveryCodesForUser,
            getPasskeyCount: jest.fn(() => 1),
        }));
        jest.doMock('../middleware/authMiddleware', () => ({
            invalidateUserCache: jest.fn(),
            invalidateUserCacheByEmail: jest.fn(),
        }));
        jest.doMock('../services/authSecurityTelemetryService', () => ({
            recordAuthSecurityEvent: jest.fn(),
        }));

        const { generateBackupRecoveryCodes } = require('../controllers/authController');
        const req = {
            user: {
                _id: 'user-recovery-1',
                email: 'user@example.test',
            },
            authSession: {
                sessionId: 'session-recovery-1',
                amr: ['webauthn'],
                deviceMethod: 'webauthn',
                stepUpUntil: new Date(Date.now() + 60_000).toISOString(),
            },
            authUid: 'firebase-user-1',
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        const next = jest.fn();

        await generateBackupRecoveryCodes(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 503,
            code: 'DUO_NOT_CONFIGURED',
        }));
        expect(generateRecoveryCodesForUser).not.toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
    });
});
