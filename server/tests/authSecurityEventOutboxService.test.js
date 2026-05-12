describe('authSecurityEventOutboxService', () => {
    const originalEnabled = process.env.AUTH_SECURITY_OUTBOX_ENABLED;

    afterEach(() => {
        process.env.AUTH_SECURITY_OUTBOX_ENABLED = originalEnabled;
        jest.resetModules();
        jest.dontMock('../models/AuthSecurityEventOutbox');
        jest.dontMock('../utils/logger');
    });

    test('builds a stable auth security event envelope shape', () => {
        const { buildAuthSecurityEventEnvelope } = require('../services/authSecurityEventOutboxService');

        const envelope = buildAuthSecurityEventEnvelope({
            event: 'login_failure',
            outcome: 'failure',
            reason: 'locked',
            surface: 'auth',
            userId: 'user-1',
            requestId: 'req-1',
            occurredAt: '2026-05-09T00:00:00.000Z',
            meta: { score: 42 },
        });

        expect(envelope).toMatchObject({
            version: 1,
            topic: 'auth.security',
            event: 'login_failure',
            outcome: 'failure',
            reason: 'locked',
            surface: 'auth',
            userId: 'user-1',
            requestId: 'req-1',
            occurredAt: '2026-05-09T00:00:00.000Z',
            meta: { score: 42 },
        });
        expect(envelope.eventId).toEqual(expect.any(String));
    });

    test('does not enqueue when the outbox is disabled', async () => {
        process.env.AUTH_SECURITY_OUTBOX_ENABLED = 'false';
        const { enqueueAuthSecurityEvent } = require('../services/authSecurityEventOutboxService');

        await expect(enqueueAuthSecurityEvent({ event: 'login_failure' })).resolves.toEqual({
            enabled: false,
            enqueued: false,
        });
    });

    test('enqueues when explicitly enabled', async () => {
        process.env.AUTH_SECURITY_OUTBOX_ENABLED = 'true';
        jest.doMock('../models/AuthSecurityEventOutbox', () => ({
            create: jest.fn().mockResolvedValue({ eventId: 'evt-1' }),
        }));

        const model = require('../models/AuthSecurityEventOutbox');
        const { enqueueAuthSecurityEvent } = require('../services/authSecurityEventOutboxService');

        await expect(enqueueAuthSecurityEvent({ event: 'login_failure' })).resolves.toMatchObject({
            enabled: true,
            enqueued: true,
            eventId: 'evt-1',
        });
        expect(model.create).toHaveBeenCalledWith(expect.objectContaining({
            topic: 'auth.security',
            status: 'pending',
            payload: expect.objectContaining({ event: 'login_failure' }),
        }));
    });
});
