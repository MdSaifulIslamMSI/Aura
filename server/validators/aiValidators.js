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

const aiChatSchema = z.object({
    body: z.object({
        message: z.string().trim().min(1).max(1200),
        assistantMode: z.enum(['chat', 'voice', 'compare', 'bundle']).optional(),
        locale: z.string().trim().max(32).optional(),
        conversationHistory: z.array(conversationEntrySchema).max(12).optional(),
        images: z.array(assistantImageSchema).max(3).optional(),
        context: z.object({}).passthrough().optional(),
    }).strict(),
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
