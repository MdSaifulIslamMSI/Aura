const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
    class HeadBucketCommand {
        constructor(input) {
            this.input = input;
        }
    }

    class PutObjectCommand {
        constructor(input) {
            this.input = input;
        }
    }

    class GetObjectCommand {
        constructor(input) {
            this.input = input;
        }
    }

    class S3Client {
        constructor(config) {
            this.config = config;
        }

        send(command) {
            return mockSend(command);
        }
    }

    return {
        GetObjectCommand,
        HeadBucketCommand,
        PutObjectCommand,
        S3Client,
    };
});

describe('reviewMediaStorageService', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        mockSend.mockReset();
        process.env = { ...ORIGINAL_ENV };
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    test('uses local storage by default', async () => {
        delete process.env.UPLOAD_STORAGE_DRIVER;
        const service = require('../services/reviewMediaStorageService');

        expect(service.getStorageDriver()).toBe('local');
    });

    test('stores media in S3 when s3 driver is enabled', async () => {
        process.env.UPLOAD_STORAGE_DRIVER = 's3';
        process.env.AWS_REGION = 'ap-south-1';
        process.env.AWS_S3_REVIEW_BUCKET = 'aura-review-media';

        const { HeadBucketCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
        mockSend.mockImplementation((command) => {
            if (command instanceof HeadBucketCommand) {
                return Promise.resolve({});
            }
            if (command instanceof PutObjectCommand) {
                return Promise.resolve({});
            }
            return Promise.reject(new Error(`Unexpected command: ${command?.constructor?.name || 'unknown'}`));
        });

        const service = require('../services/reviewMediaStorageService');
        const result = await service.storeReviewMedia({
            fileBuffer: Buffer.from('hello'),
            fileName: 'proof.png',
            mimeType: 'image/png',
        });

        expect(service.getStorageDriver()).toBe('s3');
        expect(mockSend).toHaveBeenCalledTimes(2);
        expect(mockSend.mock.calls[0][0].input).toEqual({
            Bucket: 'aura-review-media',
        });
        expect(mockSend.mock.calls[1][0].input).toMatchObject({
            Bucket: 'aura-review-media',
            Key: expect.stringMatching(/^review-media\//),
            ContentType: 'image/png',
            CacheControl: 'public, max-age=31536000, immutable',
        });
        expect(result.storageDriver).toBe('s3');
        expect(result.url).toMatch(/^\/uploads\/reviews\//);
    });
});
