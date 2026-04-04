jest.mock('../services/intelligence/knowledgeBundleService', () => ({
    getBundleVersionInfo: jest.fn(),
    listGroundingSources: jest.fn().mockResolvedValue([]),
}));

const { getBundleVersionInfo } = require('../services/intelligence/knowledgeBundleService');
const {
    requestCentralIntelligenceTurn,
    shouldUseCentralIntelligence,
    streamCentralIntelligenceTurn,
} = require('../services/intelligence/intelligenceGatewayService');

describe('intelligenceGatewayService', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = {
            ...originalEnv,
            INTELLIGENCE_SERVICE_URL: 'http://localhost:8100',
            CENTRAL_INTELLIGENCE_MODE: 'hybrid',
            INTELLIGENCE_PROVIDER: 'google_gemini',
            INTELLIGENCE_REASONING_MODEL: 'gemma-4-31b-it',
            INTELLIGENCE_ROUTING_MODEL: 'gemma-4-31b-it',
        };
        getBundleVersionInfo.mockResolvedValue({
            bundleVersion: 'bundle-1',
            expectedCommitSha: 'bundle-1',
            stale: false,
        });
    });

    afterEach(() => {
        process.env = originalEnv;
        jest.clearAllMocks();
        delete global.fetch;
    });

    test('routes system-aware requests in hybrid mode', () => {
        expect(shouldUseCentralIntelligence({
            message: 'Explain the backend route and service flow for support video',
            assistantMode: 'chat',
            context: {},
        })).toBe(true);
        expect(shouldUseCentralIntelligence({
            message: 'show me phones under 30000',
            assistantMode: 'chat',
            context: {},
        })).toBe(false);
    });

    test('routes explicit repo file and endpoint questions in hybrid mode', () => {
        expect(shouldUseCentralIntelligence({
            message: 'Explain qdrant_store.py',
            assistantMode: 'chat',
            context: {},
        })).toBe(true);
        expect(shouldUseCentralIntelligence({
            message: 'Open server/services/intelligence/intelligenceGatewayService.js',
            assistantMode: 'chat',
            context: {},
        })).toBe(true);
        expect(shouldUseCentralIntelligence({
            message: 'What handles /api/ai/chat?',
            assistantMode: 'chat',
            context: {},
        })).toBe(true);
    });

    test('returns a safe refusal when the knowledge bundle is stale', async () => {
        getBundleVersionInfo.mockResolvedValue({
            bundleVersion: 'bundle-old',
            expectedCommitSha: 'bundle-new',
            stale: true,
        });

        const result = await requestCentralIntelligenceTurn({
            user: null,
            message: 'Trace checkout end to end',
            conversationHistory: [],
            assistantMode: 'chat',
            context: {},
            images: [],
            session: {},
        });

        expect(result.assistantTurn.verification).toMatchObject({
            label: 'cannot_verify',
        });
        expect(result.answer).toMatch(/cannot verify app-specific details/i);
        expect(result.grounding).toMatchObject({
            status: 'cannot_verify',
            reason: 'stale_bundle',
            staleBundle: true,
            missingEvidence: false,
        });
        expect(global.fetch).toBeUndefined();
    });

    test('allows stale repo-hint requests to reach central intelligence', async () => {
        getBundleVersionInfo.mockResolvedValue({
            bundleVersion: 'bundle-old',
            expectedCommitSha: 'bundle-new',
            stale: true,
        });

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: jest.fn().mockResolvedValue(JSON.stringify({
                answer: 'The live workspace shows repo-hint routing in intelligenceGatewayService.js.',
                assistantTurn: {
                    response: 'The live workspace shows repo-hint routing in intelligenceGatewayService.js.',
                    citations: [
                        {
                            id: 'workspace:server/services/intelligence/intelligenceGatewayService.js:20',
                            label: 'server/services/intelligence/intelligenceGatewayService.js:20',
                            path: 'server/services/intelligence/intelligenceGatewayService.js',
                            type: 'code',
                            startLine: 20,
                            endLine: 40,
                            score: 0.94,
                            metadata: {},
                        },
                    ],
                    toolRuns: [
                        {
                            id: 'search-live',
                            toolName: 'search_code_chunks',
                            status: 'completed',
                            startedAt: '',
                            endedAt: '',
                            latencyMs: 1,
                            summary: 'Found workspace evidence.',
                            inputPreview: {},
                            outputPreview: {
                                store: 'workspace',
                            },
                        },
                    ],
                    verification: {
                        label: 'app_grounded',
                        confidence: 0.91,
                        summary: 'Verified against live repo source files because the indexed bundle is stale.',
                        evidenceCount: 1,
                    },
                    answerMode: 'app_grounded',
                },
                grounding: {
                    mode: 'app_grounded',
                    status: 'verified',
                    reason: 'stale_bundle_live_repo_fallback',
                    staleBundle: true,
                    missingEvidence: false,
                    evidenceCount: 1,
                    bundleVersion: 'workspace-live',
                    traceId: 'trace-live-repo',
                    sources: [
                        {
                            label: 'server/services/intelligence/intelligenceGatewayService.js:20',
                            path: 'server/services/intelligence/intelligenceGatewayService.js',
                            type: 'code',
                        },
                    ],
                },
                provider: {
                    name: 'gemma-central-intelligence',
                    model: 'google/gemma-4-31B-it:novita',
                },
                latencyMs: 32,
            })),
        });

        const result = await requestCentralIntelligenceTurn({
            user: null,
            message: 'Explain intelligenceGatewayService.js',
            conversationHistory: [],
            assistantMode: 'chat',
            context: {},
            images: [],
            session: {},
            traceId: 'trace-governed',
            decisionId: 'decision-governed',
            governanceContext: {
                route: 'HYBRID',
                latencyBudgetMs: 4500,
                maxCost: 0.15,
                disabledTools: ['get_socket_health'],
            },
        });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [, options] = global.fetch.mock.calls[0];
        const payload = JSON.parse(options.body);
        expect(payload.traceId).toBe('trace-governed');
        expect(payload.decisionId).toBe('decision-governed');
        expect(payload.governanceContext).toMatchObject({
            route: 'HYBRID',
            latencyBudgetMs: 4500,
            maxCost: 0.15,
            disabledTools: ['get_socket_health'],
        });
        expect(payload.providerConfig.allowStaleWorkspaceFallback).toBe(true);
        expect(payload.providerConfig.endpointProvider).toBe('google_gemini');
        expect(payload.providerConfig.reasoningModel).toBe('gemma-4-31b-it');
        expect(payload.providerConfig.routingModel).toBe('gemma-4-31b-it');
        expect(result.answer).toMatch(/live workspace/i);
        expect(result.grounding).toMatchObject({
            status: 'verified',
            staleBundle: true,
            bundleVersion: 'workspace-live',
        });
        expect(result.evidenceEnvelope).toMatchObject({
            verified: true,
        });
    });

    test('streams token events and normalizes the final streamed reply', async () => {
        const encoder = new TextEncoder();
        const frames = [
            'event: token\ndata: {"text":"Hel"}\n\n',
            'event: token\ndata: {"text":"lo"}\n\n',
            'event: verification\ndata: {"label":"app_grounded","confidence":0.9,"summary":"Verified against indexed app evidence.","evidenceCount":1}\n\n',
            'event: final_turn\ndata: {"answer":"Hello","assistantTurn":{"response":"Hello","citations":[{"id":"c1","label":"server/app.js:10","path":"server/app.js","type":"code","startLine":10,"endLine":20,"score":1,"metadata":{}}],"toolRuns":[],"verification":{"label":"app_grounded","confidence":0.9,"summary":"Verified against indexed app evidence.","evidenceCount":1},"answerMode":"app_grounded"},"grounding":{"mode":"app_grounded","bundleVersion":"bundle-1","traceId":"trace-stream","sources":[{"label":"server/app.js:10","path":"server/app.js","type":"code"}]},"provider":{"name":"gemma-central-intelligence","model":"google/gemma-4-31B-it:novita"},"latencyMs":42}\n\n',
        ];
        let index = 0;

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            body: {
                getReader: () => ({
                    read: jest.fn().mockImplementation(async () => {
                        if (index >= frames.length) {
                            return {
                                done: true,
                                value: undefined,
                            };
                        }

                        const value = encoder.encode(frames[index]);
                        index += 1;
                        return {
                            done: false,
                            value,
                        };
                    }),
                }),
            },
        });

        const writeEvent = jest.fn();
        const result = await streamCentralIntelligenceTurn({
            user: null,
            message: 'Explain checkout flow',
            conversationHistory: [],
            assistantMode: 'chat',
            context: {},
            images: [],
            session: {},
            writeEvent,
        });

        expect(writeEvent).toHaveBeenNthCalledWith(1, 'token', { text: 'Hel' });
        expect(writeEvent).toHaveBeenNthCalledWith(2, 'token', { text: 'lo' });
        expect(writeEvent).toHaveBeenNthCalledWith(3, 'verification', expect.objectContaining({
            label: 'app_grounded',
        }));
        expect(result.assistantTurn.response).toBe('Hello');
        expect(result.grounding).toMatchObject({
            mode: 'app_grounded',
            bundleVersion: 'bundle-1',
        });
        expect(result.providerInfo).toMatchObject({
            model: 'google/gemma-4-31B-it:novita',
        });
    });
});
