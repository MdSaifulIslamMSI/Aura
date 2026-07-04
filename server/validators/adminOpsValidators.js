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
            'emailOpsMonitor',
            'catalogImport',
            'catalogSync',
            'adminAnalytics',
            'all',
        ])).max(10).optional(),
    }).passthrough().optional(),
});

const adminOpsAwsControlSchema = z.object({
    query: z.object({}).passthrough(),
    params: z.object({}).passthrough(),
    body: z.any().optional(),
});

const adminOpsAwsControlActionSchema = z.object({
    query: z.object({}).passthrough(),
    params: z.object({}).passthrough(),
    body: z.object({
        target: z.enum(['staging', 'production']),
        action: z.enum(['start', 'stop']),
        reason: z.string().trim().min(8).max(1000),
        confirmationPhrase: z.string().trim().max(80).optional(),
    }).strict(),
});

module.exports = {
    adminClientDiagnosticsSchema,
    adminOpsAwsControlActionSchema,
    adminOpsAwsControlSchema,
    adminOpsReadinessSchema,
    adminOpsSmokeSchema,
    adminOpsMaintenanceSchema,
};
