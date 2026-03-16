const createMockRedisClient = ({ nowMsRef }) => {
    const store = new Map();

    const purgeExpired = () => {
        const now = nowMsRef.current;
        for (const [key, record] of store.entries()) {
            if (record.expiresAtMs <= now) {
                store.delete(key);
            }
        }
    };

    return {
        async set(key, value, options = {}) {
            purgeExpired();
            if (options.NX && store.has(key)) {
                return null;
            }
            const ttlSeconds = Number(options.EX || 0);
            if (ttlSeconds <= 0) {
                throw new Error('EX must be positive');
            }
            store.set(key, {
                value,
                expiresAtMs: nowMsRef.current + (ttlSeconds * 1000),
            });
            return 'OK';
        },
        async get(key) {
            purgeExpired();
            return store.get(key)?.value ?? null;
        },
        __store: store,
        __purgeExpired: purgeExpired,
    };
};

describe('uploadSignatureService', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalUploadSigningSecret = process.env.UPLOAD_SIGNING_SECRET;

    afterEach(() => {
        jest.useRealTimers();
        jest.resetModules();
        jest.restoreAllMocks();
        process.env.NODE_ENV = originalNodeEnv;
        process.env.UPLOAD_SIGNING_SECRET = originalUploadSigningSecret;
    });

    test('issues and verifies upload token when signing secret is configured', () => {
        process.env.NODE_ENV = 'test';
        process.env.UPLOAD_SIGNING_SECRET = 'test-upload-signing-secret';

        const {
            createUploadToken,
            verifyUploadToken,
        } = require('../services/uploadSignatureService');

        const { token } = createUploadToken({
            userId: 'u123',
            purpose: 'review-media',
            fileName: 'demo.jpg',
            mimeType: 'image/jpeg',
            maxBytes: 1024,
        });

        const payload = verifyUploadToken(token);
        expect(payload.uid).toBe('u123');
        expect(payload.purpose).toBe('review-media');
        expect(payload.fileName).toBe('demo.jpg');
        expect(payload.mimeType).toBe('image/jpeg');
        expect(payload.maxBytes).toBe(1024);
    });

    test.each(['development', 'staging', 'production'])(
        'throws when UPLOAD_SIGNING_SECRET is missing in %s',
        (nodeEnv) => {
            process.env.NODE_ENV = nodeEnv;
            delete process.env.UPLOAD_SIGNING_SECRET;

            expect(() => createUploadToken({
                userId: 'u123',
                purpose: 'review-media',
                fileName: 'demo.jpg',
                mimeType: 'image/jpeg',
                maxBytes: 1024,
            })).toThrow('UPLOAD_SIGNING_SECRET is required');
        }
    );

    test('does not fallback to JWT_SECRET when UPLOAD_SIGNING_SECRET is missing', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.UPLOAD_SIGNING_SECRET;
        process.env.JWT_SECRET = 'legacy-jwt-secret';

        const { createUploadToken } = require('../services/uploadSignatureService');

        expect(() => createUploadToken({
            userId: 'u123',
            purpose: 'review-media',
            fileName: 'demo.jpg',
            mimeType: 'image/jpeg',
            maxBytes: 1024,
        })).toThrow('UPLOAD_SIGNING_SECRET is required');
    });

    test('allows only one parallel nonce consumption for the same token', async () => {
        process.env.NODE_ENV = 'test';
        process.env.UPLOAD_SIGNING_SECRET = 'test-upload-signing-secret';

        const nowMsRef = { current: Date.now() };
        const redisClient = createMockRedisClient({ nowMsRef });

        jest.doMock('../config/redis', () => ({
            getRedisClient: () => redisClient,
            flags: { redisPrefix: 'aura-test' },
        }));

        const {
            createUploadToken,
            verifyAndConsumeUploadToken,
        } = require('../services/uploadSignatureService');

        const { token } = createUploadToken({
            userId: 'u123',
            purpose: 'review-media',
            fileName: 'demo.jpg',
            mimeType: 'image/jpeg',
            maxBytes: 1024,
        });

        const [first, second] = await Promise.allSettled([
            verifyAndConsumeUploadToken(token),
            verifyAndConsumeUploadToken(token),
        ]);

        const fulfilledCount = [first, second].filter((result) => result.status === 'fulfilled').length;
        const rejected = [first, second].find((result) => result.status === 'rejected');

        expect(fulfilledCount).toBe(1);
        expect(rejected.status).toBe('rejected');
        expect(rejected.reason.message).toBe('Upload token already used');
    });

    test('enforces one-time nonce usage across simulated service instances via shared redis', async () => {
        process.env.NODE_ENV = 'test';
        process.env.UPLOAD_SIGNING_SECRET = 'test-upload-signing-secret';

        const nowMsRef = { current: Date.now() };
        const sharedRedis = createMockRedisClient({ nowMsRef });

        jest.doMock('../config/redis', () => ({
            getRedisClient: () => sharedRedis,
            flags: { redisPrefix: 'aura-test' },
        }));

        const firstInstance = require('../services/uploadSignatureService');
        const { token } = firstInstance.createUploadToken({
            userId: 'u123',
            purpose: 'review-media',
            fileName: 'demo.jpg',
            mimeType: 'image/jpeg',
            maxBytes: 1024,
        });

        jest.resetModules();
        jest.doMock('../config/redis', () => ({
            getRedisClient: () => sharedRedis,
            flags: { redisPrefix: 'aura-test' },
        }));

        const secondInstance = require('../services/uploadSignatureService');

        await expect(firstInstance.verifyAndConsumeUploadToken(token)).resolves.toMatchObject({ uid: 'u123' });
        await expect(secondInstance.verifyAndConsumeUploadToken(token)).rejects.toThrow('Upload token already used');
    });

    test('stores nonce with ttl and redis cleanup expires it automatically', async () => {
        process.env.NODE_ENV = 'test';
        process.env.UPLOAD_SIGNING_SECRET = 'test-upload-signing-secret';

        const initialNow = Date.now();
        const nowMsRef = { current: initialNow };
        const redisClient = createMockRedisClient({ nowMsRef });

        jest.doMock('../config/redis', () => ({
            getRedisClient: () => redisClient,
            flags: { redisPrefix: 'aura-test' },
        }));

        const {
            createUploadToken,
            verifyAndConsumeUploadToken,
        } = require('../services/uploadSignatureService');

        const { token } = createUploadToken({
            userId: 'u123',
            purpose: 'review-media',
            fileName: 'demo.jpg',
            mimeType: 'image/jpeg',
            maxBytes: 1024,
            ttlSeconds: 60,
        });

        await verifyAndConsumeUploadToken(token);
        expect(redisClient.__store.size).toBe(1);

        nowMsRef.current = initialNow + (61 * 1000);
        redisClient.__purgeExpired();

        expect(redisClient.__store.size).toBe(0);
    });
});
