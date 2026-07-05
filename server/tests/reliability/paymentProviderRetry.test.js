const {
    retryWithBackoff,
    withProviderTimeout,
} = require('../../services/payments/foundation/providerContract');

describe('payment provider retry reliability', () => {
    beforeEach(() => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('retryWithBackoff applies jitter before retrying provider calls', async () => {
        const sleeps = [];
        let attempts = 0;

        await expect(retryWithBackoff(async () => {
            attempts += 1;
            if (attempts < 2) throw new Error('temporary provider outage');
            return 'ok';
        }, {
            retries: 1,
            initialDelayMs: 100,
            maxDelayMs: 1000,
            jitterRatio: 0.25,
            random: () => 1,
            sleepFn: (delayMs) => {
                sleeps.push(delayMs);
                return Promise.resolve();
            },
        })).resolves.toBe('ok');

        expect(attempts).toBe(2);
        expect(sleeps).toEqual([125]);
    });

    test('withProviderTimeout does not retry non-idempotent mutations by default', async () => {
        let attempts = 0;
        const operation = jest.fn(async () => {
            attempts += 1;
            const error = new Error('provider unavailable');
            error.statusCode = 503;
            throw error;
        });

        await expect(withProviderTimeout('test-provider', 'capture', operation, {
            timeoutMs: 500,
            retries: 3,
        })).rejects.toThrow('provider unavailable');

        expect(attempts).toBe(1);
    });

    test('withProviderTimeout retries idempotent provider mutations with safe backoff', async () => {
        let attempts = 0;
        const operation = jest.fn(async () => {
            attempts += 1;
            if (attempts < 2) {
                const error = new Error('provider throttled');
                error.statusCode = 503;
                throw error;
            }
            return { status: 'ok' };
        });

        await expect(withProviderTimeout('test-provider', 'refund', operation, {
            timeoutMs: 500,
            retries: 2,
            retryDelayMs: 1,
            idempotencyKey: 'refund-1',
        })).resolves.toEqual({ status: 'ok' });

        expect(attempts).toBe(2);
    });
});
