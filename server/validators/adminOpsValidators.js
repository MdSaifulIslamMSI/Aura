const { z } = require('zod');

const adminOpsReadinessSchema = z.object({
    query: z.object({}).passthrough(),
    params: z.object({}).passthrough(),
    body: z.any().optional(),
});

const adminOpsSmokeSchema = z.object({
    query: z.object({}).passthrough(),
    params: z.object({}).passthrough(),
    body: z.object({}).passthrough().optional(),
});

module.exports = {
    adminOpsReadinessSchema,
    adminOpsSmokeSchema,
};

