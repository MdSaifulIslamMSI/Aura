const crypto = require('crypto');
const Order = require('../../models/Order');
const SupportTicket = require('../../models/SupportTicket');
const { listClientDiagnostics } = require('../clientDiagnosticIngestionService');
const { checkCoreDependencies, checkServiceReadiness } = require('../healthService');
const { getSocketHealth } = require('../socketService');
const {
    getBundleVersionInfo,
    getFileSection,
    getModelSchema,
    getRouteContract,
    searchCodeChunks,
    traceSystemPath,
} = require('./knowledgeBundleService');
const { getCentralIntelligenceHealth } = require('./intelligenceGatewayService');

const TOOL_NAMES = Object.freeze([
    'search_code_chunks',
    'get_file_section',
    'trace_system_path',
    'get_route_contract',
    'get_model_schema',
    'get_health_snapshot',
    'get_socket_health',
    'get_client_diagnostics',
    'get_order_summary',
    'get_support_summary',
]);

const safeString = (value = '') => String(value ?? '').trim();

const buildToolRun = ({
    toolName,
    input = {},
    output = {},
    startedAt = Date.now(),
    summary = '',
} = {}) => ({
    id: `${toolName}-${crypto.randomUUID()}`,
    toolName,
    status: 'completed',
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date().toISOString(),
    latencyMs: Math.max(0, Date.now() - startedAt),
    summary,
    inputPreview: input,
    outputPreview: output,
});

const assertToolName = (toolName = '') => {
    const normalized = safeString(toolName);
    if (!TOOL_NAMES.includes(normalized)) {
        throw new Error(`Unknown intelligence tool "${normalized}"`);
    }
    return normalized;
};

const requireActor = (authContext = {}) => {
    const actorUserId = safeString(authContext?.actorUserId || '');
    return {
        actorUserId,
        isAdmin: Boolean(authContext?.isAdmin),
    };
};

const runOrderSummary = async ({ input = {}, authContext = {} } = {}) => {
    const { actorUserId, isAdmin } = requireActor(authContext);
    const orderId = safeString(input?.orderId || '');

    const query = {};
    if (orderId) {
        query._id = orderId;
    }
    if (!isAdmin) {
        if (!actorUserId) {
            return {
                order: null,
                message: 'Missing actor scope for order lookup.',
            };
        }
        query.user = actorUserId;
    } else if (safeString(input?.userId || '')) {
        query.user = safeString(input.userId);
    }

    const order = await Order.findOne(query)
        .sort({ updatedAt: -1 })
        .select('_id user orderStatus totalPrice displayCurrency paymentState createdAt updatedAt orderItems shippingAddress statusTimeline')
        .lean();

    return {
        order: order || null,
        scopedToActor: !isAdmin,
    };
};

const runSupportSummary = async ({ input = {}, authContext = {} } = {}) => {
    const { actorUserId, isAdmin } = requireActor(authContext);
    const ticketId = safeString(input?.ticketId || '');

    const query = {};
    if (ticketId) {
        query._id = ticketId;
    }
    if (!isAdmin) {
        if (!actorUserId) {
            return {
                ticket: null,
                message: 'Missing actor scope for support lookup.',
            };
        }
        query.user = actorUserId;
    } else if (safeString(input?.userId || '')) {
        query.user = safeString(input.userId);
    }

    const ticket = await SupportTicket.findOne(query)
        .sort({ updatedAt: -1 })
        .select('_id user subject category status priority lastMessageAt lastMessagePreview liveCallLastStatus liveCallRequested liveCallRequestedMode liveCallLastContextLabel updatedAt createdAt')
        .lean();

    return {
        ticket: ticket || null,
        scopedToActor: !isAdmin,
    };
};

