jest.mock('../services/clientDiagnosticIngestionService', () => ({
    listClientDiagnostics: jest.fn().mockResolvedValue({
        diagnostics: [],
        source: 'memory',
    }),
}));

jest.mock('../services/healthService', () => ({
    checkCoreDependencies: jest.fn().mockResolvedValue({
        dbConnected: true,
        redisConnected: true,
    }),
    checkServiceReadiness: jest.fn().mockResolvedValue({
        ai: {
            intelligence: {
                healthy: true,
            },
        },
    }),
}));

jest.mock('../services/socketService', () => ({
    getSocketHealth: jest.fn().mockReturnValue({
        initialized: true,
        adapterMode: 'redis',
    }),
}));

jest.mock('../services/intelligence/knowledgeBundleService', () => ({
    getBundleVersionInfo: jest.fn().mockResolvedValue({
        bundleVersion: 'bundle-1',
        expectedCommitSha: 'bundle-1',
        stale: false,
    }),
    getFileSection: jest.fn(),
    getModelSchema: jest.fn().mockResolvedValue([]),
    getRouteContract: jest.fn().mockResolvedValue([]),
    searchCodeChunks: jest.fn().mockResolvedValue([
        {
            id: 'chunk-1',
            label: 'server/routes/aiRoutes.js:1',
            path: 'server/routes/aiRoutes.js',
            excerpt: 'router.post("/chat"...',
            startLine: 1,
            endLine: 20,
            score: 0.92,
            metadata: {
                subsystem: 'backend',
            },
        },
    ]),
    traceSystemPath: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/intelligence/intelligenceGatewayService', () => ({
    getCentralIntelligenceHealth: jest.fn().mockResolvedValue({
        healthy: true,
    }),
}));

jest.mock('../models/Order', () => ({
    findOne: jest.fn(),
}));

jest.mock('../models/SupportTicket', () => ({
    findOne: jest.fn(),
}));

const Order = require('../models/Order');
const { runInternalAiTool } = require('../services/intelligence/intelligenceToolService');

describe('intelligenceToolService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns grounded search results for search_code_chunks', async () => {
        const response = await runInternalAiTool({
            toolName: 'search_code_chunks',
            input: {
                query: 'ai routes',
            },
            authContext: {},
        });

        expect(response.result.bundleVersion.bundleVersion).toBe('bundle-1');
        expect(response.result.results[0]).toMatchObject({
            path: 'server/routes/aiRoutes.js',
        });
        expect(response.toolRun.summary).toMatch(/code evidence/i);
    });

    test('scopes order lookups to the actor when the caller is not admin', async () => {
        const chain = {
            sort: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue({
                _id: 'order-1',
                user: 'user-1',
                orderStatus: 'placed',
            }),
        };
        Order.findOne.mockReturnValue(chain);

        const response = await runInternalAiTool({
            toolName: 'get_order_summary',
            input: {},
            authContext: {
                actorUserId: 'user-1',
                isAdmin: false,
            },
        });

        expect(Order.findOne).toHaveBeenCalledWith({
            user: 'user-1',
        });
        expect(response.result.order).toMatchObject({
            _id: 'order-1',
        });
        expect(response.result.scopedToActor).toBe(true);
    });
});
