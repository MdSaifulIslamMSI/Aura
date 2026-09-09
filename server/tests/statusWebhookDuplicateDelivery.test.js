const StatusWebhookEvent = require('../models/StatusWebhookEvent');
const logger = require('../utils/logger');

// The concurrent-delivery assertions race two webhook inserts against the
// idempotencyKey unique index; sync it before the suite and give hooks
// headroom on loaded CI runners.
beforeAll(async () => {
    await StatusWebhookEvent.syncIndexes();
}, 30000);

jest.setTimeout(30000);

const { handleStatusWebhook, assertWebhookSignature } = require('../services/statusWebhookService');

const buildDelivery = (eventId) => ({
    source: 'uptime_kuma',
    rawBody: JSON.stringify({ heartbeat: { id: eventId, status: 1 }, monitor: { name: 'no-such-monitor' } }),
    payload: { heartbeat: { id: eventId, status: 1 }, monitor: { name: 'no-such-monitor' } },
    req: { get: () => null, ip: '127.0.0.1' },
});

describe('status webhook duplicate delivery resilience', () => {
    beforeEach(() => {
        jest.spyOn(logger, 'warn').mockImplementation(() => {});
        jest.spyOn(logger, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('concurrent deliveries of the same eventId both resolve with exactly one processed', async () => {
        const eventId = `evt_status_race_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const delivery = buildDelivery(eventId);

        const [first, second] = await Promise.allSettled([
            handleStatusWebhook(delivery),
            handleStatusWebhook(delivery),
        ]);

        // Before the fix, the losing create surfaced E11000 as a 500 to the
        // monitor provider instead of a duplicate acknowledgement.
        expect(first.status).toBe('fulfilled');
        expect(second.status).toBe('fulfilled');

        const results = [first.value, second.value];
        expect(results.filter((result) => result.duplicate === true)).toHaveLength(1);
        expect(results.filter((result) => result.processed === true)).toHaveLength(1);

        const events = await StatusWebhookEvent.find({ idempotencyKey: `uptime_kuma:${eventId}` }).lean();
        expect(events).toHaveLength(1);
        expect(events[0].eventId).toBe(eventId);
    });

    test('sequential redelivery is acknowledged as a duplicate', async () => {
        const eventId = `evt_status_seq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const first = await handleStatusWebhook(buildDelivery(eventId));
        const second = await handleStatusWebhook(buildDelivery(eventId));

        expect(first.processed).toBe(true);
        expect(second.duplicate).toBe(true);

        const events = await StatusWebhookEvent.find({ idempotencyKey: `uptime_kuma:${eventId}` }).lean();
        expect(events).toHaveLength(1);
        expect(events[0].hitCount).toBe(2);
    });
});

describe('alertmanager webhook authentication', () => {
    const makeReq = (headers) => ({
        get: (name) => headers[String(name).toLowerCase()] ?? null,
        ip: '127.0.0.1',
    });

    afterEach(() => {
        delete process.env.STATUS_WEBHOOK_TOKEN;
        delete process.env.STATUS_WEBHOOK_SECRET;
    });

    test('alertmanager source authenticates with the shared bearer token', () => {
        process.env.STATUS_WEBHOOK_TOKEN = 'shared-status-token';
        expect(() => assertWebhookSignature({
            source: 'alertmanager',
            req: makeReq({ authorization: 'Bearer shared-status-token' }),
            rawBody: '{"status":"firing"}',
        })).not.toThrow();
    });

    test('alertmanager source still requires a valid HMAC signature without a bearer match', () => {
        process.env.STATUS_WEBHOOK_TOKEN = 'shared-status-token';
        expect(() => assertWebhookSignature({
            source: 'alertmanager',
            req: makeReq({
                authorization: 'Bearer wrong-token',
                'x-aura-timestamp': String(Date.now()),
                'x-aura-signature': 'not-a-valid-signature',
            }),
            rawBody: '{"status":"firing"}',
        })).toThrow(/signature is invalid/i);
    });
});
