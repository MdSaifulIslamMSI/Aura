const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'must be a valid identifier');
const componentStatus = z.enum([
    'operational',
    'degraded_performance',
    'partial_outage',
    'major_outage',
    'maintenance',
]);
const incidentStatus = z.enum(['investigating', 'identified', 'monitoring', 'resolved']);
const incidentImpact = z.enum(['none', 'minor', 'major', 'critical', 'maintenance']);
const notificationLevel = z.enum(['all', 'major', 'maintenance']);
const checkType = z.enum(['http', 'database', 'redis', 'internal_health', 'manual']);

const passthroughQuery = z.object({}).passthrough();
const passthroughParams = z.object({}).passthrough();

const statusHistorySchema = z.object({
    query: z.object({
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(50).optional(),
        type: z.enum(['all', 'incidents', 'maintenance']).optional(),
        status: z.enum(['all', 'investigating', 'identified', 'monitoring', 'resolved']).optional(),
    }).passthrough(),
    params: passthroughParams,
    body: z.any().optional(),
});

const statusIncidentDetailSchema = z.object({
    query: passthroughQuery,
    params: z.object({
        slug: z.string().min(1).max(220),
    }),
    body: z.any().optional(),
});

const statusSubscribeSchema = z.object({
    query: passthroughQuery,
    params: passthroughParams,
    body: z.object({
        email: z.string().email().max(254),
        selectedComponentIds: z.array(objectId).max(100).optional(),
        selectedGroupIds: z.array(objectId).max(100).optional(),
        notificationLevel: notificationLevel.optional(),
    }),
});

const statusUnsubscribeSchema = z.object({
    query: passthroughQuery,
    params: passthroughParams,
    body: z.object({
        token: z.string().min(20).max(512),
    }),
});

const componentBodyFields = {
    groupId: objectId.optional(),
    groupName: z.string().min(1).max(120).optional(),
    name: z.string().min(1).max(120),
    slug: z.string().max(160).optional(),
    description: z.string().max(500).optional(),
    checkType: checkType.optional(),
    checkUrl: z.string().max(500).optional(),
    checkMethod: z.enum(['GET', 'HEAD', 'POST']).optional(),
    expectedStatusCode: z.coerce.number().int().min(100).max(599).optional(),
    timeoutMs: z.coerce.number().int().min(250).max(30000).optional(),
    isPublic: z.boolean().optional(),
    isMonitored: z.boolean().optional(),
    manualStatusOverride: componentStatus.nullable().optional(),
    currentStatus: componentStatus.optional(),
    order: z.coerce.number().int().min(0).max(10000).optional(),
    metadata: z.record(z.any()).optional(),
};

const componentCreateBody = z.object(componentBodyFields).refine((value) => value.groupId || value.groupName, {
    message: 'groupId or groupName is required',
    path: ['groupId'],
});

const componentUpdateBody = z.object({
    ...componentBodyFields,
    name: componentBodyFields.name.optional(),
});

const adminStatusComponentCreateSchema = z.object({
    query: passthroughQuery,
    params: passthroughParams,
    body: componentCreateBody,
});

const adminStatusComponentUpdateSchema = z.object({
    query: passthroughQuery,
    params: z.object({ id: objectId }),
    body: componentUpdateBody,
});

const baseIncidentBody = z.object({
    title: z.string().min(1).max(180),
    slug: z.string().max(220).optional(),
    description: z.string().max(5000).optional(),
    impact: incidentImpact.optional(),
    status: incidentStatus.optional(),
    affectedComponentIds: z.array(objectId).max(100).optional(),
    startedAt: z.coerce.date().optional(),
    scheduledStartAt: z.coerce.date().nullable().optional(),
    scheduledEndAt: z.coerce.date().nullable().optional(),
    isPublic: z.boolean().optional(),
    updateMessage: z.string().max(5000).optional(),
    confirmMajor: z.boolean().optional(),
});

const adminStatusIncidentCreateSchema = z.object({
    query: passthroughQuery,
    params: passthroughParams,
    body: baseIncidentBody,
});

const adminStatusIncidentUpdateSchema = z.object({
    query: passthroughQuery,
    params: z.object({ id: objectId }),
    body: baseIncidentBody.partial().extend({
        resolutionSummary: z.string().max(5000).optional(),
        resolvedAt: z.coerce.date().optional(),
    }),
});

const adminStatusIncidentTimelineSchema = z.object({
    query: passthroughQuery,
    params: z.object({ id: objectId }),
    body: z.object({
        status: incidentStatus.optional(),
        message: z.string().min(1).max(5000),
    }),
});

const adminStatusIncidentResolveSchema = z.object({
    query: passthroughQuery,
    params: z.object({ id: objectId }),
    body: z.object({
        message: z.string().max(5000).optional(),
        resolutionSummary: z.string().max(5000).optional(),
        resolvedAt: z.coerce.date().optional(),
    }).optional().default({}),
});

const adminStatusMaintenanceCreateSchema = z.object({
    query: passthroughQuery,
    params: passthroughParams,
    body: baseIncidentBody.extend({
        scheduledStartAt: z.coerce.date(),
        scheduledEndAt: z.coerce.date(),
    }),
});

const adminStatusChecksSchema = z.object({
    query: z.object({
        componentId: objectId.optional(),
        status: componentStatus.optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
    }).passthrough(),
    params: passthroughParams,
    body: z.any().optional(),
});

module.exports = {
    adminStatusChecksSchema,
    adminStatusComponentCreateSchema,
    adminStatusComponentUpdateSchema,
    adminStatusIncidentCreateSchema,
    adminStatusIncidentResolveSchema,
    adminStatusIncidentTimelineSchema,
    adminStatusIncidentUpdateSchema,
    adminStatusMaintenanceCreateSchema,
    statusHistorySchema,
    statusIncidentDetailSchema,
    statusSubscribeSchema,
    statusUnsubscribeSchema,
};
