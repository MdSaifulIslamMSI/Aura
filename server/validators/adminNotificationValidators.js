const { z } = require('zod');

const readFlag = z.union([z.boolean(), z.string()]);

const adminNotificationListSchema = z.object({
    query: z.object({
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
        unreadOnly: readFlag.optional(),
        isRead: readFlag.optional(),
        severity: z.enum(['info', 'warning', 'critical']).optional(),
        actionKey: z.string().trim().max(120).optional(),
        entityType: z.string().trim().max(60).optional(),
        search: z.string().trim().max(120).optional(),
    }),
});

const adminNotificationMarkReadSchema = z.object({
    params: z.object({
        notificationId: z.string().trim().min(8).max(120),
    }),
    body: z.object({
        read: z.boolean().optional(),
    }).optional(),
});

const adminNotificationMarkAllReadSchema = z.object({
    body: z.object({
        unreadOnly: readFlag.optional(),
        isRead: readFlag.optional(),
        severity: z.enum(['info', 'warning', 'critical']).optional(),
        actionKey: z.string().trim().max(120).optional(),
        entityType: z.string().trim().max(60).optional(),
        search: z.string().trim().max(120).optional(),
    }).optional(),
});

module.exports = {
    adminNotificationListSchema,
    adminNotificationMarkReadSchema,
    adminNotificationMarkAllReadSchema,
};
