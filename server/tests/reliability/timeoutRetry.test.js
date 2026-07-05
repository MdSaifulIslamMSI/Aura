const { TimeoutError, withTimeout } = require('../../utils/timeout');
const {
    computeJitteredBackoffDelayMs,
    normalizeRetryOptions,
    retryWithJitter,
} = require('../../utils/retry');

describe('shared reliability timeout and retry utilities', () => {
    test('withTimeout aborts slow dependency work with a safe timeout error', async () => {
        let observedSignal = null;

        await expect(withTimeout(({ signal }) => {
            observedSignal = signal;
            expect(signal.aborted).toBe(false);
            return new Promise(() => {});
        }, {
            label: 'dependency.lookup',
            timeoutMs: 5,
        })).rejects.toMatchObject({
            name: 'TimeoutError',
            code: 'DEPENDENCY_TIMEOUT',
            label: 'dependency.lookup',
            expose: false,
        });
        expect(observedSignal.aborted).toBe(true);
    });

    test('retryWithJitter stops after the configured max attempt count', async () => {
        const attempts = [];
        const sleeps = [];
        const error = new Error('temporary outage');

        await expect(retryWithJitter(async ({ attempt }) => {
            attempts.push(attempt);
            throw error;
        }, {
            maxAttempts: 3,
            idempotent: true,
            initialDelayMs: 100,
            maxDelayMs: 500,
            jitterRatio: 0,
            sleepFn: (delayMs) => {
                sleeps.push(delayMs);
                return Promise.resolve();
            },
        })).rejects.toBe(error);

        expect(attempts).toEqual([0, 1, 2]);
        expect(sleeps).toEqual([100, 200]);
    });

    test('retryWithJitter uses bounded jittered exponential backoff', () => {
        expect(computeJitteredBackoffDelayMs({
            attempt: 1,
            initialDelayMs: 100,
            maxDelayMs: 1000,
            jitterRatio: 0.25,
            random: () => 1,
        })).toBe(250);
        expect(computeJitteredBackoffDelayMs({
            attempt: 1,
            initialDelayMs: 100,
            maxDelayMs: 1000,
            jitterRatio: 0.25,
            random: () => 0,
        })).toBe(150);
    });

    test('non-idempotent operations are not retried by default', async () => {
        const attempts = [];

        await expect(retryWithJitter(async ({ attempt }) => {
            attempts.push(attempt);
            throw new Error('do not retry mutation');
        }, {
            maxAttempts: 4,
            sleepFn: () => {
                throw new Error('sleep should not run');
            },
        })).rejects.toThrow('do not retry mutation');

        expect(attempts).toEqual([0]);
        expect(normalizeRetryOptions({ maxAttempts: 4 }).maxAttempts).toBe(1);
    });

    test('TimeoutError is safe for public dependency failure envelopes', () => {
        const error = new TimeoutError('catalog timed out', {
            label: 'catalog.search',
            timeoutMs: 2500,
        });

        expect(error).toMatchObject({
            code: 'DEPENDENCY_TIMEOUT',
            statusCode: 503,
            expose: false,
            timeoutMs: 2500,
            label: 'catalog.search',
        });
    });
});
