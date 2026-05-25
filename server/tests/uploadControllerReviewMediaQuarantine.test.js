jest.mock('../services/uploadSignatureService', () => ({
    createUploadToken: jest.fn(),
    verifyAndConsumeUploadToken: jest.fn(),
}));

jest.mock('../services/malwareScanService', () => ({
    scanUploadBuffer: jest.fn(),
}));

jest.mock('../services/reviewMediaStorageService', () => ({
    ensureReviewUploadStorageReady: jest.fn().mockResolvedValue(undefined),
    getStorageDriver: jest.fn(() => 'local'),
    markReviewMediaScanState: jest.fn().mockResolvedValue(undefined),
    promoteReviewMediaFromQuarantine: jest.fn(),
    quarantineReviewMedia: jest.fn(),
    REVIEW_MEDIA_SCAN_STATES: {
        PENDING: 'pending',
        CLEAN: 'clean',
        INFECTED: 'infected',
    },
}));

const { scanUploadBuffer } = require('../services/malwareScanService');
const { verifyAndConsumeUploadToken } = require('../services/uploadSignatureService');
const {
    markReviewMediaScanState,
    promoteReviewMediaFromQuarantine,
    quarantineReviewMedia,
    REVIEW_MEDIA_SCAN_STATES,
} = require('../services/reviewMediaStorageService');
const { uploadReviewMedia } = require('../controllers/uploadController');

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('uploadController review media quarantine flow', () => {
    const buildRes = () => ({
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
    });

    const buildReq = () => ({
        user: { _id: 'user-1' },
        body: {
            uploadToken: 'token-123',
            fileName: 'proof.png',
            mimeType: 'image/png',
            dataUrl: `data:image/png;base64,${pngBase64}`,
        },
    });

    beforeEach(() => {
        jest.clearAllMocks();
        verifyAndConsumeUploadToken.mockResolvedValue({
            uid: 'user-1',
            purpose: 'review-media',
            mimeType: 'image/png',
            maxBytes: 1024 * 1024,
        });
        quarantineReviewMedia.mockResolvedValue({
            storageDriver: 'local',
            storageKey: 'pending.png',
            quarantineKey: 'pending.png',
            scanStatus: REVIEW_MEDIA_SCAN_STATES.PENDING,
            url: '/uploads/reviews/pending.png',
        });
        promoteReviewMediaFromQuarantine.mockResolvedValue({
            storageDriver: 'local',
            storageKey: 'pending.png',
            quarantineKey: 'pending.png',
            scanStatus: REVIEW_MEDIA_SCAN_STATES.CLEAN,
            url: '/uploads/reviews/pending.png',
        });
    });

    test('quarantines review media before scanning and promotes only clean uploads', async () => {
        scanUploadBuffer.mockResolvedValueOnce({ status: 'clean', engines: [] });
        const res = buildRes();
        const next = jest.fn();

        await uploadReviewMedia(buildReq(), res, next);

        expect(quarantineReviewMedia).toHaveBeenCalledWith(expect.objectContaining({
            fileName: 'proof.png',
            mimeType: 'image/png',
            fileBuffer: expect.any(Buffer),
        }));
        expect(quarantineReviewMedia.mock.invocationCallOrder[0])
            .toBeLessThan(scanUploadBuffer.mock.invocationCallOrder[0]);
        expect(promoteReviewMediaFromQuarantine).toHaveBeenCalledWith({
            storageKey: 'pending.png',
            quarantineKey: 'pending.png',
            mimeType: 'image/png',
        });
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            media: expect.objectContaining({
                url: '/uploads/reviews/pending.png',
            }),
        }));
        expect(next).not.toHaveBeenCalled();
    });

    test('leaves review media pending and blocks the response when scan fails', async () => {
        scanUploadBuffer.mockResolvedValueOnce({
            status: 'error',
            engines: [{ engine: 'clamav', status: 'error', detail: 'connection refused' }],
        });
        const res = buildRes();
        const next = jest.fn();

        await uploadReviewMedia(buildReq(), res, next);

        expect(markReviewMediaScanState).toHaveBeenCalledWith(expect.objectContaining({
            storageKey: 'pending.png',
            quarantineKey: 'pending.png',
            scanStatus: REVIEW_MEDIA_SCAN_STATES.PENDING,
            mimeType: 'image/png',
            detail: 'malware scan unavailable',
        }));
        expect(promoteReviewMediaFromQuarantine).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 503,
            message: 'Upload malware scan unavailable. Please try again later.',
        }));
    });
});
