const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'must be a valid identifier');
const componentStatus = z.enum([
    'operational',
    'degraded',
    'degraded_performance',
    'partial_outage',
    'major_outage',
    'maintenance',
]);
const incidentStatus = z.enum(['investigating', 'identified', 'monitoring', 'resolved']);
const incidentSeverity = z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']);
const incidentImpact = z.enum(['none', 'minor', 'major', 'critical', 'maintenance']);
const incidentSource = z.enum(['manual', 'uptime_kuma', 'gatus', 'sentry', 'github_actions', 'synthetic', 'alertmanager']);
const incidentTimelineType = z.enum(['detected', 'status_update', 'mitigation', 'deployment', 'monitor_recovered', 'resolved', 'internal_note', 'postmortem']);
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
    dependencies: z.array(z.string().min(1).max(160)).max(50).optional(),
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
    summary: z.string().max(5000).optional(),
    severity: incidentSeverity.optional(),
    impact: incidentImpact.optional(),
    status: incidentStatus.optional(),
    commander: z.string().max(160).optional(),
    source: incidentSource.optional(),
    affectedComponentIds: z.array(objectId).max(100).optional(),
    startedAt: z.coerce.date().optional(),
    detectedAt: z.coerce.date().nullable().optional(),
    acknowledgedAt: z.coerce.date().nullable().optional(),
    scheduledStartAt: z.coerce.date().nullable().optional(),
    scheduledEndAt: z.coerce.date().nullable().optional(),
    isPublic: z.boolean().optional(),
    rootCause: z.string().max(5000).optional(),
    mitigation: z.string().max(5000).optional(),
    prevention: z.string().max(5000).optional(),
    customerImpact: z.string().max(5000).optional(),
    internalNotes: z.string().max(10000).optional(),
    updateMessage: z.string().max(5000).optional(),
    updateType: incidentTimelineType.optional(),
    updatePublic: z.boolean().optional(),
    deployment: z.object({
        workflow: z.string().max(160).optional(),
        conclusion: z.string().max(80).optional(),
        sha: z.string().max(80).optional(),
        url: z.string().max(500).optional(),
    }).optional(),
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
        type: incidentTimelineType.optional(),
        message: z.string().min(1).max(5000),
        public: z.boolean().optional(),
        isPublic: z.boolean().optional(),
        actor: z.string().max(160).optional(),
        deployment: z.object({
            workflow: z.string().max(160).optional(),
            conclusion: z.string().max(80).optional(),
            sha: z.string().max(80).optional(),
            url: z.string().max(500).optional(),
        }).optional(),
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
        startsAt: z.coerce.date().optional(),
        endsAt: z.coerce.date().optional(),
        publicMessage: z.string().max(5000).optional(),
        notifySubscribers: z.boolean().optional(),
    }),
});

const adminStatusIncidentPostmortemSchema = z.object({
    query: passthroughQuery,
    params: z.object({ id: objectId }),
    body: z.object({
        owner: z.string().max(160).optional(),
        dueDate: z.coerce.date().optional(),
    }).optional().default({}),
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
    adminStatusIncidentPostmortemSchema,
    statusHistorySchema,
    statusIncidentDetailSchema,
    statusSubscribeSchema,
    statusUnsubscribeSchema,
};
