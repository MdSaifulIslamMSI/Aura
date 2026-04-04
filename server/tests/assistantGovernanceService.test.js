jest.mock('../services/intelligence/intelligenceGatewayService', () => ({
    shouldUseCentralIntelligence: jest.fn(() => false),
}));

const { shouldUseCentralIntelligence } = require('../services/intelligence/intelligenceGatewayService');
const {
    buildOrchestratorRouteDecision,
    detectRisk,
    estimateComplexity,
} = require('../services/ai/assistantGovernanceService');

describe('assistantGovernanceService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        shouldUseCentralIntelligence.mockReturnValue(false);
    });

    test('keeps low-risk shopping turns local', () => {
        const decision = buildOrchestratorRouteDecision({
            message: 'show me phones under 30000',
            assistantMode: 'chat',
            context: {},
        });

        expect(decision).toMatchObject({
            route: 'LOCAL',
            requires_confirmation: false,
        });
    });

    test('routes system-grounded turns through hybrid by default', () => {
        shouldUseCentralIntelligence.mockReturnValue(true);
        const decision = buildOrchestratorRouteDecision({
            message: 'trace checkout flow through the backend',
            assistantMode: 'chat',
            context: {},
        });

        expect(decision).toMatchObject({
            route: 'HYBRID',
            reason_summary: expect.stringMatching(/fast provisional answer/i),
        });
    });

    test('honors internal override controls without exposing them as a different contract shape', () => {
        const decision = buildOrchestratorRouteDecision({
            message: 'show me phones',
            assistantMode: 'chat',
            context: {
                forceRoute: 'CENTRAL',
                maxCost: 0.05,
                latencyBudgetMs: 4200,
                disabledTools: ['search_products'],
            },
        });

        expect(decision).toMatchObject({
            route: 'CENTRAL',
            cost_estimate: 0.05,
            latency_budget_ms: 4200,
            overrides: {
                forceRoute: 'CENTRAL',
                disabledTools: ['search_products'],
            },
        });
    });

    test('scores risky financial language higher than plain browse requests', () => {
        expect(detectRisk({ message: 'buy now and checkout' })).toBe('HIGH');
        expect(detectRisk({ message: 'show shoes' })).toBe('LOW');
        expect(estimateComplexity({ message: 'trace why checkout fails in the backend route graph' })).toBeGreaterThan(0.6);
    });
});
