const { z } = require('zod');

const pageSchema = z.coerce.number().int().min(1).max(500).optional();
const limitSchema = z.coerce.number().int().min(1).max(100).optional();

const adminEmailOpsSummarySchema = z.object({
    query: z.object({}).passthrough(),
    params: z.object({}).passthrough(),
    body: z.any().optional(),
});

const adminEmailOpsDeliveryListSchema = z.object({
    query: z.object({
        page: pageSchema,
        limit: limitSchema,
        status: z.enum(['sent', 'failed', 'skipped']).optional(),
        provider: z.enum(['gmail', 'resend', 'null', 'disabled', 'unknown']).optional(),
        eventType: z.string().max(120).optional(),
        search: z.string().max(240).optional(),
    }).passthrough(),
    params: z.object({}).passthrough(),
    body: z.any().optional(),
});

const adminEmailOpsQueueListSchema = z.object({
    query: z.object({
        page: pageSchema,
        limit: limitSchema,
        status: z.enum(['pending', 'processing', 'retry', 'sent', 'failed']).optional(),
        orderId: z.string().max(120).optional(),
        recipient: z.string().max(240).optional(),
    }).passthrough(),
    params: z.object({}).passthrough(),
    body: z.any().optional(),
});

const adminEmailOpsQueueDetailSchema = z.object({
    query: z.object({}).passthrough(),
    params: z.object({
        notificationId: z.string().min(3).max(120),
    }).passthrough(),
    body: z.any().optional(),
});

const adminEmailOpsQueueRetrySchema = z.object({
    query: z.object({}).passthrough(),
    params: z.object({
        notificationId: z.string().min(3).max(120),
    }).passthrough(),
    body: z.object({}).passthrough().optional(),
});

const adminEmailOpsTestSendSchema = z.object({
    query: z.object({}).passthrough(),
    params: z.object({}).passthrough(),
    body: z.object({
        recipientEmail: z.string().email().optional(),
    }).passthrough().optional(),
});

module.exports = {
    adminEmailOpsSummarySchema,
    adminEmailOpsDeliveryListSchema,
    adminEmailOpsQueueListSchema,
    adminEmailOpsQueueDetailSchema,
    adminEmailOpsQueueRetrySchema,
    adminEmailOpsTestSendSchema,
};
