const { z } = require('zod');

const notificationStatusEnum = z.enum(['pending', 'processing', 'retry', 'sent', 'failed']);

const adminOrderEmailListSchema = z.object({
    query: z.object({
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
        status: notificationStatusEnum.optional(),
        orderId: z.string().trim().optional(),
        recipient: z.string().trim().max(120).optional(),
    }),
});

const adminOrderEmailDetailSchema = z.object({
    params: z.object({
        notificationId: z.string().trim().min(8).max(120),
    }),
});

const adminOrderEmailRetrySchema = z.object({
    params: z.object({
        notificationId: z.string().trim().min(8).max(120),
    }),
    body: z.object({}).passthrough().optional(),
});

module.exports = {
    adminOrderEmailListSchema,
    adminOrderEmailDetailSchema,
    adminOrderEmailRetrySchema,
};
