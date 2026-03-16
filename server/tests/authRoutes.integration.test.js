const request = require('supertest');
const app = require('../index');

jest.setTimeout(30000);

describe('Auth API surface', () => {
    test('GET /api/auth/session should fail without token', async () => {
        const res = await request(app).get('/api/auth/session');
        expect(res.statusCode).toBe(401);
    });

    test('POST /api/auth/sync should fail without token', async () => {
        const res = await request(app)
            .post('/api/auth/sync')
            .send({
                email: 'test@example.com',
                name: 'Test User',
                phone: '+919876543210',
        });
        expect(res.statusCode).toBe(401);
    });

    test('POST /api/auth/otp/send should expose OTP validation under auth aliases', async () => {
        const res = await request(app)
            .post('/api/auth/otp/send')
            .send({ phone: '1234567890', purpose: 'signup' });
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toContain('required');
    });
});


describe('Auth sync verified-email gating', () => {
    test('POST /api/auth/sync rejects unverified auth token', async () => {
        let isolatedApp;

        jest.isolateModules(() => {
            jest.doMock('../models/User', () => ({
                findOneAndUpdate: jest.fn(),
                findById: jest.fn(),
                findOne: jest.fn(),
            }));
            jest.doMock('../services/latticeChallengeService', () => ({
                generateLatticeChallenge: jest.fn().mockResolvedValue({ challengeId: 'stub' }),
                verifyLatticeProof: jest.fn(),
            }));

            const express = require('express');
            const { syncSession } = require('../controllers/authController');
            const { errorHandler } = require('../middleware/errorMiddleware');

            isolatedApp = express();
            isolatedApp.use(express.json());
            isolatedApp.post('/api/auth/sync', (req, res, next) => {
                req.user = {
                    email: 'unverified@example.com',
                    name: 'Unverified User',
                    isVerified: false,
                };
                req.authUid = 'uid-unverified';
                req.authToken = {
                    email: 'unverified@example.com',
                    email_verified: false,
                };
                next();
            }, syncSession);
            isolatedApp.use(errorHandler);
        });

        const res = await request(isolatedApp)
            .post('/api/auth/sync')
            .send({ email: 'unverified@example.com', name: 'Unverified User' });

        expect(res.statusCode).toBe(403);
        expect(res.body.message).toContain('Email verification is required before session sync');
    });
});
