jest.mock('../models/User', () => ({
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
}));
jest.mock('../services/uploadSignatureService', () => ({
    createUploadToken: jest.fn(),
    verifyAndConsumeUploadToken: jest.fn(),
}));
jest.mock('../services/uploadSecurityPipeline', () => ({
    validateImageDataUriUpload: jest.fn(),
}));
jest.mock('../services/avatarImageService', () => ({
    normalizeAvatarImage: jest.fn(),
}));
jest.mock('../services/avatarMediaStorageService', () => ({
    deleteAvatarMedia: jest.fn(),
    getQuarantinedAvatarMedia: jest.fn(),
    getStorageDriver: jest.fn(() => 'local'),
    promoteAvatarMedia: jest.fn(),
    quarantineAvatarMedia: jest.fn(),
}));
jest.mock('../services/authSecurityTelemetryService', () => ({
    recordAuthSecurityEvent: jest.fn(),
}));

const User = require('../models/User');
const signatureService = require('../services/uploadSignatureService');
const uploadPipeline = require('../services/uploadSecurityPipeline');
const avatarImageService = require('../services/avatarImageService');
const storageService = require('../services/avatarMediaStorageService');
const {
    createAvatarUploadIntent,
    finalizeAvatarMedia,
    uploadAvatarMedia,
} = require('../controllers/accountAvatarController');

const ownerId = '507f1f77bcf86cd799439181';
const buildResponse = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
});
const flush = async (controller, req, res, next) => {
    controller(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));
};

describe('account avatar controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('issues a short-lived upload intent bound to the authenticated owner', async () => {
        signatureService.createUploadToken.mockReturnValue({
            token: 'signed-upload-token',
            expiresAt: '2026-07-26T12:10:00.000Z',
        });
        const req = {
            user: { _id: ownerId },
            body: { fileName: 'portrait.png', mimeType: 'image/png', sizeBytes: 2048 },
        };
        const res = buildResponse();
        const next = jest.fn();

        await flush(createAvatarUploadIntent, req, res, next);

        expect(signatureService.createUploadToken).toHaveBeenCalledWith(expect.objectContaining({
            userId: ownerId,
            purpose: 'avatar-upload',
            fileName: 'portrait.png',
            mimeType: 'image/png',
        }));
        expect(res.status).toHaveBeenCalledWith(201);
        expect(next).not.toHaveBeenCalled();
    });

    test('rejects a validly shaped upload token owned by another user before scanning', async () => {
        signatureService.verifyAndConsumeUploadToken.mockResolvedValue({
            uid: '507f1f77bcf86cd799439199',
            purpose: 'avatar-upload',
            fileName: 'portrait.png',
            mimeType: 'image/png',
            maxBytes: 2048,
        });
        const req = {
            user: { _id: ownerId },
            body: {
                uploadToken: 'signed',
                fileName: 'portrait.png',
                mimeType: 'image/png',
                dataUrl: 'data:image/png;base64,AAAA',
            },
        };
        const res = buildResponse();
        const next = jest.fn();

        await flush(uploadAvatarMedia, req, res, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
        expect(uploadPipeline.validateImageDataUriUpload).not.toHaveBeenCalled();
    });

    test('scans, normalizes, quarantines, and returns only a finalize token', async () => {
        signatureService.verifyAndConsumeUploadToken.mockResolvedValue({
            uid: ownerId,
            purpose: 'avatar-upload',
            fileName: 'portrait.png',
            mimeType: 'image/png',
            maxBytes: 2048,
        });
        uploadPipeline.validateImageDataUriUpload.mockResolvedValue({
            fileBuffer: Buffer.from('source'),
        });
        avatarImageService.normalizeAvatarImage.mockResolvedValue({
            fileBuffer: Buffer.from('normalized'),
            mimeType: 'image/webp',
            sizeBytes: 10,
            width: 512,
            height: 512,
        });
        storageService.quarantineAvatarMedia.mockResolvedValue({
            storageKey: 'pending-avatar.webp',
            storageDriver: 'local',
        });
        signatureService.createUploadToken.mockReturnValue({
            token: 'signed-finalize-token',
            expiresAt: '2026-07-26T12:10:00.000Z',
        });
        const req = {
            user: { _id: ownerId },
            body: {
                uploadToken: 'signed',
                fileName: 'portrait.png',
                mimeType: 'image/png',
                dataUrl: 'data:image/png;base64,AAAA',
            },
        };
        const res = buildResponse();
        const next = jest.fn();

        await flush(uploadAvatarMedia, req, res, next);

        expect(storageService.quarantineAvatarMedia).toHaveBeenCalledWith({
            fileBuffer: Buffer.from('normalized'),
            ownerId,
        });
        expect(signatureService.createUploadToken).toHaveBeenCalledWith(expect.objectContaining({
            userId: ownerId,
            purpose: 'avatar-finalize',
            fileName: 'pending-avatar.webp',
        }));
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            finalizeToken: 'signed-finalize-token',
            media: expect.objectContaining({ width: 512, height: 512 }),
        }));
    });

    test('finalizes only the owner-bound quarantined key and atomically updates the profile', async () => {
        signatureService.verifyAndConsumeUploadToken.mockResolvedValue({
            uid: ownerId,
            purpose: 'avatar-finalize',
            fileName: 'pending-avatar.webp',
            mimeType: 'image/webp',
            maxBytes: 10,
        });
        storageService.getQuarantinedAvatarMedia.mockResolvedValue(Buffer.alloc(10));
        User.findById.mockReturnValue({
            select: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue({ __v: 3, avatar: '', avatarMedia: {} }),
            }),
        });
        storageService.promoteAvatarMedia.mockResolvedValue({
            storageKey: 'pending-avatar.webp',
            storageDriver: 'local',
            url: '/uploads/avatars/pending-avatar.webp',
        });
        User.findOneAndUpdate.mockResolvedValue({
            avatar: '/uploads/avatars/pending-avatar.webp',
            __v: 4,
        });
        const req = {
            user: { _id: ownerId },
            body: { finalizeToken: 'signed-finalize' },
        };
        const res = buildResponse();
        const next = jest.fn();

        await flush(finalizeAvatarMedia, req, res, next);

        expect(User.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: ownerId, __v: 3 },
            expect.objectContaining({
                $set: expect.objectContaining({
                    avatar: '/uploads/avatars/pending-avatar.webp',
                    avatarMedia: expect.objectContaining({
                        storageKey: 'pending-avatar.webp',
                        mimeType: 'image/webp',
                    }),
                }),
            }),
            expect.any(Object)
        );
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            avatar: '/uploads/avatars/pending-avatar.webp',
            profileVersion: 4,
        });
        expect(next).not.toHaveBeenCalled();
    });
});
