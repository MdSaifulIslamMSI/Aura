const {
    isSplitRuntimeEnabled,
    shouldRunBackgroundWorkers,
    checkSplitRuntimeWorkerHealth,
} = require('../config/runtimeRoles');

describe('runtime role resolution', () => {
    test('single-process runtime always runs its own workers', () => {
        expect(isSplitRuntimeEnabled({})).toBe(false);
        expect(shouldRunBackgroundWorkers({})).toBe(true);
    });

    test('split runtime without a worker health URL keeps legacy in-process workers', () => {
        const env = { SPLIT_RUNTIME_ENABLED: 'true' };
        expect(isSplitRuntimeEnabled(env)).toBe(true);
        expect(shouldRunBackgroundWorkers(env)).toBe(true);
    });

    test('split runtime delegates workers only when the API can monitor them', () => {
        const env = { SPLIT_RUNTIME_ENABLED: 'true', WORKER_HEALTH_URL: 'http://worker:8080' };
        expect(shouldRunBackgroundWorkers(env)).toBe(false);
    });

    test('worker health probe reports no gaps when the worker is ready', async () => {
        const fetchImpl = jest.fn(async () => ({
            ok: true,
            json: async () => ({ worker: { ready: true } }),
        }));
        const gaps = await checkSplitRuntimeWorkerHealth({
            fetchImpl,
            env: { WORKER_HEALTH_URL: 'http://worker:8080' },
        });
        expect(gaps).toEqual([]);
        expect(fetchImpl).toHaveBeenCalledWith('http://worker:8080/health', expect.any(Object));
    });

    test('worker health probe fails closed on unreachable or unready worker', async () => {
        const unreachable = await checkSplitRuntimeWorkerHealth({
            fetchImpl: jest.fn(async () => { throw new Error('ECONNREFUSED'); }),
            env: { WORKER_HEALTH_URL: 'http://worker:8080' },
        });
        expect(unreachable).toEqual(['worker_process_unreachable']);

        const unready = await checkSplitRuntimeWorkerHealth({
            fetchImpl: jest.fn(async () => ({
                ok: true,
                json: async () => ({ worker: { ready: false } }),
            })),
            env: { WORKER_HEALTH_URL: 'http://worker:8080' },
        });
        expect(unready).toEqual(['worker_process_unready']);

        const missingUrl = await checkSplitRuntimeWorkerHealth({ fetchImpl: jest.fn(), env: {} });
        expect(missingUrl).toEqual(['worker_health_url_missing']);
    });
});
