const { z } = require('zod');
const {
    MAX_DIAGNOSTICS_PER_REQUEST,
    listClientDiagnostics,
    persistClientDiagnostics,
} = require('../services/clientDiagnosticIngestionService');

const diagnosticEventSchema = z.object({
    id: z.string().optional(),
    type: z.string().min(1),
    severity: z.string().optional(),
    timestamp: z.string().optional(),
    route: z.string().optional(),
    sessionId: z.string().optional(),
    requestId: z.string().optional(),
    serverRequestId: z.string().optional(),
    method: z.string().optional(),
    url: z.string().optional(),
    detail: z.string().optional(),
    status: z.number().optional(),
    durationMs: z.number().optional(),
    error: z.any().optional(),
    context: z.any().optional(),
}).passthrough();

const listDiagnosticsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    type: z.string().max(120).optional(),
    severity: z.string().max(32).optional(),
    sessionId: z.string().max(120).optional(),
    requestId: z.string().max(120).optional(),
    route: z.string().max(220).optional(),
}).passthrough();

const ingestDiagnosticsSchema = z.object({
    events: z.array(diagnosticEventSchema)
        .min(1)
        .max(MAX_DIAGNOSTICS_PER_REQUEST),
});

const ingestClientDiagnostics = (req, res) => {
    const parsedPayload = ingestDiagnosticsSchema.safeParse(req.body || {});

    if (!parsedPayload.success) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid client diagnostics payload.',
            requestId: req.requestId || '',
            errors: parsedPayload.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
            })),
        });
    }

    return Promise.resolve(persistClientDiagnostics({
        events: parsedPayload.data.events,
        ingestionRequestId: req.requestId || '',
        clientSessionId: String(req.headers['x-client-session-id'] || ''),
        clientRoute: String(req.headers['x-client-route'] || ''),
        clientIp: req.ip || '',
        userAgent: req.get('user-agent') || '',
    })).then((result) => res.status(202).json({
        status: 'accepted',
        accepted: result.acceptedCount,
        persisted: result.persistedCount,
        persistenceMode: result.persistenceMode,
        requestId: req.requestId || '',
    }));
};

const getClientDiagnostics = (req, res) => {
    const parsedQuery = listDiagnosticsQuerySchema.safeParse(req.query || {});

    if (!parsedQuery.success) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid client diagnostics query.',
            requestId: req.requestId || '',
            errors: parsedQuery.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
            })),
        });
    }

    return Promise.resolve(listClientDiagnostics(parsedQuery.data)).then((result) => res.json({
        success: true,
        requestId: req.requestId || '',
        source: result.source,
        count: result.diagnostics.length,
        diagnostics: result.diagnostics,
    }));
};

module.exports = {
    getClientDiagnostics,
    ingestClientDiagnostics,
};
