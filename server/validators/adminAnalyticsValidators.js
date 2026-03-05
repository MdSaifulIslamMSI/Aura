const { z } = require('zod');

const rangeEnum = z.enum(['24h', '7d', '30d', '90d', 'custom']);
const granularityEnum = z.enum(['hour', 'day']);
const datasetEnum = z.enum(['overview', 'orders', 'payments', 'listings', 'notifications']);

const baseQuerySchema = z.object({
    range: rangeEnum.optional(),
    from: z.string().trim().optional(),
    to: z.string().trim().optional(),
});

const adminAnalyticsOverviewSchema = z.object({
    query: baseQuerySchema,
});

const adminAnalyticsTimeSeriesSchema = z.object({
    query: baseQuerySchema.extend({
        granularity: granularityEnum.optional(),
    }),
});

const adminAnalyticsAnomalySchema = z.object({
    query: z.object({
        windowMinutes: z.coerce.number().int().min(15).max(240).optional(),
    }),
});

const adminAnalyticsExportSchema = z.object({
    query: baseQuerySchema.extend({
        dataset: datasetEnum.optional(),
        limit: z.coerce.number().int().min(1).max(5000).optional(),
    }),
});

module.exports = {
    adminAnalyticsOverviewSchema,
    adminAnalyticsTimeSeriesSchema,
    adminAnalyticsAnomalySchema,
    adminAnalyticsExportSchema,
};
