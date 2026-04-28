const crypto = require('crypto');
const cbor = require('cbor');

const sha256 = (input) => crypto.createHash('sha256').update(input).digest();
const toBase64Url = (input) => Buffer.from(input).toString('base64url');

const createWebAuthnKeyPair = () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
    });
    const publicJwk = publicKey.export({ format: 'jwk' });
    return {
        privateKey,
        publicJwk,
        publicKeySpkiBase64: Buffer.from(publicKey.export({ format: 'der', type: 'spki' })).toString('base64'),
    };
};

const buildCredentialPublicKey = (publicJwk = {}) => cbor.encode(new Map([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Buffer.from(String(publicJwk.x || ''), 'base64url')],
    [-3, Buffer.from(String(publicJwk.y || ''), 'base64url')],
]));

const buildRegistrationAuthenticatorData = ({
    rpId = '',
    publicJwk = {},
    credentialIdBuffer = Buffer.alloc(0),
    signCount = 0,
    userVerified = true,
}) => {
    const rpIdHash = sha256(Buffer.from(String(rpId || ''), 'utf8'));
    const flags = 0x01 | 0x40 | (userVerified ? 0x04 : 0);
    const signCountBuffer = Buffer.alloc(4);
    signCountBuffer.writeUInt32BE(signCount, 0);
    const credentialLength = Buffer.alloc(2);
    credentialLength.writeUInt16BE(credentialIdBuffer.length, 0);

    return Buffer.concat([
        rpIdHash,
        Buffer.from([flags]),
        signCountBuffer,
        crypto.randomBytes(16),
        credentialLength,
        credentialIdBuffer,
        buildCredentialPublicKey(publicJwk),
    ]);
};

const buildAssertionAuthenticatorData = ({
    rpId = '',
    signCount = 0,
    userVerified = true,
}) => {
    const rpIdHash = sha256(Buffer.from(String(rpId || ''), 'utf8'));
    const flags = 0x01 | (userVerified ? 0x04 : 0);
    const signCountBuffer = Buffer.alloc(4);
    signCountBuffer.writeUInt32BE(signCount, 0);
    return Buffer.concat([rpIdHash, Buffer.from([flags]), signCountBuffer]);
};

const buildClientData = ({ type = '', challenge = '', origin = '' }) => (
    Buffer.from(JSON.stringify({
        type,
        challenge,
        origin,
        crossOrigin: false,
    }), 'utf8')
);

const buildWebAuthnRegistrationCredential = ({
    challenge = '',
    origin = '',
    rpId = '',
    credentialIdBuffer = Buffer.alloc(0),
    publicJwk = {},
    transports = ['internal'],
    authenticatorAttachment = 'platform',
}) => {
    const clientDataJSON = buildClientData({
        type: 'webauthn.create',
        challenge,
        origin,
    });
    const attestationObject = cbor.encode({
        fmt: 'none',
        attStmt: {},
        authData: buildRegistrationAuthenticatorData({
            rpId,
            publicJwk,
            credentialIdBuffer,
        }),
    });
    const credentialIdBase64Url = toBase64Url(credentialIdBuffer);

    return {
        id: credentialIdBase64Url,
        rawIdBase64Url: credentialIdBase64Url,
        type: 'public-key',
        authenticatorAttachment,
        response: {
            clientDataJSONBase64Url: toBase64Url(clientDataJSON),
            attestationObjectBase64Url: toBase64Url(attestationObject),
            transports,
        },
    };
};

