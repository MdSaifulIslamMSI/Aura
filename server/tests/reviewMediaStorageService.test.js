const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
    class CopyObjectCommand {
        constructor(input) {
            this.input = input;
        }
    }

    class DeleteObjectCommand {
        constructor(input) {
            this.input = input;
        }
    }

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
        CopyObjectCommand,
        DeleteObjectCommand,
        GetObjectCommand,
        HeadBucketCommand,
        PutObjectCommand,
        S3Client,
    };
});

describe('reviewMediaStorageService', () => {
    const ORIGINAL_ENV = { ...process.env };
    let tempDirs = [];

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        mockSend.mockReset();
        process.env = { ...ORIGINAL_ENV };
        tempDirs = [];
    });

    afterEach(() => {
        const fs = require('fs');
        for (const tempDir of tempDirs) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    const makeTempUploadDir = () => {
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-review-media-'));
        tempDirs.push(tempDir);
        return tempDir;
    };

    test('uses local storage by default', async () => {
        delete process.env.UPLOAD_STORAGE_DRIVER;
        const service = require('../services/reviewMediaStorageService');

        expect(service.getStorageDriver()).toBe('local');
    });

    test('blocks pending and infected local quarantine objects from serving', async () => {
        process.env.REVIEW_UPLOAD_DIR = makeTempUploadDir();
        const service = require('../services/reviewMediaStorageService');
        const pending = await service.quarantineReviewMedia({
            fileBuffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
            fileName: 'proof.png',
            mimeType: 'image/png',
        });

        expect(pending.scanStatus).toBe(service.REVIEW_MEDIA_SCAN_STATES.PENDING);
        await expect(service.getReviewMediaObject({ storageKey: pending.storageKey }))
            .rejects.toMatchObject({ code: 404 });

        await service.markReviewMediaScanState({
            storageKey: pending.storageKey,
            quarantineKey: pending.quarantineKey,
            scanStatus: service.REVIEW_MEDIA_SCAN_STATES.INFECTED,
            mimeType: 'image/png',
            scanResult: {
                engines: [{ engine: 'builtin-eicar', status: 'infected', signature: 'EICAR-Test-Signature' }],
            },
        });

        await expect(service.getReviewMediaObject({ storageKey: pending.storageKey }))
            .rejects.toMatchObject({ code: 404 });
    });

    test('serves local media only after clean quarantine promotion', async () => {
        process.env.REVIEW_UPLOAD_DIR = makeTempUploadDir();
        const service = require('../services/reviewMediaStorageService');
        const fileBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
        const pending = await service.quarantineReviewMedia({
            fileBuffer,
            fileName: 'proof.png',
            mimeType: 'image/png',
        });

        const clean = await service.promoteReviewMediaFromQuarantine({
            storageKey: pending.storageKey,
            quarantineKey: pending.quarantineKey,
            mimeType: 'image/png',
        });

        expect(clean.scanStatus).toBe(service.REVIEW_MEDIA_SCAN_STATES.CLEAN);
        const object = await service.getReviewMediaObject({ storageKey: clean.storageKey });
        expect(object).toMatchObject({
            contentType: 'image/png',
            contentLength: fileBuffer.length,
        });
        const chunks = [];
        await new Promise((resolve, reject) => {
            object.body.on('data', (chunk) => chunks.push(chunk));
            object.body.on('end', resolve);
            object.body.on('error', reject);
        });
        expect(Buffer.concat(chunks)).toEqual(fileBuffer);
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

    test('quarantines and promotes S3 media with scan-state metadata', async () => {
        process.env.UPLOAD_STORAGE_DRIVER = 's3';
        process.env.AWS_REGION = 'ap-south-1';
        process.env.AWS_S3_REVIEW_BUCKET = 'aura-review-media';

        const { CopyObjectCommand, DeleteObjectCommand, HeadBucketCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
        mockSend.mockImplementation((command) => {
            if (
                command instanceof HeadBucketCommand
                || command instanceof PutObjectCommand
                || command instanceof CopyObjectCommand
                || command instanceof DeleteObjectCommand
            ) {
                return Promise.resolve({});
            }
            return Promise.reject(new Error(`Unexpected command: ${command?.constructor?.name || 'unknown'}`));
        });

        const service = require('../services/reviewMediaStorageService');
        const pending = await service.quarantineReviewMedia({
            fileBuffer: Buffer.from('hello'),
            fileName: 'proof.png',
            mimeType: 'image/png',
        });
        const clean = await service.promoteReviewMediaFromQuarantine({
            storageKey: pending.storageKey,
            quarantineKey: pending.quarantineKey,
            mimeType: 'image/png',
        });

        expect(pending.scanStatus).toBe(service.REVIEW_MEDIA_SCAN_STATES.PENDING);
        expect(clean.scanStatus).toBe(service.REVIEW_MEDIA_SCAN_STATES.CLEAN);
        expect(mockSend.mock.calls[1][0].input).toMatchObject({
            Key: expect.stringMatching(/^review-media\/quarantine\//),
            Metadata: { 'scan-status': 'pending', 'scan-updated-at': expect.any(String) },
        });
        expect(mockSend.mock.calls[2][0].input).toMatchObject({
            Key: expect.stringMatching(/^review-media\//),
            MetadataDirective: 'REPLACE',
            Metadata: { 'scan-status': 'clean', 'scan-updated-at': expect.any(String) },
        });
        expect(mockSend.mock.calls[3][0]).toBeInstanceOf(DeleteObjectCommand);
    });
});
