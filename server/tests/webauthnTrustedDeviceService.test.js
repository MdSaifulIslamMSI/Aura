const crypto = require('crypto');
const cbor = require('cbor');

const sha256 = (input) => crypto.createHash('sha256').update(input).digest();
const toBase64Url = (input) => Buffer.from(input).toString('base64url');

const createEcKeyPair = () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
    });
    return {
        privateKey,
        publicJwk: publicKey.export({ format: 'jwk' }),
        publicKeySpkiBase64: Buffer.from(
            publicKey.export({ format: 'der', type: 'spki' })
        ).toString('base64'),
    };
};

const buildClientData = ({
    type,
    challenge,
    origin,
    crossOrigin = false,
    topOrigin,
}) => Buffer.from(JSON.stringify({
    type,
    challenge,
    origin,
    crossOrigin,
    ...(topOrigin ? { topOrigin } : {}),
}), 'utf8');

const buildCoseEcKey = ({ publicJwk, algorithm = -7 }) => cbor.encode(new Map([
    [1, 2],
    [3, algorithm],
    [-1, 1],
    [-2, Buffer.from(publicJwk.x, 'base64url')],
    [-3, Buffer.from(publicJwk.y, 'base64url')],
]));

const buildRegistrationAuthData = ({
    rpId,
    credentialId,
    publicJwk,
    algorithm = -7,
    backupEligible = false,
    backedUp = false,
    userVerified = true,
    credentialLengthOverride,
}) => {
    const flags = 0x01
        | (userVerified ? 0x04 : 0)
        | 0x40
        | (backupEligible ? 0x08 : 0)
        | (backedUp ? 0x10 : 0);
    const signCount = Buffer.alloc(4);
    const credentialLength = Buffer.alloc(2);
    credentialLength.writeUInt16BE(
        credentialLengthOverride === undefined ? credentialId.length : credentialLengthOverride,
        0
    );
    return Buffer.concat([
        sha256(Buffer.from(rpId, 'utf8')),
        Buffer.from([flags]),
        signCount,
        Buffer.alloc(16),
        credentialLength,
        credentialId,
        buildCoseEcKey({ publicJwk, algorithm }),
    ]);
};

const buildRegistrationCredential = ({
    challenge,
    origin,
    rpId,
    credentialId,
    rawId = credentialId,
    publicJwk,
    type = 'public-key',
    format = 'none',
    attestationStatement = {},
    algorithm = -7,
    backupEligible = false,
    backedUp = false,
    userVerified = true,
    crossOrigin = false,
    credentialLengthOverride,
}) => {
    const clientData = buildClientData({
        type: 'webauthn.create',
        challenge,
        origin,
        crossOrigin,
    });
    const attestationObject = cbor.encode({
        fmt: format,
        attStmt: attestationStatement,
        authData: buildRegistrationAuthData({
            rpId,
            credentialId,
            publicJwk,
            algorithm,
            backupEligible,
            backedUp,
            userVerified,
            credentialLengthOverride,
        }),
    });
    return {
        id: toBase64Url(rawId),
        rawIdBase64Url: toBase64Url(rawId),
        type,
        authenticatorAttachment: 'platform',
        response: {
            clientDataJSONBase64Url: toBase64Url(clientData),
            attestationObjectBase64Url: toBase64Url(attestationObject),
            transports: ['internal'],
        },
    };
};

const buildAssertionCredential = ({
    challenge,
    origin,
    rpId,
    credentialId,
    privateKey,
    signCount = 1,
    userHandle = null,
    type = 'public-key',
    backupEligible = false,
    backedUp = false,
    userVerified = true,
    crossOrigin = false,
    trailingBytes = Buffer.alloc(0),
}) => {
    const clientData = buildClientData({
        type: 'webauthn.get',
        challenge,
        origin,
        crossOrigin,
    });
    const flags = 0x01
        | (userVerified ? 0x04 : 0)
        | (backupEligible ? 0x08 : 0)
        | (backedUp ? 0x10 : 0);
    const signCountBuffer = Buffer.alloc(4);
    signCountBuffer.writeUInt32BE(signCount, 0);
    const authenticatorData = Buffer.concat([
        sha256(Buffer.from(rpId, 'utf8')),
        Buffer.from([flags]),
        signCountBuffer,
        trailingBytes,
    ]);
    const signature = crypto.sign('sha256', Buffer.concat([
        authenticatorData,
        sha256(clientData),
    ]), privateKey);
    return {
        id: toBase64Url(credentialId),
        rawIdBase64Url: toBase64Url(credentialId),
        type,
        response: {
            clientDataJSONBase64Url: toBase64Url(clientData),
            authenticatorDataBase64Url: toBase64Url(authenticatorData),
            signatureBase64Url: toBase64Url(signature),
            userHandleBase64Url: userHandle ? toBase64Url(userHandle) : '',
        },
    };
};

