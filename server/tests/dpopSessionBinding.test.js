const crypto = require('crypto');
const request = require('supertest');
const app = require('../index');
const User = require('../models/User');
const browserSessionService = require('../services/browserSessionService');
const { SESSION_COOKIE_NAME } = require('../services/browserSessionService');
const { createTestUser } = require('./helpers/securityTestHelpers');

const generateClientKeyPair = () => {
    return crypto.generateKeyPairSync('ec', {
        namedCurve: 'P-256'
    });
};

const generateDpopProof = (privateKey, publicKey, method, url, jti, iat) => {
    const jwk = publicKey.export({ format: 'jwk' });
    const header = {
        typ: 'dpop+jwt',
        alg: 'ES256',
        jwk: {
            kty: jwk.kty,
            crv: jwk.crv,
            x: jwk.x,
            y: jwk.y
        }
    };
    const payload = {
        jti: jti || crypto.randomBytes(16).toString('hex'),
        htm: method.toUpperCase(),
        htu: url,
        iat: iat !== undefined ? iat : Math.floor(Date.now() / 1000)
    };

    const headerBase64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signingInput = `${headerBase64}.${payloadBase64}`;

    const signature = crypto.sign(
        'sha256',
        Buffer.from(signingInput),
        {
            key: privateKey,
            dsaEncoding: 'ieee-p1363'
        }
    );
    const signatureBase64 = signature.toString('base64url');
    return `${signingInput}.${signatureBase64}`;
};

