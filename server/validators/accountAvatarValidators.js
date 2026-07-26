const { z } = require('zod');

const avatarMimeTypeSchema = z.enum([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
]);

const createAvatarUploadIntentSchema = z.object({
    body: z.object({
        fileName: z.string().trim().min(1).max(220),
        mimeType: avatarMimeTypeSchema,
        sizeBytes: z.coerce.number().int().positive().max(2 * 1024 * 1024),
    }).strict(),
    params: z.object({}).strict().optional(),
    query: z.object({}).strict().optional(),
}).strict();

const uploadAvatarMediaSchema = z.object({
    body: z.object({
        uploadToken: z.string().trim().min(20).max(4096),
        fileName: z.string().trim().min(1).max(220),
        mimeType: avatarMimeTypeSchema,
        dataUrl: z.string().trim().min(40).max(3 * 1024 * 1024),
    }).strict(),
    params: z.object({}).strict().optional(),
    query: z.object({}).strict().optional(),
}).strict();

const finalizeAvatarMediaSchema = z.object({
    body: z.object({
        finalizeToken: z.string().trim().min(20).max(4096),
    }).strict(),
    params: z.object({}).strict().optional(),
    query: z.object({}).strict().optional(),
}).strict();

module.exports = {
    createAvatarUploadIntentSchema,
    finalizeAvatarMediaSchema,
    uploadAvatarMediaSchema,
};
