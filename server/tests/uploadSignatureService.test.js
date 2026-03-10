const {
    createUploadToken,
    verifyUploadToken,
} = require('../services/uploadSignatureService');

describe('uploadSignatureService', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalUploadSigningSecret = process.env.UPLOAD_SIGNING_SECRET;
    const originalJwtSecret = process.env.JWT_SECRET;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        process.env.UPLOAD_SIGNING_SECRET = originalUploadSigningSecret;
        process.env.JWT_SECRET = originalJwtSecret;
    });

    test('issues and verifies upload token when signing secret is configured', () => {
        process.env.NODE_ENV = 'test';
        process.env.UPLOAD_SIGNING_SECRET = 'test-upload-signing-secret';

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

    test('fails closed in production when upload signing secret is missing', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.UPLOAD_SIGNING_SECRET;
        delete process.env.JWT_SECRET;

        expect(() => createUploadToken({
            userId: 'u123',
            purpose: 'review-media',
            fileName: 'demo.jpg',
            mimeType: 'image/jpeg',
            maxBytes: 1024,
        })).toThrow('UPLOAD_SIGNING_SECRET is required in production');
    });
});
