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

const adminOpsMaintenanceSchema = z.object({
    query: z.object({}).passthrough(),
    params: z.object({}).passthrough(),
    body: z.object({
        tasks: z.array(z.enum([
            'paymentOutbox',
            'orderEmail',
            'catalogImport',
            'catalogSync',
            'adminAnalytics',
            'all',
        ])).max(10).optional(),
    }).passthrough().optional(),
});

module.exports = {
    adminOpsReadinessSchema,
    adminOpsSmokeSchema,
    adminOpsMaintenanceSchema,
};
