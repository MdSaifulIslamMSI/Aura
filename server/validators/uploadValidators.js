const { z } = require('zod');

const signReviewUploadSchema = z.object({
    body: z.object({
        fileName: z.string().trim().min(1).max(220),
        mimeType: z.string().trim().min(3).max(120),
        sizeBytes: z.preprocess((val) => Number(val), z.number().int().positive().max(15 * 1024 * 1024)),
    }).strict(),
});

const uploadReviewMediaSchema = z.object({
    body: z.object({
        uploadToken: z.string().trim().min(20).max(4096),
        fileName: z.string().trim().min(1).max(220),
        mimeType: z.string().trim().min(3).max(120),
        dataUrl: z.string().trim().min(40).max(20 * 1024 * 1024),
    }).strict(),
});

module.exports = {
    signReviewUploadSchema,
    uploadReviewMediaSchema,
};
