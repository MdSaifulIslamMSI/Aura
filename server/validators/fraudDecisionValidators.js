const { z } = require('zod');

const objectIdSchema = z.string().trim().regex(/^[a-f0-9]{24}$/i, 'Invalid fraud decision id');

const adminFraudDecisionListSchema = z.object({
    query: z.object({
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
        status: z.enum(['all', 'none', 'open', 'approved', 'rejected', 'resolved', 'escalated']).optional(),
        queue: z.string().trim().max(80).optional(),
        decision: z.enum(['allow', 'challenge', 'review', 'hold', 'block']).optional(),
        action: z.string().trim().max(120).optional(),
        userId: z.string().trim().regex(/^[a-f0-9]{24}$/i, 'Invalid user id').optional(),
        subjectType: z.string().trim().max(80).optional(),
        subjectId: z.string().trim().max(120).optional(),
        from: z.string().trim().max(40).optional(),
        to: z.string().trim().max(40).optional(),
    }),
});

const adminFraudDecisionResolveSchema = z.object({
    params: z.object({
        decisionId: objectIdSchema,
    }),
    body: z.object({
        resolution: z.enum(['approve', 'reject', 'escalate', 'dismiss']),
        note: z.string().trim().max(1000).optional(),
        assignedTo: z.string().trim().regex(/^[a-f0-9]{24}$/i, 'Invalid assignee id').optional(),
    }),
});

module.exports = {
    adminFraudDecisionListSchema,
    adminFraudDecisionResolveSchema,
};
