const {
    findDangerousPayloadKeys,
    validateSensitiveJsonPayload,
} = require('../../security/payloadHardeningService');
const {
    isDeniedHostname,
    isDeniedIpAddress,
    validateRemoteFetchUrl,
} = require('../../security/remoteFetchGuardService');
const { validateUploadBuffer } = require('../../services/uploadSecurityPipeline');

describe('payload and remote-fetch hardening', () => {
    test('prototype pollution payload is rejected', () => {
        const payload = JSON.parse('{"safe":true,"__proto__":{"admin":true}}');

        expect(findDangerousPayloadKeys(payload)).toContain('__proto__');
        expect(() => validateSensitiveJsonPayload({
            payload,
            allowedFields: ['safe'],
        })).toThrow('Request payload failed security validation.');
    });

    test('unknown JSON fields are rejected on sensitive route', () => {
        expect(() => validateSensitiveJsonPayload({
            payload: { amount: 100, isAdmin: true },
            allowedFields: ['amount'],
        })).toThrow('Request payload failed security validation.');
    });

    test('SSRF localhost and metadata IPs are rejected', async () => {
        expect(isDeniedHostname('localhost')).toBe(true);
        expect(isDeniedIpAddress('169.254.169.254')).toBe(true);
        await expect(validateRemoteFetchUrl({ url: 'http://127.0.0.1/admin' }))
            .rejects
            .toThrow('Remote URL is not allowed.');
        await expect(validateRemoteFetchUrl({ url: 'http://169.254.169.254/latest/meta-data' }))
            .rejects
            .toThrow('Remote URL is not allowed.');
    });

    test('executable upload is rejected before scanning', async () => {
        await expect(validateUploadBuffer({
            fileBuffer: Buffer.from('MZfake-executable'),
            fileName: 'payload.exe',
            mimeType: 'application/x-msdownload',
            purpose: 'test',
        })).rejects.toThrow('Unsupported upload file type.');
    });

    test('oversized upload is rejected', async () => {
        await expect(validateUploadBuffer({
            fileBuffer: Buffer.from([0x89, 0x50, 0x4E, 0x47, 1, 2, 3, 4]),
            fileName: 'image.png',
            mimeType: 'image/png',
            maxBytes: 4,
            purpose: 'test',
        })).rejects.toThrow('Uploaded file is too large.');
    });
});
