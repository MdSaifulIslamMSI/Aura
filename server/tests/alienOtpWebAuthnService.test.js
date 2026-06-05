const {
    createChallenge,
    resetAlienOtpChallengeMemoryForTests,
} = require('../services/alienOtpChallengeService');
const {
    generateAlienAssertionOptions,
    verifyAlienAssertion,
} = require('../services/alienOtpWebAuthnService');

const passkeyUser = {
    _id: 'user-1',
    email: 'user@example.test',
    trustedDevices: [{
        deviceId: 'device-1',
        publicKeySpkiBase64: Buffer.from('fake-key').toString('base64'),
        webauthnCredentialIdBase64Url: 'credential-1',
        webauthnTransports: ['internal'],
        webauthnCounter: 2,
    }],
};

describe('ALIEN OTP WebAuthn service', () => {
    beforeEach(() => {
        resetAlienOtpChallengeMemoryForTests();
    });

    test('generates assertion options for the registered passkey credential', async () => {
        const challenge = await createChallenge({
            userId: 'user-1',
            action: 'admin.role.update',
            deviceId: 'device-1',
        });

        const options = await generateAlienAssertionOptions({
            userId: 'user-1',
            challengeId: challenge.challengeId,
            user: passkeyUser,
            req: {
                headers: {
                    origin: 'https://app.example.test',
                    host: 'app.example.test',
                },
                protocol: 'https',
            },
        });

        expect(options.challenge).toBe(challenge.nonce);
        expect(options.allowCredentials).toEqual([expect.objectContaining({
            id: 'credential-1',
            type: 'public-key',
        })]);
    });

    test('verifies an assertion with the stored credential metadata', async () => {
        const challenge = await createChallenge({
            userId: 'user-1',
            action: 'admin.role.update',
            deviceId: 'device-1',
        });
        const verifyAssertion = jest.fn(() => ({ counter: 3 }));

        const result = await verifyAlienAssertion({
            userId: 'user-1',
            challengeId: challenge.challengeId,
            user: passkeyUser,
            expectedOrigin: 'https://app.example.test',
            expectedRpId: 'app.example.test',
            assertionResponse: {
                deviceId: 'device-1',
                credential: {
                    rawIdBase64Url: 'credential-1',
                    response: {
                        clientDataJSONBase64Url: 'client',
                    },
                },
            },
            verifyAssertion,
        });

        expect(result.success).toBe(true);
        expect(result.counter).toBe(3);
        expect(verifyAssertion).toHaveBeenCalledWith(expect.objectContaining({
            expectedChallenge: challenge.nonce,
            storedCredentialIdBase64Url: 'credential-1',
            storedCounter: 2,
        }));
    });

    test('rejects credentials not registered to the user', async () => {
        const challenge = await createChallenge({
            userId: 'user-1',
            action: 'admin.role.update',
        });

        const result = await verifyAlienAssertion({
            userId: 'user-1',
            challengeId: challenge.challengeId,
            user: passkeyUser,
            assertionResponse: {
                credential: {
                    rawIdBase64Url: 'credential-2',
                    response: {},
                },
            },
        });

        expect(result).toMatchObject({
            success: false,
            reason: 'unknown_passkey_credential',
        });
    });
});
