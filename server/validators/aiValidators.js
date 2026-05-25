const { z } = require('zod');

const ASSISTANT_IMAGE_MAX_BYTES = Number(process.env.ASSISTANT_IMAGE_MAX_BYTES || 8 * 1024 * 1024);
const ASSISTANT_AUDIO_MAX_BYTES = Number(process.env.ASSISTANT_AUDIO_MAX_BYTES || 8 * 1024 * 1024);
const ASSISTANT_IMAGE_DATA_URI_MAX_CHARS = Math.ceil(ASSISTANT_IMAGE_MAX_BYTES * 4 / 3) + 128;
const ASSISTANT_AUDIO_DATA_URI_MAX_CHARS = Math.ceil(ASSISTANT_AUDIO_MAX_BYTES * 4 / 3) + 128;
const ASSISTANT_IMAGE_ALLOWED_MIME = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
]);
const ASSISTANT_AUDIO_ALLOWED_MIME = new Set([
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/m4a',
]);

const normalizeMimeType = (value) => String(value || '').split(';', 1)[0].trim().toLowerCase();

const getDataUriMimeType = (value = '') => {
    const match = String(value || '').match(/^data:([^;,]+);base64,/i);
    return match ? normalizeMimeType(match[1]) : '';
};

const addAssistantMediaIssues = ({ value, ctx, allowedMimeTypes, label }) => {
    const metadataMimeType = normalizeMimeType(value.mimeType);
    if (metadataMimeType && !allowedMimeTypes.has(metadataMimeType)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['mimeType'],
            message: `Unsupported assistant ${label} MIME type`,
        });
    }

    if (!value.dataUrl) return;

    const dataUriMimeType = getDataUriMimeType(value.dataUrl);
    if (!dataUriMimeType) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['dataUrl'],
            message: `Assistant ${label} dataUrl must be a base64 data URI`,
        });
        return;
    }
    if (!allowedMimeTypes.has(dataUriMimeType)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['dataUrl'],
            message: `Unsupported assistant ${label} data URI MIME type`,
        });
    }
};

const assistantImageSchema = z.object({
    url: z.string().trim().url().optional(),
    dataUrl: z.string().trim().max(ASSISTANT_IMAGE_DATA_URI_MAX_CHARS).optional(),
    fileName: z.string().trim().max(240).optional(),
    mimeType: z.string().trim().max(120).optional(),
}).refine((value) => Boolean(value.url || value.dataUrl), {
    message: 'Each image must include a url or dataUrl',
}).superRefine((value, ctx) => {
    addAssistantMediaIssues({
        value,
        ctx,
        allowedMimeTypes: ASSISTANT_IMAGE_ALLOWED_MIME,
        label: 'image',
    });
});

const assistantAudioSchema = z.object({
    url: z.string().trim().url().optional(),
    dataUrl: z.string().trim().max(ASSISTANT_AUDIO_DATA_URI_MAX_CHARS).optional(),
    fileName: z.string().trim().max(240).optional(),
    mimeType: z.string().trim().max(120).optional(),
}).refine((value) => Boolean(value.url || value.dataUrl), {
    message: 'Each audio item must include a url or dataUrl',
}).superRefine((value, ctx) => {
    addAssistantMediaIssues({
        value,
        ctx,
        allowedMimeTypes: ASSISTANT_AUDIO_ALLOWED_MIME,
        label: 'audio',
    });
});

const conversationEntrySchema = z.object({
    role: z.enum(['user', 'assistant', 'system']).optional(),
    content: z.string().trim().min(1).max(2400),
}).strict();

const assistantActionRequestSchema = z.object({
    type: z.string().trim().min(1).max(80),
    page: z.string().trim().max(80).optional(),
    productId: z.string().trim().max(120).optional(),
    productIds: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
    orderId: z.string().trim().max(120).optional(),
    couponCode: z.string().trim().max(30).optional(),
    requestType: z.string().trim().max(40).optional(),
    reason: z.string().trim().max(600).optional(),
    amount: z.number().nonnegative().optional(),
    query: z.string().trim().max(600).optional(),
    quantity: z.number().int().positive().max(20).optional(),
    filters: z.object({}).passthrough().optional(),
    params: z.object({}).passthrough().optional(),
}).strict();

const aiChatSchema = z.object({
    body: z.object({
        message: z.string().trim().max(1200).optional(),
        assistantMode: z.enum(['chat', 'voice', 'compare', 'bundle']).optional(),
        sessionId: z.string().trim().max(120).optional(),
        confirmation: z.object({
            actionId: z.string().trim().min(1).max(120),
            approved: z.boolean(),
            contextVersion: z.number().int().nonnegative().optional(),
        }).strict().optional(),
        actionRequest: assistantActionRequestSchema.optional(),
        locale: z.string().trim().max(32).optional(),
        conversationHistory: z.array(conversationEntrySchema).max(12).optional(),
        images: z.array(assistantImageSchema).max(3).optional(),
        audio: z.array(assistantAudioSchema).max(2).optional(),
        context: z.object({}).passthrough().optional(),
    }).strict().refine((value) => Boolean(
        String(value.message || '').trim()
        || value.confirmation
        || value.actionRequest
        || (Array.isArray(value.images) && value.images.length > 0)
        || (Array.isArray(value.audio) && value.audio.length > 0)
    ), {
        message: 'Message, media, confirmation, or actionRequest is required',
        path: ['message'],
    }),
});

const aiVoiceSessionSchema = z.object({
    body: z.object({
        locale: z.string().trim().max(32).optional(),
        channel: z.enum(['voice', 'voice-assistant']).optional(),
    }).strict().optional(),
});

const aiVoiceSpeakSchema = z.object({
    body: z.object({
        text: z.string().trim().min(1).max(600),
        locale: z.string().trim().max(32).optional(),
    }).strict(),
});

const aiSessionBodySchema = z.object({
    sessionId: z.string().trim().max(120).optional(),
    assistantMode: z.enum(['chat', 'voice', 'compare', 'bundle']).optional(),
    originPath: z.string().trim().max(240).optional(),
}).strict();

const aiSessionParamsSchema = z.object({
    sessionId: z.string().trim().min(1).max(120),
}).strict();

const aiSessionCreateSchema = z.object({
    body: aiSessionBodySchema,
});

const aiSessionParamsOnlySchema = z.object({
    params: aiSessionParamsSchema,
});

module.exports = {
    aiChatSchema,
    aiSessionCreateSchema,
    aiSessionParamsOnlySchema,
    aiVoiceSpeakSchema,
    aiVoiceSessionSchema,
};
