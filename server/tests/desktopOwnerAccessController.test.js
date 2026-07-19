const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const mockCreateCustomToken = jest.fn();

jest.mock('../config/firebase', () => ({
    auth: () => ({
        createCustomToken: mockCreateCustomToken,
    }),
}));

jest.mock('../services/authSecurityTelemetryService', () => ({
    recordAuthSecurityEvent: jest.fn(),
}));

const {
    buildDesktopOwnerAccessPayload,
    createDesktopOwnerAccessSignature,
    resetDesktopOwnerAccessReplayCacheForTests,
} = require('../services/desktopOwnerAccessService');
const { issueDesktopOwnerAccessToken } = require('../controllers/authController');

const envKeys = [
    'AURA_DESKTOP_OWNER_ACCESS_ENABLED',
    'AURA_DESKTOP_OWNER_ACCESS_KEY',
    'AURA_DESKTOP_OWNER_FIREBASE_UID',
];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.post('/owner-access', issueDesktopOwnerAccessToken);
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || 500).json({
            code: err.code,
            message: err.message,
        });
    });
    return app;
};

const buildAssertion = () => {
    const requestId = crypto.randomUUID();
    const issuedAt = new Date().toISOString();
    const nonce = crypto.randomBytes(24).toString('base64url');
    const payload = buildDesktopOwnerAccessPayload({
        requestId,
        issuedAt,
        nonce,
    });
    return {
        issuedAt,
        nonce,
        requestId,
        signature: createDesktopOwnerAccessSignature(payload, process.env.AURA_DESKTOP_OWNER_ACCESS_KEY),
    };
};

describe('desktop owner access controller', () => {
    beforeEach(() => {
        process.env.AURA_DESKTOP_OWNER_ACCESS_ENABLED = 'true';
        process.env.AURA_DESKTOP_OWNER_ACCESS_KEY = crypto.randomBytes(48).toString('base64url');
        process.env.AURA_DESKTOP_OWNER_FIREBASE_UID = 'configured-owner-uid';
        resetDesktopOwnerAccessReplayCacheForTests();
        mockCreateCustomToken.mockReset();
        mockCreateCustomToken.mockResolvedValue('owner-custom-token');
    });

    afterAll(() => {
        for (const key of envKeys) {
            if (originalEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = originalEnv[key];
            }
        }
    });

    test('mints a desktop custom token only for the configured owner uid', async () => {
        const res = await request(buildApp())
            .post('/owner-access')
            .send(buildAssertion());

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            success: true,
            customToken: 'owner-custom-token',
        });
        expect(mockCreateCustomToken).toHaveBeenCalledWith('configured-owner-uid', {
            desktop_owner_access: true,
            desktop_request_id: expect.any(String),
        });
    });

    test('fails closed when the owner key proof is missing', async () => {
        const res = await request(buildApp())
            .post('/owner-access')
            .send({
                requestId: crypto.randomUUID(),
            });

        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({
            code: 'DESKTOP_OWNER_ACCESS_INVALID',
            message: 'Desktop owner access could not be verified.',
        });
        expect(mockCreateCustomToken).not.toHaveBeenCalled();
    });
});