const buildWebAuthnAssertionCredential = ({
    challenge = '',
    origin = '',
    rpId = '',
    credentialIdBuffer = Buffer.alloc(0),
    privateKey,
    signCount = 1,
    authenticatorAttachment = 'platform',
}) => {
    const clientDataJSON = buildClientData({
        type: 'webauthn.get',
        challenge,
        origin,
    });
    const authenticatorData = buildAssertionAuthenticatorData({
        rpId,
        signCount,
    });
    const verificationData = Buffer.concat([
        authenticatorData,
        sha256(clientDataJSON),
    ]);
    const signature = crypto.sign('sha256', verificationData, privateKey);
    const credentialIdBase64Url = toBase64Url(credentialIdBuffer);

    return {
        id: credentialIdBase64Url,
        rawIdBase64Url: credentialIdBase64Url,
        type: 'public-key',
        authenticatorAttachment,
        response: {
            clientDataJSONBase64Url: toBase64Url(clientDataJSON),
            authenticatorDataBase64Url: toBase64Url(authenticatorData),
            signatureBase64Url: toBase64Url(signature),
            userHandleBase64Url: '',
        },
    };
};

describe('trustedDeviceChallengeService', () => {
    const originalEnv = {
        NODE_ENV: process.env.NODE_ENV,
        AUTH_DEVICE_CHALLENGE_SECRET: process.env.AUTH_DEVICE_CHALLENGE_SECRET,
        AUTH_DEVICE_CHALLENGE_SECRET_VERSION: process.env.AUTH_DEVICE_CHALLENGE_SECRET_VERSION,
        AUTH_DEVICE_CHALLENGE_PREVIOUS_SECRETS: process.env.AUTH_DEVICE_CHALLENGE_PREVIOUS_SECRETS,
        AUTH_TRUSTED_DEVICE_PREFER_WEBAUTHN: process.env.AUTH_TRUSTED_DEVICE_PREFER_WEBAUTHN,
        AUTH_WEBAUTHN_AUTHENTICATOR_ATTACHMENT: process.env.AUTH_WEBAUTHN_AUTHENTICATOR_ATTACHMENT,
        AUTH_WEBAUTHN_RP_ID: process.env.AUTH_WEBAUTHN_RP_ID,
        AUTH_WEBAUTHN_ORIGIN: process.env.AUTH_WEBAUTHN_ORIGIN,
        AUTH_WEBAUTHN_USER_VERIFICATION: process.env.AUTH_WEBAUTHN_USER_VERIFICATION,
    };

    afterEach(() => {
        for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
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

    const loadServiceWithDbState = ({ dbState, userId }) => {
        let service;

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

        return service;
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

        const bootstrapVerification = service.verifyTrustedDeviceBootstrapSession({
            user: { _id: userId },
            deviceId,
            deviceSessionToken: assertResult.deviceSessionToken,
        });

        expect(bootstrapVerification).toMatchObject({
            success: true,
            deviceSessionHash: service.hashTrustedDeviceSessionToken(assertResult.deviceSessionToken),
        });
    });

    test('keeps trusted-device challenge binding stable when bearer auth becomes a browser session', async () => {
        const dbState = { trustedDevices: [] };
        const userId = '507f1f77bcf86cd799439099';
        const deviceId = 'device_session_bridge_123456';
        const issuedWithBearerAuth = {
            authUid: 'firebase-uid-bridge',
            authToken: { auth_time: 1710001000, iat: 1710001100 },
        };
        const verifiedWithBrowserSession = {
            authUid: 'firebase-uid-bridge',
            authToken: { auth_time: 1710001000, iat: 1710001200 },
        };
        const service = loadServiceWithDbState({ dbState, userId });
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { format: 'der', type: 'spki' },
            privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
        });

        const enrollChallenge = await service.issueTrustedDeviceChallenge({
            user: { _id: userId, trustedDevices: [] },
            deviceId,
            deviceLabel: 'Bridge laptop',
            ...issuedWithBearerAuth,
        });

        const enrollResult = await service.verifyTrustedDeviceChallenge({
            user: { _id: userId, trustedDevices: [] },
            token: enrollChallenge.token,
            proof: createRsaProof({
                challenge: enrollChallenge.challenge,
                mode: enrollChallenge.mode,
                deviceId,
                privateKeyPem: privateKey,
            }),
            publicKeySpkiBase64: Buffer.from(publicKey).toString('base64'),
            deviceId,
            deviceLabel: 'Bridge laptop',
            ...verifiedWithBrowserSession,
        });

        expect(enrollResult.success).toBe(true);
        expect(enrollResult.mode).toBe('enroll');

        const trustedSession = service.verifyTrustedDeviceSession({
            user: { _id: userId },
            deviceId,
            deviceSessionToken: enrollResult.deviceSessionToken,
            ...verifiedWithBrowserSession,
        });

        expect(trustedSession).toEqual({ success: true });
    });

    test('offers platform WebAuthn user verification for face or device-unlock enrollment', async () => {
        const userId = '507f1f77bcf86cd799439015';
        const deviceId = 'device_face_auth_123456';
        const origin = 'https://console.aura.test';
        const rpId = 'console.aura.test';

        process.env.NODE_ENV = 'test';
        process.env.AUTH_TRUSTED_DEVICE_PREFER_WEBAUTHN = 'true';
        process.env.AUTH_WEBAUTHN_RP_ID = rpId;
        process.env.AUTH_WEBAUTHN_ORIGIN = origin;
        process.env.AUTH_WEBAUTHN_USER_VERIFICATION = 'required';
        process.env.AUTH_WEBAUTHN_AUTHENTICATOR_ATTACHMENT = 'platform';

        const service = loadServiceWithDbState({
            dbState: { trustedDevices: [] },
            userId,
        });

        const challenge = await service.issueTrustedDeviceChallenge({
            user: {
                _id: userId,
                email: 'face-auth@example.com',
                name: 'Face Auth Member',
                trustedDevices: [],
            },
            deviceId,
            deviceLabel: 'Face auth laptop',
            req: {
                headers: {
                    origin,
                },
            },
        });

        expect(challenge.preferredMethod).toBe('webauthn');
        expect(challenge.availableMethods[0]).toBe('webauthn');
        expect(challenge.webauthn.registrationOptions.authenticatorSelection).toMatchObject({
            authenticatorAttachment: 'platform',
            residentKey: 'preferred',
            userVerification: 'required',
        });
    });

    test('accepts a previously issued trusted-device session after secret rotation when previous secrets are configured', async () => {
        const dbState = { trustedDevices: [] };
        const userId = '507f1f77bcf86cd799439011';
        const deviceId = 'device_rotation_123456';
        const authContext = {
            authUid: 'firebase-uid-2',
            authToken: { iat: 1710001234 },
        };
        const currentSecretV1 = 'trusted-device-secret-v1-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const currentSecretV2 = 'trusted-device-secret-v2-ABCDEFGHIJKLMNOPQRSTUVWXYZ';

        const loadService = ({ currentSecret, currentVersion, previousSecrets = '' }) => {
            let service;
            jest.isolateModules(() => {
                process.env.NODE_ENV = 'test';
                process.env.AUTH_DEVICE_CHALLENGE_SECRET = currentSecret;
                process.env.AUTH_DEVICE_CHALLENGE_SECRET_VERSION = currentVersion;
                process.env.AUTH_DEVICE_CHALLENGE_PREVIOUS_SECRETS = previousSecrets;

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
            return service;
        };

        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { format: 'der', type: 'spki' },
            privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
        });
        const publicKeySpkiBase64 = Buffer.from(publicKey).toString('base64');

        const serviceV1 = loadService({
            currentSecret: currentSecretV1,
            currentVersion: 'td-v1',
        });

        const enrollChallenge = await serviceV1.issueTrustedDeviceChallenge({
            user: { _id: userId, trustedDevices: [] },
            deviceId,
            deviceLabel: 'Rotation laptop',
            ...authContext,
        });

        const enrollResult = await serviceV1.verifyTrustedDeviceChallenge({
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
            deviceLabel: 'Rotation laptop',
            ...authContext,
        });

        expect(enrollResult.success).toBe(true);
        expect(enrollResult.deviceSessionToken.startsWith('td-v1.')).toBe(true);

        const serviceV2 = loadService({
            currentSecret: currentSecretV2,
            currentVersion: 'td-v2',
            previousSecrets: `td-v1:${currentSecretV1}`,
        });

        const trustedSession = serviceV2.verifyTrustedDeviceSession({
            user: { _id: userId },
            deviceId,
            deviceSessionToken: enrollResult.deviceSessionToken,
            ...authContext,
        });

        expect(trustedSession).toEqual({ success: true });

        const rotatedChallenge = await serviceV2.issueTrustedDeviceChallenge({
            user: { _id: userId, trustedDevices: dbState.trustedDevices },
            deviceId,
            deviceLabel: 'Rotation laptop',
            ...authContext,
        });

        expect(rotatedChallenge.token.startsWith('td-v2.')).toBe(true);
    });

    test('does not issue a public bootstrap challenge for browser-key trusted devices', async () => {
        const userId = '507f1f77bcf86cd799439012';
        const deviceId = 'device_browser_bootstrap_123456';
        const { publicKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { format: 'der', type: 'spki' },
            privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
        });
        const service = loadServiceWithDbState({
            dbState: {
                trustedDevices: [{
                    deviceId,
                    label: 'Browser laptop',
                    method: 'browser_key',
                    algorithm: 'RSA-PSS-SHA256',
                    publicKeySpkiBase64: Buffer.from(publicKey).toString('base64'),
                    createdAt: new Date(),
                    lastSeenAt: new Date(),
                    lastVerifiedAt: new Date(),
                }],
            },
            userId,
        });

        const deviceSessionToken = service.issueTrustedDeviceSession({
            user: { _id: userId },
            deviceId,
        }).deviceSessionToken;

        const bootstrapChallenge = await service.issueTrustedDeviceBootstrapChallenge({
            req: {
                headers: {
                    'x-aura-device-id': deviceId,
                    'x-aura-device-label': 'Browser laptop',
                    'x-aura-device-session': deviceSessionToken,
                },
            },
            user: {
                _id: userId,
                trustedDevices: [{
                    deviceId,
                    label: 'Browser laptop',
                    method: 'browser_key',
                    algorithm: 'RSA-PSS-SHA256',
                    publicKeySpkiBase64: Buffer.from(publicKey).toString('base64'),
                    createdAt: new Date(),
                    lastSeenAt: new Date(),
                    lastVerifiedAt: new Date(),
                }],
            },
            scope: 'otp-send:forgot-password',
        });

        expect(bootstrapChallenge).toBeNull();
    });

    test('rejects a bootstrap challenge when the passkey trusted device session proof changes between issue and verify', async () => {
        const dbState = { trustedDevices: [] };
        const userId = '507f1f77bcf86cd799439012';
        const deviceId = 'device_bootstrap_123456';
        const authContext = {
            authUid: 'firebase-uid-bootstrap',
            authToken: { iat: 1710003456 },
        };
        const origin = 'https://console.aura.test';
        const rpId = 'console.aura.test';
        const req = {
            headers: {
                origin,
            },
        };

        process.env.NODE_ENV = 'test';
        process.env.AUTH_TRUSTED_DEVICE_PREFER_WEBAUTHN = 'true';
        process.env.AUTH_WEBAUTHN_RP_ID = rpId;
        process.env.AUTH_WEBAUTHN_ORIGIN = origin;
        process.env.AUTH_WEBAUTHN_USER_VERIFICATION = 'required';

        const service = loadServiceWithDbState({ dbState, userId });
        const webauthnKeyPair = createWebAuthnKeyPair();
        const credentialIdBuffer = crypto.randomBytes(32);

        const enrollChallenge = await service.issueTrustedDeviceChallenge({
            user: { _id: userId, trustedDevices: [] },
            deviceId,
            deviceLabel: 'Bootstrap laptop',
            req,
            ...authContext,
        });

        const registrationCredential = buildWebAuthnRegistrationCredential({
            challenge: enrollChallenge.challenge,
            origin,
            rpId,
            credentialIdBuffer,
            publicJwk: webauthnKeyPair.publicJwk,
        });

        const enrollResult = await service.verifyTrustedDeviceChallenge({
            user: { _id: userId, trustedDevices: [] },
            token: enrollChallenge.token,
            method: 'webauthn',
            credential: registrationCredential,
            deviceId,
            deviceLabel: 'Bootstrap laptop',
            ...authContext,
        });

        const bootstrapChallenge = await service.issueTrustedDeviceBootstrapChallenge({
            req: {
                headers: {
                    origin,
                    'x-aura-device-id': deviceId,
                    'x-aura-device-label': 'Bootstrap laptop',
                    'x-aura-device-session': enrollResult.deviceSessionToken,
                },
            },
            user: { _id: userId, trustedDevices: dbState.trustedDevices },
            scope: 'otp-send:forgot-password',
        });
        expect(bootstrapChallenge).toBeTruthy();
        expect(bootstrapChallenge.availableMethods).toEqual(['webauthn']);
        expect(bootstrapChallenge.preferredMethod).toBe('webauthn');

        const wrongSessionToken = service.issueTrustedDeviceSession({
            user: { _id: userId },
            deviceId,
            authUid: 'firebase-uid-bootstrap-other',
            authToken: { iat: 1710007890 },
        }).deviceSessionToken;
        const assertionCredential = buildWebAuthnAssertionCredential({
            challenge: bootstrapChallenge.challenge,
            origin,
            rpId,
            credentialIdBuffer,
            privateKey: webauthnKeyPair.privateKey,
            signCount: 1,
        });

        const verification = await service.verifyTrustedDeviceChallenge({
            user: { _id: userId, trustedDevices: dbState.trustedDevices },
            token: bootstrapChallenge.token,
            method: 'webauthn',
            credential: assertionCredential,
            deviceId,
            deviceLabel: 'Bootstrap laptop',
            deviceSessionToken: wrongSessionToken,
            expectedScope: 'otp-send:forgot-password',
        });

        expect(verification).toEqual({
            success: false,
            reason: 'Device challenge trusted session mismatch',
        });
    });

    test('keeps localhost enrollment passkey-capable when WebAuthn is preferred', async () => {
        const dbState = { trustedDevices: [] };
        const userId = '507f1f77bcf86cd799439011';
        const deviceId = 'device_localhost_123456';

        process.env.NODE_ENV = 'test';
        process.env.AUTH_TRUSTED_DEVICE_PREFER_WEBAUTHN = 'true';
        delete process.env.AUTH_WEBAUTHN_RP_ID;
        delete process.env.AUTH_WEBAUTHN_ORIGIN;

        const service = loadServiceWithDbState({ dbState, userId });
        const challenge = await service.issueTrustedDeviceChallenge({
            user: {
                _id: userId,
                email: 'admin@example.com',
                name: 'Admin User',
                trustedDevices: [],
            },
            deviceId,
            deviceLabel: 'Localhost laptop',
            req: {
                headers: {
                    origin: 'http://localhost:4173',
                },
            },
        });

        expect(challenge.mode).toBe('enroll');
        expect(challenge.preferredMethod).toBe('webauthn');
        expect(challenge.availableMethods).toEqual(['webauthn', 'browser_key']);
        expect(challenge.webauthn?.registrationOptions?.rp).toEqual({
            id: 'localhost',
            name: 'Aura Trusted Device',
        });
    });

    test('keeps hosted enrollment passkey-capable when the storefront origin is sent explicitly behind a proxy host', async () => {
        const dbState = { trustedDevices: [] };
        const userId = '507f1f77bcf86cd799439011';
        const deviceId = 'device_hosted_proxy_123456';

        process.env.NODE_ENV = 'test';
        process.env.AUTH_TRUSTED_DEVICE_PREFER_WEBAUTHN = 'true';
        delete process.env.AUTH_WEBAUTHN_RP_ID;
        delete process.env.AUTH_WEBAUTHN_ORIGIN;

        const service = loadServiceWithDbState({ dbState, userId });
        const challenge = await service.issueTrustedDeviceChallenge({
            user: {
                _id: userId,
                email: 'admin@example.com',
                name: 'Admin User',
                trustedDevices: [],
            },
            deviceId,
            deviceLabel: 'Hosted laptop',
            req: {
                headers: {
                    host: '13.206.172.186.sslip.io',
                    'x-forwarded-proto': 'https',
                    'x-aura-client-origin': 'https://aurapilot.vercel.app',
                },
            },
        });

        expect(challenge.mode).toBe('enroll');
        expect(challenge.preferredMethod).toBe('webauthn');
        expect(challenge.availableMethods).toEqual(['webauthn', 'browser_key']);
        expect(challenge.webauthn?.registrationOptions?.rp).toEqual({
            id: 'aurapilot.vercel.app',
            name: 'Aura Trusted Device',
        });
    });

    test('suppresses WebAuthn enrollment on 127.0.0.1 and keeps browser-key enrollment available', async () => {
        const dbState = { trustedDevices: [] };
        const userId = '507f1f77bcf86cd799439011';
        const deviceId = 'device_loopback_123456';

        process.env.NODE_ENV = 'test';
        process.env.AUTH_TRUSTED_DEVICE_PREFER_WEBAUTHN = 'true';
        delete process.env.AUTH_WEBAUTHN_RP_ID;
        delete process.env.AUTH_WEBAUTHN_ORIGIN;

        const service = loadServiceWithDbState({ dbState, userId });
        const challenge = await service.issueTrustedDeviceChallenge({
            user: {
                _id: userId,
                email: 'admin@example.com',
                name: 'Admin User',
                trustedDevices: [],
            },
            deviceId,
            deviceLabel: 'Loopback laptop',
            req: {
                headers: {
                    origin: 'http://127.0.0.1:4173',
                },
            },
        });

        expect(challenge.mode).toBe('enroll');
        expect(challenge.preferredMethod).toBe('browser_key');
        expect(challenge.availableMethods).toEqual(['browser_key']);
        expect(challenge.algorithm).toBe('RSA-PSS-SHA256');
        expect(challenge.webauthn).toBeNull();
    });

    test('suppresses WebAuthn enrollment when the configured RP settings do not match the current host', async () => {
        const dbState = { trustedDevices: [] };
        const userId = '507f1f77bcf86cd799439011';
        const deviceId = 'device_rp_mismatch_123456';

        process.env.NODE_ENV = 'test';
        process.env.AUTH_TRUSTED_DEVICE_PREFER_WEBAUTHN = 'true';
        process.env.AUTH_WEBAUTHN_RP_ID = 'app.example.com';
        process.env.AUTH_WEBAUTHN_ORIGIN = 'https://app.example.com';

        const service = loadServiceWithDbState({ dbState, userId });
        const challenge = await service.issueTrustedDeviceChallenge({
            user: {
                _id: userId,
                email: 'admin@example.com',
                name: 'Admin User',
                trustedDevices: [],
            },
            deviceId,
            deviceLabel: 'Mismatch laptop',
            req: {
                headers: {
                    origin: 'http://localhost:4173',
                },
            },
        });

        expect(challenge.mode).toBe('enroll');
        expect(challenge.preferredMethod).toBe('browser_key');
        expect(challenge.availableMethods).toEqual(['browser_key']);
        expect(challenge.webauthn).toBeNull();
    });

    test('enrolls and verifies a WebAuthn trusted device when passkeys are preferred', async () => {
        let service;
        const dbState = { trustedDevices: [] };
        const userId = '507f1f77bcf86cd799439011';
        const deviceId = 'device_passkey_123456';
        const authContext = {
            authUid: 'firebase-uid-passkey',
            authToken: { iat: 1710005678 },
        };
        const origin = 'https://console.aura.test';
        const rpId = 'console.aura.test';
        const req = {
            headers: {
                origin,
            },
        };

        process.env.NODE_ENV = 'test';
        process.env.AUTH_TRUSTED_DEVICE_PREFER_WEBAUTHN = 'true';
        process.env.AUTH_WEBAUTHN_RP_ID = rpId;
        process.env.AUTH_WEBAUTHN_ORIGIN = origin;
        process.env.AUTH_WEBAUTHN_USER_VERIFICATION = 'required';

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

        const webauthnKeyPair = createWebAuthnKeyPair();
        const credentialIdBuffer = crypto.randomBytes(32);
        const baseUser = {
            _id: userId,
            email: 'admin@example.com',
            name: 'Admin User',
        };

        const enrollChallenge = await service.issueTrustedDeviceChallenge({
            user: { ...baseUser, trustedDevices: [] },
            deviceId,
            deviceLabel: 'Passkey laptop',
            req,
            ...authContext,
        });

        expect(enrollChallenge.mode).toBe('enroll');
        expect(enrollChallenge.preferredMethod).toBe('webauthn');
        expect(enrollChallenge.availableMethods).toEqual(['webauthn', 'browser_key']);
        expect(enrollChallenge.webauthn?.registrationOptions).toBeTruthy();

        const registrationCredential = buildWebAuthnRegistrationCredential({
            challenge: enrollChallenge.challenge,
            origin,
            rpId,
            credentialIdBuffer,
            publicJwk: webauthnKeyPair.publicJwk,
        });

        const enrollResult = await service.verifyTrustedDeviceChallenge({
            user: { ...baseUser, trustedDevices: [] },
            token: enrollChallenge.token,
            method: 'webauthn',
            credential: registrationCredential,
            deviceId,
            deviceLabel: 'Passkey laptop',
            ...authContext,
        });

        expect(enrollResult.success).toBe(true);
        expect(enrollResult.mode).toBe('enroll');
        expect(enrollResult.method).toBe('webauthn');
        expect(enrollResult.trustedDevice).toMatchObject({
            deviceId,
            label: 'Passkey laptop',
            method: 'webauthn',
            algorithm: 'WEBAUTHN-ES256',
        });
        expect(dbState.trustedDevices).toHaveLength(1);
        expect(dbState.trustedDevices[0]).toMatchObject({
            deviceId,
            label: 'Passkey laptop',
            method: 'webauthn',
            publicKeySpkiBase64: webauthnKeyPair.publicKeySpkiBase64,
            webauthnCredentialIdBase64Url: registrationCredential.rawIdBase64Url,
            webauthnUserVerification: 'required',
            authenticatorAttachment: 'platform',
        });

        const assertChallenge = await service.issueTrustedDeviceChallenge({
            user: { ...baseUser, trustedDevices: dbState.trustedDevices },
            deviceId,
            deviceLabel: 'Passkey laptop',
            req,
            ...authContext,
        });

        expect(assertChallenge.mode).toBe('assert');
        expect(assertChallenge.availableMethods).toEqual(['webauthn']);
        expect(assertChallenge.registeredMethod).toBe('webauthn');
        expect(assertChallenge.webauthn?.assertionOptions?.allowCredentials).toEqual([
            {
                id: registrationCredential.rawIdBase64Url,
                type: 'public-key',
                transports: ['internal'],
            },
        ]);

        const assertionCredential = buildWebAuthnAssertionCredential({
            challenge: assertChallenge.challenge,
            origin,
            rpId,
            credentialIdBuffer,
            privateKey: webauthnKeyPair.privateKey,
            signCount: 5,
        });

        const assertResult = await service.verifyTrustedDeviceChallenge({
            user: { ...baseUser, trustedDevices: dbState.trustedDevices },
            token: assertChallenge.token,
            method: 'webauthn',
            credential: assertionCredential,
            deviceId,
            deviceLabel: 'Passkey laptop',
            ...authContext,
        });

        expect(assertResult.success).toBe(true);
        expect(assertResult.mode).toBe('assert');
        expect(assertResult.method).toBe('webauthn');
        expect(assertResult.trustedDevice).toMatchObject({
            deviceId,
            label: 'Passkey laptop',
            method: 'webauthn',
            webauthnCounter: 5,
        });
        expect(dbState.trustedDevices[0].webauthnCounter).toBe(5);

        const trustedSession = service.verifyTrustedDeviceSession({
            user: { _id: userId },
            deviceId,
            deviceSessionToken: assertResult.deviceSessionToken,
            ...authContext,
        });

        expect(trustedSession).toEqual({ success: true });
    });
});
