describe('uploadSecurityTelemetryService', () => {
    const loadSubject = () => {
        jest.resetModules();
        jest.doMock('../utils/logger', () => ({
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        }));

        const logger = require('../utils/logger');
        const telemetry = require('../services/uploadSecurityTelemetryService');
        const { registry } = require('../middleware/metrics');
        return { logger, registry, telemetry };
    };

    afterEach(() => {
        jest.dontMock('../utils/logger');
    });

    test('records bounded upload security metrics and structured logs', async () => {
        const { logger, registry, telemetry } = loadSubject();

        telemetry.recordUploadSecurityEvent({
            event: 'malware_blocked',
            outcome: 'blocked',
            reason: 'malware_blocked',
            purpose: 'avatar',
            meta: {
                userId: 'user-1',
                mimeType: 'image/png',
            },
        });

        const metrics = await registry.metrics();

        expect(metrics).toContain(
            'aura_upload_security_events_total{event="malware_blocked",outcome="blocked",reason="malware_blocked",purpose="avatar"} 1'
        );
        expect(logger.warn).toHaveBeenCalledWith('upload.security_event', expect.objectContaining({
            event: 'malware_blocked',
            outcome: 'blocked',
            purpose: 'avatar',
            reason: 'malware_blocked',
            mimeType: 'image/png',
        }));
    });

    test('keeps novel reasons low-cardinality', () => {
        const { telemetry } = loadSubject();

        expect(telemetry.__private.normalizeEvent('malware_blocked')).toBe('malware_blocked');
        expect(telemetry.__private.normalizeEvent('custom user supplied label')).toBe('other');
        expect(telemetry.__private.normalizeReason('malware_scan_unavailable')).toBe('malware_scan_unavailable');
        expect(telemetry.__private.normalizeReason('mime_mismatch')).toBe('mime_mismatch');
        expect(telemetry.__private.normalizeReason('very specific scanner stack trace')).toBe('other');
    });
});