const runInternalAiTool = async ({
    toolName = '',
    input = {},
    authContext = {},
} = {}) => {
    const normalizedToolName = assertToolName(toolName);
    const startedAt = Date.now();
    const bundleVersion = await getBundleVersionInfo();

    switch (normalizedToolName) {
        case 'search_code_chunks': {
            const results = await searchCodeChunks({
                query: safeString(input?.query || ''),
                limit: Number(input?.limit || 6),
                subsystem: safeString(input?.subsystem || ''),
            });
            return {
                toolRun: buildToolRun({
                    toolName: normalizedToolName,
                    input,
                    output: {
                        resultCount: results.length,
                    },
                    startedAt,
                    summary: results.length > 0
                        ? `Found ${results.length} code evidence match${results.length === 1 ? '' : 'es'}.`
                        : 'No code evidence matches found.',
                }),
                result: {
                    bundleVersion,
                    results,
                },
            };
        }
        case 'get_file_section': {
            const section = await getFileSection({
                targetPath: safeString(input?.path || input?.targetPath || ''),
                startLine: Number(input?.startLine || 0),
                endLine: Number(input?.endLine || 0),
                aroundLine: Number(input?.aroundLine || 0),
                radius: Number(input?.radius || 12),
            });
            return {
                toolRun: buildToolRun({
                    toolName: normalizedToolName,
                    input,
                    output: {
                        path: section?.path || '',
                    },
                    startedAt,
                    summary: section ? `Loaded ${section.path}:${section.startLine}-${section.endLine}.` : 'No file section found.',
                }),
                result: {
                    bundleVersion,
                    section,
                },
            };
        }
        case 'trace_system_path': {
            const traces = await traceSystemPath({
                query: safeString(input?.query || ''),
                limit: Number(input?.limit || 4),
            });
            return {
                toolRun: buildToolRun({
                    toolName: normalizedToolName,
                    input,
                    output: {
                        traceCount: traces.length,
                    },
                    startedAt,
                    summary: traces.length > 0
                        ? `Traced ${traces.length} connected system path${traces.length === 1 ? '' : 's'}.`
                        : 'No graph trace matched the query.',
                }),
                result: {
                    bundleVersion,
                    traces,
                },
            };
        }
        case 'get_route_contract': {
            const matches = await getRouteContract({
                endpoint: safeString(input?.endpoint || ''),
            });
            return {
                toolRun: buildToolRun({
                    toolName: normalizedToolName,
                    input,
                    output: {
                        matchCount: matches.length,
                    },
                    startedAt,
                    summary: matches.length > 0
                        ? `Resolved ${matches.length} route contract match${matches.length === 1 ? '' : 'es'}.`
                        : 'No route contract matched the endpoint.',
                }),
                result: {
                    bundleVersion,
                    matches,
                },
            };
        }
        case 'get_model_schema': {
            const matches = await getModelSchema({
                modelName: safeString(input?.modelName || ''),
            });
            return {
                toolRun: buildToolRun({
                    toolName: normalizedToolName,
                    input,
                    output: {
                        matchCount: matches.length,
                    },
                    startedAt,
                    summary: matches.length > 0
                        ? `Resolved ${matches.length} model schema match${matches.length === 1 ? '' : 'es'}.`
                        : 'No model schema matched the requested name.',
                }),
                result: {
                    bundleVersion,
                    matches,
                },
            };
        }
        case 'get_health_snapshot': {
            const [core, services, intelligence] = await Promise.all([
                checkCoreDependencies(),
                checkServiceReadiness(),
                getCentralIntelligenceHealth(),
            ]);
            const result = {
                bundleVersion,
                core,
                services,
                intelligence,
            };
            return {
                toolRun: buildToolRun({
                    toolName: normalizedToolName,
                    input,
                    output: {
                        intelligenceHealthy: Boolean(intelligence?.healthy),
                    },
                    startedAt,
                    summary: 'Collected runtime health snapshot.',
                }),
                result,
            };
        }
        case 'get_socket_health': {
            const result = {
                bundleVersion,
                socketHealth: getSocketHealth(),
            };
            return {
                toolRun: buildToolRun({
                    toolName: normalizedToolName,
                    input,
                    output: {
                        adapterMode: result.socketHealth?.adapterMode || 'unknown',
                    },
                    startedAt,
                    summary: 'Collected realtime socket health.',
                }),
                result,
            };
        }
        case 'get_client_diagnostics': {
            const diagnostics = await listClientDiagnostics({
                limit: Number(input?.limit || 10),
                type: safeString(input?.type || ''),
                severity: safeString(input?.severity || ''),
                sessionId: safeString(input?.sessionId || ''),
                requestId: safeString(input?.requestId || ''),
                route: safeString(input?.route || ''),
            });
            return {
                toolRun: buildToolRun({
                    toolName: normalizedToolName,
                    input,
                    output: {
                        count: diagnostics.diagnostics.length,
                    },
                    startedAt,
                    summary: diagnostics.diagnostics.length > 0
                        ? `Collected ${diagnostics.diagnostics.length} client diagnostic event${diagnostics.diagnostics.length === 1 ? '' : 's'}.`
                        : 'No client diagnostics matched the requested filters.',
                }),
                result: {
                    bundleVersion,
                    ...diagnostics,
                },
            };
        }
        case 'get_order_summary': {
            const result = await runOrderSummary({ input, authContext });
            return {
                toolRun: buildToolRun({
                    toolName: normalizedToolName,
                    input,
                    output: {
                        hasOrder: Boolean(result.order),
                    },
                    startedAt,
                    summary: result.order
                        ? `Resolved order ${result.order._id}.`
                        : result.message || 'No order matched the request scope.',
                }),
                result: {
                    bundleVersion,
                    ...result,
                },
            };
        }
        case 'get_support_summary': {
            const result = await runSupportSummary({ input, authContext });
            return {
                toolRun: buildToolRun({
                    toolName: normalizedToolName,
                    input,
                    output: {
                        hasTicket: Boolean(result.ticket),
                    },
                    startedAt,
                    summary: result.ticket
                        ? `Resolved support ticket ${result.ticket._id}.`
                        : result.message || 'No support ticket matched the request scope.',
                }),
                result: {
                    bundleVersion,
                    ...result,
                },
            };
        }
        default:
            throw new Error(`Unsupported intelligence tool "${normalizedToolName}"`);
    }
};

module.exports = {
    TOOL_NAMES,
    runInternalAiTool,
};
