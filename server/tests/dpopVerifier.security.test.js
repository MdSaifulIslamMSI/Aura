const crypto = require('crypto');

let mockRedisClient = null;

jest.mock('../config/redis', () => ({
    getRedisClient: () => mockRedisClient,
    flags: { redisPrefix: 'test' },
}));

jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
}));

const { verifyDpopProof } = require('../utils/dpop');

const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

const createProof = ({ jti, path = '/api/auth/session' } = {}) => {
    const publicJwk = keyPair.publicKey.export({ format: 'jwk' });
    const header = {
        typ: 'dpop+jwt',
        alg: 'ES256',
        jwk: {
            kty: publicJwk.kty,
            crv: publicJwk.crv,
            x: publicJwk.x,
            y: publicJwk.y,
        },
    };
    const payload = {
        htm: 'GET',
        htu: `https://api.example.test${path}`,
        iat: Math.floor(Date.now() / 1000),
        jti,
    };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = crypto.sign('sha256', Buffer.from(signingInput), {
        key: keyPair.privateKey,
        dsaEncoding: 'ieee-p1363',
    });
    return `${signingInput}.${signature.toString('base64url')}`;
};

const createRequest = (proof, path = '/api/auth/session') => ({
    method: 'GET',
    originalUrl: path,
    headers: { dpop: proof },
    get: (name) => (String(name).toLowerCase() === 'dpop' ? proof : ''),
});

describe('DPoP verifier fail-closed behavior', () => {
    beforeEach(() => {
        mockRedisClient = null;
    });

    test('rejects non-string jti values that evade process-local replay equality', async () => {
        const proof = createProof({ jti: { replayKey: 'same-value' } });

        await expect(verifyDpopProof(createRequest(proof))).resolves.toMatchObject({
            success: false,
            reason: 'Invalid jti claim',
        });
    });

    test('fails closed when the distributed replay store errors', async () => {
        mockRedisClient = {
            set: jest.fn().mockRejectedValue(new Error('redis unavailable')),
        };
        const proof = createProof({ jti: crypto.randomUUID() });

        await expect(verifyDpopProof(createRequest(proof))).resolves.toMatchObject({
            success: false,
            reason: 'DPoP replay protection unavailable',
        });
    });
});
