const IdempotencyRecord = require('../models/IdempotencyRecord');
const { hashPayload } = require('../services/payments/helpers');
const { withIdempotency } = require('../services/payments/idempotencyService');

describe('Idempotency Service', () => {
    test('serializes concurrent identical requests and replays the settled response', async () => {
        let releaseHandler;
        let markStarted;

        const handlerStarted = new Promise((resolve) => {
            markStarted = resolve;
        });

        const handler = jest.fn(async () => {
            markStarted();
            await new Promise((resolve) => {
                releaseHandler = resolve;
            });
            return {
                statusCode: 201,
                response: { intentId: 'pi_serialized', status: 'created' },
            };
        });

        const firstCall = withIdempotency({
            key: 'idem-payment-intent-1',
            userKey: 'user-1',
            route: 'payments:create_intent',
            requestPayload: { amount: 1999, currency: 'INR' },
            handler,
        });

        await handlerStarted;

        const secondCall = withIdempotency({
            key: 'idem-payment-intent-1',
            userKey: 'user-1',
            route: 'payments:create_intent',
            requestPayload: { amount: 1999, currency: 'INR' },
            handler,
        });

        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(handler).toHaveBeenCalledTimes(1);

        releaseHandler();

        const [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);
        expect(firstResult).toMatchObject({
            replayed: false,
            statusCode: 201,
            response: { intentId: 'pi_serialized', status: 'created' },
        });
        expect(secondResult).toMatchObject({
            replayed: true,
            statusCode: 201,
            response: { intentId: 'pi_serialized', status: 'created' },
        });

        const records = await IdempotencyRecord.find({
            key: 'idem-payment-intent-1',
            user: 'user-1',
            route: 'payments:create_intent',
        }).lean();

        expect(records).toHaveLength(1);
        expect(records[0].state).toBe('completed');
        expect(records[0].lockToken).toBe('');
    });

    test('rejects payload changes for an already-completed idempotency key', async () => {
        await withIdempotency({
            key: 'idem-payload-mismatch',
            userKey: 'user-2',
            route: 'payments:create_refund',
            requestPayload: { amount: 500, reason: 'partial_refund' },
            handler: async () => ({
                statusCode: 200,
                response: { refundId: 'rfnd_1' },
            }),
        });

        await expect(withIdempotency({
            key: 'idem-payload-mismatch',
            userKey: 'user-2',
            route: 'payments:create_refund',
            requestPayload: { amount: 900, reason: 'partial_refund' },
            handler: async () => ({
                statusCode: 200,
                response: { refundId: 'rfnd_2' },
            }),
        })).rejects.toMatchObject({
            statusCode: 409,
            message: expect.stringMatching(/different payload/i),
        });
    });

    test('recovers a committed operation before reclaiming a stale processing lock', async () => {
        const requestPayload = { amount: 4400, currency: 'INR' };
        await IdempotencyRecord.create({
            key: 'idem-recover-committed',
            user: 'user-recover',
            route: 'orders:create',
            requestHash: hashPayload(requestPayload),
            state: 'processing',
            lockToken: 'stale-lock-token',
            lockExpiresAt: new Date(Date.now() - 1000),
            statusCode: 202,
            response: {},
            processedAt: new Date(Date.now() - 1000),
            expiresAt: new Date(Date.now() + 60 * 1000),
        });
        const handler = jest.fn();
        const recover = jest.fn().mockResolvedValue({
            statusCode: 201,
            response: { orderId: 'order-recovered' },
        });

        const result = await withIdempotency({
            key: 'idem-recover-committed',
            userKey: 'user-recover',
            route: 'orders:create',
            requestPayload,
            handler,
            recover,
        });

        expect(handler).not.toHaveBeenCalled();
        expect(recover).toHaveBeenCalledWith(expect.objectContaining({
            key: 'idem-recover-committed',
            userKey: 'user-recover',
            route: 'orders:create',
        }));
        expect(result).toMatchObject({
            replayed: true,
            statusCode: 201,
            response: { orderId: 'order-recovered' },
        });
        await expect(IdempotencyRecord.findOne({ key: 'idem-recover-committed' }).lean()).resolves.toMatchObject({
            state: 'completed',
            response: { orderId: 'order-recovered' },
        });
    });

    test('does not let a recovery callback clear a newer lock owner', async () => {
        const requestPayload = { amount: 5100, currency: 'INR' };
        const record = await IdempotencyRecord.create({
            key: 'idem-recover-lock-cas',
            user: 'user-recover-cas',
            route: 'orders:create',
            requestHash: hashPayload(requestPayload),
            state: 'processing',
            lockToken: 'original-lock',
            lockExpiresAt: new Date(Date.now() - 1000),
            statusCode: 202,
            response: {},
            processedAt: new Date(Date.now() - 1000),
            expiresAt: new Date(Date.now() + 60_000),
        });
        const recover = jest.fn(async ({ record: current }) => {
            await IdempotencyRecord.updateOne({ _id: current._id }, {
                $set: {
                    lockToken: 'new-owner-lock',
                    lockExpiresAt: new Date(Date.now() - 1000),
                },
            });
            return { statusCode: 201, response: { orderId: 'order-recovered-cas' } };
        });
        const handler = jest.fn(async () => ({
            statusCode: 201,
            response: { orderId: 'order-reclaimed-cas' },
        }));

        const result = await withIdempotency({
            key: 'idem-recover-lock-cas',
            userKey: 'user-recover-cas',
            route: 'orders:create',
            requestPayload,
            handler,
            recover,
        });

        expect(recover).toHaveBeenCalled();
        expect(handler).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
            replayed: false,
            response: { orderId: 'order-reclaimed-cas' },
        });
        await expect(IdempotencyRecord.findById(record._id).lean()).resolves.toMatchObject({
            state: 'completed',
            lockToken: '',
            response: { orderId: 'order-reclaimed-cas' },
        });
    });

    test('reclaims stale processing locks instead of leaving the key wedged', async () => {
        const requestPayload = { amount: 3200, currency: 'INR' };
        const staleRecord = await IdempotencyRecord.create({
            key: 'idem-stale-lock',
            user: 'user-3',
            route: 'orders:create',
            requestHash: hashPayload(requestPayload),
            state: 'processing',
            lockToken: 'stale-lock-token',
            lockExpiresAt: new Date(Date.now() - 1000),
            statusCode: 202,
            response: {},
            processedAt: new Date(Date.now() - 1000),
            expiresAt: new Date(Date.now() + 60 * 1000),
        });

        const handler = jest.fn(async () => ({
            statusCode: 201,
            response: { orderId: 'order_reclaimed' },
        }));

        const result = await withIdempotency({
            key: 'idem-stale-lock',
            userKey: 'user-3',
            route: 'orders:create',
            requestPayload,
            handler,
        });

        expect(handler).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
            replayed: false,
            statusCode: 201,
            response: { orderId: 'order_reclaimed' },
        });

        const refreshed = await IdempotencyRecord.findById(staleRecord._id).lean();
        expect(refreshed.state).toBe('completed');
        expect(refreshed.lockToken).toBe('');
        expect(refreshed.response).toMatchObject({ orderId: 'order_reclaimed' });
    });
});
