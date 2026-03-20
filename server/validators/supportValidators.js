const { z } = require('zod');

const createSupportTicketSchema = z.object({
    body: z.object({
        subject: z.string().trim().min(3).max(200),
        category: z.enum(['moderation_appeal', 'general_support', 'order_issue', 'other']),
        message: z.string().trim().min(5).max(2000),
        relatedActionId: z.string().nullable().optional(),
    }),
});

const sendSupportMessageSchema = z.object({
    params: z.object({
        id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format'),
    }),
    body: z.object({
        message: z.string().trim().min(1).max(2000),
    }),
});

const supportTicketQuerySchema = z.object({
    query: z.object({
        status: z.enum(['open', 'resolved', 'closed']).optional(),
        page: z.preprocess((val) => Number(val) || 1, z.number().int().min(1)).default(1),
        limit: z.preprocess((val) => Number(val) || 10, z.number().int().min(1).max(50)).default(10),
    }),
});

const ticketIdParamSchema = z.object({
    params: z.object({
        id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format'),
    }),
});

const adminUpdateTicketSchema = z.object({
    params: z.object({
        id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format'),
    }),
    body: z.object({
        status: z.enum(['open', 'resolved', 'closed']),
        resolutionSummary: z.string().trim().max(800).optional(),
        userActionRequired: z.boolean().optional(),
    }),
});

module.exports = {
    createSupportTicketSchema,
    sendSupportMessageSchema,
    supportTicketQuerySchema,
    ticketIdParamSchema,
    adminUpdateTicketSchema,
};