describe('webauthnTrustedDeviceService', () => {
    const challenge = toBase64Url(Buffer.alloc(32, 7));
    const origin = 'https://console.aura.test';
    const rpId = 'console.aura.test';

    beforeEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = 'test';
        delete process.env.AUTH_WEBAUTHN_ORIGIN;
        delete process.env.AUTH_WEBAUTHN_RP_ID;
    });

    test('accepts a strict none-attestation registration and records backup state', () => {
        const service = require('../services/webauthnTrustedDeviceService');
        const keyPair = createEcKeyPair();
        const credentialId = crypto.randomBytes(32);
        const result = service.verifyWebAuthnRegistration({
            credential: buildRegistrationCredential({
                challenge,
                origin,
                rpId,
                credentialId,
                publicJwk: keyPair.publicJwk,
                backupEligible: true,
                backedUp: true,
            }),
            expectedChallenge: challenge,
            expectedOrigin: origin,
            expectedRpId: rpId,
        });

        expect(result).toMatchObject({
            algorithm: 'WEBAUTHN-ES256',
            credentialIdBase64Url: toBase64Url(credentialId),
            backupEligible: true,
            backedUp: true,
            userVerified: true,
        });
    });

    test('records a preferred ceremony without UV as user-present rather than MFA', () => {
        const service = require('../services/webauthnTrustedDeviceService');
        const keyPair = createEcKeyPair();
        const credentialId = crypto.randomBytes(32);
        const result = service.verifyWebAuthnAssertion({
            credential: buildAssertionCredential({
                challenge,
                origin,
                rpId,
                credentialId,
                privateKey: keyPair.privateKey,
                userVerified: false,
            }),
            expectedChallenge: challenge,
            expectedOrigin: origin,
            expectedRpId: rpId,
            userVerification: 'preferred',
            storedPublicKeySpkiBase64: keyPair.publicKeySpkiBase64,
            storedCredentialIdBase64Url: toBase64Url(credentialId),
        });

        expect(result).toMatchObject({
            userVerification: 'preferred',
            userVerified: false,
        });
    });

    test.each([
        ['a non-public-key credential', { type: 'password' }, /type must be public-key/i],
        ['an unsupported COSE algorithm', { algorithm: -8 }, /unsupported WebAuthn EC credential/i],
        ['a non-none attestation statement', { format: 'packed', attestationStatement: { sig: Buffer.alloc(64) } }, /none attestation/i],
        ['a cross-origin ceremony', { crossOrigin: true }, /cross-origin/i],
        ['an impossible backup state', { backedUp: true }, /backup state is inconsistent/i],
        ['a malformed credential length', { credentialLengthOverride: 4096 }, /credential ID length is invalid/i],
    ])('rejects registration with %s', (_label, overrides, expectedError) => {
        const service = require('../services/webauthnTrustedDeviceService');
        const keyPair = createEcKeyPair();
        const credentialId = crypto.randomBytes(32);
        expect(() => service.verifyWebAuthnRegistration({
            credential: buildRegistrationCredential({
                challenge,
                origin,
                rpId,
                credentialId,
                publicJwk: keyPair.publicJwk,
                ...overrides,
            }),
            expectedChallenge: challenge,
            expectedOrigin: origin,
            expectedRpId: rpId,
        })).toThrow(expectedError);
    });

    test('rejects registration when rawId does not match the attested credential ID', () => {
        const service = require('../services/webauthnTrustedDeviceService');
        const keyPair = createEcKeyPair();
        expect(() => service.verifyWebAuthnRegistration({
            credential: buildRegistrationCredential({
                challenge,
                origin,
                rpId,
                credentialId: crypto.randomBytes(32),
                rawId: crypto.randomBytes(32),
                publicJwk: keyPair.publicJwk,
            }),
            expectedChallenge: challenge,
            expectedOrigin: origin,
            expectedRpId: rpId,
        })).toThrow(/attested credential ID mismatch/i);
    });

    test('verifies an assertion, user handle, counter, and backup flags together', () => {
        const service = require('../services/webauthnTrustedDeviceService');
        const keyPair = createEcKeyPair();
        const credentialId = crypto.randomBytes(32);
        const userHandle = Buffer.from('507f1f77bcf86cd799439011', 'utf8');
        const result = service.verifyWebAuthnAssertion({
            credential: buildAssertionCredential({
                challenge,
                origin,
                rpId,
                credentialId,
                privateKey: keyPair.privateKey,
                signCount: 5,
                userHandle,
                backupEligible: true,
                backedUp: true,
            }),
            expectedChallenge: challenge,
            expectedOrigin: origin,
            expectedRpId: rpId,
            storedPublicKeySpkiBase64: keyPair.publicKeySpkiBase64,
            storedCredentialIdBase64Url: toBase64Url(credentialId),
            storedCounter: 4,
            expectedUserHandleBase64Url: toBase64Url(userHandle),
        });

        expect(result).toMatchObject({
            counter: 5,
            credentialIdBase64Url: toBase64Url(credentialId),
            backupEligible: true,
            backedUp: true,
        });
    });

    test('rejects an assertion with a mismatched user handle', () => {
        const service = require('../services/webauthnTrustedDeviceService');
        const keyPair = createEcKeyPair();
        const credentialId = crypto.randomBytes(32);
        expect(() => service.verifyWebAuthnAssertion({
            credential: buildAssertionCredential({
                challenge,
                origin,
                rpId,
                credentialId,
                privateKey: keyPair.privateKey,
                userHandle: Buffer.from('wrong-user', 'utf8'),
            }),
            expectedChallenge: challenge,
            expectedOrigin: origin,
            expectedRpId: rpId,
            storedPublicKeySpkiBase64: keyPair.publicKeySpkiBase64,
            storedCredentialIdBase64Url: toBase64Url(credentialId),
            expectedUserHandleBase64Url: toBase64Url(Buffer.from('expected-user', 'utf8')),
        })).toThrow(/user handle mismatch/i);
    });

    test('rejects assertion authenticator data with unflagged trailing bytes', () => {
        const service = require('../services/webauthnTrustedDeviceService');
        const keyPair = createEcKeyPair();
        const credentialId = crypto.randomBytes(32);
        expect(() => service.verifyWebAuthnAssertion({
            credential: buildAssertionCredential({
                challenge,
                origin,
                rpId,
                credentialId,
                privateKey: keyPair.privateKey,
                trailingBytes: Buffer.from([0]),
            }),
            expectedChallenge: challenge,
            expectedOrigin: origin,
            expectedRpId: rpId,
            storedPublicKeySpkiBase64: keyPair.publicKeySpkiBase64,
            storedCredentialIdBase64Url: toBase64Url(credentialId),
        })).toThrow(/unexpected trailing bytes/i);
    });

    test('uses configured production origin and ignores the compatibility origin header', () => {
        process.env.NODE_ENV = 'production';
        process.env.AUTH_WEBAUTHN_ORIGIN = 'https://app.example.com';
        process.env.AUTH_WEBAUTHN_RP_ID = 'example.com';
        jest.resetModules();
        const service = require('../services/webauthnTrustedDeviceService');

        const context = service.resolveWebAuthnRequestContext({
            headers: {
                host: 'internal-api.local',
                'x-aura-client-origin': 'https://evil.example.net',
            },
        });

        expect(context.origin).toBe('https://app.example.com');
        expect(context.rpId).toBe('example.com');
        expect(context.isEnrollmentEligible).toBe(true);
    });

    test('marks production enrollment ineligible when the browser origin conflicts with configuration', () => {
        process.env.NODE_ENV = 'production';
        process.env.AUTH_WEBAUTHN_ORIGIN = 'https://app.example.com';
        process.env.AUTH_WEBAUTHN_RP_ID = 'example.com';
        jest.resetModules();
        const service = require('../services/webauthnTrustedDeviceService');

        const context = service.resolveWebAuthnRequestContext({
            headers: { origin: 'https://evil.example.net' },
        });

        expect(context.origin).toBe('https://app.example.com');
        expect(context.isEnrollmentEligible).toBe(false);
        expect(context.enrollmentIneligibilityReason).toMatch(/does not match the browser origin/i);
    });

    test('fails closed when production WebAuthn origin configuration is missing', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.AUTH_WEBAUTHN_ORIGIN;
        delete process.env.AUTH_WEBAUTHN_RP_ID;
        jest.resetModules();
        const service = require('../services/webauthnTrustedDeviceService');

        expect(() => service.resolveWebAuthnRequestContext({
            headers: {
                host: 'app.example.com',
                origin: 'https://app.example.com',
            },
        })).toThrow(/production WebAuthn requires/i);
    });
});
