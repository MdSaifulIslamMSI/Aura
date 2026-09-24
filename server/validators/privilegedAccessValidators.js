const { z } = require('zod');

const objectIdSchema = z.string().trim().regex(/^[a-f\d]{24}$/i, 'Invalid id');

const privilegedGrantListSchema = z.object({
    query: z.object({
        status: z.enum(['pending', 'approved', 'denied', 'revoked', 'expired']).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
});

const privilegedGrantRequestSchema = z.object({
    body: z.object({
        permission: z.string().trim().min(3).max(120),
        reason: z.string().trim().min(10).max(500),
    }),
});

const privilegedGrantIdSchema = z.object({
    params: z.object({
        grantId: z.string().trim().min(8).max(80),
    }),
});

const privilegedGrantDenySchema = z.object({
    params: z.object({
        grantId: z.string().trim().min(8).max(80),
    }),
    body: z.object({
        reason: z.string().trim().min(3).max(500),
    }),
});

module.exports = {
    objectIdSchema,
    privilegedGrantListSchema,
    privilegedGrantRequestSchema,
    privilegedGrantIdSchema,
    privilegedGrantDenySchema,
};
