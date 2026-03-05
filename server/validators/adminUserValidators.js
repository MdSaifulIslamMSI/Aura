const { z } = require('zod');

const adminUserListSchema = z.object({
    query: z.object({
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
        search: z.string().trim().max(120).optional(),
        accountState: z.enum(['active', 'warned', 'suspended', 'deleted']).optional(),
        isVerified: z.union([z.boolean(), z.string()]).optional(),
        isSeller: z.union([z.boolean(), z.string()]).optional(),
        isAdmin: z.union([z.boolean(), z.string()]).optional(),
    }),
});

const adminUserDetailSchema = z.object({
    params: z.object({
        userId: z.string().trim().min(8).max(120),
    }),
});

const adminWarnUserSchema = z.object({
    params: z.object({
        userId: z.string().trim().min(8).max(120),
    }),
    body: z.object({
        reason: z.string().trim().min(5).max(500),
    }).strict(),
});

const adminSuspendUserSchema = z.object({
    params: z.object({
        userId: z.string().trim().min(8).max(120),
    }),
    body: z.object({
        reason: z.string().trim().min(5).max(500),
        durationHours: z.coerce.number().int().min(1).max(24 * 365).default(72),
    }).strict(),
});

const adminDismissWarningSchema = z.object({
    params: z.object({
        userId: z.string().trim().min(8).max(120),
    }),
    body: z.object({
        reason: z.string().trim().max(500).optional(),
    }).strict().optional(),
});

const adminReactivateUserSchema = z.object({
    params: z.object({
        userId: z.string().trim().min(8).max(120),
    }),
    body: z.object({
        reason: z.string().trim().max(500).optional(),
    }).strict().optional(),
});

const adminDeleteUserSchema = z.object({
    params: z.object({
        userId: z.string().trim().min(8).max(120),
    }),
    body: z.object({
        reason: z.string().trim().min(5).max(500),
        scrubPII: z.boolean().optional().default(false),
    }).strict(),
});

module.exports = {
    adminUserListSchema,
    adminUserDetailSchema,
    adminWarnUserSchema,
    adminSuspendUserSchema,
    adminDismissWarningSchema,
    adminReactivateUserSchema,
    adminDeleteUserSchema,
};

