const {
    evaluateAuthCase,
    generateAuthCases,
} = require('../../tests/auth/helpers/matrix-engine');

describe('elastic auth security properties', () => {
    test('invalid credentials do not authenticate across generated cases', () => {
        const batch = generateAuthCases({ mode: 'security', seed: 'AUTH-PROPERTY-CREDENTIALS', limit: 1000, expansionLevel: 'level_1_device' });
        for (const authCase of batch.cases) {
            const invalidPassword = !['valid_password', 'unicode_password', 'special_char_password'].includes(authCase.passwordCases);
            const invalidEmail = !['valid_email', 'uppercase_email', 'mixedcase_email', 'leading_trailing_space', 'unicode_email'].includes(authCase.emailCases);
            if (!invalidPassword && !invalidEmail) continue;
            const result = evaluateAuthCase(authCase);
            if (authCase.routeTypes !== 'public_route') {
                expect(result.allowed).toBe(false);
            }
            expect(result.expectedResponsePrivacy.genericCredentialError).toBe(true);
        }
    });

    test('tampered, expired, malformed, wrong-secret, and missing access tokens never authorize protected routes', () => {
        const tokenStates = [
            'expired_access_token',
            'malformed_access_token',
            'tampered_access_token',
            'missing_access_token',
            'token_signed_with_wrong_secret',
            'token_without_required_claims',
        ];
        for (const tokenState of tokenStates) {
            const result = evaluateAuthCase({
                userRoles: 'admin',
                accountStates: 'active',
                passwordCases: 'valid_password',
                emailCases: 'valid_email',
                tokenStates: tokenState,
                sessionStates: 'active_session',
                otpStates: 'correct_otp',
                deviceStates: 'known_device',
                rateLimitStates: 'normal_request',
                routeTypes: 'admin_route',
            });
            expect(result.allowed).toBe(false);
            expect(result.status).toBe(401);
        }
    });

    test('disabled, deleted, locked, reset-required, and MFA-required accounts do not access protected routes', () => {
        const accountStates = ['disabled', 'deleted', 'locked', 'password_reset_required', 'mfa_required'];
        for (const accountState of accountStates) {
            const result = evaluateAuthCase({
                userRoles: 'customer',
                accountStates: accountState,
                passwordCases: 'valid_password',
                emailCases: 'valid_email',
                tokenStates: 'valid_access_token',
                sessionStates: 'active_session',
                otpStates: 'correct_otp',
                deviceStates: 'known_device',
                rateLimitStates: 'normal_request',
                routeTypes: 'authenticated_customer_route',
            });
            expect(result.allowed).toBe(false);
            expect(result.status).toBe(401);
        }
    });

    test('high-risk device, fraud, payment, and behavior states require reauthentication', () => {
        const batch = generateAuthCases({ mode: 'critical', seed: 'AUTH-PROPERTY-REAUTH', limit: 1000, expansionLevel: 'level_4_critical' });
        const reauthCases = batch.cases.filter((authCase) => (
            ['suspicious_device', 'vpn_like_ip', 'impossible_travel_pattern'].includes(authCase.deviceStates) ||
            ['high', 'critical'].includes(authCase.fraudScoreLevels) ||
            ['saved_card_access', 'checkout_attempt', 'refund_attempt', 'high_value_order'].includes(authCase.paymentRiskStates) ||
            ['bot_like_pattern', 'account_takeover_pattern'].includes(authCase.behavioralRiskStates)
        ));
        expect(reauthCases.length).toBeGreaterThan(0);
        for (const authCase of reauthCases.slice(0, 200)) {
            const result = evaluateAuthCase({ ...authCase, routeTypes: 'authenticated_customer_route' });
            expect(result.allowed).toBe(false);
            expect(result.requiresReauth).toBe(true);
        }
    });

    test('sensitive auth fields are never part of allowed response privacy contract', () => {
        const result = evaluateAuthCase({
            userRoles: 'customer',
            accountStates: 'active',
            passwordCases: 'valid_password',
            emailCases: 'valid_email',
            tokenStates: 'valid_access_token',
            sessionStates: 'active_session',
            otpStates: 'correct_otp',
            deviceStates: 'known_device',
            rateLimitStates: 'normal_request',
            routeTypes: 'authenticated_customer_route',
        });
        expect(result.expectedResponsePrivacy.sensitiveFieldsNeverReturned).toEqual([
            'password',
            'passwordHash',
            'resetToken',
            'otp',
            'refreshTokenHash',
        ]);
    });
});
