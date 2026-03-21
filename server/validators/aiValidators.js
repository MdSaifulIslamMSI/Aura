const { z } = require('zod');

const assistantImageSchema = z.object({
    url: z.string().trim().url().optional(),
    dataUrl: z.string().trim().max(12_000_000).optional(),
    fileName: z.string().trim().max(240).optional(),
    mimeType: z.string().trim().max(120).optional(),
}).refine((value) => Boolean(value.url || value.dataUrl), {
    message: 'Each image must include a url or dataUrl',
});

const conversationEntrySchema = z.object({
    role: z.enum(['user', 'assistant', 'system']).optional(),
    content: z.string().trim().min(1).max(2400),
}).strict();

const assistantActionRequestSchema = z.object({
    type: z.string().trim().min(1).max(80),
    page: z.string().trim().max(80).optional(),
    productId: z.string().trim().max(120).optional(),
    quantity: z.number().int().positive().max(20).optional(),
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
        context: z.object({}).passthrough().optional(),
    }).strict().refine((value) => Boolean(String(value.message || '').trim() || value.confirmation || value.actionRequest), {
        message: 'Message, confirmation, or actionRequest is required',
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

module.exports = {
    aiChatSchema,
    aiVoiceSpeakSchema,
    aiVoiceSessionSchema,
};