describe('DPoP Session Binding Integration Security', () => {
    let originalDpopRequired;
    let testUser;
    let clientKeyPair;
    let anotherKeyPair;

    beforeAll(async () => {
        originalDpopRequired = process.env.AUTH_DPOP_REQUIRED;
        clientKeyPair = generateClientKeyPair();
        anotherKeyPair = generateClientKeyPair();
    });

    afterAll(async () => {
        process.env.AUTH_DPOP_REQUIRED = originalDpopRequired;
    });

    beforeEach(async () => {
        process.env.AUTH_DPOP_REQUIRED = 'false';
        testUser = await createTestUser();
    });

    afterEach(async () => {
        process.env.AUTH_DPOP_REQUIRED = 'false';
        if (testUser && testUser._id) {
            await browserSessionService.revokeBrowserSessionsForUser(testUser._id);
            await User.deleteOne({ _id: testUser._id });
        }
        testUser = null;
    });

    test('1. Sessions established with a DPoP proof bind the client public JWK', async () => {
        const dummyReq = {
            method: 'POST',
            path: '/api/auth/exchange',
            headers: {
                dpop: generateDpopProof(clientKeyPair.privateKey, clientKeyPair.publicKey, 'POST', 'http://localhost/api/auth/exchange')
            },
            secure: false
        };

        const session = await browserSessionService.createBrowserSession({
            req: dummyReq,
            user: testUser,
            authUid: testUser.authUid,
            authToken: {
                exp: Math.floor(Date.now() / 1000) + 3600,
                firebase: { sign_in_provider: 'password' }
            }
        });

        expect(session.dpopJwk).toBeDefined();
        expect(session.dpopJwk.kty).toBe('EC');
        expect(session.dpopJwk.crv).toBe('P-256');
        expect(session.dpopJwk.x).toBeDefined();
        expect(session.dpopJwk.y).toBeDefined();

        await browserSessionService.revokeBrowserSession(session.sessionId);
    });

    test('2. Request with valid cookie and valid matching DPoP proof succeeds', async () => {
        const dummyReq = {
            method: 'GET',
            path: '/api/auth/session',
            headers: {
                dpop: generateDpopProof(clientKeyPair.privateKey, clientKeyPair.publicKey, 'GET', 'http://localhost/api/auth/session')
            },
            secure: false
        };

        const session = await browserSessionService.createBrowserSession({
            req: dummyReq,
            user: testUser,
            authUid: testUser.authUid,
            authToken: {
                exp: Math.floor(Date.now() / 1000) + 3600,
                firebase: { sign_in_provider: 'password' }
            }
        });

        await expect(browserSessionService.getBrowserSession(session.sessionId)).resolves.toMatchObject({
            sessionId: session.sessionId,
        });

        // Make requests using Supertest
        const validProof = generateDpopProof(clientKeyPair.privateKey, clientKeyPair.publicKey, 'GET', 'http://localhost/api/auth/session');

        await request(app)
            .get('/api/auth/session')
            .set('Cookie', `${SESSION_COOKIE_NAME}=${session.sessionId}`)
            .set('DPoP', validProof)
            .expect(200);

        await browserSessionService.revokeBrowserSession(session.sessionId);
    });

    test('3. Request with valid cookie but missing DPoP proof is rejected when session is bound', async () => {
        const dummyReq = {
            method: 'GET',
            path: '/api/auth/session',
            headers: {
                dpop: generateDpopProof(clientKeyPair.privateKey, clientKeyPair.publicKey, 'GET', 'http://localhost/api/auth/session')
            },
            secure: false
        };

        const session = await browserSessionService.createBrowserSession({
            req: dummyReq,
            user: testUser,
            authUid: testUser.authUid,
            authToken: {
                exp: Math.floor(Date.now() / 1000) + 3600,
                firebase: { sign_in_provider: 'password' }
            }
        });

        const res = await request(app)
            .get('/api/auth/session')
            .set('Cookie', `${SESSION_COOKIE_NAME}=${session.sessionId}`)
            .expect(401);

        expect(res.body.message).toContain('DPoP header is required');

        await browserSessionService.revokeBrowserSession(session.sessionId);
    });

    test('4. Request with valid cookie but mismatched DPoP public key is rejected', async () => {
        const dummyReq = {
            method: 'GET',
            path: '/api/auth/session',
            headers: {
                dpop: generateDpopProof(clientKeyPair.privateKey, clientKeyPair.publicKey, 'GET', 'http://localhost/api/auth/session')
            },
            secure: false
        };

        const session = await browserSessionService.createBrowserSession({
            req: dummyReq,
            user: testUser,
            authUid: testUser.authUid,
            authToken: {
                exp: Math.floor(Date.now() / 1000) + 3600,
                firebase: { sign_in_provider: 'password' }
            }
        });

        // Sign DPoP proof with a different key pair
        const mismatchedProof = generateDpopProof(anotherKeyPair.privateKey, anotherKeyPair.publicKey, 'GET', 'http://localhost/api/auth/session');

        const res = await request(app)
            .get('/api/auth/session')
            .set('Cookie', `${SESSION_COOKIE_NAME}=${session.sessionId}`)
            .set('DPoP', mismatchedProof)
            .expect(401);

        expect(res.body.message).toContain('DPoP key binding mismatch');

        await browserSessionService.revokeBrowserSession(session.sessionId);
    });

    test('5. Request with replayed DPoP jti is rejected', async () => {
        const dummyReq = {
            method: 'GET',
            path: '/api/auth/session',
            headers: {
                dpop: generateDpopProof(clientKeyPair.privateKey, clientKeyPair.publicKey, 'GET', 'http://localhost/api/auth/session')
            },
            secure: false
        };

        const session = await browserSessionService.createBrowserSession({
            req: dummyReq,
            user: testUser,
            authUid: testUser.authUid,
            authToken: {
                exp: Math.floor(Date.now() / 1000) + 3600,
                firebase: { sign_in_provider: 'password' }
            }
        });

        const jti = 'jti-replay-test-12345';
        const proof1 = generateDpopProof(clientKeyPair.privateKey, clientKeyPair.publicKey, 'GET', 'http://localhost/api/auth/session', jti);
        const proof2 = generateDpopProof(clientKeyPair.privateKey, clientKeyPair.publicKey, 'GET', 'http://localhost/api/auth/session', jti);

        // First request is successful
        await request(app)
            .get('/api/auth/session')
            .set('Cookie', `${SESSION_COOKIE_NAME}=${session.sessionId}`)
            .set('DPoP', proof1)
            .expect(200);

        // Second request with same JTI fails
        const res = await request(app)
            .get('/api/auth/session')
            .set('Cookie', `${SESSION_COOKIE_NAME}=${session.sessionId}`)
            .set('DPoP', proof2)
            .expect(401);

        expect(res.body.message).toContain('DPoP jti replay detected');

        await browserSessionService.revokeBrowserSession(session.sessionId);
    });

    test('6. Request with expired DPoP proof (iat too old) is rejected', async () => {
        const dummyReq = {
            method: 'GET',
            path: '/api/auth/session',
            headers: {
                dpop: generateDpopProof(clientKeyPair.privateKey, clientKeyPair.publicKey, 'GET', 'http://localhost/api/auth/session')
            },
            secure: false
        };

        const session = await browserSessionService.createBrowserSession({
            req: dummyReq,
            user: testUser,
            authUid: testUser.authUid,
            authToken: {
                exp: Math.floor(Date.now() / 1000) + 3600,
                firebase: { sign_in_provider: 'password' }
            }
        });

        // 10 minutes ago
        const expiredProof = generateDpopProof(clientKeyPair.privateKey, clientKeyPair.publicKey, 'GET', 'http://localhost/api/auth/session', null, Math.floor(Date.now() / 1000) - 600);

        const res = await request(app)
            .get('/api/auth/session')
            .set('Cookie', `${SESSION_COOKIE_NAME}=${session.sessionId}`)
            .set('DPoP', expiredProof)
            .expect(401);

        expect(res.body.message).toContain('DPoP proof expired');

        await browserSessionService.revokeBrowserSession(session.sessionId);
    });

    test('7. Request with mismatched HTM / HTU is rejected', async () => {
        const dummyReq = {
            method: 'GET',
            path: '/api/auth/session',
            headers: {
                dpop: generateDpopProof(clientKeyPair.privateKey, clientKeyPair.publicKey, 'GET', 'http://localhost/api/auth/session')
            },
            secure: false
        };

        const session = await browserSessionService.createBrowserSession({
            req: dummyReq,
            user: testUser,
            authUid: testUser.authUid,
            authToken: {
                exp: Math.floor(Date.now() / 1000) + 3600,
                firebase: { sign_in_provider: 'password' }
            }
        });

        // Mismatched HTTP Method (signed POST, request is GET)
        const mismatchedMethodProof = generateDpopProof(clientKeyPair.privateKey, clientKeyPair.publicKey, 'POST', 'http://localhost/api/auth/session');
        const resMethod = await request(app)
            .get('/api/auth/session')
            .set('Cookie', `${SESSION_COOKIE_NAME}=${session.sessionId}`)
            .set('DPoP', mismatchedMethodProof)
            .expect(401);

        expect(resMethod.body.message).toContain('HTM mismatch');

        // Mismatched HTU path (signed /api/auth/other, request is /api/auth/session)
        const mismatchedPathProof = generateDpopProof(clientKeyPair.privateKey, clientKeyPair.publicKey, 'GET', 'http://localhost/api/auth/other');
        const resPath = await request(app)
            .get('/api/auth/session')
            .set('Cookie', `${SESSION_COOKIE_NAME}=${session.sessionId}`)
            .set('DPoP', mismatchedPathProof)
            .expect(401);

        expect(resPath.body.message).toContain('HTU pathname mismatch');

        await browserSessionService.revokeBrowserSession(session.sessionId);
    });
});
