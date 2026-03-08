const { z } = require('zod');

const adminOpsReadinessSchema = z.object({
    query: z.object({}).passthrough(),
    params: z.object({}).passthrough(),
    body: z.any().optional(),
});

const adminClientDiagnosticsSchema = z.object({
    query: z.object({
        limit: z.coerce.number().int().min(1).max(100).optional(),
        type: z.string().max(120).optional(),
        severity: z.string().max(32).optional(),
        sessionId: z.string().max(120).optional(),
        requestId: z.string().max(120).optional(),
        route: z.string().max(220).optional(),
    }).passthrough(),
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
    adminClientDiagnosticsSchema,
    adminOpsReadinessSchema,
    adminOpsSmokeSchema,
    adminOpsMaintenanceSchema,
};
