const crypto = require('crypto');

describe('trustedDeviceChallengeService', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    const createRsaProof = ({ challenge, mode, deviceId, privateKeyPem }) => {
        const message = Buffer.from(`aura-device-proof|${mode}|${deviceId}|${challenge}`, 'utf8');
        return crypto.sign(
            'sha256',
            message,
            {
                key: privateKeyPem,
                padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
                saltLength: 32,
            }
        ).toString('base64');
    };

    test('enrolls a new trusted device and then verifies future assertions for the same Firebase session', async () => {
        let service;
        const dbState = { trustedDevices: [] };
        const userId = '507f1f77bcf86cd799439011';
        const deviceId = 'device_test_123456';
        const authContext = {
            authUid: 'firebase-uid-1',
            authToken: { iat: 1710000000 },
        };

        jest.isolateModules(() => {
            jest.doMock('../models/User', () => ({
                findById: jest.fn().mockReturnValue({
                    lean: jest.fn().mockResolvedValue({
                        _id: userId,
                        trustedDevices: dbState.trustedDevices,
                    }),
                }),
                updateOne: jest.fn().mockImplementation(async (_filter, update) => {
                    dbState.trustedDevices = update.$set.trustedDevices;
                    return { acknowledged: true, modifiedCount: 1 };
                }),
            }));

            service = require('../services/trustedDeviceChallengeService');
        });

        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { format: 'der', type: 'spki' },
            privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
        });
        const publicKeySpkiBase64 = Buffer.from(publicKey).toString('base64');

        const enrollChallenge = await service.issueTrustedDeviceChallenge({
            user: { _id: userId, trustedDevices: [] },
            deviceId,
            deviceLabel: 'Admin laptop',
            ...authContext,
        });

        expect(enrollChallenge.mode).toBe('enroll');

        const enrollResult = await service.verifyTrustedDeviceChallenge({
            user: { _id: userId, trustedDevices: [] },
            token: enrollChallenge.token,
            proof: createRsaProof({
                challenge: enrollChallenge.challenge,
                mode: enrollChallenge.mode,
                deviceId,
                privateKeyPem: privateKey,
            }),
            publicKeySpkiBase64,
            deviceId,
            deviceLabel: 'Admin laptop',
            ...authContext,
        });

        expect(enrollResult.success).toBe(true);
        expect(enrollResult.mode).toBe('enroll');
        expect(enrollResult.deviceSessionToken).toBeTruthy();
        expect(dbState.trustedDevices).toHaveLength(1);

        const assertChallenge = await service.issueTrustedDeviceChallenge({
            user: { _id: userId, trustedDevices: dbState.trustedDevices },
            deviceId,
            deviceLabel: 'Admin laptop',
            ...authContext,
        });

        expect(assertChallenge.mode).toBe('assert');

        const assertResult = await service.verifyTrustedDeviceChallenge({
            user: { _id: userId, trustedDevices: dbState.trustedDevices },
            token: assertChallenge.token,
            proof: createRsaProof({
                challenge: assertChallenge.challenge,
                mode: assertChallenge.mode,
                deviceId,
                privateKeyPem: privateKey,
            }),
            deviceId,
            deviceLabel: 'Admin laptop',
            ...authContext,
        });

        expect(assertResult.success).toBe(true);
        expect(assertResult.mode).toBe('assert');

        const trustedSession = service.verifyTrustedDeviceSession({
            user: { _id: userId },
            deviceId,
            deviceSessionToken: assertResult.deviceSessionToken,
            ...authContext,
        });

        expect(trustedSession).toEqual({ success: true });
    });
});
