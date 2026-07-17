describe('authSecurityTelemetryService', () => {
    const loadSubject = () => {
        jest.resetModules();
        jest.doMock('../utils/logger', () => ({
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        }));

        const logger = require('../utils/logger');
        const telemetry = require('../services/authSecurityTelemetryService');
        const { registry } = require('../middleware/metrics');
        return { logger, registry, telemetry };
    };

    afterEach(() => {
        jest.dontMock('../utils/logger');
    });

    test('records bounded auth security metrics and redacted structured logs', async () => {
        const { logger, registry, telemetry } = loadSubject();

        telemetry.recordAuthSecurityEvent({
            event: 'admin_access_blocked',
            outcome: 'blocked',
            reason: 'passkey_required',
            surface: 'admin',
            req: {
                requestId: 'req-admin-1',
                method: 'GET',
                originalUrl: '/api/admin/users/507f1f77bcf86cd799439011',
                headers: {},
                user: { isAdmin: true },
            },
            meta: { statusCode: 403, method: 'webauthn' },
        });

        const metrics = await registry.metrics();

        expect(metrics).toContain(
            'aura_auth_security_events_total{event="admin_access_blocked",outcome="blocked",reason="passkey",surface="admin",audience="admin",method="passkey"} 1'
        );
        expect(logger.warn).toHaveBeenCalledWith('auth.security_event', expect.objectContaining({
            audience: 'admin',
            event: 'admin_access_blocked',
            factorMethod: 'passkey',
            method: 'GET',
            outcome: 'blocked',
            path: '/api/admin/users/:id',
            reason: 'passkey',
            requestId: 'req-admin-1',
            statusCode: 403,
            surface: 'admin',
        }));
    });

    test('classifies dynamic failure reasons into low-cardinality buckets', () => {
        const { telemetry } = loadSubject();

        expect(telemetry.__private.normalizeReason('locked 15min')).toBe('locked');
        expect(telemetry.__private.normalizeReason('no_session')).toBe('missing');
        expect(telemetry.__private.normalizeReason('Device challenge session binding mismatch')).toBe('mismatch');
        expect(telemetry.__private.normalizeReason('webauthn_step_up_required')).toBe('webauthn');
        expect(telemetry.__private.normalizeReason('passkey_required')).toBe('passkey');
        expect(telemetry.__private.normalizeReason('fresh login required')).toBe('recent_auth');
        expect(telemetry.__private.normalizeReason('break glass required')).toBe('break_glass');
        expect(telemetry.__private.normalizeReason('SMTP Down')).toBe('unavailable');
        expect(telemetry.__private.normalizeReason('firebase_session_cleanup_pending')).toBe('unavailable');
        expect(telemetry.__private.normalizeReason('user_session_revoked')).toBe('revoked');
        expect(telemetry.__private.normalizeReason('something novel and verbose')).toBe('other');
    });

    test('keeps audience and factor labels on fixed allowlists', () => {
        const { telemetry } = loadSubject();

        expect(telemetry.__private.normalizeAudience('', { user: { isAdmin: true } })).toBe('admin');
        expect(telemetry.__private.normalizeAudience('', { user: { isSeller: true } })).toBe('seller');
        expect(telemetry.__private.normalizeAudience('', { authUid: 'user-id' })).toBe('public');
        expect(telemetry.__private.normalizeAudience('attacker-controlled-value')).toBe('unknown');
        expect(telemetry.__private.normalizeMethod('webauthn')).toBe('passkey');
        expect(telemetry.__private.normalizeMethod('duo_oidc')).toBe('duo');
        expect(telemetry.__private.normalizeMethod('arbitrary-factor')).toBe('unknown');
    });
});
