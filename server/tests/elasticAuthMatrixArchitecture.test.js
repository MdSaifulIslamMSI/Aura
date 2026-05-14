const {
    buildCountReport,
    evaluateAuthCase,
    generateAuthCases,
    loadMatrix,
} = require('../../tests/auth/helpers/matrix-engine');
const { classifyFiles } = require('../../tests/auth/helpers/risk-classifier');

describe('elastic auth matrix architecture', () => {
    test('base matrix supports exactly 1,045,529,856 logical combinations', () => {
        const report = buildCountReport('level_0_base');
        expect(report.baseMatrix.logicalCeiling).toBe(1045529856);
        expect(report.selectedExpansion.logicalCeiling).toBe(1045529856);
    });

    test('auto-expand levels calculate expected logical ceilings', () => {
        const report = buildCountReport('level_4_critical');
        expect(report.expansionLevels.level_1_device.logicalCeiling).toBe(26138246400);
        expect(report.expansionLevels.level_2_risk.logicalCeiling).toBe(653456160000);
        expect(report.expansionLevels.level_3_payment_security.logicalCeiling).toBe(3267280800000);
        expect(report.expansionLevels.level_4_critical.logicalCeiling).toBe(49009212000000);
    });

    test('generated cases are deterministic by seed', () => {
        const left = generateAuthCases({ mode: 'generated', seed: 'AUTH-REPLAY-1', limit: 50, expansionLevel: 'level_2_risk' });
        const right = generateAuthCases({ mode: 'generated', seed: 'AUTH-REPLAY-1', limit: 50, expansionLevel: 'level_2_risk' });
        expect(left.cases).toEqual(right.cases);
    });

    test('auto-expanded generated cases include future dimensions only when enabled', () => {
        const base = generateAuthCases({ mode: 'generated', seed: 'AUTH-BASE', limit: 5, expansionLevel: 'level_0_base' });
        const expanded = generateAuthCases({ mode: 'critical', seed: 'AUTH-CRITICAL', limit: 5, expansionLevel: 'level_4_critical' });
        expect(base.cases[0]).not.toHaveProperty('browserTypes');
        expect(expanded.cases[0]).toHaveProperty('browserTypes');
        expect(expanded.cases[0]).toHaveProperty('behavioralRiskStates');
    });

    test('risk classifier selects critical full expansion for token and role guard changes', () => {
        const result = classifyFiles([
            'server/services/token.service.js',
            'server/middleware/role.middleware.js',
        ]);
        expect(result.riskLevel).toBe('CRITICAL');
        expect(result.autoExpandLevel).toBe('level_4_critical');
        expect(result.recommendedCommand).toBe('npm run test:auth:critical');
    });

    test('risk classifier selects payment security expansion for checkout auth boundaries', () => {
        const result = classifyFiles([
            'server/controllers/paymentController.js',
            'server/services/checkoutAuthorizationService.js',
        ]);
        expect(result.riskLevel).toBe('CRITICAL');
        expect(result.autoExpandLevel).toBe('level_3_payment_security');
    });

    test('route evaluator rejects lower roles on higher privilege routes', () => {
        const evaluation = evaluateAuthCase({
            userRoles: 'customer',
            accountStates: 'active',
            passwordCases: 'valid_password',
            emailCases: 'valid_email',
            tokenStates: 'valid_access_token',
            sessionStates: 'active_session',
            otpStates: 'correct_otp',
            deviceStates: 'known_device',
            rateLimitStates: 'normal_request',
            routeTypes: 'admin_route',
        });
        expect(evaluation.allowed).toBe(false);
        expect(evaluation.status).toBe(403);
    });

    test('matrix keeps all required dimensions present', () => {
        const matrix = loadMatrix();
        expect(matrix.userRoles).toHaveLength(6);
        expect(matrix.accountStates).toHaveLength(7);
        expect(matrix.passwordCases).toHaveLength(12);
        expect(matrix.emailCases).toHaveLength(9);
        expect(matrix.tokenStates).toHaveLength(12);
        expect(matrix.sessionStates).toHaveLength(8);
        expect(matrix.otpStates).toHaveLength(7);
        expect(matrix.deviceStates).toHaveLength(7);
        expect(matrix.rateLimitStates).toHaveLength(7);
        expect(matrix.routeTypes).toHaveLength(7);
    });
});
