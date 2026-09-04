const { z } = require('zod');
const { AVATAR_UPLOAD_MAX_BYTES } = require('../utils/avatarValidation');

// Base64 inflates binary payloads by ~4/3 plus the data-URI prefix; cap the
// data URL just above what a max-size upload can legitimately decode to so
// oversized payloads fail fast here instead of deep in the scan pipeline.
const AVATAR_DATA_URL_MAX_CHARS = Math.ceil(AVATAR_UPLOAD_MAX_BYTES * 4 / 3) + 1024;

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
        sizeBytes: z.coerce.number().int().positive().max(AVATAR_UPLOAD_MAX_BYTES),
    }).strict(),
    params: z.object({}).strict().optional(),
    query: z.object({}).strict().optional(),
}).strict();

const uploadAvatarMediaSchema = z.object({
    body: z.object({
        uploadToken: z.string().trim().min(20).max(4096),
        fileName: z.string().trim().min(1).max(220),
        mimeType: avatarMimeTypeSchema,
        dataUrl: z.string().trim().min(40).max(AVATAR_DATA_URL_MAX_CHARS),
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
